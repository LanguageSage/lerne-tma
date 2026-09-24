from typing import Optional
from uuid import UUID
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
import logging

from api import services
from api.dependencies.auth import get_user_id

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/cards",
    tags=["cards"],
)

@router.post("/save")
async def save_card(data: dict, background_tasks: BackgroundTasks, user_id: int = Depends(get_user_id)):
    try:
        from api import models
        user = models.TMAUser.get_or_none(models.TMAUser.user_id == user_id)
        if user and user.is_guest:
            raise HTTPException(status_code=403, detail="Для создания и изменения карточек требуется авторизация через Telegram.")
        card = services.save_card(data, user_id)
        if card:
            auto_generate = data.get('auto_generate_audio', True)
            if auto_generate and not card.audio_path and card.front_text:
                background_tasks.add_task(services.ensure_card_audio, card, user_id)
            # Сразу возвращаем полные данные для StudyView
            return services.format_card_for_study(card, user_id)
        raise HTTPException(status_code=400, detail="Could not save card. Check logs.")
    except HTTPException:
        raise
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error(f"Router save_card error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/bulk-save")
def bulk_save_cards(data: dict, user_id: int = Depends(get_user_id)):
    try:
        from api import models
        user = models.TMAUser.get_or_none(models.TMAUser.user_id == user_id)
        if user and user.is_guest:
            raise HTTPException(status_code=403, detail="Для создания карточек требуется авторизация.")
        cards_list = data.get("cards", [])
        if not cards_list:
            raise HTTPException(status_code=400, detail="Список карточек пуст.")
        import_id = data.get('import_id')
        if import_id is not None:
            try:
                import_id = str(UUID(str(import_id)))
            except (ValueError, TypeError, AttributeError):
                raise HTTPException(status_code=422, detail='Некорректный import_id')
        res = services.bulk_save_cards(cards_list, user_id, import_id=import_id)
        if isinstance(res, dict):
            return res
        return {"status": "success", "count": len(res), "cards": res}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Router bulk_save error type=%s", type(e).__name__)
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/batch-move")
async def batch_move_cards(data: dict, user_id: int = Depends(get_user_id)):
    try:
        from api import models
        user = models.TMAUser.get_or_none(models.TMAUser.user_id == user_id)
        if user and user.is_guest:
            raise HTTPException(status_code=403, detail="Для перемещения карточек требуется авторизация.")
        card_ids = data.get("card_ids", [])
        target_deck_id = data.get("target_deck_id")
        on_duplicate = data.get("on_duplicate", "skip")
        if not card_ids:
            raise HTTPException(status_code=400, detail="Список карточек пуст.")
        if not target_deck_id:
            raise HTTPException(status_code=400, detail="Не указана целевая колода.")
        return services.batch_move_cards(card_ids, int(target_deck_id), user_id, on_duplicate=on_duplicate)
    except HTTPException:
        raise
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error(f"Router batch_move_cards error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/batch-copy")
async def batch_copy_cards(data: dict, user_id: int = Depends(get_user_id)):
    try:
        from api import models
        user = models.TMAUser.get_or_none(models.TMAUser.user_id == user_id)
        if user and user.is_guest:
            raise HTTPException(status_code=403, detail="Для копирования карточек требуется авторизация.")
        card_ids = data.get("card_ids", [])
        target_deck_id = data.get("target_deck_id")
        on_duplicate = data.get("on_duplicate", "skip")
        if not card_ids:
            raise HTTPException(status_code=400, detail="Список карточек пуст.")
        if not target_deck_id:
            raise HTTPException(status_code=400, detail="Не указана целевая колода.")
        return services.batch_copy_cards(card_ids, int(target_deck_id), user_id, on_duplicate=on_duplicate)
    except HTTPException:
        raise
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error(f"Router batch_copy_cards error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/batch-delete")
async def batch_delete_cards(data: dict, user_id: int = Depends(get_user_id)):
    try:
        from api import models
        user = models.TMAUser.get_or_none(models.TMAUser.user_id == user_id)
        if user and user.is_guest:
            raise HTTPException(status_code=403, detail="Для удаления карточек требуется авторизация.")
        card_ids = data.get("card_ids", [])
        if not card_ids:
            raise HTTPException(status_code=400, detail="Список карточек пуст.")
        return services.batch_delete_cards(card_ids, user_id)
    except HTTPException:
        raise
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error(f"Router batch_delete_cards error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{card_id}")
@router.patch("/{card_id}")
async def update_card(card_id: int, data: dict, user_id: int = Depends(get_user_id)):
    try:
        from api import models
        user = models.TMAUser.get_or_none(models.TMAUser.user_id == user_id)
        if user and user.is_guest:
            raise HTTPException(status_code=403, detail="Для создания и изменения карточек требуется авторизация.")
        data_to_save = dict(data) if data else {}
        data_to_save['id'] = card_id
        card = services.save_card(data_to_save, user_id)
        if card:
            return services.format_card_for_study(card, user_id)
        raise HTTPException(status_code=400, detail="Could not update card.")
    except HTTPException:
        raise
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error(f"Router update_card error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{card_id}")
def delete_card(card_id: int, user_id: int = Depends(get_user_id)):
    if services.delete_card(card_id, user_id):
        return {"status": "success"}
    raise HTTPException(status_code=404, detail="Card not found or access denied")

@router.post("/{card_id}/flag")
async def set_flag(card_id: int, data: dict, user_id: int = Depends(get_user_id)):
    flag = data.get("flag", 0)
    card = services.set_card_flag(card_id, user_id, flag)
    if card:
        return services.format_card_for_study(card, user_id)
    raise HTTPException(status_code=404, detail="Card not found")
    
@router.get("/duplicates")
def get_duplicates(user_id: int = Depends(get_user_id)):
    return services.get_duplicate_cards(user_id)


@router.post("/reorder")
def reorder_cards(data: dict, user_id: int = Depends(get_user_id)):
    from api import models
    card_ids = data.get('card_ids', [])
    try:
        user_decks = models.TMA_Deck.select(models.TMA_Deck.id).where(models.TMA_Deck.user_id == user_id)
        collab_decks = models.TMA_Collaborator.select(models.TMA_Collaborator.target_id).where(
            (models.TMA_Collaborator.user_id == user_id) &
            (models.TMA_Collaborator.target_type == 'deck') &
            (models.TMA_Collaborator.role.in_(['owner', 'editor']))
        )
        valid_decks = models.TMA_Deck.select(models.TMA_Deck.id).where(
            (models.TMA_Deck.id << user_decks) | (models.TMA_Deck.id << collab_decks)
        )
        with models.tma_db.atomic():
            for idx, card_id in enumerate(card_ids):
                models.TMA_Card.update(position=idx).where(
                    (models.TMA_Card.id == card_id) & (models.TMA_Card.deck_id << valid_decks)
                ).execute()
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Error reordering cards: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/search")
def search_cards(
    q: str = "",
    folder_id: Optional[int] = None,
    target_language: Optional[str] = "de",
    limit: int = 60,
    user_id: int = Depends(get_user_id)
):
    try:
        return services.search_all_in_scope(
            user_id=user_id,
            query=q,
            folder_id=folder_id,
            target_language=target_language,
            limit=limit
        )
    except Exception as e:
        logger.error(f"Error in search_cards router: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))



