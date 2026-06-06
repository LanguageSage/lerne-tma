import logging
from fastapi import APIRouter, Depends, HTTPException, Body, Request
from fastapi.responses import HTMLResponse, Response

from api.models import TMAUser, TMA_Deck, TMA_Card, TMAMedia
from api.dependencies.auth import get_user_id
from api.services.sharing_service import SharingService
from api.templates.share_templates import get_share_html

router = APIRouter(tags=["share"])
logger = logging.getLogger(__name__)

@router.post("/share/generate/{type}/{item_id}")
def generate_share(type: str, item_id: int, data: dict = Body(None), user_id: int = Depends(get_user_id)):
    """Generates or retrieves a unique share_id for a deck or card."""
    prefix = "d_" if type == "deck" else "c_"
    
    if type == "deck":
        item = TMA_Deck.get_or_none((TMA_Deck.id == item_id) & (TMA_Deck.user_id == user_id))
    elif type == "card":
        item = TMA_Card.get_or_none((TMA_Card.id == item_id) & (TMA_Card.is_deleted == False))
        if item and item.deck and item.deck.user_id != user_id:
            raise HTTPException(status_code=403, detail="Access denied")
    else:
        raise HTTPException(status_code=400, detail="Invalid item type")
        
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
        
    if not item.share_id:
        item.share_id = SharingService.generate_unique_share_id(prefix)
        item.save()
    
    share_id = item.share_id

    # Handle Screenshot if provided
    if data and "screenshot" in data:
        SharingService.save_screenshot(share_id, data["screenshot"])

    return {"status": "ok", "share_id": share_id}


@router.get("/share/info/{share_id}")
def get_share_info(share_id: str):
    """Gets public info about a shared item for preview."""
    if share_id.startswith("d_"):
        deck = TMA_Deck.get_or_none(TMA_Deck.share_id == share_id)
        if not deck:
            raise HTTPException(status_code=404, detail="Shared deck not found")
            
        creator = TMAUser.get_or_none(TMAUser.user_id == deck.user_id)
        return {
            "type": "deck",
            "id": deck.id,
            "name": deck.name,
            "level": deck.level,
            "topic": deck.topic,
            "creator_name": creator.username or creator.first_name if creator else "Unknown",
            "creator_avatar": creator.photo_url if creator else None
        }
    elif share_id.startswith("c_"):
        card = TMA_Card.get_or_none((TMA_Card.share_id == share_id) & (TMA_Card.is_deleted == False))
        if not card:
            raise HTTPException(status_code=404, detail="Shared card not found")
            
        creator_id = card.creator_id or (card.deck.user_id if card.deck else None)
        creator = TMAUser.get_or_none(TMAUser.user_id == creator_id)
        return {
            "type": "card",
            "id": card.id,
            "front_text": card.front_text,
            "back_text": card.back_text,
            "image_path": card.image_path,
            "creator_name": creator.username or creator.first_name if creator else "Unknown",
            "creator_avatar": creator.photo_url if creator else None
        }
    else:
        raise HTTPException(status_code=400, detail="Invalid share link format")

@router.post("/share/import")
def import_shared_item(payload: dict = Body(...), user_id: int = Depends(get_user_id)):
    """Imports a shared card into Inbox or a shared deck as a new standalone deck."""
    share_id = payload.get("share_id")
    if not share_id:
        raise HTTPException(status_code=400, detail="share_id is required")

    logger.info(f"IMPORT: User {user_id} is importing item {share_id}")
    try:
        resolution = payload.get("resolution")
        result = SharingService.import_item(share_id, user_id, resolution=resolution)
        logger.info(f"IMPORT SUCCESS: {share_id} for user {user_id}")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"IMPORT CRITICAL ERROR: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal error during import: {str(e)}")


@router.get("/share/v/{share_id}", response_class=HTMLResponse)
def view_shared_item(share_id: str, request: Request):
    """Returns a page with OpenGraph tags for beautiful link preview in Telegram/Socials."""
    info = get_share_info(share_id)
    title = info.get("name") or info.get("front_text") or "Lerne TMA"
    description = f"Поделился: {info.get('creator_name', 'Пользователь Lerne')}"
    if info.get("type") == "deck":
        description += f" | Уровень: {info.get('level', '—')} | Тема: {info.get('topic', '—')}"
    else:
        description += " | Новая карточка для изучения"

    host = request.headers.get("host", "tma-amber.vercel.app")
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    domain = f"{scheme}://{host}"
    
    preview_url = f"{domain}/api/preview/{share_id}.jpg?v=18"
    app_url = f"https://t.me/LerneDeutsch287_bot?startapp={share_id}"

    return get_share_html(title, description, preview_url, app_url)


@router.get("/preview/{share_id}.jpg")
@router.get("/share/v/{share_id}/preview.png")
@router.get("/share/v/{share_id}/preview.jpg")
def get_share_preview_image(share_id: str):
    """Returns a stored screenshot or generates a beautiful premium preview image."""
    filename = f"preview_{share_id}.png"
    media = TMAMedia.get_or_none(TMAMedia.filename == filename, TMAMedia.folder == 'previews')
    
    headers = {
        "Cache-Control": "public, max-age=31536000",
        "Access-Control-Allow-Origin": "*"
    }
    
    if media:
        return Response(content=bytes(media.content), media_type="image/jpeg", headers=headers)

    info = get_share_info(share_id)
    img_data = SharingService.get_preview_image(info, share_id)
    return Response(content=img_data, media_type="image/jpeg", headers=headers)




