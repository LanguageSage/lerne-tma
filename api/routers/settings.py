from fastapi import APIRouter, HTTPException, Depends
import logging

from api import models
from api import services
from api.dependencies.auth import get_user_id

logger = logging.getLogger(__name__)

ADMIN_USER_ID = 642478257

router = APIRouter(
    tags=["settings"],
)

# User Settings (Custom Prompts Manager)
from api import ai_service

SYSTEM_PRESETS = [
    {
        "id": "preset_a2",
        "name": "🎯 Уровень A2 — Базовый немецкий",
        "level": "A2",
        "badge": "Базовый",
        "description": "Разбор слов и подробная грамматика с 3 несложными примерами",
        "instruction": "объясни слова с переводом на русский и подробно грамматику, затем 3 примера с другими вариантами того же смысла. Изучаемый язык немецкий уровня А2, родной русский. пиши немецкий текст сложностью не выше уровня А2"
    },
    {
        "id": "preset_b1",
        "name": "⚡ Уровень B1 — Уверенный немецкий",
        "level": "B1",
        "badge": "По умолчанию",
        "description": "Стандарт системы: подробный разбор грамматики и 3 примера уровня B1",
        "instruction": "объясни слова с переводом на русский и подробно грамматику, затем 3 примера с другими вариантами того же смысла. Изучаемый язык немецкий, родной русский. пиши немецкий текст сложностью не выше уровня Б1"
    },
    {
        "id": "preset_b2",
        "name": "🚀 Уровень B2 — Продвинутый немецкий",
        "level": "B2",
        "badge": "Продвинутый",
        "description": "Разбор слов, подбор синонимов, подробная грамматика и примеры уровня B2",
        "instruction": "объясни слова с переводом на русский, синонимы и подробно грамматику, затем 3 примера с другими вариантами того же смысла. Изучаемый язык немецкий, родной русский. пиши немецкий текст сложностью уровня Б2"
    }
]

@router.get("/user/prompts")
def get_user_prompts(target_language: Optional[str] = "de", user_id: int = Depends(get_user_id)):
    custom_prompts = []
    active_prompt_id = None
    target_lang = (target_language or "de").lower().strip()
    
    try:
        from api.services.language_service import get_language_config
        lang_cfg = get_language_config(target_lang)
        
        query = models.TMACustomPrompt.select().where(
            (models.TMACustomPrompt.user_id == user_id) & 
            ((models.TMACustomPrompt.target_language == target_lang) | (models.TMACustomPrompt.target_language.is_null() if target_lang == 'de' else False))
        ).order_by(models.TMACustomPrompt.id.asc())

        for p in query:
            if p.is_active:
                active_prompt_id = p.id
            custom_prompts.append({
                "id": p.id,
                "name": p.name,
                "translation_prompt": p.translation_prompt or "",
                "context_prompt": p.context_prompt or "",
                "target_language": p.target_language or "de",
                "is_active": p.is_active
            })
    except Exception as e:
        logger.error(f"Error fetching custom prompts: {e}")
        
    from api.services.language_service import get_language_config
    lang_cfg = get_language_config(target_lang)

    return {
        "custom_prompts": custom_prompts,
        "active_prompt_id": active_prompt_id,
        "target_language": target_lang,
        "language_name": lang_cfg["name"],
        "language_flag": lang_cfg["flag"],
        "system_presets": [
            {
                "id": "preset_b1",
                "name": f"Промпт B1 ({lang_cfg['name']})",
                "badge": "Рекомендуемый",
                "level": "B1",
                "description": f"Оптимальный баланс: разбор слов, объяснение грамматики {lang_cfg['name'].lower()} языка и 3 примера.",
                "instruction": lang_cfg["default_prompts"]["analysis"]
            }
        ],
        "defaults": {
            "de": lang_cfg["default_prompts"]["translation"],
            "ru": lang_cfg["default_prompts"]["analysis"]
        }
    }

@router.post("/user/prompts")
def save_user_prompt(data: dict, user_id: int = Depends(get_user_id)):
    prompt_id = data.get('id')
    name = data.get('name', 'Мой промпт')
    translation_prompt = data.get('translation_prompt', '')
    context_prompt = data.get('context_prompt', '')
    target_language = (data.get('target_language') or 'de').lower().strip()
    
    # Fallback for single prompt input
    single_prompt = data.get('prompt')
    if single_prompt:
        if not translation_prompt:
            translation_prompt = single_prompt
        if not context_prompt:
            context_prompt = single_prompt
    
    if prompt_id:
        p = models.TMACustomPrompt.get_or_none((models.TMACustomPrompt.id == prompt_id) & (models.TMACustomPrompt.user_id == user_id))
        if not p:
            raise HTTPException(status_code=404, detail="Prompt not found")
        p.name = name
        p.translation_prompt = translation_prompt
        p.context_prompt = context_prompt
        p.target_language = target_language
        p.save()
    else:
        p = models.TMACustomPrompt.create(
            user_id=user_id,
            name=name,
            translation_prompt=translation_prompt,
            context_prompt=context_prompt,
            target_language=target_language,
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
def activate_user_prompt(prompt_id: int, data: dict = None, user_id: int = Depends(get_user_id)):
    target_lang = (data.get('target_language') if data else 'de') or 'de'
    # Deactivate all for target_language
    models.TMACustomPrompt.update(is_active=False).where(
        (models.TMACustomPrompt.user_id == user_id) & 
        ((models.TMACustomPrompt.target_language == target_lang) | (models.TMACustomPrompt.target_language.is_null() if target_lang == 'de' else False))
    ).execute()
    # Activate selected
    updated = models.TMACustomPrompt.update(is_active=True).where(
        (models.TMACustomPrompt.id == prompt_id) & (models.TMACustomPrompt.user_id == user_id)
    ).execute()
    if not updated:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return {"status": "ok"}

@router.post("/user/prompts/deactivate")
def deactivate_user_prompts(data: dict = None, user_id: int = Depends(get_user_id)):
    target_lang = (data.get('target_language') if data else 'de') or 'de'
    models.TMACustomPrompt.update(is_active=False).where(
        (models.TMACustomPrompt.user_id == user_id) & 
        ((models.TMACustomPrompt.target_language == target_lang) | (models.TMACustomPrompt.target_language.is_null() if target_lang == 'de' else False))
    ).execute()
    return {"status": "ok"}

@router.post("/user/prompts/preset/{preset_id}/activate")
def activate_system_preset(preset_id: str, user_id: int = Depends(get_user_id)):
    preset = next((p for p in SYSTEM_PRESETS if p["id"] == preset_id), None)
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    
    models.TMACustomPrompt.update(is_active=False).where(models.TMACustomPrompt.user_id == user_id).execute()
    
    p = models.TMACustomPrompt.get_or_none((models.TMACustomPrompt.user_id == user_id) & (models.TMACustomPrompt.name == preset["name"]))
    if not p:
        p = models.TMACustomPrompt.create(
            user_id=user_id,
            name=preset["name"],
            translation_prompt=preset["instruction"],
            context_prompt=preset["instruction"],
            is_active=True
        )
    else:
        p.translation_prompt = preset["instruction"]
        p.context_prompt = preset["instruction"]
        p.is_active = True
        p.save()
    return {"status": "ok", "id": p.id}

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

# Admin Prompt Management Endpoints
@router.get("/admin/prompts/all")
def get_all_prompts():
    """Returns all custom prompts from all users along with author user details."""
    prompts_data = []
    try:
        user_map = {}
        for u in models.TMAUser.select():
            name = f"{u.first_name or ''} {u.last_name or ''}".strip() or f"User {u.user_id}"
            user_map[u.user_id] = {
                "name": name,
                "username": u.username or "",
                "user_id": u.user_id
            }

        global_setting = models.TMASetting.get_or_none(models.TMASetting.key == "GLOBAL_SYSTEM_PROMPT_ID")
        global_prompt_id = int(global_setting.value) if (global_setting and global_setting.value) else None

        for p in models.TMACustomPrompt.select().order_by(models.TMACustomPrompt.id.desc()):
            user_info = user_map.get(p.user_id, {
                "name": f"User {p.user_id}",
                "username": "",
                "user_id": p.user_id
            })
            prompts_data.append({
                "id": p.id,
                "user_id": p.user_id,
                "author_name": user_info["name"],
                "author_username": user_info["username"],
                "name": p.name,
                "translation_prompt": p.translation_prompt or "",
                "context_prompt": p.context_prompt or "",
                "is_active": p.is_active,
                "is_global_default": p.id == global_prompt_id,
                "created_at": str(p.created_at) if hasattr(p, 'created_at') else ""
            })
    except Exception as e:
        logger.error(f"Error fetching all prompts: {e}")
        
    return {
        "prompts": prompts_data,
        "global_prompt_id": global_prompt_id
    }

@router.post("/admin/prompts/set-global/{prompt_id}")
def set_global_default_prompt(prompt_id: int):
    """Sets a specific prompt ID as the global default system prompt for all users."""
    import datetime
    try:
        if prompt_id != 0:
            prompt = models.TMACustomPrompt.get_or_none(models.TMACustomPrompt.id == prompt_id)
            if not prompt:
                raise HTTPException(status_code=404, detail="Prompt not found")
        
        now = datetime.datetime.now()
        s, _ = models.TMASetting.get_or_create(key="GLOBAL_SYSTEM_PROMPT_ID", defaults={'value': str(prompt_id), 'updated_at': now})
        s.value = str(prompt_id)
        s.updated_at = now
        s.save()
        
        return {"status": "ok", "global_prompt_id": prompt_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error setting global default prompt: {e}")
        raise HTTPException(status_code=500, detail=str(e))

