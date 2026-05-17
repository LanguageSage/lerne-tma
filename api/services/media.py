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
        for path_field, folder in [('audio_path', 'audio'), ('image_path', 'images'), ('video_front_path', 'videos'), ('video_back_path', 'videos')]:
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


