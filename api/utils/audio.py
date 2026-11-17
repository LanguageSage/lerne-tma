import os
import re
import hashlib
import edge_tts
import logging
from uuid import uuid4

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

MAX_AUDIO_BYTES = 20 * 1024 * 1024


def validate_audio_upload(data):
    """Validate complete PCM WAV or MPEG Layer III frames, independent of MIME/name."""
    import io
    import wave
    if not data or len(data) > MAX_AUDIO_BYTES:
        raise ValueError('Audio file is empty or exceeds 20 MiB')
    if data.startswith(b'RIFF'):
        try:
            if data[8:12] != b'WAVE' or int.from_bytes(data[4:8], 'little') + 8 != len(data):
                raise ValueError('Invalid WAV container size')
            with wave.open(io.BytesIO(data)) as audio:
                frames, channels, width = audio.getnframes(), audio.getnchannels(), audio.getsampwidth()
                if not frames or channels not in (1, 2) or width not in (1, 2, 3, 4) or not 8000 <= audio.getframerate() <= 192000:
                    raise ValueError('Unsupported PCM WAV parameters')
                if len(audio.readframes(frames)) != frames * channels * width:
                    raise ValueError('Truncated WAV audio')
            return 'audio/wav'
        except (wave.Error, EOFError) as exc:
            raise ValueError('Invalid PCM WAV audio') from exc
    offset, end, count, stream = 0, len(data), 0, None
    if data.startswith(b'ID3'):
        if len(data) < 10 or data[3] not in (2, 3, 4) or any(b & 0x80 for b in data[6:10]):
            raise ValueError('Invalid MP3 ID3 tag')
        offset = 10 + sum(b << shift for b, shift in zip(data[6:10], (21, 14, 7, 0)))
        if data[3] == 4 and data[5] & 0x10:
            offset += 10
    if data[-128:-125] == b'TAG':
        end -= 128
    while offset + 4 <= end:
        a, b, c, _ = data[offset:offset + 4]
        version, layer, rate, sample = (b >> 3) & 3, (b >> 1) & 3, c >> 4, (c >> 2) & 3
        if a != 255 or b & 0xe0 != 0xe0 or version == 1 or layer != 1 or rate in (0, 15) or sample == 3:
            raise ValueError('Invalid MP3 frame')
        signature = (version, sample)
        if stream is not None and stream != signature:
            raise ValueError('Inconsistent MP3 stream')
        stream = signature
        rates = (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320) if version == 3 else (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160)
        frequency = (44100, 48000, 32000)[sample] // (1 if version == 3 else 2 if version == 2 else 4)
        length = (144000 if version == 3 else 72000) * rates[rate] // frequency + ((c >> 1) & 1)
        offset += length
        count += 1
    if offset != end or count < 2:
        raise ValueError('Unsupported or truncated audio. Use MP3 or PCM WAV')
    return 'audio/mpeg'


async def generate_audio(text, voice=None, rate="+0%", output_dir=None, with_boundaries=False, force=False):
    """
    Генератор аудио. Возвращает:
      - (path_or_url, None)              при with_boundaries=False
      - (path_or_url, word_boundaries)   при with_boundaries=True

    word_boundaries — список словарей вида:
        [{"word": "Hallo", "start": 0.05, "end": 0.42}, ...]
    где start/end — время в секундах от начала аудио.
    """
    from api.local_runtime import is_local
    if is_local():
        raise RuntimeError('TTS is unavailable in LOCAL')
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
    audio_snapshot = None

    already_cached = not force and os.path.exists(abs_filepath) and os.path.getsize(abs_filepath) > 0

    if already_cached and not with_boundaries:
        # Fast path: file is cached, boundaries not requested
        pass
    else:
        temporary = abs_filepath + '.' + uuid4().hex + '.partial'
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
                    return None, None

                with open(temporary, "wb") as f:
                    f.write(audio_bytes)

                word_boundaries = _parse_boundaries(boundaries_raw)
            else:
                # Simple save — no boundary tracking needed
                if not already_cached:
                    await communicate.save(temporary)

            if not os.path.isfile(temporary) or not os.path.getsize(temporary):
                return None, None
            # Upload this synthesis, even if another process publishes the same
            # cache filename between our replace and the upload coroutine.
            with open(temporary, 'rb') as generated:
                audio_snapshot = generated.read()
            os.replace(temporary, abs_filepath)

            if not os.path.exists(abs_filepath) or os.path.getsize(abs_filepath) == 0:
                logger.error("Edge TTS generated an empty file or file not found")
                return None, None

        except Exception as e:
            logger.error(f"Edge TTS Generation Error: {e}", exc_info=True)
            raise e
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    # --- Облачная часть (Supabase Storage) ---
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_KEY")

    if not supabase_url or not supabase_key or "your_project_url_here" in supabase_url:
        raise RuntimeError("Supabase Storage is not configured for audio")
    cloud_url = await _upload_to_supabase(audio_snapshot if audio_snapshot is not None else abs_filepath, filename, supabase_url, supabase_key)
    if not cloud_url:
        raise RuntimeError("Audio upload to Supabase Storage failed")
    logger.info("Audio uploaded to cloud: %s", cloud_url)
    return cloud_url, word_boundaries


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


_supabase_http_session = None


async def _get_supabase_session():
    global _supabase_http_session
    import aiohttp
    if _supabase_http_session is None or _supabase_http_session.closed:
        timeout = aiohttp.ClientTimeout(total=15, connect=5)
        _supabase_http_session = aiohttp.ClientSession(timeout=timeout)
    return _supabase_http_session


async def _upload_to_supabase(file_path_or_bytes, filename, project_url, api_key, media_type='audio/mpeg'):
    """Загрузка файла или байтов в Supabase Storage через REST API (async)."""
    bucket = "audio"
    project_url = project_url.rstrip("/")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "x-upsert": "false",
        "Content-Type": media_type
    }

    try:
        if isinstance(file_path_or_bytes, (bytes, bytearray)):
            data = file_path_or_bytes
        else:
            with open(file_path_or_bytes, "rb") as f:
                data = f.read()

        if not data or len(data) > MAX_AUDIO_BYTES:
            return None
        # Different synthesis bytes must never overwrite an already attached
        # object, even for force regeneration of the same text/voice cache key.
        digest = hashlib.sha256(data).hexdigest()
        filename = 'audio_' + digest + ('.wav' if media_type == 'audio/wav' else '.mp3')
        upload_url = f"{project_url}/storage/v1/object/{bucket}/{filename}"
        public_url = f"{project_url}/storage/v1/object/public/{bucket}/{filename}"

        session = await _get_supabase_session()
        async with session.post(upload_url, headers=headers, data=data, allow_redirects=False) as resp:
            if resp.status not in (200, 201, 400, 409):
                logger.error('Audio Storage upload failed: HTTP %s', resp.status)
                return None
        # Duplicate replies and successful POST alike require byte evidence.
        # One bounded GET per upload; no HEAD + GET and no retry loop.
        async with session.get(public_url, allow_redirects=False) as resp:
            if resp.status != 200:
                logger.error('Audio Storage verification failed: HTTP %s', resp.status)
                return None
            observed = hashlib.sha256()
            size = 0
            async for block in resp.content.iter_chunked(65536):
                size += len(block)
                if size > len(data):
                    return None
                observed.update(block)
            if size != len(data) or observed.hexdigest() != digest:
                logger.error('Audio Storage SHA-256 verification failed')
                return None
        return public_url
    except Exception:
        logger.error('Audio Storage request failed; upload is not confirmed')
        return None





def _strip_markdown(text):
    if not text:
        return ''
    res = text.replace('**', '').replace('__', '').replace('`', '').replace('*', '').replace('_', '')
    res = res.replace('<center>', '').replace('</center>', '').replace('<large>', '').replace('</large>', '')
    import unicodedata
    res = ''.join(ch for ch in res if unicodedata.category(ch)[0] != 'C')
    return res.replace('‑', '-').replace('–', '-').replace('—', '-').strip()


def _prepare_tts_text(text, max_chars=900):
    """Prepare already authored V2 speech; literal bracket/directive text stays literal."""
    if not text:
        return ''
    res = re.sub(r'https?://\S+', '', _strip_markdown(text))
    res = re.sub(r'\s+', ' ', res).strip()
    if len(res) <= max_chars:
        return res
    trimmed = res[:max_chars].rsplit(' ', 1)[0].strip()
    return trimmed or res[:max_chars].strip()
