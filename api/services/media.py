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
    if media_type in ("videos", "video_front", "video_back"):
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


def is_user_auto_generate_audio_enabled(user_id: int) -> bool:
    """Checks USER_SETTINGS_{user_id} in TMASetting. Returns False if explicitly disabled by user."""
    if not user_id:
        return True
    try:
        import json
        from ..models import TMASetting
        setting = TMASetting.get_or_none(TMASetting.key == f"USER_SETTINGS_{user_id}")
        if setting and setting.value:
            settings_dict = json.loads(setting.value)
            if isinstance(settings_dict, dict):
                val = settings_dict.get("autoGenerateCardAudio")
                if val is None:
                    val = settings_dict.get("auto_generate_card_audio")
                if val is False or val == "false":
                    return False
    except Exception as e:
        logger.warning(f"Error checking user auto-generate audio setting for user {user_id}: {e}")
    return True


def _is_user_audio_path(path: str | None) -> bool:
    if not path:
        return False
    clean = os.path.basename(path.split('?')[0])
    return clean.startswith("aud_")


def _has_existing_audio(path: str | None) -> bool:
    if not path:
        return False
    if path.startswith("http://") or path.startswith("https://"):
        return True
    clean = os.path.basename(path.split('?')[0])
    if _is_user_audio_path(clean):
        return True
    if _check_media_exists(clean, "audio"):
        return True
    out_dir = "/tmp/pending_audio" if os.environ.get("VERCEL") else os.path.join(os.getcwd(), "user_files", "pending_audio")
    if os.path.exists(os.path.join(out_dir, clean)):
        return True
    return False


async def ensure_card_audio(card, user_id: int):
    """Проверяет наличие озвучки для лицевой стороны карточки.
    Если файла озвучки нет в TMAMedia или он пустой/недействительный,
    генерирует новую озвучку через Edge TTS и атомарно сохраняет в БД.
    Безопасен для V2 и не допускает stale whole-row save.
    """
    import re
    from ..models import TMA_Deck, TMA_Card, TMAMedia, TMASetting
    from ..utils.audio import generate_audio
    from .collaborative_service import can_edit_audio
    from .legacy_card_writes import require_legacy_cards, legacy_lifecycle_scope, LegacyCardWriteBlocked

    card_id = getattr(card, 'id', None)
    if not card_id:
        return

    deck_id = getattr(card, 'deck_id', None)
    if not deck_id:
        card_row = TMA_Card.get_or_none(TMA_Card.id == card_id)
        if not card_row:
            return
        deck_id = card_row.deck_id

    if not can_edit_audio(user_id, 'deck', deck_id):
        return

    if user_id and not is_user_auto_generate_audio_enabled(user_id):
        return

    # Check version before external I/O
    try:
        require_legacy_cards([card_id], lock=False)
    except LegacyCardWriteBlocked:
        logger.info(f"ensure_card_audio skipped for non-legacy card {card_id}")
        return
    except Exception as e:
        logger.warning(f"ensure_card_audio version check failed for card {card_id}: {e}")
        return

    # 1. Проверяем, есть ли уже озвучка
    if _has_existing_audio(getattr(card, 'audio_path', None)):
        return

    front_text = (getattr(card, 'front_text', None) or "").strip()
    if not front_text:
        return

    # Определяем язык по наличию кириллицы либо языку колоды
    if re.search(r'[а-яА-ЯёЁ]', front_text):
        lang = "ru"
    else:
        deck_lang = getattr(card, 'target_language', None)
        if not deck_lang and deck_id:
            deck_obj = TMA_Deck.get_or_none(TMA_Deck.id == deck_id)
            if deck_obj and deck_obj.target_language:
                deck_lang = deck_obj.target_language
        lang = (deck_lang or "de").lower().strip()

    db_settings = _get_cached_tma_settings()

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
        # Генерируем аудио БЕЗ открытых транзакций и блокировок
        result = await generate_audio(front_text, voice=voice, rate=rate)
        if isinstance(result, tuple):
            result = result[0]

        if not result:
            logger.error(f"Failed to generate audio for card {card_id}")
            return

        saved_audio = None
        if result.startswith("http"):
            saved_audio = result
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
                saved_audio = cloud_url
            else:
                out_dir = "/tmp/pending_audio" if os.environ.get("VERCEL") else os.path.join(os.getcwd(), "user_files", "pending_audio")
                os.makedirs(out_dir, exist_ok=True)
                with open(os.path.join(out_dir, filename), "wb") as f:
                    f.write(content)
                saved_audio = filename

            try:
                os.remove(result)
            except Exception:
                pass

        if not saved_audio:
            return

        # Атомарная проверка и сохранение БЕЗ stale whole-row save
        with legacy_lifecycle_scope(lock_membership=False):
            try:
                require_legacy_cards([card_id], lock=True)
            except LegacyCardWriteBlocked:
                logger.info(f"ensure_card_audio aborted: card {card_id} is no longer legacy")
                return

            query = TMA_Card.select().where(TMA_Card.id == card_id)
            if TMA_Card._meta.database.for_update:
                query = query.for_update()
            current = query.get_or_none()
            if not current or current.is_deleted:
                logger.info(f"ensure_card_audio aborted: card {card_id} was deleted")
                return

            if not can_edit_audio(user_id, 'deck', current.deck_id):
                logger.info(f"ensure_card_audio aborted: permission lost for card {card_id}")
                return

            if (current.front_text or "").strip() != front_text:
                logger.info(f"ensure_card_audio aborted: front_text changed during TTS for card {card_id}")
                return

            if current.audio_path and _has_existing_audio(current.audio_path):
                logger.info(f"ensure_card_audio aborted: audio was already attached for card {card_id}")
                return

            now = datetime.datetime.now()
            updated = TMA_Card.update(
                audio_path=saved_audio,
                updated_at=now
            ).where(
                (TMA_Card.id == card_id) &
                (TMA_Card.is_deleted == False) &
                (TMA_Card.front_text == current.front_text) &
                ((TMA_Card.audio_path.is_null()) | (TMA_Card.audio_path == ''))
            ).execute()

            if updated:
                if hasattr(card, 'audio_path'):
                    card.audio_path = saved_audio
                if hasattr(card, 'updated_at'):
                    card.updated_at = now
                logger.info(f"Generated audio attached to card {card_id}: {saved_audio}")
    except Exception as e:
        logger.error(f"Failed to ensure audio for card {card_id}: {e}", exc_info=True)
