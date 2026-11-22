import datetime
from typing import Optional, Dict, Any, Literal
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, ConfigDict
import logging

from api import models
from api import services
from api.dependencies.auth import get_user_id
from api.permissions import is_admin
from api.services.user_settings import read_user_settings, save_user_settings

router = APIRouter(
    tags=["settings"],
)

logger = logging.getLogger(__name__)

# User Settings (Custom Prompts Manager)
from api import ai_service, ai_clients
from api.db_workers import db_phases, db_worker, run_db



@router.get("/user/settings")
@db_worker
def get_user_settings_endpoint(user_id: int = Depends(get_user_id)):
    try:
        return {**read_user_settings(user_id), '_designMigrationVersion': 1}
    except Exception as e:
        logger.error(f"Error fetching user settings for {user_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to read user settings")


@router.post("/user/settings")
@db_worker
def save_user_settings_endpoint(data: dict, user_id: int = Depends(get_user_id)):
    try:
        if not isinstance(data, dict):
            raise HTTPException(status_code=400, detail="Settings must be a dictionary")
        current = save_user_settings(user_id, data)
        return {"status": "success", "settings": current, "designMigrationVersion": 1}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving user settings for {user_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to save user settings")

@router.get("/user/reminder-settings")
@db_worker
def get_user_reminder_settings_endpoint(user_id: int = Depends(get_user_id)):
    return services.get_user_reminder_settings(user_id)

@router.post("/user/reminder-settings")
@db_worker
def save_user_reminder_settings_endpoint(data: dict, user_id: int = Depends(get_user_id)):
    success = services.save_user_reminder_settings(user_id, data)
    if success:
        return {"status": "success", "settings": services.get_user_reminder_settings(user_id)}
    raise HTTPException(status_code=500, detail="Failed to save reminder settings")

@router.get("/user/prompts")
@db_worker
def get_user_prompts(target_language: str = "de", native_language: str = None, user_id: int = Depends(get_user_id)):
    custom_prompts = []
    active_standard_prompt_id = None
    active_trainer_prompt_id = None
    active_exam_prompt_id = None
    active_standard_preset_id = None
    active_trainer_preset_id = None
    active_exam_preset_id = None
    target_lang = (target_language or "de").lower().strip()
    
    from api.services.language_service import get_language_config, get_system_presets, get_prompt_for_phrase
    if not native_language:
        native_rec = models.TMASetting.get_or_none(models.TMASetting.key == "NATIVE_LANGUAGE")
        native_language = native_rec.value if native_rec else "ru"
        
    native_lang = (native_language or "ru").lower().strip()
    lang_cfg = get_language_config(target_lang, native_lang)
    presets = get_system_presets(target_lang, native_lang)
    
    try:
        query = models.TMACustomPrompt.select().where(
            (models.TMACustomPrompt.user_id == user_id) & 
            ((models.TMACustomPrompt.target_language == target_lang) | (models.TMACustomPrompt.target_language.is_null() if target_lang == 'de' else False))
        ).order_by(models.TMACustomPrompt.id.asc())

        for p in query:
            ptype = p.prompt_type or 'standard'
            if p.is_active:
                if ptype == 'trainer':
                    active_trainer_prompt_id = p.id
                    matched_preset = next((pr for pr in presets if pr["name"] == p.name), None)
                    if matched_preset:
                        active_trainer_preset_id = matched_preset["id"]
                elif ptype == 'exam':
                    active_exam_prompt_id = p.id
                    matched_preset = next((pr for pr in presets if pr["name"] == p.name), None)
                    if matched_preset:
                        active_exam_preset_id = matched_preset["id"]
                else:
                    active_standard_prompt_id = p.id
                    matched_preset = next((pr for pr in presets if pr["name"] == p.name), None)
                    if matched_preset:
                        active_standard_preset_id = matched_preset["id"]

            custom_prompts.append({
                "id": p.id,
                "name": p.name,
                "instruction": p.translation_prompt or p.context_prompt or "",
                "translation_prompt": p.translation_prompt or "",
                "context_prompt": p.context_prompt or "",
                "target_language": p.target_language or "de",
                "prompt_type": ptype,
                "is_active": p.is_active
            })
            
        if not active_standard_prompt_id and not active_standard_preset_id:
            active_standard_preset_id = "preset_b1"
        if not active_trainer_prompt_id and not active_trainer_preset_id:
            active_trainer_preset_id = "preset_trainer"
        if not active_exam_prompt_id and not active_exam_preset_id:
            active_exam_preset_id = "preset_exam"
    except Exception as e:
        logger.error(f"Error fetching custom prompts: {e}")

    return {
        "custom_prompts": custom_prompts,
        "active_prompt_id": active_standard_prompt_id,
        "active_preset_id": active_standard_preset_id or "preset_b1",
        "active_standard_prompt_id": active_standard_prompt_id,
        "active_trainer_prompt_id": active_trainer_prompt_id,
        "active_exam_prompt_id": active_exam_prompt_id,
        "active_standard_preset_id": active_standard_preset_id or "preset_b1",
        "active_trainer_preset_id": active_trainer_preset_id or "preset_trainer",
        "active_exam_preset_id": active_exam_preset_id or "preset_exam",
        "target_language": target_lang,
        "native_language": native_lang,
        "language_name": lang_cfg["name"],
        "language_flag": lang_cfg["flag"],
        "system_presets": presets,
        "defaults": {
            "translation": get_prompt_for_phrase("{phrase}", target_lang, native_lang),
            "analysis": get_prompt_for_phrase("phrase", target_lang, native_lang)
        }
    }

@router.post("/user/prompts")
@db_worker
def save_user_prompt(data: dict, user_id: int = Depends(get_user_id)):
    prompt_id = data.get('id')
    name = data.get('name', 'Мой промпт')
    translation_prompt = data.get('translation_prompt', '')
    context_prompt = data.get('context_prompt', '')
    target_language = (data.get('target_language') or 'de').lower().strip()
    prompt_type = data.get('prompt_type', 'standard')
    
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
        p.prompt_type = prompt_type
        p.save()
    else:
        p = models.TMACustomPrompt.create(
            user_id=user_id,
            name=name,
            translation_prompt=translation_prompt,
            context_prompt=context_prompt,
            target_language=target_language,
            prompt_type=prompt_type,
            is_active=False
        )
    return {"status": "ok", "id": p.id}

@router.delete("/user/prompts/{prompt_id}")
@db_worker
def delete_user_prompt(prompt_id: int, user_id: int = Depends(get_user_id)):
    p = models.TMACustomPrompt.get_or_none((models.TMACustomPrompt.id == prompt_id) & (models.TMACustomPrompt.user_id == user_id))
    if not p:
        raise HTTPException(status_code=404, detail="Prompt not found")
    p.delete_instance()
    return {"status": "ok"}

@router.post("/user/prompts/{prompt_id}/activate")
@db_worker
def activate_user_prompt(prompt_id: int, data: dict = None, user_id: int = Depends(get_user_id)):
    target_lang = (data.get('target_language') if data else 'de') or 'de'
    target_type = (data.get('prompt_type') if data else None)
    
    p_target = models.TMACustomPrompt.get_or_none((models.TMACustomPrompt.id == prompt_id) & (models.TMACustomPrompt.user_id == user_id))
    if not p_target:
        raise HTTPException(status_code=404, detail="Prompt not found")
    
    ptype = target_type or p_target.prompt_type or 'standard'

    # Deactivate all for target_language and matching prompt_type
    models.TMACustomPrompt.update(is_active=False).where(
        (models.TMACustomPrompt.user_id == user_id) & 
        (models.TMACustomPrompt.prompt_type == ptype) &
        ((models.TMACustomPrompt.target_language == target_lang) | (models.TMACustomPrompt.target_language.is_null() if target_lang == 'de' else False))
    ).execute()
    
    p_target.is_active = True
    p_target.save()
    return {"status": "ok"}

@router.post("/user/prompts/deactivate")
@db_worker
def deactivate_user_prompts(data: dict = None, user_id: int = Depends(get_user_id)):
    target_lang = (data.get('target_language') if data else 'de') or 'de'
    ptype = (data.get('prompt_type') if data else 'standard') or 'standard'
    models.TMACustomPrompt.update(is_active=False).where(
        (models.TMACustomPrompt.user_id == user_id) & 
        (models.TMACustomPrompt.prompt_type == ptype) &
        ((models.TMACustomPrompt.target_language == target_lang) | (models.TMACustomPrompt.target_language.is_null() if target_lang == 'de' else False))
    ).execute()
    return {"status": "ok"}

@router.post("/user/prompts/preset/{preset_id}/activate")
@db_worker
def activate_system_preset(preset_id: str, data: dict = None, user_id: int = Depends(get_user_id)):
    target_lang = (data.get('target_language') if data else 'de') or 'de'
    native_lang = (data.get('native_language') if data else None)
    if not native_lang:
        native_rec = models.TMASetting.get_or_none(models.TMASetting.key == "NATIVE_LANGUAGE")
        native_lang = native_rec.value if native_rec else "ru"
    from api.services.language_service import get_system_presets
    presets = get_system_presets(target_lang, native_lang)
    preset = next((p for p in presets if p["id"] == preset_id), None)
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    
    ptype = preset.get('prompt_type', 'standard')

    models.TMACustomPrompt.update(is_active=False).where(
        (models.TMACustomPrompt.user_id == user_id) &
        (models.TMACustomPrompt.prompt_type == ptype) &
        ((models.TMACustomPrompt.target_language == target_lang) | (models.TMACustomPrompt.target_language.is_null() if target_lang == 'de' else False))
    ).execute()
    
    p = models.TMACustomPrompt.get_or_none(
        (models.TMACustomPrompt.user_id == user_id) & 
        (models.TMACustomPrompt.name == preset["name"]) &
        ((models.TMACustomPrompt.target_language == target_lang) | (models.TMACustomPrompt.target_language.is_null() if target_lang == 'de' else False))
    )
    if not p:
        p = models.TMACustomPrompt.create(
            user_id=user_id,
            name=preset["name"],
            translation_prompt=preset["instruction"],
            context_prompt=preset["instruction"],
            target_language=target_lang,
            prompt_type=ptype,
            is_active=True
        )
    else:
        p.translation_prompt = preset["instruction"]
        p.context_prompt = preset["instruction"]
        p.target_language = target_lang
        p.prompt_type = ptype
        p.is_active = True
        p.save()
    return {"status": "ok", "id": p.id}

_SENSITIVE_SETTING_TERMS = ("KEY", "SECRET", "TOKEN", "PASSWORD", "PASSWD", "CREDENTIAL")
_PERSONAL_SETTING_PREFIXES = (
    "USER_SETTINGS_", "USER_DESIGN_V1_BACKUP_", "DECK_LEARNING_",
    "REMINDER_SETTINGS_", "LAST_REMINDER_SLOTS_", "LAST_REMINDER_ATTEMPT_",
)
_READONLY_ADMIN_KEYS = {"AI_KEYS_STATUS", "EFFECTIVE_AI_CONFIG"}


def _is_excluded_admin_setting(key: str) -> bool:
    key_upper = (key or "").upper()
    return key_upper.startswith(_PERSONAL_SETTING_PREFIXES) or any(t in key_upper for t in _SENSITIVE_SETTING_TERMS)


def _upsert_tma_setting(key: str, value: str, now=None):
    now = now or datetime.datetime.now()
    rec, created = models.TMASetting.get_or_create(
        key=key,
        defaults={'value': value, 'updated_at': now}
    )
    if not created:
        rec.value = value
        rec.updated_at = now
        rec.save()


def _build_ai_keys_status() -> dict:
    return {p: ai_service.get_provider_keys_info(p) for p in ai_service.PROVIDER_KEY_MAP}


def _effective_ai_config() -> dict:
    provider, ai_key, model = ai_service.get_ai_config(force_refresh=True)
    return {"provider": provider, "model": model, "has_key": bool(ai_key or provider == "ollama")}


class KeyManagementRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    provider: Literal["google", "groq", "openrouter"]
    action: Literal["add", "replace", "delete", "clear", "promote"]
    keys_text: Optional[str] = None
    key_id: Optional[str] = None


# Admin Settings
@router.get("/admin/settings")
@db_worker
def get_admin_settings(user_id: int = Depends(get_user_id)):
    if not is_admin(user_id):
        raise HTTPException(status_code=403, detail="Only admins can access settings")
    settings = {}
    for s in models.TMASetting.select():
        if _is_excluded_admin_setting(s.key):
            continue
        settings[s.key] = s.value
    if not settings.get("DEFAULT_MODEL") and settings.get("AI_MODEL"):
        settings["DEFAULT_MODEL"] = settings["AI_MODEL"]
    settings["AI_KEYS_STATUS"] = _build_ai_keys_status()
    settings["EFFECTIVE_AI_CONFIG"] = _effective_ai_config()
    return settings


@router.post("/admin/settings")
@db_worker
def save_admin_settings(data: dict, user_id: int = Depends(get_user_id)):
    if not is_admin(user_id):
        raise HTTPException(status_code=403, detail="Only admins can access settings")
    try:
        now = datetime.datetime.now()
        secret_key_fields = set(ai_service.PROVIDER_KEY_MAP.values()) | {"API_KEY"}
        touched_default_model = False
        for k, v in data.items():
            key = str(k).upper().strip()
            if not key or key in _READONLY_ADMIN_KEYS:
                continue
            if key in secret_key_fields:
                if v is None or not str(v).strip():
                    continue
                if key == "API_KEY":
                    continue
                provider = next(p for p, setting_name in ai_service.PROVIDER_KEY_MAP.items() if setting_name == key)
                existing_keys, source = ai_service.get_provider_keys_raw(provider)
                base_keys = existing_keys if source == "db" else []
                merged = list(dict.fromkeys([*base_keys, *ai_clients.AIService._parse_keys(str(v))]))
                _upsert_tma_setting(key, "\n".join(merged), now)
                continue
            value = "" if v is None else str(v)
            _upsert_tma_setting(key, value, now)
            if key == "DEFAULT_MODEL":
                touched_default_model = True
        if touched_default_model:
            models.TMASetting.delete().where(models.TMASetting.key == "AI_MODEL").execute()
        ai_service.invalidate_ai_config_cache()
        return {
            "status": "ok",
            "AI_KEYS_STATUS": _build_ai_keys_status(),
            "EFFECTIVE_AI_CONFIG": _effective_ai_config(),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving settings: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/admin/settings/keys")
@db_worker
def manage_provider_keys(request: KeyManagementRequest, user_id: int = Depends(get_user_id)):
    if not is_admin(user_id):
        raise HTTPException(status_code=403, detail="Only admins can access settings")
    setting_key = ai_service.PROVIDER_KEY_MAP[request.provider]
    current_keys, _source = ai_service.get_provider_keys_raw(request.provider)

    if request.action == "add":
        new_keys = ai_clients.AIService._parse_keys(request.keys_text)
        if not new_keys:
            raise HTTPException(status_code=400, detail="Укажите хотя бы один ключ API")
        next_keys = list(dict.fromkeys([*current_keys, *new_keys]))
    elif request.action == "replace":
        next_keys = ai_clients.AIService._parse_keys(request.keys_text)
    elif request.action == "delete":
        if not request.key_id:
            raise HTTPException(status_code=400, detail="Не указан идентификатор ключа")
        next_keys = [k for k in current_keys if ai_clients.key_fingerprint(k) != request.key_id]
        if len(next_keys) == len(current_keys):
            raise HTTPException(status_code=404, detail="Ключ не найден")
    elif request.action == "clear":
        next_keys = []
    elif request.action == "promote":
        if not request.key_id:
            raise HTTPException(status_code=400, detail="Не указан идентификатор ключа")
        target = next((k for k in current_keys if ai_clients.key_fingerprint(k) == request.key_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="Ключ не найден")
        next_keys = [target, *(k for k in current_keys if k != target)]

    _upsert_tma_setting(setting_key, "\n".join(next_keys))
    ai_service.invalidate_ai_config_cache()
    return {
        "status": "ok",
        "AI_KEYS_STATUS": _build_ai_keys_status(),
        "EFFECTIVE_AI_CONFIG": _effective_ai_config(),
    }


def _model_list_settings(provider, url):
    if not provider or provider == "default":
        provider_rec = models.TMASetting.get_or_none(models.TMASetting.key == "AI_PROVIDER")
        provider = (provider_rec.value.strip() if provider_rec and provider_rec.value and provider_rec.value.strip() != "default" else "google")

    if not url and provider == "ollama":
        url_rec = models.TMASetting.get_or_none(models.TMASetting.key == "OLLAMA_URL")
        url = url_rec.value if url_rec else None

    return provider, url


@router.get("/settings/models")
@db_phases
async def list_models(provider: str = None, url: str = None, user_id: int = Depends(get_user_id)):
    """Unified endpoint for model listing, used by AITab."""
    if not is_admin(user_id):
        raise HTTPException(status_code=403, detail="Only admins can access settings")
    if provider == "default":
        provider = None
    if not provider or (not url and provider == "ollama"):
        provider, url = await run_db(_model_list_settings, provider, url)
    from api.routers.ai import _provider_url
    resolved_url, resolver = (
        await _provider_url(url, required=provider == "ollama")
        if (provider == "ollama" or url is not None)
        else (None, None)
    )
    return await ai_service.get_provider_models(provider, resolved_url, ollama_resolver=resolver)


@router.get("/settings/test-ai")
@db_phases
async def test_ai_connection(user_id: int = Depends(get_user_id)):
    """Unified test endpoint for AITab: tests all configured keys individually without exposing secrets."""
    if not is_admin(user_id):
        raise HTTPException(status_code=403, detail="Only admins can access settings")
    provider, ai_key, model = await run_db(ai_service.get_ai_config, True)

    if not model or not model.strip():
        return {
            "status": "error",
            "provider": provider,
            "model": None,
            "keys": [],
            "total_keys": 0,
            "error": "В настройках не выбрана модель ИИ",
        }
    model = model.strip()

    client = ai_clients.AIService(provider=provider, api_key=ai_key)
    if provider != "ollama" and not client.api_keys:
        return {
            "status": "error",
            "provider": provider,
            "model": model,
            "keys": [],
            "total_keys": 0,
            "error": "API ключи не настроены",
        }

    keys = client.api_keys if client.api_keys else [""]
    key_results = []

    for idx, k in enumerate(keys):
        single_client = ai_clients.AIService(provider=provider, api_key=k)
        response, success = await single_client.chat_completion(
            system_prompt="Return 'OK'.",
            user_message="Test.",
            model=model
        )
        key_results.append({
            "index": idx + 1,
            "key_id": ai_clients.key_fingerprint(k) if k else "ollama",
            "key_masked": ai_clients.mask_api_key(k) if k else "Ollama",
            "status": "ok" if success else "error",
            "message": "OK (Соединение установлено)" if success else str(response)
        })

    all_ok = all(r["status"] == "ok" for r in key_results)
    any_ok = any(r["status"] == "ok" for r in key_results)
    overall_status = "ok" if all_ok else ("warning" if any_ok else "error")

    return {
        "status": overall_status,
        "provider": provider,
        "model": model,
        "keys": key_results,
        "total_keys": len(keys),
        "error": None if any_ok else (key_results[0]["message"] if key_results else "No keys")
    }

@router.get("/admin/presets")
@db_worker
def get_admin_presets(user_id: int = Depends(get_user_id)):
    if not is_admin(user_id): raise HTTPException(403, 'Admin only')
    return []

# Community Moderation
@router.get("/admin/community/decks")
@db_worker
def get_community_decks(user_id: int = Depends(get_user_id)):
    if not is_admin(user_id):
        raise HTTPException(status_code=403, detail="Only admins can view community decks")
    return services.get_community_content(user_id)

@router.post("/admin/community/promote/{deck_id}")
@db_worker
def promote_deck(deck_id: int, user_id: int = Depends(get_user_id)):
    if not is_admin(user_id):
        raise HTTPException(status_code=403, detail="Only admins can promote decks")
    result = services.promote_to_library(deck_id)
    if result:
        return {"status": "success", "new_library_id": result.id}
    raise HTTPException(status_code=500, detail="Failed to promote deck")

# Admin Prompt Management Endpoints
@router.get("/admin/prompts/all")
@db_worker
def get_all_prompts(user_id: int = Depends(get_user_id)):
    if not is_admin(user_id): raise HTTPException(403, 'Admin only')
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
@db_worker
def set_global_default_prompt(prompt_id: int, user_id: int = Depends(get_user_id)):
    if not is_admin(user_id): raise HTTPException(403, 'Admin only')
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


# ─────────────────────────────────────────────────────────────────────────────
# Design Config V2 — Global Published Design
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/design/global")
@db_worker
def get_global_design(user_id: int = Depends(get_user_id)):
    """Returns the current globally published Design Config V2.
    Public endpoint — all authenticated users can read it.
    Returns {} if no global design has been published yet."""
    import json
    try:
        record = models.TMASetting.get_or_none(models.TMASetting.key == "GLOBAL_DESIGN_V2")
        if record and record.value:
            return json.loads(record.value)
    except Exception as e:
        logger.error(f"Error fetching GLOBAL_DESIGN_V2: {e}")
    return {}


@router.post("/admin/design/publish")
@db_worker
def publish_global_design(data: dict, user_id: int = Depends(get_user_id)):
    """Publishes a new global Design Config V2 for all users.
    Admin-only. Server creates revision and updatedAt (not trusted from client).
    Client sends: {"config": {...}}
    Returns the full saved document: {schemaVersion, revision, updatedAt, config}"""
    if not is_admin(user_id):
        raise HTTPException(status_code=403, detail="Only admins can publish global design")
    import json
    import datetime
    config = data.get("config")
    if not config or not isinstance(config, dict):
        raise HTTPException(status_code=400, detail="config field is required and must be an object")
    try:
        # Read current revision to increment
        current_revision = 0
        record = models.TMASetting.get_or_none(models.TMASetting.key == "GLOBAL_DESIGN_V2")
        if record and record.value:
            try:
                current_doc = json.loads(record.value)
                current_revision = int(current_doc.get("revision", 0))
            except Exception:
                pass
        now = datetime.datetime.utcnow().isoformat() + "Z"
        doc = {
            "schemaVersion": 2,
            "revision": current_revision + 1,
            "updatedAt": now,
            "config": config,
        }
        value = json.dumps(doc, ensure_ascii=False)
        if record:
            record.value = value
            record.updated_at = datetime.datetime.now()
            record.save()
        else:
            models.TMASetting.create(
                key="GLOBAL_DESIGN_V2",
                value=value,
                updated_at=datetime.datetime.now()
            )
        return doc
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error publishing global design: {e}")
        raise HTTPException(status_code=500, detail="Failed to publish global design")

