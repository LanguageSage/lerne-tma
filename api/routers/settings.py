from fastapi import APIRouter, HTTPException, Depends
import logging

import models
from api import services
from api.dependencies.auth import get_user_id

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["settings"],
)

# User Settings (Prompts)
@router.get("/user/prompts")
def get_user_prompts(user_id: int = Depends(get_user_id)):
    p = models.TMAUserPrompt.get_or_none(models.TMAUserPrompt.user_id == user_id)
    if not p:
        return {"translation_prompt": "", "context_prompt": ""}
    return {
        "translation_prompt": p.translation_prompt or "",
        "context_prompt": p.context_prompt or ""
    }

@router.post("/user/prompts")
def save_user_prompts(data: dict, user_id: int = Depends(get_user_id)):
    p, created = models.TMAUserPrompt.get_or_create(user_id=user_id)
    p.translation_prompt = data.get('translation_prompt')
    p.context_prompt = data.get('context_prompt')
    p.save()
    return {"status": "ok"}

# Admin Settings
@router.get("/admin/settings")
def get_admin_settings():
    settings = {}
    for s in models.TMASetting.select():
        settings[s.key] = s.value
    return settings

@router.post("/admin/settings")
def save_admin_settings(data: dict):
    import datetime
    try:
        now = datetime.datetime.now()
        for k, v in data.items():
            key = k.upper()
            # Убеждаемся, что передаем начальные значения для новых записей
            s, created = models.TMASetting.get_or_create(
                key=key, 
                defaults={'value': str(v), 'updated_at': now}
            )
            if not created:
                s.value = str(v)
                s.updated_at = now
                s.save()
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Error saving settings: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/settings/models")
async def list_models(user_id: int = Depends(get_user_id)):
    """Unified endpoint for model listing, used by AITab."""
    import ai_service
    # Получаем текущего провайдера из настроек
    provider_rec = models.TMASetting.get_or_none(models.TMASetting.key == "AI_PROVIDER")
    provider = provider_rec.value if provider_rec and provider_rec.value != "default" else "google"
    
    # Получаем URL для Ollama если нужно
    url_rec = models.TMASetting.get_or_none(models.TMASetting.key == "OLLAMA_URL")
    url = url_rec.value if url_rec else None
    
    return await ai_service.get_provider_models(provider, url)

@router.get("/settings/test-ai")
async def test_ai_connection(user_id: int = Depends(get_user_id)):
    """Unified test endpoint for AITab."""
    import ai_service
    import ai_clients
    provider, ai_key, model = ai_service.get_ai_config()
    
    # Use default model for test if not set
    if not model:
        model = "gemini-1.5-flash" if provider == "google" else "llama3-8b-8192"
        
    client = ai_clients.AIService(provider=provider, api_key=ai_key)
    response, success = await client.chat_completion(
        system_prompt="Return 'OK'.",
        user_message="Test.",
        model=model
    )
    if success:
        return {"status": "ok"}
    return {"status": "error", "error": response}

@router.get("/admin/presets")
def get_admin_presets():
    return []

# Community Moderation
@router.get("/admin/community/decks")
def get_community_decks(user_id: int = Depends(get_user_id)):
    return services.get_community_content(user_id)

@router.post("/admin/community/promote/{deck_id}")
def promote_deck(deck_id: int):
    result = services.promote_to_library(deck_id)
    if result:
        return {"status": "success", "new_library_id": result.id}
    raise HTTPException(status_code=500, detail="Failed to promote deck")
