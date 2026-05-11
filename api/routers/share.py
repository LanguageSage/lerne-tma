import uuid
import logging
from fastapi import APIRouter, Depends, HTTPException, Body
from typing import Optional
from playhouse.shortcuts import model_to_dict

from api.models import TMAUser, TMA_Deck, TMA_Card
from api.dependencies.auth import get_user_id

router = APIRouter(tags=["share"])
logger = logging.getLogger(__name__)

def generate_unique_share_id(prefix=""):
    return f"{prefix}{uuid.uuid4().hex[:12]}"

@router.post("/share/generate/{item_type}/{item_id}")
def generate_share_link(item_type: str, item_id: int, user_id: int = Depends(get_user_id)):
    """Generates a share_id for a card or deck if it doesn't have one."""
    if item_type == "deck":
        item = TMA_Deck.get_or_none((TMA_Deck.id == item_id) & (TMA_Deck.user_id == user_id))
        prefix = "d_"
    elif item_type == "card":
        # Need to join with deck to check ownership
        item = TMA_Card.select().join(TMA_Deck).where(
            (TMA_Card.id == item_id) & (TMA_Deck.user_id == user_id)
        ).first()
        prefix = "c_"
    else:
        raise HTTPException(status_code=400, detail="Invalid item type")
        
    if not item:
        raise HTTPException(status_code=404, detail="Item not found or access denied")
        
    if not item.share_id:
        item.share_id = generate_unique_share_id(prefix)
        # For cards, also ensure creator_id is set
        if item_type == "card" and not item.creator_id:
            item.creator_id = user_id
        item.save()
        
    return {"status": "ok", "share_id": item.share_id}

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
        card = TMA_Card.get_or_none(TMA_Card.share_id == share_id)
        if not card:
            raise HTTPException(status_code=404, detail="Shared card not found")
            
        creator_id = card.creator_id or card.deck.user_id
        creator = TMAUser.get_or_none(TMAUser.user_id == creator_id)
        return {
            "type": "card",
            "id": card.id,
            "front_text": card.front_text,
            "back_text": card.back_text,
            "creator_name": creator.username or creator.first_name if creator else "Unknown",
            "creator_avatar": creator.photo_url if creator else None
        }
    else:
        raise HTTPException(status_code=400, detail="Invalid share link format")

@router.post("/share/import")
def import_shared_item(
    payload: dict = Body(...), 
    user_id: int = Depends(get_user_id)
):
    """Imports a shared card or deck to the user's library."""
    share_id = payload.get("share_id")
    target_deck_id = payload.get("target_deck_id")

    if not share_id:
        raise HTTPException(status_code=400, detail="share_id is required")

    if share_id.startswith("d_"):
        source_deck = TMA_Deck.get_or_none(TMA_Deck.share_id == share_id)
        if not source_deck:
            raise HTTPException(status_code=404, detail="Shared deck not found")
            
        # Create a copy of the deck
        new_deck = TMA_Deck.create(
            user_id=user_id,
            name=f"{source_deck.name} (Imported)",
            level=source_deck.level,
            topic=source_deck.topic
        )
        
        # Copy all cards
        source_cards = TMA_Card.select().where((TMA_Card.deck == source_deck) & (TMA_Card.is_deleted == False))
        for card in source_cards:
            TMA_Card.create(
                deck=new_deck,
                front_text=card.front_text,
                back_text=card.back_text,
                context=card.context,
                image_path=card.image_path,
                image_data=card.image_data,
                audio_path=card.audio_path,
                tags=card.tags,
                metadata=card.metadata,
                card_type=card.card_type,
                difficulty=card.difficulty,
                topics=card.topics,
                source=card.source,
                creator_id=card.creator_id or source_deck.user_id # Preserve original creator
            )
            
        return {"status": "ok", "type": "deck", "new_id": new_deck.id}
        
    elif share_id.startswith("c_"):
        if not target_deck_id:
            raise HTTPException(status_code=400, detail="target_deck_id is required for importing a card")
            
        # Verify target deck belongs to user
        target_deck = TMA_Deck.get_or_none((TMA_Deck.id == target_deck_id) & (TMA_Deck.user_id == user_id))
        if not target_deck:
            raise HTTPException(status_code=404, detail="Target deck not found or access denied")
            
        source_card = TMA_Card.get_or_none(TMA_Card.share_id == share_id)
        if not source_card:
            raise HTTPException(status_code=404, detail="Shared card not found")
            
        # Create copy of the card
        new_card = TMA_Card.create(
            deck=target_deck,
            front_text=source_card.front_text,
            back_text=source_card.back_text,
            context=source_card.context,
            image_path=source_card.image_path,
            image_data=source_card.image_data,
            audio_path=source_card.audio_path,
            tags=source_card.tags,
            metadata=source_card.metadata,
            card_type=source_card.card_type,
            difficulty=source_card.difficulty,
            topics=source_card.topics,
            source=source_card.source,
            creator_id=source_card.creator_id or source_card.deck.user_id
        )
        
        return {"status": "ok", "type": "card", "new_id": new_card.id}
    else:
        raise HTTPException(status_code=400, detail="Invalid share link format")
