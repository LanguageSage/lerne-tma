import datetime
import logging
from ..models import TMA_Folder, TMA_Deck, tma_db

logger = logging.getLogger(__name__)

def get_active_folders(user_id: int):
    """Возвращает все активные (не удаленные) папки пользователя."""
    try:
        folders = list(TMA_Folder.select().where(
            (TMA_Folder.user_id == user_id) & (TMA_Folder.is_deleted == False)
        ).order_by(TMA_Folder.id.asc()))
        
        return [{
            "id": f.id,
            "name": f.name,
            "parent_id": getattr(f, 'parent_id', None),
            "color": f.color
        } for f in folders]
    except Exception as e:
        logger.error(f"Error in get_active_folders: {e}")
        return []

def create_folder(name: str, user_id: int, parent_id: int = None, color: str = None):
    """Создает новую папку для пользователя."""
    try:
        # Проверяем родителя, если указан
        if parent_id is not None:
            parent = TMA_Folder.get_or_none((TMA_Folder.id == parent_id) & (TMA_Folder.user_id == user_id))
            if not parent:
                raise ValueError("Родительская папка не найдена")

        folder = TMA_Folder.create(
            user_id=user_id,
            name=name,
            parent_id=parent_id,
            color=color,
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
        folder.name = name
        folder.updated_at = datetime.datetime.now()
        folder.save()
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
        logger.error(f"Error deleting folder {folder_id}: {e}")
        return False
