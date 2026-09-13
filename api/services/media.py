import os
import datetime
import logging
import time
import json
from ..models import TMA_Deck, TMA_Card, TMAProgress, TMAReviewHistory, Deck, Card, tma_db, TMAMedia
from .. import srs
from peewee import fn, JOIN
from functools import lru_cache

logger = logging.getLogger(__name__)

_tma_settings_cache = {}
_tma_settings_cache_time = 0

def _get_cached_tma_settings():
    global _tma_settings_cache, _tma_settings_cache_time
    now = time.time()
    if now - _tma_settings_cache_time < 30 and _tma_settings_cache:
        return _tma_settings_cache
    try:
        from ..models import TMASetting
        new_cache = {}
        for s in TMASetting.select():
            new_cache[s.key] = s.value
        _tma_settings_cache = new_cache
        _tma_settings_cache_time = now
    except Exception as e:
        logger.error(f"Error fetching settings for ensure_card_audio: {e}")
    return _tma_settings_cache

def _build_media_exists_map(cards_dicts: list) -> set:
    """Собирает множество существующих и пригодных медиа одним запросом."""
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
            if path_str and not path_str.startswith('http'):
                filenames.add(os.path.basename(path_str))
    
    if not filenames:
        return set()
    
    try:
        existing = set()
        filenames_list = list(filenames)
        for i in range(0, len(filenames_list), 500):
            chunk = filenames_list[i:i+500]
            query = TMAMedia.select(
                TMAMedia.filename,
                TMAMedia.folder,
                fn.LENGTH(TMAMedia.content),
                fn.SUBSTR(TMAMedia.content, 1, 4096),
            ).where(TMAMedia.filename << chunk)
            for filename, folder, content_size, content_prefix in query.tuples():
                if folder != 'audio' or content_size is None or _is_valid_audio_content(content_prefix, content_size):
                    existing.add((filename, folder))
        return existing
    except Exception as e:
        logger.error(f"Error in _build_media_exists_map: {e}")
        return set()


def _is_valid_audio_content(content_prefix, content_size=None) -> bool:
    """Проверяет размер и сигнатуру аудио по небольшому начальному фрагменту."""
    content = bytes(content_prefix or b'')
    size = content_size if content_size is not None else len(content)
    if size < 128 or not any(content):
        return False
    if content.startswith((b'ID3', b'RIFF', b'OggS', b'fLaC', b'\x1aE\xdf\xa3')):
        return True
    if len(content) >= 8 and content[4:8] == b'ftyp':
        return True
    return any(
        content[index] == 0xFF and (content[index + 1] & 0xE0) == 0xE0
        for index in range(len(content) - 1)
    )


@lru_cache(maxsize=2000)
def _check_media_exists(filename: str, folder: str) -> bool:
    """Кэшированная проверка существования и минимальной целостности медиа."""
    try:
        from ..models import TMAMedia
        row = TMAMedia.select(
            fn.LENGTH(TMAMedia.content),
            fn.SUBSTR(TMAMedia.content, 1, 4096),
        ).where(
            TMAMedia.filename == filename,
            TMAMedia.folder == folder,
        ).tuples().first()
        if not row:
            return False
        if folder != 'audio':
            return True
        # If content is NULL, it has been migrated to Supabase Storage and is served via Storage redirect
        if row[0] is None:
            return True
        return _is_valid_audio_content(row[1], row[0])
    except Exception:
        return False


def resolve_media_url(path_str: str, media_type: str, exists_map: set = None) -> str | None:
    """Формирует канонический URL для медиа-ресурсов."""
    if not path_str:
        return None
    clean_filename = os.path.basename(path_str.split('?')[0])
    if not clean_filename:
        return None

    if media_type in ("audio", "audio_back"):
        if path_str.startswith("http://") or path_str.startswith("https://"):
            if "/storage/v1/object/public/tma-audio/" in path_str:
                return path_str.replace("/storage/v1/object/public/tma-audio/", "/storage/v1/object/public/audio/")
            return path_str
        supabase_url = os.environ.get("SUPABASE_URL", "https://wdopyuulhiykrextyvnt.supabase.co").rstrip("/")
        return f"{supabase_url}/storage/v1/object/public/audio/{clean_filename}"

    if path_str.startswith("http://") or path_str.startswith("https://"):
        return path_str
    filename = clean_filename
    
    folder = "images"
    if media_type in ("audio", "audio_back"):
        folder = "audio"
    elif media_type in ("videos", "video_front", "video_back"):
        folder = "videos"
    elif media_type == "backgrounds":
        folder = "backgrounds"

    if exists_map is not None:
        if (filename, folder) not in exists_map:
            return None
    elif not _check_media_exists(filename, folder):
        return None

    if path_str.startswith("/api/media/"):
        return path_str
    
    return f"/api/media/{folder}/{filename}"


async def ensure_card_audio(card, user_id: int):
    """Проверяет наличие озвучки для лицевой стороны карточки.
    Если файла озвучки нет в TMAMedia или он пустой/недействительный,
    генерирует новую озвучку через Edge TTS и сохраняет в БД.
    """
    import re
    from ..models import TMAMedia, TMASetting
    from ..utils.audio import generate_audio
    from .collaborative_service import can_edit_audio

    if not can_edit_audio(user_id, 'deck', card.deck_id):
        return
    
    # 1. Проверяем, есть ли уже озвучка
    has_valid_audio = False
    if card.audio_path:
        if card.audio_path.startswith("http"):
            has_valid_audio = True
        else:
            filename = os.path.basename(card.audio_path)
            # Проверяем только наличие записи по ID (без скачивания гигабайтных/мегабайтных BLOB из БД)
            has_valid_audio = _check_media_exists(filename, "audio")
                
    if has_valid_audio:
        return
        
    # 2. Озвучки нет или она повреждена. Генерируем новую.
    if not card.front_text or not card.front_text.strip():
        return
        
    # Определяем язык по наличию кириллицы либо языку колоды
    if re.search(r'[а-яА-ЯёЁ]', card.front_text):
        lang = "ru"
    else:
        deck_lang = getattr(card, 'target_language', None)
        if not deck_lang and getattr(card, 'deck_id', None):
            from ..models import TMA_Deck
            deck_obj = TMA_Deck.get_or_none(TMA_Deck.id == card.deck_id)
            if deck_obj and deck_obj.target_language:
                deck_lang = deck_obj.target_language
        lang = (deck_lang or "de").lower().strip()
    
    # Загружаем настройки озвучки (с простым TTL кэшем)
    db_settings = _get_cached_tma_settings()
        
    voice = None
    rate = None
    
    # Маппинг голосов по умолчанию
    LANG_DEFAULT_VOICES = {
        "de": "de-DE-KatjaNeural",
        "ru": "ru-RU-SvetlanaNeural",
        "en": "en-US-JennyNeural",
        "no": "nb-NO-FinnNeural",
        "uk": "uk-UA-PolinaNeural",
    }
    
    clean_lang = (lang or "de").lower().strip()
    if clean_lang == "de":
        voice = db_settings.get("TTS_VOICE") or LANG_DEFAULT_VOICES["de"]
        rate = db_settings.get("TTS_SPEED") or "+0%"
    elif clean_lang == "ru":
        voice = db_settings.get("TTS_VOICE_RU") or LANG_DEFAULT_VOICES["ru"]
        rate = db_settings.get("TTS_SPEED_RU") or db_settings.get("TTS_SPEED") or "+0%"
    elif clean_lang in LANG_DEFAULT_VOICES:
        voice = db_settings.get(f"TTS_VOICE_{clean_lang.upper()}") or LANG_DEFAULT_VOICES[clean_lang]
        rate = db_settings.get("TTS_SPEED") or "+0%"
    else:
        voice = db_settings.get("TTS_VOICE") or LANG_DEFAULT_VOICES["de"]
        rate = db_settings.get("TTS_SPEED") or "+0%"
        
    try:
        # Генерируем аудио
        result = await generate_audio(card.front_text, voice=voice, rate=rate)
        if isinstance(result, tuple):
            result = result[0]
            
        if not result:
            logger.error(f"Failed to generate audio for card {card.id}")
            return
            
        if result.startswith("http"):
            # Облачная ссылка
            card.audio_path = result
            card.save()
            logger.info(f"Generated cloud audio for card {card.id}: {result}")
        else:
            filename = os.path.basename(result)
            with open(result, "rb") as f:
                content = f.read()

            supabase_url = os.environ.get("SUPABASE_URL")
            supabase_key = os.environ.get("SUPABASE_KEY")
            cloud_url = None
            if supabase_url and supabase_key:
                try:
                    from ..utils.audio import _upload_to_supabase
                    cloud_url = await _upload_to_supabase(content, filename, supabase_url, supabase_key)
                except Exception as up_err:
                    logger.warning(f"Failed to upload ensured audio to storage: {up_err}")

            if cloud_url:
                card.audio_path = cloud_url
                card.save()
                logger.info(f"Generated audio uploaded to cloud for card {card.id}: {cloud_url}")
            else:
                # Fallback to local DB
                media, created = TMAMedia.get_or_create(
                    filename=filename,
                    folder='audio',
                    defaults={'content': content}
                )
                if not created:
                    media.content = content
                    media.save(only=[TMAMedia.content])
                _check_media_exists.cache_clear()
                card.audio_path = filename
                card.save()
                logger.info(f"Generated local audio for card {card.id} and saved to TMAMedia: {filename}")
            
            try: os.remove(result)
            except Exception: pass
            
            logger.info(f"Generated local audio for card {card.id} and saved to TMAMedia: {filename}")
    except Exception as e:
        logger.error(f"Failed to ensure audio for card {card.id}: {e}", exc_info=True)
