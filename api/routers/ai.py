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

@router.post("/ai/generate")
@router.post("/cards/ai-generate")
async def generate_card(request: PhraseRequest, user_id: int = Depends(get_user_id)):
    return await ai_service.generate_card_fields(user_id, request.phrase)
