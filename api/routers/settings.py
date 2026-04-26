from fastapi import APIRouter, HTTPException, Depends
import logging

import models
import services
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
    for k, v in data.items():
        key = k.upper()
        s, created = models.TMASetting.get_or_create(key=key)
        s.value = str(v)
        s.save()
    return {"status": "ok"}

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
