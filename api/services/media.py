import os
import datetime
import logging
import json
from ..models import TMA_Deck, TMA_Card, TMAProgress, TMAReviewHistory, Deck, Card, tma_db, TMAMedia
from .. import srs
from peewee import fn, JOIN
from functools import lru_cache

logger = logging.getLogger(__name__)

def _build_media_exists_map(cards_dicts: list) -> set:
    """Собирает множество (filename, folder) существующих в TMAMedia записей.
    Один запрос вместо N проверок."""
    from ..models import TMAMedia
    
    filenames = set()
    for c in cards_dicts:
        for path_field, folder in [
            ('audio_path', 'audio'),
            ('audio_back_path', 'audio'),
            ('image_path', 'images'),
            ('video_front_path', 'videos'),
            ('video_back_path', 'videos')
        ]:
            path_str = c.get(path_field)
            path_str = c.get(path_field)
            if path_str and not path_str.startswith('http'):
                filenames.add(os.path.basename(path_str))
    
    if not filenames:
        return set()
    
    try:
        existing = set()
        filenames_list = list(filenames)
        for i in range(0, len(filenames_list), 500):
            chunk = filenames_list[i:i+500]
            for m in TMAMedia.select(TMAMedia.filename, TMAMedia.folder).where(TMAMedia.filename << chunk):
                existing.add((m.filename, m.folder))
        return existing
    except Exception as e:
        logger.error(f"Error in _build_media_exists_map: {e}")
        return set()


@lru_cache(maxsize=2000)
def _check_media_exists(filename: str, folder: str) -> bool:
    """Кэшированная проверка существования медиа в БД."""
    try:
        from ..models import TMAMedia
        return TMAMedia.select(TMAMedia.id).where(
            TMAMedia.filename == filename,
            TMAMedia.folder == folder
        ).exists()
    except Exception:
        return False


def resolve_media_url(path_str: str, media_type: str, exists_map: set = None) -> str | None:
    """Формирует URL для медиа. Если передан exists_map — пропускаем запрос в БД."""
    if not path_str: return None
    if path_str.startswith("http"): return path_str
    
    # Извлекаем только имя файла
    filename = os.path.basename(path_str)
    
    folder = "images"
    if media_type == "audio": folder = "audio"
    elif media_type == "videos": folder = "videos"
    elif media_type == "backgrounds": folder = "backgrounds"
    
    # 1. Если есть предзагруженная карта существования — используем её
    if exists_map is not None:
        if (filename, folder) not in exists_map:
            return None
        return f"/api/media/{media_type}/{filename}"
    
    # 2. Используем кэшированную проверку (убирает сотни лишних запросов к БД)
    if _check_media_exists(filename, folder):
        return f"/api/media/{media_type}/{filename}"
    
    return None


async def ensure_card_audio(card, user_id: int):
    """Проверяет наличие озвучки для лицевой стороны карточки.
    Если файла озвучки нет в TMAMedia или он пустой/недействительный,
    генерирует новую озвучку через Edge TTS и сохраняет в БД.
    """
    import re
    from ..models import TMAMedia, TMASetting
    from ..utils.audio import generate_audio
    
    # 1. Проверяем, есть ли уже озвучка
    has_valid_audio = False
    if card.audio_path:
        if card.audio_path.startswith("http"):
            has_valid_audio = True
        else:
            filename = os.path.basename(card.audio_path)
            # Проверяем наличие файла в TMAMedia и то, что он не пустой
            media = TMAMedia.get_or_none(
                (TMAMedia.filename == filename) & 
                (TMAMedia.folder == "audio")
            )
            if media and media.content and len(media.content) > 0:
                has_valid_audio = True
                
    if has_valid_audio:
        return
        
    # 2. Озвучки нет или она повреждена. Генерируем новую.
    if not card.front_text or not card.front_text.strip():
        return
        
    logger.info(f"Audio missing or invalid for card {card.id}. Regenerating front audio...")
    
    # Определяем язык по наличию кириллицы
    lang = "ru" if re.search(r'[а-яА-ЯёЁ]', card.front_text) else "de"
    
    # Загружаем настройки озвучки
    db_settings = {}
    try:
        for s in TMASetting.select():
            db_settings[s.key] = s.value
    except Exception as e:
        logger.error(f"Error fetching settings for ensure_card_audio: {e}")
        
    voice = None
    rate = None
    
    # Маппинг голосов по умолчанию
    LANG_DEFAULT_VOICES = {
        "de": "de-DE-KatjaNeural",
        "ru": "ru-RU-SvetlanaNeural",
    }
    
    if lang == "de":
        voice = db_settings.get("TTS_VOICE") or LANG_DEFAULT_VOICES["de"]
        rate = db_settings.get("TTS_SPEED") or "+0%"
    else:
        voice = db_settings.get("TTS_VOICE_RU") or LANG_DEFAULT_VOICES["ru"]
        rate = db_settings.get("TTS_SPEED_RU") or db_settings.get("TTS_SPEED") or "+0%"
        
    try:
        # Генерируем аудио
        result = await generate_audio(card.front_text, voice=voice, rate=rate)
        if not result:
            logger.error(f"Failed to generate audio for card {card.id}")
            return
            
        if result.startswith("http"):
            # Облачная ссылка
            card.audio_path = result
            card.save()
            logger.info(f"Generated cloud audio for card {card.id}: {result}")
        else:
            # Локальный файл, сохраняем контент в БД
            filename = os.path.basename(result)
            with open(result, "rb") as f:
                content = f.read()
                
            TMAMedia.get_or_create(
                filename=filename,
                folder='audio',
                defaults={'content': content}
            )
            
            card.audio_path = filename
            card.save()
            
            try: os.remove(result)
            except: pass
            
            logger.info(f"Generated local audio for card {card.id} and saved to TMAMedia: {filename}")
    except Exception as e:
        logger.error(f"Failed to ensure audio for card {card.id}: {e}", exc_info=True)
