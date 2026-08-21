from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
import logging
import datetime
import asyncio
from api import ai_service, models, services
from api.dependencies.auth import get_user_id

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["ai"],
)

class PhraseRequest(BaseModel):
    phrase: str
    target_language: str = "de"
    native_language: str = None
    action_type: str = "full_card"

@router.get("/admin/models/{provider}")
async def list_models(provider: str, url: str = None):
    """Lists available models for a given provider."""
    return await ai_service.get_provider_models(provider, url)

class TestAIRequest(BaseModel):
    provider: str
    model: str
    api_key: str = None
    ollama_url: str = None

@router.post("/admin/test-ai")
async def test_ai_connection(request: TestAIRequest):
    """Tests if the AI provider is reachable and working."""
    import ai_clients
    client = ai_clients.AIService(
        provider=request.provider,
        api_key=request.api_key,
        ollama_url=request.ollama_url
    )
    response, success = await client.chat_completion(
        system_prompt="Return 'OK'.",
        user_message="Test connection.",
        model=request.model
    )
    if success:
        return {"status": "success", "message": "Connection successful!"}
    else:
        return {"status": "error", "message": response}

import datetime
from api.models import TMA_Card

class BatchRequest(BaseModel):
    text: str
    target_language: str = "de"
    native_language: str = None
    deck_id: str = None

@router.post("/ai/generate")
@router.post("/cards/ai-generate")
async def generate_card(request: PhraseRequest, user_id: int = Depends(get_user_id)):
    return await ai_service.generate_card_fields(
        user_id=user_id,
        phrase=request.phrase,
        target_language=request.target_language,
        native_language=request.native_language,
        action_type=request.action_type
    )

@router.post("/ai/generate-batch")
@router.post("/cards/ai-generate-batch")
async def generate_batch_cards(request: BatchRequest, user_id: int = Depends(get_user_id)):
    res = await ai_service.generate_batch_card_fields(
        user_id=user_id,
        text=request.text,
        target_language=request.target_language,
        native_language=request.native_language
    )
    if "error" in res:
        raise HTTPException(status_code=400, detail=res["error"])

    # Check if AI level detection is enabled (Pass 2)
    from api import models, services
    detect_level_setting = models.TMASetting.get_or_none(models.TMASetting.key == "AI_DETECT_LEVEL")
    detect_level = (detect_level_setting.value.lower() != "false") if detect_level_setting else True

    levels = []
    if detect_level and "cards" in res and res["cards"]:
        phrases = [c.get("front") or c.get("front_text") or "" for c in res["cards"]]
        try:
            levels = await ai_service.classify_phrases_batch(phrases, request.target_language or "de")
        except Exception as e:
            logger.warning(f"Pass 2 level classification error: {e}")
            levels = ["A1"] * len(res["cards"])

    # If deck_id is provided, auto-create the cards in DB
    if request.deck_id and "cards" in res and res["cards"]:
        target_deck_id = int(request.deck_id) if str(request.deck_id).isdigit() else None
        if target_deck_id:
            from peewee import fn
            created_cards = []
            with models.tma_db.atomic():
                max_pos = models.TMA_Card.select(fn.MAX(models.TMA_Card.position)).where(
                    (models.TMA_Card.deck_id == target_deck_id) & (models.TMA_Card.is_deleted == False)
                ).scalar() or 0

                for idx, card_data in enumerate(res["cards"]):
                    card_level = levels[idx] if idx < len(levels) else (card_data.get("level") if detect_level else None)
                    card_tags = card_level if card_level else None
                    card_pos = max_pos + idx + 1
                    new_c = models.TMA_Card.create(
                        deck_id=target_deck_id,
                        front_text=card_data.get("front", ""),
                        back_text=card_data.get("back", ""),
                        context=card_data.get("context", ""),
                        tags=card_tags,
                        source="ai_batch",
                        position=card_pos,
                        created_at=datetime.datetime.now(),
                        updated_at=datetime.datetime.now()
                    )
                    created_cards.append({
                        "id": new_c.id,
                        "deck_id": new_c.deck_id,
                        "front_text": new_c.front_text,
                        "front": new_c.front_text,
                        "back_text": new_c.back_text,
                        "back": new_c.back_text,
                        "context": new_c.context,
                        "level": card_level,
                        "tags": new_c.tags,
                        "position": card_pos
                    })
                    # Schedule background audio generation (non-blocking)
                    asyncio.create_task(services.ensure_card_audio(new_c, user_id))
            res["saved_cards"] = created_cards
    elif "cards" in res and res["cards"]:
        for idx, card_data in enumerate(res["cards"]):
            if detect_level and idx < len(levels):
                card_data["level"] = levels[idx]
                card_data["tags"] = levels[idx]

    return res


class ClassifyBatchRequest(BaseModel):
    deck_id: Optional[int] = None
    card_ids: Optional[list[int]] = None
    target_language: Optional[str] = "de"


@router.post("/cards/classify-batch")
async def classify_cards_batch_endpoint(request: ClassifyBatchRequest, user_id: int = Depends(get_user_id)):
    """Batch classifies CEFR levels for existing cards in a deck or by card IDs (usable by Lerne UA and TMA)."""
    cards_query = []
    if request.deck_id:
        cards_query = list(models.TMA_Card.select().where(
            (models.TMA_Card.deck_id == request.deck_id) & (models.TMA_Card.is_deleted == False)
        ).order_by(models.TMA_Card.position.asc(), models.TMA_Card.id.asc()))
    elif request.card_ids:
        cards_query = list(models.TMA_Card.select().where(
            (models.TMA_Card.id << request.card_ids) & (models.TMA_Card.is_deleted == False)
        ))

    if not cards_query:
        return {"status": "ok", "updated_count": 0, "cards": []}

    phrases = [c.front_text or "" for c in cards_query]
    levels = await ai_service.classify_phrases_batch(phrases, request.target_language or "de")

    updated_cards = []
    with models.tma_db.atomic():
        for idx, card in enumerate(cards_query):
            lvl = levels[idx] if idx < len(levels) else "A1"
            curr_tags = card.tags or ""
            cleaned_tags = ",".join([t for t in curr_tags.split(",") if t and t.upper() not in {"A1", "A2", "B1", "B2", "C1", "C2"}])
            new_tags = f"{cleaned_tags},{lvl}".strip(",") if cleaned_tags else lvl
            card.tags = new_tags
            card.updated_at = datetime.datetime.now()
            card.save()
            updated_cards.append({
                "id": card.id,
                "deck_id": card.deck_id,
                "front": card.front_text,
                "level": lvl,
                "tags": new_tags
            })

    return {
        "status": "ok",
        "updated_count": len(updated_cards),
        "cards": updated_cards
    }
