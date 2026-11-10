import os
import logging
import time
import json
from urllib.parse import unquote, urlsplit
from fastapi import HTTPException
from ..models import tma_db, TMAMedia
from peewee import fn
from functools import lru_cache
from api.local_runtime import is_local

logger = logging.getLogger(__name__)


def validate_new_audio_path(path: str | None, previous: str | None = None) -> None:
    """Reject new cloud card links unless their permanent Storage object exists."""
    if not path or path == previous:
        return
    if is_local():
        from api.local_runtime import media_file
        name = path.removeprefix('/api/media/audio/').removeprefix('audio/')
        if (not path.startswith(('http:', 'https:', '/tmp/')) and name and
                '/' not in name and '\\' not in name and name not in ('.', '..') and
                media_file('audio', name).is_file()):
            return
        raise HTTPException(422, 'Аудиофайл отсутствует в LOCAL media.')
    parsed = urlsplit(path)
    if not parsed.scheme and not parsed.netloc:
        name = path.removeprefix('/api/media/audio/').removeprefix('audio/')
        if not parsed.query and not parsed.fragment and name and '/' not in name and '\\' not in name and name not in ('.', '..'):
            row = TMAMedia.select(fn.LENGTH(TMAMedia.content), fn.SUBSTR(TMAMedia.content, 1, 4096)).where(
                TMAMedia.folder == 'audio', TMAMedia.filename == name, TMAMedia.content.is_null(False)).tuples().first()
            if row and _is_valid_audio_content(row[1], row[0]):
                return
        raise HTTPException(422, 'Аудиофайл отсутствует в постоянном хранилище.')
    base = os.environ.get('SUPABASE_URL', '').rstrip('/')
    if not base:
        raise HTTPException(503, 'Supabase Storage не настроен; новая аудиоссылка не сохранена.')
    parsed, origin = urlsplit(path), urlsplit(base)
    prefix = '/storage/v1/object/public/audio/'
    name = unquote(parsed.path[len(prefix):]) if parsed.path.startswith(prefix) else ''
    if (parsed.scheme != origin.scheme or parsed.netloc != origin.netloc or
            parsed.query or parsed.fragment or not name or '\\' in name or
            any(part in ('', '.', '..') for part in name.split('/'))):
        raise HTTPException(422, 'Аудио должно ссылаться на постоянный объект Supabase Storage.')
    found = tma_db.execute_sql(
        'SELECT 1 FROM storage.objects WHERE bucket_id = %s AND name = %s LIMIT 1',
        ('audio', name)).fetchone()
    if not found:
        raise HTTPException(422, 'Аудиофайл отсутствует в Supabase Storage; ссылка не сохранена.')

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
def _check_media_exists(filename: str, folder: str, *, strict=False) -> bool:
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
        if strict:
            raise
        return False


def resolve_media_url(path_str: str, media_type: str, exists_map: set = None, *, strict=False) -> str | None:
    """Формирует канонический URL для медиа-ресурсов."""
    if not path_str:
        return None
    if is_local():
        folder = 'audio' if media_type in ('audio', 'audio_back') else 'videos' if media_type in ('videos', 'video_front', 'video_back') else 'backgrounds' if media_type == 'backgrounds' else 'images'
        return f'/api/media/{folder}/{os.path.basename(path_str.split("?")[0])}'
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
    elif not _check_media_exists(filename, folder, strict=strict):
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
