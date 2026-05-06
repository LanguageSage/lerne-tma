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

@router.get("/admin/models/{provider}")
async def list_models(provider: str, url: str = None):
    """Lists available models for a given provider."""
    return await ai_service.get_provider_models(provider, url)

@router.post("/ai/generate")
@router.post("/cards/ai-generate")
async def generate_card(request: PhraseRequest, user_id: int = Depends(get_user_id)):
    return await ai_service.generate_card_fields(user_id, request.phrase)
