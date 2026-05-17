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

async def generate_audio(text, voice=None, rate="+0%", output_dir=None):
    """
    Генератор аудио. Возвращает либо локальный путь, либо облачную ссылку.
    """
    clean_text = _prepare_tts_text(text)
    if not clean_text:
        raise ValueError("Text is empty after cleanup")
    
    if voice:
        # Если голос из нашего сокращенного списка - мапим его
        voice = SUPPORTED_VOICES.get(voice, voice)
    
    voice = voice or DEFAULT_VOICE

    if not output_dir:
        if os.environ.get("VERCEL"):
            output_dir = "/tmp/pending_audio"
        else:
            output_dir = os.path.join(os.getcwd(), "user_files", "pending_audio")
        
    os.makedirs(output_dir, exist_ok=True)
    
    file_data = f"{clean_text}_{voice}_{rate}"
    file_hash = hashlib.md5(file_data.encode('utf-8')).hexdigest()
    filename = f"edge_audio_{file_hash}.mp3"
    abs_filepath = os.path.join(output_dir, filename)
    
    # Кэш
    if os.path.exists(abs_filepath) and os.path.getsize(abs_filepath) > 0:
        # Если мы в облаке, файл все равно нужно проверить в Storage или загрузить
        pass
    else:
        logger.info(f"Generating audio for text: {clean_text[:50]}...")
        try:
            # Используем asyncio.run_coroutine_threadsafe если нужно, но здесь мы в асинхронном контексте
            communicate = edge_tts.Communicate(clean_text, voice, rate=rate)
            await communicate.save(abs_filepath)
            
            if not os.path.exists(abs_filepath) or os.path.getsize(abs_filepath) == 0:
                logger.error("Edge TTS generated an empty file or file not found")
                return None
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
                return cloud_url
        except Exception as e:
            logger.warning(f"Failed to upload to cloud storage, falling back to DB: {e}")

    # Если в облако не залили, возвращаем локальный путь для сохранения в TMAMedia
    return abs_filepath

async def _upload_to_supabase(file_path, filename, project_url, api_key):
    """Загрузка файла в Supabase Storage через REST API (async)."""
    import aiohttp
    bucket = "tma-audio"
    # Очищаем URL от лишних слешей
    project_url = project_url.rstrip('/')
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
                    # Возвращаем публичную ссылку (бакет должен быть PUBLIC)
                    return f"{project_url}/storage/v1/object/public/{bucket}/{filename}"
                else:
                    error_text = await resp.text()
                    logger.error(f"Supabase Upload Error ({resp.status}): {error_text}")
                    return None
    except Exception as e:
        logger.error(f"Supabase Storage Exception: {e}")
        return None

def _strip_markdown(text):
    if not text: return ""
    # 1. Убираем разметку
    res = text.replace("**", "").replace("__", "").replace("`", "").replace("*", "").replace("_", "")
    res = res.replace("<center>", "").replace("</center>", "").replace("<large>", "").replace("</large>", "")
    
    # 2. Убираем специфические символы разметки SRS/Anki, если они есть
    res = re.sub(r'\{\{.*?\}\}', '', res) # {{c1::...}}
    res = re.sub(r'\[\[.*?\]\]', '', res)
    
    # 3. Нормализация Unicode (удаляем невидимые символы, контрольные коды)
    import unicodedata
    res = "".join(ch for ch in res if unicodedata.category(ch)[0] != "C")
    
    # 4. Убираем "длинные" тире и прочие юникод-символы, которые могут вызвать проблемы
    res = res.replace("\u2011", "-").replace("\u2013", "-").replace("\u2014", "-")
    
    return res.strip()


def _prepare_tts_text(text, max_chars=900):
    res = _strip_markdown(text)
    res = re.sub(r'https?://\S+', '', res)
    res = re.sub(r'\s+', ' ', res).strip()
    if len(res) <= max_chars:
        return res

    trimmed = res[:max_chars].rsplit(' ', 1)[0].strip()
    return trimmed or res[:max_chars].strip()
