import os
import re
import hashlib
import asyncio
import edge_tts
import logging
import requests
from pathlib import Path

# Настройка логирования
logger = logging.getLogger(__name__)

DEFAULT_VOICE = "de-DE-KatjaNeural"

SUPPORTED_VOICES = {
    "de_f_katja": "de-DE-KatjaNeural",
    "de_m_conrad": "de-DE-ConradNeural",
    "de_f_amala": "de-DE-AmalaNeural",
    "ru_f_svetlana": "ru-RU-SvetlanaNeural",
    "ru_m_dmitry": "ru-RU-DmitryNeural",
    "en_f_aria": "en-US-AriaNeural",
    "en_m_guy": "en-US-GuyNeural"
}

# Наносекундный делитель для перевода offset Edge TTS → секунды.
# Edge TTS возвращает audio_offset в единицах 100 нс.
_OFFSET_TO_SECONDS = 10_000_000


async def generate_audio(text, voice=None, rate="+0%", output_dir=None, with_boundaries=False):
    """
    Генератор аудио. Возвращает:
      - (path_or_url, None)              при with_boundaries=False
      - (path_or_url, word_boundaries)   при with_boundaries=True

    word_boundaries — список словарей вида:
        [{"word": "Hallo", "start": 0.05, "end": 0.42}, ...]
    где start/end — время в секундах от начала аудио.
    """
    clean_text = _prepare_tts_text(text)
    if not clean_text:
        raise ValueError("Text is empty after cleanup")

    if voice:
        voice = SUPPORTED_VOICES.get(voice, voice)

    voice = voice or DEFAULT_VOICE

    if not output_dir:
        if os.environ.get("VERCEL"):
            output_dir = "/tmp/pending_audio"
        else:
            output_dir = os.path.join(os.getcwd(), "user_files", "pending_audio")

    os.makedirs(output_dir, exist_ok=True)

    file_data = f"{clean_text}_{voice}_{rate}"
    file_hash = hashlib.md5(file_data.encode("utf-8")).hexdigest()
    filename = f"edge_audio_{file_hash}.mp3"
    abs_filepath = os.path.join(output_dir, filename)

    word_boundaries = None

    already_cached = os.path.exists(abs_filepath) and os.path.getsize(abs_filepath) > 0

    if already_cached and not with_boundaries:
        # Fast path: file is cached, boundaries not requested
        pass
    else:
        logger.info(f"Generating audio for text: {clean_text[:50]}...")
        try:
            communicate = edge_tts.Communicate(clean_text, voice, rate=rate)

            if with_boundaries:
                # Stream and collect both audio bytes and word boundary events
                audio_chunks = []
                boundaries_raw = []

                async for event in communicate.stream():
                    if event["type"] == "audio":
                        audio_chunks.append(event["data"])
                    elif event["type"] == "WordBoundary":
                        boundaries_raw.append(event)

                audio_bytes = b"".join(audio_chunks)
                if not audio_bytes:
                    logger.error("Edge TTS streamed empty audio")
                    return abs_filepath, None

                with open(abs_filepath, "wb") as f:
                    f.write(audio_bytes)

                word_boundaries = _parse_boundaries(boundaries_raw)
            else:
                # Simple save — no boundary tracking needed
                if not already_cached:
                    await communicate.save(abs_filepath)

            if not os.path.exists(abs_filepath) or os.path.getsize(abs_filepath) == 0:
                logger.error("Edge TTS generated an empty file or file not found")
                return None, None

        except Exception as e:
            logger.error(f"Edge TTS Generation Error: {e}", exc_info=True)
            raise e

    # --- Облачная часть (Supabase Storage) ---
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_KEY")

    if supabase_url and supabase_key and "your_project_url_here" not in supabase_url:
        try:
            cloud_url = await _upload_to_supabase(abs_filepath, filename, supabase_url, supabase_key)
            if cloud_url:
                logger.info(f"Audio uploaded to cloud: {cloud_url}")
                return cloud_url, word_boundaries
        except Exception as e:
            logger.warning(f"Failed to upload to cloud storage, falling back to DB: {e}")

    return abs_filepath, word_boundaries


def _parse_boundaries(raw_events):
    """
    Converts Edge TTS WordBoundary events into a clean list of
    { word, start, end } dicts with times in seconds.
    """
    if not raw_events:
        return []

    result = []
    for i, ev in enumerate(raw_events):
        word = ev.get("text", "")
        # audio_offset: start in 100-ns units
        start_sec = ev.get("audio_offset", 0) / _OFFSET_TO_SECONDS
        # duration: in 100-ns units (may be absent in some versions)
        duration_100ns = ev.get("duration", 0)
        if duration_100ns:
            end_sec = start_sec + duration_100ns / _OFFSET_TO_SECONDS
        elif i + 1 < len(raw_events):
            # Estimate end from next word's start
            end_sec = raw_events[i + 1].get("audio_offset", 0) / _OFFSET_TO_SECONDS
        else:
            end_sec = start_sec + 0.4  # fallback

        result.append({
            "word": word,
            "start": round(start_sec, 4),
            "end": round(end_sec, 4),
        })

    return result


async def _upload_to_supabase(file_path, filename, project_url, api_key):
    """Загрузка файла в Supabase Storage через REST API (async)."""
    import aiohttp
    bucket = "tma-audio"
    project_url = project_url.rstrip("/")
    upload_url = f"{project_url}/storage/v1/object/{bucket}/{filename}"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "x-upsert": "true"
    }

    try:
        with open(file_path, "rb") as f:
            data = f.read()

        async with aiohttp.ClientSession() as session:
            async with session.post(upload_url, headers=headers, data=data) as resp:
                if resp.status in [200, 201]:
                    return f"{project_url}/storage/v1/object/public/{bucket}/{filename}"
                else:
                    error_text = await resp.text()
                    logger.error(f"Supabase Upload Error ({resp.status}): {error_text}")
                    return None
    except Exception as e:
        logger.error(f"Supabase Storage Exception: {e}")
        return None


def _clean_bracket_syntax(t):
    if not t:
        return ""

    def _repl(m):
        raw = m.group(1)
        parts = [p.strip() for p in re.split(r"[|;,/]", raw) if p.strip()]
        if not parts:
            return ""
        correct = next((p for p in parts if p.startswith("*")), parts[0])
        return re.sub(r"^\*", "", correct).strip()

    return re.sub(r"\{([^}]+)\}", _repl, t)


def _strip_markdown(text):
    if not text:
        return ""
    res = _clean_bracket_syntax(text)
    res = res.replace("**", "").replace("__", "").replace("`", "").replace("*", "").replace("_", "")
    res = res.replace("<center>", "").replace("</center>", "").replace("<large>", "").replace("</large>", "")
    res = re.sub(r"\{\{.*?\}\}", "", res)
    res = re.sub(r"\[\[.*?\]\]", "", res)
    import unicodedata
    res = "".join(ch for ch in res if unicodedata.category(ch)[0] != "C")
    res = res.replace("\u2011", "-").replace("\u2013", "-").replace("\u2014", "-")
    return res.strip()


def _prepare_tts_text(text, max_chars=900):
    res = _strip_markdown(text)
    res = re.sub(r"https?://\S+", "", res)
    res = re.sub(r"\s+", " ", res).strip()
    if len(res) <= max_chars:
        return res
    trimmed = res[:max_chars].rsplit(" ", 1)[0].strip()
    return trimmed or res[:max_chars].strip()
