import datetime
import hashlib
import logging
from fastapi import HTTPException
from peewee import PostgresqlDatabase
from ..models import TMA_Folder, TMA_Deck, TMAMedia, tma_db

logger = logging.getLogger(__name__)

def get_active_folders(user_id: int, folder_map: dict = None):
    """Возвращает все активные папки пользователя (собственные, по соавторству и глобальные)."""
    try:
        from .decks import ensure_inbox_deck
        from .collaborative_service import filter_active_folder_map, get_user_accessible_folder_ids, get_batch_collaborative_info

        def _load_active_folders():
            return filter_active_folder_map({
                f.id: f for f in TMA_Folder.select().where(TMA_Folder.is_deleted == False)
            })

        if folder_map is None:
            folder_map = _load_active_folders()

        # Only ensure inbox folder/deck if missing
        has_inbox_folder = any(f.user_id == user_id and f.name == "📥 Входящие" for f in folder_map.values())
        if not has_inbox_folder:
            ensure_inbox_deck(user_id)
            folder_map = _load_active_folders()

        accessible_folder_ids = get_user_accessible_folder_ids(user_id, folder_map=folder_map)
        if not accessible_folder_ids:
            return []

        folders = [folder_map[fid] for fid in accessible_folder_ids if fid in folder_map]
        folders.sort(key=lambda f: (getattr(f, 'position', 0) or 0, f.id))

        collab_info = get_batch_collaborative_info(user_id, folders=folders, folder_map=folder_map, include_presence=True)
        folder_collab_map = collab_info.get('folders', {})

        result = []
        for f in folders:
            collab_meta = folder_collab_map.get(f.id, {})
            role = collab_meta.get('role', 'owner' if f.user_id == user_id else None)
            is_shared = collab_meta.get('is_shared', False)
            is_global_readonly = collab_meta.get('is_global_readonly', False)
            is_official = collab_meta.get('is_official', False)

            result.append({
                "id": f.id,
                "name": f.name,
                "parent_id": getattr(f, 'parent_id', None),
                "color": f.color,
                "target_language": getattr(f, 'target_language', 'de') or 'de',
                "position": getattr(f, 'position', 0) or 0,
                "is_shared": is_shared,
                "presence_enabled": collab_meta.get('presence_enabled', False),
                "role": role,
                "is_owner": role == 'owner',
                "is_global_readonly": is_global_readonly,
                "is_official": is_official,
                "access_scope": getattr(f, 'access_scope', 'private'),
            })

        return result
    except Exception as e:
        logger.error(f"Error in get_active_folders: {e}", exc_info=True)
        raise e


def ensure_inbox_folder(user_id: int, target_language: str = 'de') -> TMA_Folder:
    """Возвращает (или создаёт) специальную папку «Входящие» для пользователя под конкретный язык."""
    lang = (target_language or 'de').lower().strip()
    with tma_db.atomic():
        if isinstance(tma_db.obj, PostgresqlDatabase):
            key = f'inbox:{user_id}:{lang}'.encode('utf-8')
            lock_id = int.from_bytes(hashlib.blake2b(key, digest_size=8).digest(), 'big', signed=True)
            tma_db.execute_sql('SELECT pg_advisory_xact_lock(%s)', (lock_id,))

        inbox_folder = TMA_Folder.get_or_none(
            (TMA_Folder.user_id == user_id) &
            (TMA_Folder.name == "📥 Входящие") &
            ((TMA_Folder.target_language == lang) | (TMA_Folder.target_language.is_null() if lang == 'de' else False)) &
            (TMA_Folder.is_deleted == False)
        )
        if not inbox_folder:
            inbox_folder = TMA_Folder.create(
                user_id=user_id,
                name="📥 Входящие",
                color="#ffd043",
                target_language=lang,
                created_at=datetime.datetime.now(),
                updated_at=datetime.datetime.now()
            )
            logger.info(f"Created Inbox folder for user {user_id} (lang={lang}, id={inbox_folder.id})")
        elif getattr(inbox_folder, 'target_language', None) != lang:
            inbox_folder.target_language = lang
            inbox_folder.save()
        return inbox_folder


def _require_folder_write(folder_id: int, user_id: int) -> TMA_Folder:
    """Returns the folder if user can mutate it, else raises 403/404.
    - owner: full access
    - global_readonly viewer: 403 with helpful message
    - no access: 404
    """
    from .collaborative_service import _require_can_mutate, is_folder_chain_active
    folder = TMA_Folder.get_or_none((TMA_Folder.id == folder_id) & (TMA_Folder.is_deleted == False))
    if not folder or not is_folder_chain_active(folder.parent_id):
        raise HTTPException(status_code=404, detail="Папка не найдена")
    _require_can_mutate(user_id, 'folder', folder_id)
    return folder


def create_folder(name: str, user_id: int, parent_id: int = None, color: str = None, target_language: str = 'de'):
    """Создает новую папку для пользователя, предотвращая дублирование системных папок."""
    try:
        clean_name = (name or '').strip()
        lang = (target_language or 'de').lower().strip()

        # Защита от дублирования папки «📥 Входящие»
        if clean_name == "📥 Входящие":
            return ensure_inbox_folder(user_id, target_language=lang)

        # Защита от дублирования папки «Leben in Deutschland»
        if clean_name == "Leben in Deutschland" and parent_id is None:
            existing_lid = TMA_Folder.get_or_none(
                (TMA_Folder.user_id == user_id) &
                (TMA_Folder.name == "Leben in Deutschland") &
                (TMA_Folder.parent.is_null()) &
                (TMA_Folder.is_deleted == False)
            )
            if existing_lid:
                return existing_lid

        if parent_id is not None:
            from .collaborative_service import _require_can_mutate, is_folder_chain_active
            parent = TMA_Folder.get_or_none((TMA_Folder.id == parent_id) & (TMA_Folder.is_deleted == False))
            if not parent or not is_folder_chain_active(parent.parent_id):
                raise ValueError("Родительская папка не найдена или нет доступа")
            _require_can_mutate(user_id, 'folder', parent_id)

        folder = TMA_Folder.create(
            user_id=user_id,
            name=clean_name,
            parent_id=parent_id,
            color=color,
            target_language=lang,
            created_at=datetime.datetime.now(),
            updated_at=datetime.datetime.now()
        )
        return folder
    except (HTTPException, ValueError):
        raise
    except Exception as e:
        logger.error(f"Error in create_folder: {e}")
        raise e


def rename_folder(folder_id: int, name: str, user_id: int):
    """Переименовывает папку пользователя."""
    try:
        folder = _require_folder_write(folder_id, user_id)
        if folder.name == "📥 Входящие":
            raise ValueError("Нельзя переименовать папку Входящие")
        folder.name = name
        folder.updated_at = datetime.datetime.now()
        folder.save()

        if folder.share_id:
            filename = f"preview_{folder.share_id}.png"
            TMAMedia.delete().where((TMAMedia.filename == filename) & (TMAMedia.folder == 'previews')).execute()

        return folder
    except (HTTPException, ValueError):
        raise
    except Exception as e:
        logger.error(f"Error renaming folder {folder_id}: {e}")
        raise e


def change_folder_color(folder_id: int, color: str, user_id: int):
    """Изменяет цвет папки."""
    try:
        folder = _require_folder_write(folder_id, user_id)
        folder.color = color
        folder.updated_at = datetime.datetime.now()
        folder.save()
        return folder
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error changing color of folder {folder_id}: {e}")
        raise e


def move_folder(folder_id: int, parent_id: int, user_id: int):
    """Перемещает папку в другую родительскую папку (или в корень, если parent_id=None)."""
    try:
        folder = _require_folder_write(folder_id, user_id)

        if folder_id == parent_id:
            raise ValueError("Нельзя переместить папку саму в себя")

        if parent_id is not None:
            parent = _require_folder_write(parent_id, user_id)
            if not parent:
                raise ValueError("Родительская папка не найдена")

            curr = parent
            while curr is not None:
                if curr.id == folder_id:
                    raise ValueError("Нельзя переместить папку в собственную подпапку")
                curr = TMA_Folder.get_or_none(TMA_Folder.id == curr.parent_id)

        folder.parent_id = parent_id
        folder.updated_at = datetime.datetime.now()
        folder.save()
        return folder
    except (HTTPException, ValueError):
        raise
    except Exception as e:
        logger.error(f"Error moving folder {folder_id} to parent {parent_id}: {e}")
        raise e


def get_descendant_folder_ids(folder_id: int, user_id: int) -> list:
    """Рекурсивно находит ID всех подпапок для указанной папки."""
    descendants = []
    direct_children = list(TMA_Folder.select(TMA_Folder.id).where(
        (TMA_Folder.parent_id == folder_id) & (TMA_Folder.user_id == user_id)
    ))
    for child in direct_children:
        descendants.append(child.id)
        descendants.extend(get_descendant_folder_ids(child.id, user_id))
    return descendants


def delete_folder(folder_id: int, user_id: int):
    """Мягко удаляет папку в корзину, сохраняя иерархию и состояния потомков для восстановления."""
    try:
        from .collaborative_service import _require_can_mutate, is_folder_chain_active

        with tma_db.atomic():
            query = TMA_Folder.select().where(TMA_Folder.id == folder_id)
            if tma_db.for_update:
                query = query.for_update()
            folder = query.first()
            if not folder:
                raise HTTPException(status_code=404, detail="Папка не найдена")
            if folder.user_id != user_id:
                raise HTTPException(status_code=403, detail="Только владелец может удалить папку")
            if folder.is_deleted:
                _require_can_mutate(user_id, 'folder', folder_id, allow_deleted=True)
                return True
            if not is_folder_chain_active(folder.parent_id):
                raise HTTPException(status_code=404, detail="Папка не найдена")
            _require_can_mutate(user_id, 'folder', folder_id)

            if folder.name == "📥 Входящие":
                active_inbox_count = TMA_Folder.select().where(
                    (TMA_Folder.user_id == user_id) &
                    (TMA_Folder.name == "📥 Входящие") &
                    (TMA_Folder.is_deleted == False)
                ).count()
                if active_inbox_count <= 1:
                    raise ValueError("Нельзя удалить основную папку Входящие")

            now = datetime.datetime.now()
            folder.is_deleted = True
            folder.updated_at = now
            folder.save(only=[TMA_Folder.is_deleted, TMA_Folder.updated_at])

        if folder.share_id:
            filename = f"preview_{folder.share_id}.png"
            TMAMedia.delete().where((TMAMedia.filename == filename) & (TMAMedia.folder == 'previews')).execute()

        logger.info(f"Soft-deleted folder {folder_id} for user {user_id} (subtree preserved)")
        return True
    except (HTTPException, ValueError):
        raise
    except Exception as e:
        logger.error(f"Error deleting folder {folder_id}: {e}", exc_info=True)
        raise e


def reorder_folders(folder_ids: list, user_id: int):
    """Обновляет порядок папок пользователя. Глобальные папки игнорируются."""
    try:
        from .collaborative_service import _require_can_mutate
        for folder_id in folder_ids:
            _require_can_mutate(user_id, 'folder', folder_id)
        with tma_db.atomic():
            for idx, folder_id in enumerate(folder_ids):
                # Only reorder folders owned by this user (global_readonly owned by another user are silently skipped)
                TMA_Folder.update(position=idx, updated_at=datetime.datetime.now()).where(
                    TMA_Folder.id == folder_id
                ).execute()
        return True
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error reordering folders: {e}")
        raise e
