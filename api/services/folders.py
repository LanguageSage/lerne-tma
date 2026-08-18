import datetime
import logging
from ..models import TMA_Folder, TMA_Deck, TMAMedia, tma_db

logger = logging.getLogger(__name__)

def get_active_folders(user_id: int):
    """Возвращает все активные папки пользователя (собственные и доступные по соавторству)."""
    try:
        from .decks import ensure_inbox_deck
        from .collaborative_service import get_user_accessible_folder_ids, get_batch_collaborative_info
        ensure_inbox_deck(user_id)

        accessible_folder_ids = get_user_accessible_folder_ids(user_id)
        if not accessible_folder_ids:
            return []

        folders = list(TMA_Folder.select().where(
            (TMA_Folder.id << list(accessible_folder_ids)) & (TMA_Folder.is_deleted == False)
        ).order_by(TMA_Folder.id.asc()))

        collab_info = get_batch_collaborative_info(user_id, folders=folders)
        folder_collab_map = collab_info.get('folders', {})
        
        result = []
        for f in folders:
            collab_meta = folder_collab_map.get(f.id, {})
            role = collab_meta.get('role', 'owner' if f.user_id == user_id else None)
            is_shared = collab_meta.get('is_shared', False)
            
            result.append({
                "id": f.id,
                "name": f.name,

                "parent_id": getattr(f, 'parent_id', None),
                "color": f.color,
                "target_language": getattr(f, 'target_language', 'de') or 'de',
                "is_shared": is_shared,
                "role": role,
                "is_owner": role == 'owner'
            })

        return result
    except Exception as e:
        logger.error(f"Error in get_active_folders: {e}", exc_info=True)
        raise e


def ensure_inbox_folder(user_id: int, target_language: str = 'de') -> TMA_Folder:
    """Возвращает (или создаёт) специальную папку «Входящие» для пользователя под конкретный язык."""
    lang = (target_language or 'de').lower().strip()
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

def create_folder(name: str, user_id: int, parent_id: int = None, color: str = None, target_language: str = 'de'):
    """Создает новую папку для пользователя."""
    try:
        if parent_id is not None:
            from .collaborative_service import get_effective_user_role
            from fastapi import HTTPException
            role = get_effective_user_role(user_id, 'folder', parent_id)
            if role == 'viewer':
                raise HTTPException(status_code=403, detail="У вас роль Слушателя (только чтение). Создавать подпапки в этой папке может только Редактор или Владелец.")
            elif role is None:
                raise ValueError("Родительская папка не найдена или нет доступа")


        folder = TMA_Folder.create(
            user_id=user_id,
            name=name,
            parent_id=parent_id,
            color=color,
            target_language=target_language or 'de',
            created_at=datetime.datetime.now(),
            updated_at=datetime.datetime.now()
        )
        return folder
    except Exception as e:
        logger.error(f"Error in create_folder: {e}")
        raise e

def rename_folder(folder_id: int, name: str, user_id: int):
    """Переименовывает папку пользователя."""
    try:
        folder = TMA_Folder.get_or_none((TMA_Folder.id == folder_id) & (TMA_Folder.user_id == user_id))
        if not folder:
            return None
        if folder.name == "📥 Входящие":
            raise ValueError("Нельзя переименовать папку Входящие")
        folder.name = name
        folder.updated_at = datetime.datetime.now()
        folder.save()

        if folder.share_id:
            filename = f"preview_{folder.share_id}.png"
            TMAMedia.delete().where((TMAMedia.filename == filename) & (TMAMedia.folder == 'previews')).execute()

        return folder
    except Exception as e:
        logger.error(f"Error renaming folder {folder_id}: {e}")
        raise e

def change_folder_color(folder_id: int, color: str, user_id: int):
    """Изменяет цвет папки."""
    try:
        folder = TMA_Folder.get_or_none((TMA_Folder.id == folder_id) & (TMA_Folder.user_id == user_id))
        if not folder:
            return None
        folder.color = color
        folder.updated_at = datetime.datetime.now()
        folder.save()
        return folder
    except Exception as e:
        logger.error(f"Error changing color of folder {folder_id}: {e}")
        raise e

def move_folder(folder_id: int, parent_id: int, user_id: int):
    """Перемещает папку в другую родительскую папку (или в корень, если parent_id=None)."""
    try:
        # Проверяем перемещаемую папку
        folder = TMA_Folder.get_or_none((TMA_Folder.id == folder_id) & (TMA_Folder.user_id == user_id))
        if not folder:
            return None
            
        # Нельзя переместить папку саму в себя
        if folder_id == parent_id:
            raise ValueError("Нельзя переместить папку саму в себя")
            
        # Проверяем родительскую папку
        if parent_id is not None:
            parent = TMA_Folder.get_or_none((TMA_Folder.id == parent_id) & (TMA_Folder.user_id == user_id))
            if not parent:
                raise ValueError("Родительская папка не найдена")
                
            # Проверяем на циклическую зависимость (родитель не должен быть подпапкой перемещаемой папки)
            curr = parent
            while curr is not None:
                if curr.id == folder_id:
                    raise ValueError("Нельзя переместить папку в собственную подпапку")
                curr = TMA_Folder.get_or_none((TMA_Folder.id == curr.parent_id) & (TMA_Folder.user_id == user_id))

        folder.parent_id = parent_id
        folder.updated_at = datetime.datetime.now()
        folder.save()
        return folder
    except Exception as e:
        logger.error(f"Error moving folder {folder_id} to parent {parent_id}: {e}")
        raise e

def delete_folder(folder_id: int, user_id: int):
    """Мягко удаляет папку, перенося её дочерние колоды и подпапки на уровень выше."""
    try:
        folder = TMA_Folder.get_or_none((TMA_Folder.id == folder_id) & (TMA_Folder.user_id == user_id))
        if not folder:
            return False
        if folder.name == "📥 Входящие":
            raise ValueError("Нельзя удалить папку Входящие")
            
        # Переносим колоды на уровень выше (parent_id текущей папки)
        TMA_Deck.update(folder_id=folder.parent_id, updated_at=datetime.datetime.now()).where(
            (TMA_Deck.folder_id == folder_id) & (TMA_Deck.user_id == user_id)
        ).execute()
        
        # Переносим подпапки на уровень выше
        TMA_Folder.update(parent_id=folder.parent_id, updated_at=datetime.datetime.now()).where(
            (TMA_Folder.parent_id == folder_id) & (TMA_Folder.user_id == user_id)
        ).execute()

        folder.is_deleted = True
        folder.updated_at = datetime.datetime.now()
        folder.save()
        return True
    except Exception as e:
        logger.error(f"Error deleting folder {folder_id}: {e}", exc_info=True)
        raise e
