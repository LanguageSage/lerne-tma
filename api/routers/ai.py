from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
import logging

import ai_service
from api.dependencies.auth import get_user_id

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["ai"],
)

class PhraseRequest(BaseModel):
    phrase: str
    target_language: str = "de"
    native_language: str = None

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
    return await ai_service.generate_card_fields(user_id, request.phrase, request.target_language, request.native_language)

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

    # If deck_id is provided, auto-create the cards in DB
    if request.deck_id and "cards" in res and res["cards"]:
        target_deck_id = int(request.deck_id) if str(request.deck_id).isdigit() else None
        if target_deck_id:
            created_cards = []
            for card_data in res["cards"]:
                new_c = TMA_Card.create(
                    deck_id=target_deck_id,
                    front_text=card_data.get("front", ""),
                    back_text=card_data.get("back", ""),
                    context=card_data.get("context", ""),
                    source="ai_batch",
                    created_at=datetime.datetime.now(),
                    updated_at=datetime.datetime.now()
                )
                created_cards.append({
                    "id": new_c.id,
                    "deck_id": new_c.deck_id,
                    "front_text": new_c.front_text,
                    "back_text": new_c.back_text,
                    "context": new_c.context
                })
            res["saved_cards"] = created_cards

    return res
