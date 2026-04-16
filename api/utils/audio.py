import os
import re
import hashlib
import asyncio
import edge_tts
import logging

# Простая настройка логирования в файл
file_handler = logging.FileHandler('audio_debug.log', encoding='utf-8')
file_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
logger = logging.getLogger(__name__)
logger.addHandler(file_handler)
logger.setLevel(logging.INFO)

# По умолчанию используется качественный женский голос Катя
DEFAULT_VOICE = "de-DE-KatjaNeural"

# Доступные голоса для выбора в настройках
SUPPORTED_VOICES = {
    "de_f_katja": "de-DE-KatjaNeural",
    "de_m_conrad": "de-DE-ConradNeural",
    "de_f_amala": "de-DE-AmalaNeural",
    "ru_f_svetlana": "ru-RU-SvetlanaNeural",
    "ru_m_dmitry": "ru-RU-DmitryNeural",
    "en_f_aria": "en-US-AriaNeural",
    "en_m_guy": "en-US-GuyNeural"
}

async def generate_audio(text, voice=None, output_dir=None):
    """
    Генератор аудио на базе Microsoft Edge TTS.
    Возвращает АБСОЛЮТНЫЙ путь к файлу.
    """
    # Если голос передан как ключ (например, 'de_f_katja'), резолвим его
    voice = SUPPORTED_VOICES.get(voice, voice) or DEFAULT_VOICE
    
    if not output_dir:
        output_dir = os.path.join(os.getcwd(), "user_files", "pending_audio")
        
    os.makedirs(output_dir, exist_ok=True)
    
    # Очистка текста от Markdown тегов перед озвучкой
    clean_text = _strip_markdown(text)
    
    # Генерация уникального имени файла на основе текста и голоса
    file_data = f"{clean_text}_{voice}"
    file_hash = hashlib.md5(file_data.encode('utf-8')).hexdigest()
    filename = f"edge_audio_{file_hash}.mp3"
    abs_filepath = os.path.join(output_dir, filename)
    
    # Проверяем кэш (и проверяем, что файл не пустой)
    if os.path.exists(abs_filepath) and os.path.getsize(abs_filepath) > 0:
        return abs_filepath

    try:
        communicate = edge_tts.Communicate(clean_text, voice)
        await communicate.save(abs_filepath)
        
        if os.path.exists(abs_filepath) and os.path.getsize(abs_filepath) > 0:
            return abs_filepath
        else:
            logger.error(f"Edge TTS created an empty file for: {clean_text[:30]}")
            return None
    except Exception as e:
        logger.error(f"Edge TTS Generation Error: {e}")
        return None

def _strip_markdown(text):
    """Удаляет базовую разметку для чистого звучания"""
    if not text: return ""
    return text.replace("**", "").replace("__", "").replace("`", "").replace("*", "").replace("_", "").strip()
