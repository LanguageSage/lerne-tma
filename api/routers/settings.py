from fastapi import APIRouter, HTTPException, Depends
import logging

import models
from api import services
from api.dependencies.auth import get_user_id

logger = logging.getLogger(__name__)

ADMIN_USER_ID = 642478257

router = APIRouter(
    tags=["settings"],
)

# User Settings (Custom Prompts Manager)
import ai_service

@router.get("/user/prompts")
def get_user_prompts(user_id: int = Depends(get_user_id)):
    custom_prompts = []
    active_prompt_id = None
    try:
        for p in models.TMACustomPrompt.select().where(models.TMACustomPrompt.user_id == user_id).order_by(models.TMACustomPrompt.id.asc()):
            if p.is_active:
                active_prompt_id = p.id
            custom_prompts.append({
                "id": p.id,
                "name": p.name,
                "translation_prompt": p.translation_prompt or "",
                "context_prompt": p.context_prompt or "",
                "is_active": p.is_active
            })
    except Exception as e:
        logger.error(f"Error fetching custom prompts: {e}")
        
    return {
        "custom_prompts": custom_prompts,
        "active_prompt_id": active_prompt_id,
        "defaults": {
            "de": ai_service.DEFAULT_PROMPTS["de"],
            "ru": ai_service.DEFAULT_PROMPTS["ru"]
        }
    }

@router.post("/user/prompts")
def save_user_prompt(data: dict, user_id: int = Depends(get_user_id)):
    prompt_id = data.get('id')
    name = data.get('name', 'Мой промпт')
    translation_prompt = data.get('translation_prompt', '')
    context_prompt = data.get('context_prompt', '')
    
    if prompt_id:
        p = models.TMACustomPrompt.get_or_none((models.TMACustomPrompt.id == prompt_id) & (models.TMACustomPrompt.user_id == user_id))
        if not p:
            raise HTTPException(status_code=404, detail="Prompt not found")
        p.name = name
        p.translation_prompt = translation_prompt
        p.context_prompt = context_prompt
        p.save()
    else:
        p = models.TMACustomPrompt.create(
            user_id=user_id,
            name=name,
            translation_prompt=translation_prompt,
            context_prompt=context_prompt,
            is_active=False
        )
    return {"status": "ok", "id": p.id}

@router.delete("/user/prompts/{prompt_id}")
def delete_user_prompt(prompt_id: int, user_id: int = Depends(get_user_id)):
    p = models.TMACustomPrompt.get_or_none((models.TMACustomPrompt.id == prompt_id) & (models.TMACustomPrompt.user_id == user_id))
    if not p:
        raise HTTPException(status_code=404, detail="Prompt not found")
    p.delete_instance()
    return {"status": "ok"}

@router.post("/user/prompts/{prompt_id}/activate")
def activate_user_prompt(prompt_id: int, user_id: int = Depends(get_user_id)):
    # Deactivate all
    models.TMACustomPrompt.update(is_active=False).where(models.TMACustomPrompt.user_id == user_id).execute()
    # Activate selected
    updated = models.TMACustomPrompt.update(is_active=True).where(
        (models.TMACustomPrompt.id == prompt_id) & (models.TMACustomPrompt.user_id == user_id)
    ).execute()
    if not updated:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return {"status": "ok"}

@router.post("/user/prompts/deactivate")
def deactivate_user_prompts(user_id: int = Depends(get_user_id)):
    models.TMACustomPrompt.update(is_active=False).where(models.TMACustomPrompt.user_id == user_id).execute()
    return {"status": "ok"}

# Admin Settings
@router.get("/admin/settings")
def get_admin_settings(user_id: int = Depends(get_user_id)):
    if user_id != ADMIN_USER_ID:
        raise HTTPException(status_code=403, detail="Only admins can access settings")
    settings = {}
    for s in models.TMASetting.select():
        settings[s.key] = s.value
    return settings

@router.post("/admin/settings")
def save_admin_settings(data: dict, user_id: int = Depends(get_user_id)):
    if user_id != ADMIN_USER_ID:
        raise HTTPException(status_code=403, detail="Only admins can access settings")
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
async def list_models(provider: str = None, url: str = None, user_id: int = Depends(get_user_id)):
    """Unified endpoint for model listing, used by AITab."""
    import ai_service
    if not provider:
        provider_rec = models.TMASetting.get_or_none(models.TMASetting.key == "AI_PROVIDER")
        provider = provider_rec.value if provider_rec and provider_rec.value != "default" else "google"
    
    if not url:
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
    if user_id != ADMIN_USER_ID:
        raise HTTPException(status_code=403, detail="Only admins can view community decks")
    return services.get_community_content(user_id)

@router.post("/admin/community/promote/{deck_id}")
def promote_deck(deck_id: int, user_id: int = Depends(get_user_id)):
    if user_id != ADMIN_USER_ID:
        raise HTTPException(status_code=403, detail="Only admins can promote decks")
    result = services.promote_to_library(deck_id)
    if result:
        return {"status": "success", "new_library_id": result.id}
    raise HTTPException(status_code=500, detail="Failed to promote deck")
