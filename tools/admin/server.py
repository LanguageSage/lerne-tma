import os
import re
import sys
import json
import asyncio
import datetime
import time
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional

# Add project root to sys.path
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

import logging
logger = logging.getLogger(__name__)

from fastapi import FastAPI, HTTPException, BackgroundTasks, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
import peewee
from peewee import fn

from api import models, ai_service

app = FastAPI(title="Lerne TMA Admin Console", version="1.0.0")

# Allow CORS for local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import threading
import webbrowser

# Active regeneration tasks progress tracker
regen_tasks = {}

@app.on_event("startup")
def startup_db():
    if not models.tma_db.obj:
        models.initialize_database()
    
    def _open_browser():
        time.sleep(1.2)
        try:
            webbrowser.open("http://127.0.0.1:8050")
        except Exception:
            pass

    threading.Thread(target=_open_browser, daemon=True).start()

# Serve static admin UI
static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/")
def get_admin_ui():
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return JSONResponse({"message": "Admin UI index.html not found"}, status_code=404)


from tools.admin.services import task_manager

# Pydantic Schemas
class CreateDeckRequest(BaseModel):
    user_id: int
    name: str
    target_language: str = "de"
    level: Optional[str] = None
    topic: Optional[str] = None
    is_default: bool = False

class AssignDeckRequest(BaseModel):
    user_ids: List[int]
    mode: str = "copy"  # "copy" or "collaborate"

class SetDefaultDeckRequest(BaseModel):
    is_default: bool
    copy_to_existing: bool = True

class RegenerateDeckRequest(BaseModel):
    dry_run: bool = False
    only_empty: bool = False
    only_no_context: bool = False
    no_audio: bool = False
    skip_completed: bool = False
    sync_copies: bool = False
    voice: Optional[str] = "de-DE-KatjaNeural"
    rate: Optional[str] = "+0%"
    limit: Optional[int] = None
    delay: float = 1.5
    prompt_id: Optional[str] = "preset_b1"
    native_lang: Optional[str] = "uk"
    target_lang: Optional[str] = "de"
    exclude_card_ids: Optional[List[int]] = None
    exclude_range_str: Optional[str] = None
    start_card_idx: Optional[int] = None

class RegenerateAudioRequest(BaseModel):
    voice: Optional[str] = "de-DE-KatjaNeural"
    rate: Optional[str] = "+0%"
    only_missing_audio: bool = False
    skip_completed: bool = False
    sync_copies: bool = True
    delay: float = 0.3
    limit: Optional[int] = None
    exclude_card_ids: Optional[List[int]] = None
    exclude_range_str: Optional[str] = None
    start_card_idx: Optional[int] = None

class BatchRegenerateDeckRequest(BaseModel):
    deck_ids: List[str]
    dry_run: bool = False
    only_empty: bool = False
    only_no_context: bool = False
    no_audio: bool = False
    skip_completed: bool = False
    sync_copies: bool = False
    voice: Optional[str] = "de-DE-KatjaNeural"
    rate: Optional[str] = "+0%"
    delay: float = 1.5
    prompt_id: Optional[str] = "preset_b1"
    native_lang: Optional[str] = "uk"
    target_lang: Optional[str] = "de"
    cards_per_deck_limit: Optional[int] = None
    start_deck_idx: Optional[int] = None
    start_card_idx: Optional[int] = None

class BatchRegenerateAudioRequest(BaseModel):
    deck_ids: List[str]
    voice: Optional[str] = "de-DE-KatjaNeural"
    rate: Optional[str] = "+0%"
    only_missing_audio: bool = False
    skip_completed: bool = False
    sync_copies: bool = True
    delay: float = 0.3
    cards_per_deck_limit: Optional[int] = None
    start_deck_idx: Optional[int] = None
    start_card_idx: Optional[int] = None

class BulkCreateCardsRequest(BaseModel):
    deck_id: Optional[str] = None
    new_deck_name: Optional[str] = None
    target_language: str = "de"
    level: Optional[str] = None
    topic: Optional[str] = None
    user_id: Optional[int] = 0
    is_default: bool = False
    is_library: bool = False
    phrases: List[str]
    voice: Optional[str] = "de-DE-KatjaNeural"
    rate: Optional[str] = "+0%"
    generate_ai: bool = True
    generate_audio: bool = True
    sync_copies: bool = False
    delay: float = 1.0
    native_lang: Optional[str] = "uk"
    prompt_id: Optional[str] = "preset_b1"
    start_card_idx: Optional[int] = None

class SuggestWordsRequest(BaseModel):
    topic: str
    level: Optional[str] = "A1"
    count: Optional[int] = 20
    target_lang: Optional[str] = "de"
    native_lang: Optional[str] = "uk"

class ResumeTaskRequest(BaseModel):
    task_id: Optional[str] = None
    start_deck_idx: Optional[int] = None
    start_card_idx: Optional[int] = None

class UpdateCardRequest(BaseModel):
    front_text: Optional[str] = None
    back_text: Optional[str] = None
    context: Optional[str] = None
    tags: Optional[str] = None

class BatchSummaryRequest(BaseModel):
    deck_ids: List[str]

class BatchControlRequest(BaseModel):
    action: str  # "pause", "resume", "stop", "commit_dry_run"


class ClassificationRequest(BaseModel):
    mode: str = "audit"  # "audit", "dry_run", "run"
    lang: str = "de"
    vocab_profile: str = "medium"
    overwrite: bool = True
    clear_uncertain_local: bool = False
    include_library: bool = False
    limit: Optional[int] = None
    delay: float = 1.0


VALID_CEFR_LEVELS = {"A1", "A2", "B1", "B2", "C1", "C2"}
CEFR_TAG_RE = re.compile(r"\b(A1|A2|B1|B2|C1|C2)\b", re.IGNORECASE)


def extract_existing_cefr_level(tags_str: Optional[str]) -> Optional[str]:
    if not tags_str:
        return None
    match = CEFR_TAG_RE.search(str(tags_str))
    return match.group(1).upper() if match else None


def replace_cefr_level(tags_str: Optional[str], level: str) -> str:
    tags = str(tags_str or "")
    cleaned = CEFR_TAG_RE.sub("", tags)
    cleaned_parts = [part.strip() for part in cleaned.split(",") if part.strip()]
    return ",".join([*cleaned_parts, level]) if cleaned_parts else level


def remove_cefr_level(tags_str: Optional[str]) -> str:
    tags = str(tags_str or "")
    cleaned = CEFR_TAG_RE.sub("", tags)
    return ",".join(part.strip() for part in cleaned.split(",") if part.strip())


def empty_classification_status() -> Dict[str, Any]:
    return {
        "status": "idle",
        "processed_cards": 0,
        "total_cards": 0,
        "processed_ai_chunks": 0,
        "total_ai_chunks": 0,
        "logs": [],
    }


def _level_counter_dict(counter: Counter) -> Dict[str, int]:
    return {level: int(counter.get(level, 0)) for level in sorted(VALID_CEFR_LEVELS)}


def _select_tma_cards_for_classification(req: ClassificationRequest) -> List[Dict[str, Any]]:
    lang = (req.lang or "de").lower().strip()
    query = (
        models.TMA_Card
        .select(models.TMA_Card.id, models.TMA_Card.front_text, models.TMA_Card.tags)
        .join(models.TMA_Deck)
        .where(models.TMA_Card.is_deleted == False)
        .order_by(models.TMA_Card.id.asc())
    )
    if lang == "de":
        query = query.where(
            (models.TMA_Deck.target_language == "de") |
            (models.TMA_Deck.target_language.is_null())
        )
    else:
        query = query.where(models.TMA_Deck.target_language == lang)
    if req.limit and req.limit > 0:
        query = query.limit(req.limit)
    return list(query.dicts())


def _append_classification_log(task_info: Dict[str, Any], message: str) -> None:
    task_info.setdefault("logs", []).append(message)
    if len(task_info["logs"]) > 180:
        task_info["logs"] = task_info["logs"][-180:]


def _save_classification_task(task_id: str, task_info: Dict[str, Any]) -> None:
    regen_tasks[task_id] = task_info
    task_manager.save_task_checkpoint(task_info)


async def run_classification_task(task_id: str, req: ClassificationRequest):
    """Classifies CEFR tags for TMA cards using local rules first and AI for uncertain phrases."""
    task_info = regen_tasks.get(task_id) or task_manager.get_task(task_id)
    if not task_info:
        return

    mode = (req.mode or "audit").lower().strip()
    lang = (req.lang or "de").lower().strip()
    vocab_profile = (req.vocab_profile or "medium").lower().strip()
    if mode not in {"audit", "dry_run", "run"}:
        task_info["status"] = "failed"
        _append_classification_log(task_info, f"Invalid classification mode: {mode}")
        _save_classification_task(task_id, task_info)
        return
    if vocab_profile not in {"base", "medium", "max"}:
        vocab_profile = "medium"

    task_info.update({
        "status": "running",
        "control": "run",
        "mode": mode,
        "lang": lang,
        "vocab_profile": vocab_profile,
        "overwrite": req.overwrite,
        "clear_uncertain_local": req.clear_uncertain_local,
        "include_library": req.include_library,
        "options": req.dict(),
        "task_type": "classification",
    })
    _append_classification_log(task_info, f"CEFR classification started: mode={mode}, lang={lang}, vocab={vocab_profile}.")
    _save_classification_task(task_id, task_info)

    try:
        os.environ["DE_VOCAB_PROFILE"] = vocab_profile

        all_cards = _select_tma_cards_for_classification(req)
        existing_level_counts = Counter()
        cards_to_process: List[Dict[str, Any]] = []
        skipped_tagged = 0

        for card in all_cards:
            existing_level = extract_existing_cefr_level(card.get("tags"))
            if existing_level:
                existing_level_counts[existing_level] += 1
            if existing_level and not req.overwrite:
                skipped_tagged += 1
                continue
            cards_to_process.append(card)

        phrase_to_card_ids = defaultdict(list)
        phrase_to_card_tags: Dict[int, Optional[str]] = {}
        for card in cards_to_process:
            phrase = (card.get("front_text") or "").strip()
            if phrase:
                phrase_to_card_ids[phrase].append(card["id"])
                phrase_to_card_tags[card["id"]] = card.get("tags")

        unique_phrases = list(phrase_to_card_ids.keys())
        duplicate_saved = len(cards_to_process) - len(unique_phrases)
        task_info.update({
            "total_cards": len(cards_to_process),
            "cards_scanned": len(all_cards),
            "skipped_tagged": skipped_tagged,
            "unique_phrases": len(unique_phrases),
            "duplicate_saved": duplicate_saved,
            "processed_cards": 0,
            "existing_level_counts": _level_counter_dict(existing_level_counts),
        })
        _append_classification_log(
            task_info,
            f"Scanned {len(all_cards)} cards, processing {len(cards_to_process)} cards, {len(unique_phrases)} unique phrases."
        )
        _save_classification_task(task_id, task_info)

        if not unique_phrases:
            task_info["status"] = "completed"
            _append_classification_log(task_info, "No cards require classification.")
            _save_classification_task(task_id, task_info)
            return

        from api.services.classifier import classify_sentence_fast

        phrase_to_level: Dict[str, Optional[str]] = {}
        phrase_to_source: Dict[str, str] = {}
        phrase_to_confidence: Dict[str, float] = {}
        phrase_to_local_fallback: Dict[str, str] = {}
        local_level_counts = Counter()
        local_fallback_counts = Counter()
        cleared_local_counts = Counter()
        phrases_for_ai: List[str] = []

        for idx, phrase in enumerate(unique_phrases, 1):
            if task_info.get("control") == "stop":
                task_info["status"] = "stopped"
                _append_classification_log(task_info, "Classification stopped during local pass.")
                _save_classification_task(task_id, task_info)
                return
            while task_info.get("control") == "pause":
                task_info["status"] = "paused"
                _save_classification_task(task_id, task_info)
                await asyncio.sleep(0.5)
            task_info["status"] = "running"

            if lang == "de":
                local = classify_sentence_fast(phrase, "de")
                local_level = local.get("level", "A1")
                local_conf = float(local.get("confidence", 0.0) or 0.0)
                phrase_to_local_fallback[phrase] = local_level
                if local_conf >= 0.80:
                    phrase_to_level[phrase] = local_level
                    phrase_to_source[phrase] = "local"
                    phrase_to_confidence[phrase] = local_conf
                    local_level_counts[local_level] += len(phrase_to_card_ids[phrase])
                else:
                    local_fallback_counts[local_level] += len(phrase_to_card_ids[phrase])
                    if req.clear_uncertain_local:
                        phrase_to_level[phrase] = None
                        phrase_to_source[phrase] = "cleared"
                        phrase_to_confidence[phrase] = local_conf
                        cleared_local_counts["NO_LEVEL"] += len(phrase_to_card_ids[phrase])
                    else:
                        phrases_for_ai.append(phrase)
            else:
                phrases_for_ai.append(phrase)

            if idx % 200 == 0 or idx == len(unique_phrases):
                task_info["processed_cards"] = sum(len(phrase_to_card_ids[p]) for p in phrase_to_level)
                task_info["local_unique"] = sum(1 for p in phrase_to_source if phrase_to_source[p] == "local")
                task_info["ai_unique"] = len(phrases_for_ai)
                _save_classification_task(task_id, task_info)

        uncertain_cards = sum(len(phrase_to_card_ids[p]) for p in phrases_for_ai)
        task_info.update({
            "local_unique": sum(1 for p in phrase_to_source if phrase_to_source[p] == "local"),
            "ai_unique": len(phrases_for_ai),
            "ai_cards": uncertain_cards,
            "cleared_unique": sum(1 for p in phrase_to_source if phrase_to_source[p] == "cleared"),
            "cleared_cards": int(cleared_local_counts.get("NO_LEVEL", 0)),
            "local_level_counts": _level_counter_dict(local_level_counts),
            "local_fallback_counts": _level_counter_dict(local_fallback_counts),
            "cleared_local_counts": dict(cleared_local_counts),
        })
        local_processed_cards = sum(
            len(phrase_to_card_ids[phrase])
            for phrase, source in phrase_to_source.items()
            if source in {"local", "cleared"}
        )
        _append_classification_log(
            task_info,
            f"Local pass completed: {task_info['local_unique']} confident phrases, "
            f"{task_info['cleared_unique']} cleared, {len(phrases_for_ai)} phrases need AI."
        )

        if mode == "audit":
            audit_counts = Counter(local_level_counts)
            audit_counts["NO_LEVEL"] = int(cleared_local_counts.get("NO_LEVEL", 0))
            task_info["level_counts"] = {
                **_level_counter_dict(audit_counts),
                "NO_LEVEL": int(audit_counts.get("NO_LEVEL", 0)),
            }
            task_info["source_counts"] = {
                "local": int(local_processed_cards - cleared_local_counts.get("NO_LEVEL", 0)),
                "cleared": int(cleared_local_counts.get("NO_LEVEL", 0)),
                "ai_pending": int(uncertain_cards),
            }
            task_info["status"] = "completed"
            task_info["processed_cards"] = len(cards_to_process)
            _append_classification_log(task_info, "Audit completed. AI calls and DB writes were skipped.")
            _save_classification_task(task_id, task_info)
            return

        if phrases_for_ai:
            chunk_size = 30
            chunks = [phrases_for_ai[i:i + chunk_size] for i in range(0, len(phrases_for_ai), chunk_size)]
            task_info["total_ai_chunks"] = len(chunks)
            task_info["processed_ai_chunks"] = 0
            _append_classification_log(task_info, f"AI fallback started: {len(chunks)} chunks.")
            _save_classification_task(task_id, task_info)

            for idx, chunk in enumerate(chunks, 1):
                if task_info.get("control") == "stop":
                    task_info["status"] = "stopped"
                    _append_classification_log(task_info, "Classification stopped during AI fallback.")
                    _save_classification_task(task_id, task_info)
                    return
                while task_info.get("control") == "pause":
                    task_info["status"] = "paused"
                    _save_classification_task(task_id, task_info)
                    await asyncio.sleep(0.5)
                task_info["status"] = "running"
                task_info["current_card"] = f"AI chunk {idx}/{len(chunks)}"

                try:
                    levels = await ai_service.classify_phrases_batch(chunk, target_language=lang)
                    for phrase, level in zip(chunk, levels):
                        valid_level = level if level in VALID_CEFR_LEVELS else phrase_to_local_fallback.get(phrase, "A1")
                        phrase_to_level[phrase] = valid_level
                        phrase_to_source[phrase] = "ai"
                        phrase_to_confidence[phrase] = 1.0
                except Exception as err:
                    _append_classification_log(task_info, f"AI chunk {idx} failed, local fallback used: {str(err)[:80]}")
                    for phrase in chunk:
                        phrase_to_level[phrase] = phrase_to_local_fallback.get(phrase, "A1")
                        phrase_to_source[phrase] = "fallback"
                        phrase_to_confidence[phrase] = 0.0

                task_info["processed_ai_chunks"] = idx
                task_info["processed_cards"] = min(
                    len(cards_to_process),
                    local_processed_cards + sum(
                        len(phrase_to_card_ids[p]) for p in phrases_for_ai[:idx * chunk_size]
                    )
                )
                _save_classification_task(task_id, task_info)
                if req.delay > 0 and idx < len(chunks):
                    await asyncio.sleep(req.delay)

        level_counts = Counter()
        source_counts = Counter()
        classification_results = []
        for phrase, card_ids in phrase_to_card_ids.items():
            level = phrase_to_level.get(phrase, phrase_to_local_fallback.get(phrase, "A1"))
            source = phrase_to_source.get(phrase, "fallback")
            if level:
                level_counts[level] += len(card_ids)
            else:
                level_counts["NO_LEVEL"] += len(card_ids)
            source_counts[source] += len(card_ids)
            if len(classification_results) < 80:
                first_id = card_ids[0]
                classification_results.append({
                    "phrase": phrase,
                    "card_id": first_id,
                    "card_count": len(card_ids),
                    "old_level": extract_existing_cefr_level(phrase_to_card_tags.get(first_id)),
                    "new_level": level,
                    "source": source,
                    "confidence": round(phrase_to_confidence.get(phrase, 0.0), 2),
                })

        task_info.update({
            "level_counts": {
                **_level_counter_dict(level_counts),
                "NO_LEVEL": int(level_counts.get("NO_LEVEL", 0)),
            },
            "source_counts": dict(source_counts),
            "classification_results": classification_results,
            "processed_cards": len(cards_to_process),
        })

        if mode == "dry_run":
            task_info["status"] = "completed"
            _append_classification_log(task_info, "Dry-run completed. No database changes were written.")
            _save_classification_task(task_id, task_info)
            return

        try:
            backup = create_full_db_backup()
            task_info["backup_filename"] = backup.get("filename")
            _append_classification_log(task_info, f"Backup created before DB update: {backup.get('filename')}.")
        except Exception as backup_err:
            task_info["status"] = "failed"
            _append_classification_log(task_info, f"Backup failed, DB update cancelled: {backup_err}")
            _save_classification_task(task_id, task_info)
            return

        tag_value_to_card_ids = defaultdict(list)
        for phrase, card_ids in phrase_to_card_ids.items():
            level = phrase_to_level.get(phrase, phrase_to_local_fallback.get(phrase, "A1"))
            for card_id in card_ids:
                if level:
                    new_tags = replace_cefr_level(phrase_to_card_tags.get(card_id), level)
                else:
                    new_tags = remove_cefr_level(phrase_to_card_tags.get(card_id))
                tag_value_to_card_ids[new_tags].append(card_id)

        updated_total = 0
        now = datetime.datetime.now()
        with models.tma_db.atomic():
            for new_tags, card_ids in tag_value_to_card_ids.items():
                for idx in range(0, len(card_ids), 500):
                    chunk = card_ids[idx:idx + 500]
                    updated_total += (
                        models.TMA_Card
                        .update(tags=new_tags, updated_at=now)
                        .where(models.TMA_Card.id << chunk)
                        .execute()
                    )

        task_info["updated_cards"] = updated_total
        task_info["status"] = "completed"
        _append_classification_log(task_info, f"DB update completed: {updated_total} cards updated.")
        _save_classification_task(task_id, task_info)
    except Exception as err:
        logger.error(f"Classification task failed: {err}", exc_info=True)
        task_info["status"] = "failed"
        _append_classification_log(task_info, f"Classification failed: {str(err)[:160]}")
        _save_classification_task(task_id, task_info)



# API Routes

@app.get("/api/admin/prompts")
def get_prompts(native_lang: Optional[str] = "uk", target_lang: Optional[str] = "de"):
    """Returns list of all available system and custom prompts with full instruction texts."""
    from api.services.language_service import get_system_presets
    n_lang = (native_lang or "uk").lower().strip()
    t_lang = (target_lang or "de").lower().strip()
    system_presets = get_system_presets(target_lang=t_lang, native_lang=n_lang)
    
    prompts_list = []
    
    for p in system_presets:
        prompts_list.append({
            "id": p["id"],
            "name": p["name"],
            "description": p["description"],
            "instruction": p.get("instruction", ""),
            "target_lang": t_lang,
            "is_default": p["id"] == "preset_b1"
        })

    # Fetch custom prompts from database if any exist
    try:
        customs = list(models.TMACustomPrompt.select().where(models.TMACustomPrompt.is_active == True))
        for c in customs:
            prompts_list.append({
                "id": f"custom_{c.id}",
                "name": f"⭐ {c.name or 'Кастомный промпт #' + str(c.id)}",
                "description": c.description or "Пользовательский промпт из настроек",
                "instruction": c.translation_prompt or c.context_prompt or "",
                "target_lang": getattr(c, 'target_language', 'de') or t_lang,
                "is_default": False
            })
    except Exception:
        pass

    return {"prompts": prompts_list, "native_lang": n_lang, "target_lang": t_lang}

@app.get("/api/admin/users")
def get_users(search: Optional[str] = None):
    """Returns list of users with their deck counts."""
    query = models.TMAUser.select()
    if search:
        s = search.strip()
        if s.isdigit():
            query = query.where(models.TMAUser.user_id == int(s))
        else:
            query = query.where(
                (models.TMAUser.username.contains(s)) |
                (models.TMAUser.first_name.contains(s)) |
                (models.TMAUser.last_name.contains(s))
            )
    
    users = list(query.order_by(models.TMAUser.created_at.desc()))
    
    # Collect deck counts per user in 1 SQL query
    user_deck_counts = dict(
        models.TMA_Deck.select(models.TMA_Deck.user_id, fn.COUNT(models.TMA_Deck.id))
        .where(models.TMA_Deck.is_deleted == False)
        .group_by(models.TMA_Deck.user_id)
        .tuples()
    )
    
    deck_user_ids = set(user_deck_counts.keys())
    existing_uids = set([u.user_id for u in users])
    missing_uids = deck_user_ids - existing_uids

    result = []
    for u in users:
        deck_count = user_deck_counts.get(u.user_id, 0)
        last_act = u.updated_at or u.created_at
        result.append({
            "id": u.user_id,
            "user_id": u.user_id,
            "username": u.username or "",
            "first_name": u.first_name or "",
            "last_name": u.last_name or "",
            "created_at": str(u.created_at) if u.created_at else None,
            "last_activity": str(last_act) if last_act else None,
            "deck_count": deck_count
        })
        
    for m_uid in missing_uids:
        if search and search.strip().isdigit() and int(search.strip()) != m_uid:
            continue
        deck_count = user_deck_counts.get(m_uid, 0)
        result.append({
            "id": m_uid,
            "user_id": m_uid,
            "username": f"user_{m_uid}",
            "first_name": f"User {m_uid}",
            "last_name": "",
            "created_at": None,
            "last_activity": None,
            "deck_count": deck_count
        })
        
    return {"users": result}


@app.get("/api/admin/decks")
def get_all_decks(search: Optional[str] = None, user_id: Optional[int] = None):
    """Returns all active decks in the database with health statistics (missing audio/context)."""
    result = []
    
    # 1. Fetch Library Master Decks from models.Deck (when no user_id filter is set)
    if not user_id:
        lib_query = models.Deck.select().where(models.Deck.is_deleted == False)
        if search:
            s = search.strip()
            if s.isdigit():
                lib_query = lib_query.where((models.Deck.id == int(s)) | (models.Deck.name.contains(s)))
            else:
                lib_query = lib_query.where(
                    (models.Deck.name.contains(s)) |
                    (models.Deck.target_language.contains(s)) |
                    (models.Deck.level.contains(s)) |
                    (models.Deck.topic.contains(s))
                )
        
        lib_decks = list(lib_query.order_by(models.Deck.id.desc()))
        
        lib_card_counts = dict(
            models.Card.select(models.Card.deck_id, fn.COUNT(models.Card.id))
            .where(models.Card.is_deleted == False)
            .group_by(models.Card.deck_id)
            .tuples()
        )
        lib_missing_audio = dict(
            models.Card.select(models.Card.deck_id, fn.COUNT(models.Card.id))
            .where((models.Card.is_deleted == False) & ((models.Card.audio_path.is_null(True)) | (models.Card.audio_path == '')))
            .group_by(models.Card.deck_id)
            .tuples()
        )
        lib_missing_context = dict(
            models.Card.select(models.Card.deck_id, fn.COUNT(models.Card.id))
            .where((models.Card.is_deleted == False) & ((models.Card.context.is_null(True)) | (models.Card.context == '')))
            .group_by(models.Card.deck_id)
            .tuples()
        )

        for d in lib_decks:
            c_count = lib_card_counts.get(d.id, 0)
            m_audio = lib_missing_audio.get(d.id, 0)
            m_ctx = lib_missing_context.get(d.id, 0)
            is_def = bool(getattr(d, 'is_default', False))
            
            if c_count == 0:
                h_status = "empty"
            elif m_ctx > 0:
                h_status = "needs_ai"
            elif m_audio > 0:
                h_status = "needs_audio"
            else:
                h_status = "ready"

            result.append({
                "id": f"lib_{d.id}",
                "user_id": "Библиотека ⭐",
                "name": d.name,
                "level": d.level,
                "topic": d.topic,
                "target_language": d.target_language or "de",
                "card_count": c_count,
                "missing_audio_count": m_audio,
                "missing_context_count": m_ctx,
                "health_status": h_status,
                "created_at": str(d.created_at) if d.created_at else None,
                "is_default": is_def,
                "is_library": True
            })

    # 2. Fetch User Decks from models.TMA_Deck
    user_query = models.TMA_Deck.select().where(models.TMA_Deck.is_deleted == False)
    if user_id:
        user_query = user_query.where(models.TMA_Deck.user_id == user_id)
        
    if search:
        s = search.strip()
        if s.isdigit():
            user_query = user_query.where(
                (models.TMA_Deck.id == int(s)) |
                (models.TMA_Deck.user_id == int(s)) |
                (models.TMA_Deck.name.contains(s))
            )
        else:
            user_query = user_query.where(
                (models.TMA_Deck.name.contains(s)) |
                (models.TMA_Deck.target_language.contains(s)) |
                (models.TMA_Deck.level.contains(s)) |
                (models.TMA_Deck.topic.contains(s))
            )
    
    tma_decks = list(user_query.order_by(models.TMA_Deck.id.desc()))
    
    tma_card_counts = dict(
        models.TMA_Card.select(models.TMA_Card.deck_id, fn.COUNT(models.TMA_Card.id))
        .where(models.TMA_Card.is_deleted == False)
        .group_by(models.TMA_Card.deck_id)
        .tuples()
    )
    tma_missing_audio = dict(
        models.TMA_Card.select(models.TMA_Card.deck_id, fn.COUNT(models.TMA_Card.id))
        .where((models.TMA_Card.is_deleted == False) & ((models.TMA_Card.audio_path.is_null(True)) | (models.TMA_Card.audio_path == '')))
        .group_by(models.TMA_Card.deck_id)
        .tuples()
    )
    tma_missing_context = dict(
        models.TMA_Card.select(models.TMA_Card.deck_id, fn.COUNT(models.TMA_Card.id))
        .where((models.TMA_Card.is_deleted == False) & ((models.TMA_Card.context.is_null(True)) | (models.TMA_Card.context == '')))
        .group_by(models.TMA_Card.deck_id)
        .tuples()
    )

    for d in tma_decks:
        c_count = tma_card_counts.get(d.id, 0)
        m_audio = tma_missing_audio.get(d.id, 0)
        m_ctx = tma_missing_context.get(d.id, 0)
        meta = {}
        try:
            meta = json.loads(d.metadata or "{}")
        except Exception:
            pass

        is_def = bool(meta.get("is_default", False))
        
        if c_count == 0:
            h_status = "empty"
        elif m_ctx > 0:
            h_status = "needs_ai"
        elif m_audio > 0:
            h_status = "needs_audio"
        else:
            h_status = "ready"

        result.append({
            "id": d.id,
            "user_id": d.user_id,
            "name": d.name,
            "level": d.level,
            "topic": d.topic,
            "target_language": d.target_language or "de",
            "card_count": c_count,
            "missing_audio_count": m_audio,
            "missing_context_count": m_ctx,
            "health_status": h_status,
            "created_at": str(d.created_at) if d.created_at else None,
            "is_default": is_def,
            "is_library": False,
            "share_id": d.share_id
        })

    return {"decks": result}


@app.get("/api/admin/users/{user_id}/decks")
def get_user_decks(user_id: int):
    """Returns list of decks belonging to a specific user."""
    decks = list(
        models.TMA_Deck.select()
        .where((models.TMA_Deck.user_id == user_id) & (models.TMA_Deck.is_deleted == False))
        .order_by(models.TMA_Deck.position.asc(), models.TMA_Deck.id.desc())
    )
    
    card_counts = dict(
        models.TMA_Card.select(models.TMA_Card.deck_id, fn.COUNT(models.TMA_Card.id))
        .where(models.TMA_Card.is_deleted == False)
        .group_by(models.TMA_Card.deck_id)
        .tuples()
    )

    result = []
    for d in decks:
        c_count = card_counts.get(d.id, 0)
        result.append({
            "id": d.id,
            "user_id": d.user_id,
            "name": d.name,
            "level": d.level,
            "target_language": d.target_language or "de",
            "card_count": c_count,
            "created_at": str(d.created_at) if d.created_at else None
        })
    return {"decks": result}


@app.post("/api/admin/decks/add")
def create_deck(req: CreateDeckRequest):
    """Creates a new deck for a specified user or as a default deck."""
    meta = {}
    if req.is_default:
        meta["is_default"] = True

    deck = models.TMA_Deck.create(
        user_id=req.user_id,
        name=req.name,
        target_language=req.target_language,
        level=req.level,
        topic=req.topic,
        metadata=json.dumps(meta)
    )

    if req.is_default:
        all_users = models.TMAUser.select()
        for u in all_users:
            if u.user_id != req.user_id:
                models.TMA_Deck.create(
                    user_id=u.user_id,
                    name=req.name,
                    target_language=req.target_language,
                    level=req.level,
                    topic=req.topic,
                    metadata=json.dumps({"source_deck_id": deck.id, "is_default": True})
                )

    return {"status": "ok", "deck_id": deck.id, "name": deck.name}


def get_deck_and_cards(deck_id_val):
    s_id = str(deck_id_val).strip()
    if s_id.startswith("lib_"):
        raw_id = int(s_id.replace("lib_", ""))
        deck = models.Deck.get_or_none(models.Deck.id == raw_id)
        if not deck:
            return None, [], True
        cards = list(models.Card.select().where((models.Card.deck == deck) & (models.Card.is_deleted == False)).order_by(models.Card.position.asc(), models.Card.id.asc()))
        return deck, cards, True
    else:
        try:
            d_id = int(s_id)
            deck = models.TMA_Deck.get_or_none(models.TMA_Deck.id == d_id)
            if deck:
                cards = list(models.TMA_Card.select().where((models.TMA_Card.deck_id == deck.id) & (models.TMA_Card.is_deleted == False)).order_by(models.TMA_Card.position.asc(), models.TMA_Card.id.asc()))
                return deck, cards, False
            deck = models.Deck.get_or_none(models.Deck.id == d_id)
            if deck:
                cards = list(models.Card.select().where((models.Card.deck == deck) & (models.Card.is_deleted == False)).order_by(models.Card.position.asc(), models.Card.id.asc()))
                return deck, cards, True
            return None, [], False
        except ValueError:
            return None, [], False


@app.get("/api/admin/decks/{deck_id}/cards")
def get_deck_cards(deck_id: str):
    """Returns list of all active cards in a deck with health status and deck summary for preview."""
    deck, cards, is_lib = get_deck_and_cards(deck_id)
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    result = []
    total = len(cards)
    with_audio = 0
    with_context = 0
    fully_completed = 0

    for idx, c in enumerate(cards, 1):
        has_aud = card_has_valid_audio(c)
        has_ctx = bool(c.context and str(c.context).strip())
        is_comp = card_is_fully_completed(c)

        if has_aud:
            with_audio += 1
        if has_ctx:
            with_context += 1
        if is_comp:
            fully_completed += 1

        result.append({
            "id": c.id,
            "position": idx,
            "front": c.front_text or "",
            "back": c.back_text or "",
            "context": c.context or "",
            "tags": c.tags or "",
            "has_context": has_ctx,
            "has_audio": has_aud,
            "is_complete": is_comp,
            "audio_path": c.audio_path or ""
        })

    audio_cov = round((with_audio / total * 100)) if total > 0 else 0
    ctx_cov = round((with_context / total * 100)) if total > 0 else 0
    comp_cov = round((fully_completed / total * 100)) if total > 0 else 0

    meta = {}
    try:
        meta = json.loads(getattr(deck, 'metadata', '{}') or '{}')
    except Exception:
        pass

    deck_info = {
        "id": str(deck_id),
        "name": deck.name,
        "target_language": getattr(deck, 'target_language', 'de') or 'de',
        "level": getattr(deck, 'level', None),
        "topic": getattr(deck, 'topic', None),
        "is_library": is_lib,
        "user_id": getattr(deck, 'user_id', 0) if hasattr(deck, 'user_id') else "Библиотека ⭐",
        "is_default": bool(meta.get("is_default", False)) if not is_lib else bool(getattr(deck, 'is_default', False)),
        "card_count": total,
        "with_audio_count": with_audio,
        "missing_audio_count": total - with_audio,
        "with_context_count": with_context,
        "missing_context_count": total - with_context,
        "fully_completed_count": fully_completed,
        "audio_coverage_pct": audio_cov,
        "context_coverage_pct": ctx_cov,
        "completion_pct": comp_cov
    }

    return {"cards": result, "deck": deck_info, "total": total}


@app.put("/api/admin/cards/{card_id}")
def update_card_endpoint(card_id: int, req: UpdateCardRequest):
    """Updates fields of a specific card (in TMA_Card or Card)."""
    now = datetime.datetime.now()
    tma_card = models.TMA_Card.get_or_none(models.TMA_Card.id == card_id)
    if tma_card:
        if req.front_text is not None:
            tma_card.front_text = req.front_text
        if req.back_text is not None:
            tma_card.back_text = req.back_text
        if req.context is not None:
            tma_card.context = req.context
        if req.tags is not None:
            tma_card.tags = req.tags
        tma_card.updated_at = now
        tma_card.save()
        return {"status": "ok", "card_id": card_id, "type": "tma"}

    lib_card = models.Card.get_or_none(models.Card.id == card_id)
    if lib_card:
        if req.front_text is not None:
            lib_card.front_text = req.front_text
        if req.back_text is not None:
            lib_card.back_text = req.back_text
        if req.context is not None:
            lib_card.context = req.context
        if req.tags is not None:
            lib_card.tags = req.tags
        lib_card.updated_at = now
        lib_card.save()
        return {"status": "ok", "card_id": card_id, "type": "library"}

    raise HTTPException(status_code=404, detail="Card not found")


@app.delete("/api/admin/cards/{card_id}")
def delete_card_endpoint(card_id: int):
    """Soft deletes a card."""
    now = datetime.datetime.now()
    tma_card = models.TMA_Card.get_or_none(models.TMA_Card.id == card_id)
    if tma_card:
        tma_card.is_deleted = True
        tma_card.updated_at = now
        tma_card.save()
        return {"status": "ok", "card_id": card_id}

    lib_card = models.Card.get_or_none(models.Card.id == card_id)
    if lib_card:
        lib_card.is_deleted = True
        lib_card.updated_at = now
        lib_card.save()
        return {"status": "ok", "card_id": card_id}

    raise HTTPException(status_code=404, detail="Card not found")


@app.post("/api/admin/cards/{card_id}/synthesize-audio")
async def synthesize_single_card_audio(card_id: int, voice: Optional[str] = "de-DE-KatjaNeural", rate: Optional[str] = "+0%"):
    """Synthesizes TTS audio for a single card on-the-fly and saves it."""
    card = models.TMA_Card.get_or_none(models.TMA_Card.id == card_id)
    if not card:
        card = models.Card.get_or_none(models.Card.id == card_id)

    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    front = (card.front_text or "").strip()
    if not front:
        raise HTTPException(status_code=400, detail="Card front text is empty")

    from api.utils.audio import generate_audio
    res_audio = await generate_audio(front, voice=voice or "de-DE-KatjaNeural", rate=rate or "+0%")
    if isinstance(res_audio, tuple):
        res_audio = res_audio[0]

    if not res_audio:
        raise HTTPException(status_code=500, detail="TTS generation failed")

    saved_audio = save_audio_to_db_or_cloud(res_audio)
    if saved_audio:
        card.audio_path = saved_audio
        card.updated_at = datetime.datetime.now()
        card.save()
        return {"status": "ok", "card_id": card_id, "audio_path": saved_audio}

    raise HTTPException(status_code=500, detail="Failed to save audio file")


@app.delete("/api/admin/decks/{deck_id}")
def delete_deck(deck_id: str):
    """Soft deletes a deck."""
    deck, _, is_lib = get_deck_and_cards(deck_id)
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")
    deck.is_deleted = True
    deck.updated_at = datetime.datetime.now()
    deck.save()
    return {"status": "ok", "deleted_deck_id": deck_id}




# ==========================================
# Batch Multi-Deck Regeneration API
# ==========================================

@app.post("/api/admin/decks/batch/summary")
def get_batch_summary(req: BatchSummaryRequest):
    """Returns aggregated statistics and breakdown for a list of staged deck IDs."""
    deck_list = []
    total_cards = 0
    total_missing_audio = 0
    languages = set()

    for d_id in req.deck_ids:
        deck, cards, is_lib = get_deck_and_cards(d_id)
        if not deck:
            continue

        c_count = len(cards)
        m_audio = sum(1 for c in cards if not card_has_valid_audio(c))
        lang = getattr(deck, 'target_language', 'de') or 'de'
        languages.add(lang)
        total_cards += c_count
        total_missing_audio += m_audio

        deck_list.append({
            "id": str(d_id),
            "name": deck.name,
            "target_language": lang,
            "level": getattr(deck, 'level', None),
            "card_count": c_count,
            "missing_audio_count": m_audio,
            "is_library": is_lib
        })

    return {
        "decks": deck_list,
        "total_decks": len(deck_list),
        "total_cards": total_cards,
        "total_missing_audio": total_missing_audio,
        "languages": list(languages)
    }


async def run_batch_ai_regeneration(task_id: str, options: BatchRegenerateDeckRequest):
    global regen_tasks
    task_info = regen_tasks.get(task_id)
    if not task_info:
        return

    # 1. Collect all valid decks and filter cards per deck
    decks_to_process = []
    total_cards_count = 0

    for deck_id in options.deck_ids:
        deck, cards, is_lib = get_deck_and_cards(deck_id)
        if not deck:
            task_info["logs"].append(f"⚠️ Колода #{deck_id} не найдена, пропускаем")
            continue

        if options.skip_completed:
            before_len = len(cards)
            cards = [c for c in cards if not card_is_fully_completed(c)]
            skipped_comp = before_len - len(cards)
            if skipped_comp > 0:
                task_info["logs"].append(f"  🛡️ Пропущено полностью заполненных карточек: {skipped_comp} в «{deck.name}»")

        if options.only_empty:
            cards = [c for c in cards if not c.back_text or not c.context]
        if options.only_no_context:
            cards = [c for c in cards if not c.context or not str(c.context).strip()]

        if options.dry_run:
            cards = cards[:2]  # Sample strictly 2 cards per deck for fast test
        elif options.cards_per_deck_limit and options.cards_per_deck_limit > 0:
            cards = cards[:options.cards_per_deck_limit]

        if cards:
            decks_to_process.append((deck_id, deck, cards, is_lib))
            total_cards_count += len(cards)

    # Apply deck start index if resuming
    start_d_idx = (options.start_deck_idx - 1) if (options.start_deck_idx and options.start_deck_idx > 1) else 0
    if start_d_idx > 0 and start_d_idx < len(decks_to_process):
        decks_to_process = decks_to_process[start_d_idx:]

    task_info["total_decks"] = len(decks_to_process)
    task_info["total_cards"] = total_cards_count
    task_info["status"] = "running"
    task_info["control"] = "run"
    task_info["dry_run_results"] = []
    task_info["is_dry_run"] = options.dry_run
    task_info["sync_copies"] = options.sync_copies
    task_info["voice"] = options.voice or "de-DE-KatjaNeural"
    task_info["no_audio"] = options.no_audio
    task_info["options"] = options.dict()
    task_info["task_type"] = "batch_ai"

    mode_str = "🧪 ТЕСТ (Dry-Run: по 2 карточки на колоду)" if options.dry_run else f"🚀 МАССОВАЯ ГЕНЕРАЦИЯ ({len(decks_to_process)} колод, {total_cards_count} карточек)"
    task_info["logs"].append(f"Запуск: {mode_str} (Голос: {options.voice or 'Default'})...")

    # Auto backup before full mass run
    if not options.dry_run:
        try:
            create_full_db_backup()
            task_info["logs"].append("🛡️ Автобэкап базы данных успешно создан перед стартом пакета.")
        except Exception as b_err:
            task_info["logs"].append(f"⚠️ Не удалось создать автобэкап: {b_err}")

    global_card_idx = 0

    for d_idx, (deck_id, deck, cards, is_lib) in enumerate(decks_to_process, start_d_idx + 1):
        task_info["current_deck_id"] = str(deck_id)
        task_info["current_deck_name"] = deck.name
        task_info["processed_decks"] = d_idx - 1

        target_lang = getattr(deck, 'target_language', 'de') or options.target_lang or "de"
        native_lang = options.native_lang or "uk"
        user_id_val = getattr(deck, 'user_id', 0) if hasattr(deck, 'user_id') and isinstance(getattr(deck, 'user_id'), int) else 0

        task_info["logs"].append(f"📦 [{d_idx}/{len(decks_to_process)}] Колода: «{deck.name}» (#{deck_id}) — {len(cards)} карточек...")

        # Apply card start index for first resumed deck
        start_c_idx = (options.start_card_idx - 1) if (d_idx == start_d_idx + 1 and options.start_card_idx and options.start_card_idx > 1) else 0
        cards_slice = cards[start_c_idx:]

        for c_idx, card in enumerate(cards_slice, start_c_idx + 1):
            while task_info.get("control") == "pause":
                task_info["status"] = "paused"
                task_manager.update_task_progress(task_id, status="paused")
                await asyncio.sleep(0.5)

            if task_info.get("control") == "stop":
                task_info["status"] = "stopped"
                task_info["logs"].append("🛑 Пакетная перегенерация остановлена пользователем.")
                task_manager.update_task_progress(task_id, status="stopped", log_msg="🛑 Остановлено пользователем")
                return

            task_info["status"] = "running"
            front = (card.front_text or "").strip()
            if not front:
                global_card_idx += 1
                task_info["processed_cards"] = global_card_idx
                continue

            # Update current_card BEFORE AI call so UI shows what's being processed
            global_card_idx += 1
            task_info["processed_cards"] = global_card_idx
            task_info["current_card"] = f"⏳ [{c_idx}/{len(cards)}] {front[:30]}..."

            task_manager.update_task_progress(
                task_id,
                status="running",
                current_deck_idx=d_idx,
                current_deck_id=str(deck_id),
                current_deck_name=deck.name,
                current_card_idx=c_idx,
                current_card_id=card.id,
                current_card_text=front,
                processed_cards=global_card_idx,
                processed_decks=d_idx - 1
            )

            try:
                res = await asyncio.wait_for(
                    ai_service.generate_card_fields(
                        user_id=user_id_val,
                        phrase=front,
                        target_language=target_lang,
                        native_language=native_lang,
                        action_type="full_card"
                    ),
                    timeout=90.0  # 90s hard timeout per card
                )
            except asyncio.TimeoutError:
                task_info["current_card"] = f"[{c_idx}/{len(cards)}] {front[:30]}"
                task_info["logs"].append(f"  [{c_idx}/{len(cards)}] ⏰ Таймаут 90с: {front[:25]} — пропускаем")
                if options.delay > 0:
                    await asyncio.sleep(min(options.delay, 0.5))
                continue
            except Exception as e:
                task_info["current_card"] = f"[{c_idx}/{len(cards)}] {front[:30]}"
                task_info["logs"].append(f"  [{c_idx}/{len(cards)}] ❌ Исключение AI: {str(e)[:60]}")
                if options.delay > 0:
                    await asyncio.sleep(min(options.delay, 0.5))
                continue

            task_info["current_card"] = f"[{c_idx}/{len(cards)}] {front[:30]}"

            if isinstance(res, dict) and "error" in res:
                task_info["logs"].append(f"  [{c_idx}/{len(cards)}] ❌ {front[:20]}: {res['error'][:60]}")
                if options.delay > 0:
                    await asyncio.sleep(min(options.delay, 0.5))
                continue

            try:
                new_front = res.get("front") or front
                new_back = res.get("back") or ""
                new_context = res.get("context") or ""
                new_level = res.get("level")

                if options.dry_run:
                    task_info["dry_run_results"].append({
                        "deck_id": str(deck_id),
                        "deck_name": deck.name,
                        "card_id": card.id,
                        "front": new_front,
                        "back": new_back,
                        "context": new_context,
                        "level": new_level
                    })
                else:
                    card.front_text = new_front
                    card.back_text = new_back
                    card.context = new_context
                    if new_level:
                        curr_tags = card.tags or ""
                        cleaned = ",".join([t for t in curr_tags.split(",") if t and t.upper() not in {"A1","A2","B1","B2","C1","C2"}])
                        card.tags = f"{cleaned},{new_level}".strip(",") if cleaned else new_level
                    card.updated_at = datetime.datetime.now()
                    card.save()

                    if not options.no_audio:
                        try:
                            from api.utils.audio import generate_audio
                            res_audio = await generate_audio(new_front, voice=options.voice or "de-DE-KatjaNeural", rate=options.rate or "+0%")
                            if isinstance(res_audio, tuple):
                                res_audio = res_audio[0]
                            if res_audio:
                                saved_audio = save_audio_to_db_or_cloud(res_audio)
                                if saved_audio:
                                    card.audio_path = saved_audio
                                    card.save()
                        except Exception as err:
                            task_info["logs"].append(f"    ⚠️ [TTS] Ошибка озвучки: {err}")

                    if options.sync_copies:
                        d_count, c_count = sync_card_updates_to_matching_decks(
                            deck, front, new_front, new_back, new_context, new_level, card.audio_path
                        )
                        if c_count > 0:
                            task_info["logs"].append(f"    ↪ 🔄 Синхронизировано с {d_count} другими колодами ({c_count} карт.)")

                task_info["logs"].append(f"  [{c_idx}/{len(cards)}] ✅ {new_front[:20]} -> {new_back[:20]}")

            except Exception as e:
                task_info["logs"].append(f"  [{c_idx}/{len(cards)}] ❌ Исключение: {str(e)}")

            if options.delay > 0:
                await asyncio.sleep(options.delay)

        task_info["processed_decks"] = d_idx

    task_info["status"] = "completed"
    task_info["logs"].append(f"🎉 Пакетная перегенерация {len(decks_to_process)} колод ({global_card_idx} карточек) успешно завершена!")
    task_manager.update_task_progress(task_id, status="completed", log_msg="🎉 Завершено")


async def run_batch_audio_regeneration(task_id: str, options: BatchRegenerateAudioRequest):
    global regen_tasks
    task_info = regen_tasks.get(task_id)
    if not task_info:
        return

    from api.utils.audio import generate_audio

    decks_to_process = []
    total_cards_count = 0

    for deck_id in options.deck_ids:
        deck, cards, is_lib = get_deck_and_cards(deck_id)
        if not deck:
            task_info["logs"].append(f"⚠️ Колода #{deck_id} не найдена, пропускаем")
            continue

        if options.skip_completed:
            before_len = len(cards)
            cards = [c for c in cards if not card_is_fully_completed(c)]
            skipped_comp = before_len - len(cards)
            if skipped_comp > 0:
                task_info["logs"].append(f"  🛡️ Пропущено полностью заполненных карточек: {skipped_comp} в «{deck.name}»")

        if options.only_missing_audio:
            cards = [c for c in cards if not card_has_valid_audio(c)]

        if options.cards_per_deck_limit and options.cards_per_deck_limit > 0:
            cards = cards[:options.cards_per_deck_limit]

        if cards:
            decks_to_process.append((deck_id, deck, cards, is_lib))
            total_cards_count += len(cards)

    start_d_idx = (options.start_deck_idx - 1) if (options.start_deck_idx and options.start_deck_idx > 1) else 0
    if start_d_idx > 0 and start_d_idx < len(decks_to_process):
        decks_to_process = decks_to_process[start_d_idx:]

    task_info["total_decks"] = len(decks_to_process)
    task_info["total_cards"] = total_cards_count
    task_info["status"] = "running"
    task_info["control"] = "run"
    task_info["voice"] = options.voice or "de-DE-KatjaNeural"
    task_info["rate"] = options.rate or "+0%"
    task_info["sync_copies"] = options.sync_copies
    task_info["options"] = options.dict()
    task_info["task_type"] = "batch_audio"

    voice_str = options.voice or "de-DE-KatjaNeural"
    rate_str = options.rate or "+0%"
    task_info["logs"].append(f"🎙️ Запуск пакетного озвучивания: {len(decks_to_process)} колод, {total_cards_count} карточек (Голос: {voice_str}, Скорость: {rate_str})...")

    global_card_idx = 0

    for d_idx, (deck_id, deck, cards, is_lib) in enumerate(decks_to_process, start_d_idx + 1):
        task_info["current_deck_id"] = str(deck_id)
        task_info["current_deck_name"] = deck.name
        task_info["processed_decks"] = d_idx - 1

        task_info["logs"].append(f"📦 [{d_idx}/{len(decks_to_process)}] Озвучка колоды: «{deck.name}» (#{deck_id}) — {len(cards)} карточек...")

        start_c_idx = (options.start_card_idx - 1) if (d_idx == start_d_idx + 1 and options.start_card_idx and options.start_card_idx > 1) else 0
        cards_slice = cards[start_c_idx:]

        for c_idx, card in enumerate(cards_slice, start_c_idx + 1):
            while task_info.get("control") == "pause":
                task_info["status"] = "paused"
                task_manager.update_task_progress(task_id, status="paused")
                await asyncio.sleep(0.5)

            if task_info.get("control") == "stop":
                task_info["status"] = "stopped"
                task_info["logs"].append("🛑 Пакетное озвучивание остановлено пользователем.")
                task_manager.update_task_progress(task_id, status="stopped", log_msg="🛑 Остановлено")
                return

            task_info["status"] = "running"
            front = (card.front_text or "").strip()
            if not front:
                global_card_idx += 1
                task_info["processed_cards"] = global_card_idx
                continue

            global_card_idx += 1
            task_info["processed_cards"] = global_card_idx
            task_info["current_card"] = f"⏳ [{c_idx}/{len(cards)}] {front[:30]}..."

            task_manager.update_task_progress(
                task_id,
                status="running",
                current_deck_idx=d_idx,
                current_deck_id=str(deck_id),
                current_deck_name=deck.name,
                current_card_idx=c_idx,
                current_card_id=card.id,
                current_card_text=front,
                processed_cards=global_card_idx,
                processed_decks=d_idx - 1
            )

            try:
                res_audio = await asyncio.wait_for(
                    generate_audio(front, voice=voice_str, rate=rate_str),
                    timeout=60.0  # 60s hard timeout per TTS call
                )
                if isinstance(res_audio, tuple):
                    res_audio = res_audio[0]

                task_info["current_card"] = f"[{c_idx}/{len(cards)}] {front[:30]}"

                if res_audio:
                    saved_audio = save_audio_to_db_or_cloud(res_audio)
                    if saved_audio:
                        card.audio_path = saved_audio
                        card.updated_at = datetime.datetime.now()
                        card.save()

                        if options.sync_copies:
                            d_count, c_count = sync_card_audio_to_matching_decks(deck, front, saved_audio)
                            if c_count > 0:
                                task_info["logs"].append(f"    ↪ 🔄 Аудио синхронизировано с {d_count} другими колодами ({c_count} карт.)")

                        task_info["logs"].append(f"  [{c_idx}/{len(cards)}] 🎙️ {front[:25]} -> {saved_audio}")
                    else:
                        task_info["logs"].append(f"  [{c_idx}/{len(cards)}] ❌ Ошибка сохранения аудио: {front[:20]}")
                else:
                    task_info["logs"].append(f"  [{c_idx}/{len(cards)}] ❌ Пустой результат TTS: {front[:20]}")

            except asyncio.TimeoutError:
                task_info["current_card"] = f"[{c_idx}/{len(cards)}] {front[:30]}"
                task_info["logs"].append(f"  [{c_idx}/{len(cards)}] ⏰ Таймаут TTS 60с: {front[:25]} — пропускаем")
            except Exception as e:
                task_info["current_card"] = f"[{c_idx}/{len(cards)}] {front[:30]}"
                task_info["logs"].append(f"  [{c_idx}/{len(cards)}] ❌ Ошибка TTS: {str(e)[:60]}")

            if options.delay > 0:
                await asyncio.sleep(options.delay)

        task_info["processed_decks"] = d_idx

    task_info["status"] = "completed"
    task_info["logs"].append(f"🎉 Пакетная озвучка {len(decks_to_process)} колод ({global_card_idx} карточек) успешно завершена!")
    task_manager.update_task_progress(task_id, status="completed", log_msg="🎉 Завершено")


async def run_bulk_card_creation(task_id: str, req: BulkCreateCardsRequest):
    global regen_tasks
    task_info = regen_tasks.get(task_id)
    if not task_info:
        return

    # 1. Resolve or create Deck
    deck = None
    is_lib = False
    if req.deck_id:
        deck, _, is_lib = get_deck_and_cards(req.deck_id)
        if not deck:
            task_info["status"] = "failed"
            task_info["logs"].append(f"❌ Колода #{req.deck_id} не найдена")
            task_manager.save_task_checkpoint(task_info)
            return
    elif req.new_deck_name:
        deck_name = req.new_deck_name.strip()
        t_lang = req.target_language or "de"
        lvl = req.level or "A1"
        top = req.topic
        u_id = req.user_id or 0

        if req.is_library:
            deck = models.Deck.create(
                name=deck_name,
                target_language=t_lang,
                level=lvl,
                topic=top,
                is_deleted=False
            )
            is_lib = True
            req.deck_id = f"lib_{deck.id}"
            task_info["logs"].append(f"📁 Создана новая Библиотечная колода: «{deck.name}» (ID: lib_{deck.id})")
        else:
            meta = {"is_default": True} if req.is_default else {}
            deck = models.TMA_Deck.create(
                user_id=u_id,
                name=deck_name,
                target_language=t_lang,
                level=lvl,
                topic=top,
                metadata=json.dumps(meta),
                is_deleted=False
            )
            is_lib = False
            req.deck_id = str(deck.id)
            task_info["logs"].append(f"📁 Создана новая колода пользователя: «{deck.name}» (ID: #{deck.id})")
            
            if req.is_default:
                all_users = list(models.TMAUser.select())
                for u in all_users:
                    if u.user_id != u_id:
                        models.TMA_Deck.create(
                            user_id=u.user_id,
                            name=deck_name,
                            target_language=t_lang,
                            level=lvl,
                            topic=top,
                            metadata=json.dumps({"source_deck_id": deck.id, "is_default": True}),
                            is_deleted=False
                        )
    else:
        task_info["status"] = "failed"
        task_info["logs"].append("❌ Не указан ID колоды и не задано имя для новой колоды")
        task_manager.save_task_checkpoint(task_info)
        return

    clean_phrases = [p.strip() for p in req.phrases if p and p.strip()]
    if not clean_phrases:
        task_info["status"] = "completed"
        task_info["logs"].append("⚠️ Список слов пуст. Карточки не созданы.")
        task_manager.save_task_checkpoint(task_info)
        return

    start_idx = (req.start_card_idx - 1) if (req.start_card_idx and req.start_card_idx > 1) else 0
    phrases_to_process = clean_phrases[start_idx:]

    task_info["total_cards"] = len(clean_phrases)
    task_info["total_decks"] = 1
    task_info["current_deck_id"] = str(req.deck_id)
    task_info["current_deck_name"] = deck.name
    task_info["status"] = "running"
    task_info["control"] = "run"
    task_info["voice"] = req.voice or "de-DE-KatjaNeural"
    task_info["rate"] = req.rate or "+0%"
    task_info["options"] = req.dict()
    task_info["task_type"] = "bulk_create"

    task_info["logs"].append(f"🚀 Запуск массового добавления {len(phrases_to_process)} карточек в колоду «{deck.name}»...")

    card_model = models.Card if is_lib else models.TMA_Card
    deck_filter = (models.Card.deck == deck) if is_lib else (models.TMA_Card.deck_id == deck.id)
    last_card = card_model.select().where(deck_filter & (card_model.is_deleted == False)).order_by(card_model.position.desc()).first()
    curr_pos = (last_card.position or 0) if last_card else 0

    target_lang = getattr(deck, 'target_language', 'de') or req.target_language or "de"
    native_lang = req.native_lang or "uk"
    user_id_val = getattr(deck, 'user_id', 0) if hasattr(deck, 'user_id') and isinstance(getattr(deck, 'user_id'), int) else 0
    voice_str = req.voice or "de-DE-KatjaNeural"
    rate_str = req.rate or "+0%"

    global_c_idx = start_idx
    created_count = 0

    from api.utils.audio import generate_audio

    for idx, phrase in enumerate(phrases_to_process, start_idx + 1):
        while task_info.get("control") == "pause":
            task_info["status"] = "paused"
            task_manager.update_task_progress(task_id, status="paused")
            await asyncio.sleep(0.5)

        if task_info.get("control") == "stop":
            task_info["status"] = "stopped"
            task_info["logs"].append("🛑 Массовое добавление карточек остановлено пользователем.")
            task_manager.update_task_progress(task_id, status="stopped", log_msg="🛑 Остановлено")
            return

        task_info["status"] = "running"
        global_c_idx += 1
        task_info["processed_cards"] = global_c_idx
        task_info["current_card"] = f"⏳ [{idx}/{len(clean_phrases)}] {phrase[:30]}..."

        new_front = phrase
        new_back = ""
        new_context = ""
        new_level = req.level or getattr(deck, 'level', None)

        if req.generate_ai:
            try:
                res = await asyncio.wait_for(
                    ai_service.generate_card_fields(
                        user_id=user_id_val,
                        phrase=phrase,
                        target_language=target_lang,
                        native_language=native_lang,
                        action_type="full_card"
                    ),
                    timeout=90.0
                )
                if isinstance(res, dict) and "error" not in res:
                    new_front = res.get("front") or phrase
                    new_back = res.get("back") or ""
                    new_context = res.get("context") or ""
                    if res.get("level"):
                        new_level = res.get("level")
                elif isinstance(res, dict) and "error" in res:
                    task_info["logs"].append(f"  [{idx}/{len(clean_phrases)}] ⚠️ AI ошибка: {res['error'][:60]}")
            except Exception as e:
                task_info["logs"].append(f"  [{idx}/{len(clean_phrases)}] ⚠️ AI исключение: {str(e)[:60]}")

        saved_audio = None
        if req.generate_audio:
            try:
                res_audio = await asyncio.wait_for(
                    generate_audio(new_front, voice=voice_str, rate=rate_str),
                    timeout=60.0
                )
                if isinstance(res_audio, tuple):
                    res_audio = res_audio[0]
                if res_audio:
                    saved_audio = save_audio_to_db_or_cloud(res_audio)
            except Exception as err:
                task_info["logs"].append(f"  [{idx}/{len(clean_phrases)}] ⚠️ TTS ошибка: {str(err)[:60]}")

        curr_pos += 1
        now = datetime.datetime.now()
        if is_lib:
            created_card = models.Card.create(
                deck=deck,
                front_text=new_front,
                back_text=new_back,
                context=new_context,
                tags=new_level,
                audio_path=saved_audio,
                position=curr_pos,
                is_deleted=False,
                created_at=now,
                updated_at=now
            )
        else:
            created_card = models.TMA_Card.create(
                deck_id=deck.id,
                user_id=user_id_val,
                front_text=new_front,
                back_text=new_back,
                context=new_context,
                tags=new_level,
                audio_path=saved_audio,
                position=curr_pos,
                is_deleted=False,
                created_at=now,
                updated_at=now
            )
        created_count += 1

        if req.sync_copies:
            try:
                sync_card_updates_to_matching_decks(deck, phrase, new_front, new_back, new_context, new_level, saved_audio)
            except Exception:
                pass

        task_info["current_card"] = f"[{idx}/{len(clean_phrases)}] {new_front[:30]}"
        task_info["logs"].append(f"  [{idx}/{len(clean_phrases)}] ✅ «{new_front}» -> «{new_back}»")
        
        task_manager.update_task_progress(
            task_id,
            status="running",
            current_deck_idx=1,
            current_deck_id=str(req.deck_id),
            current_deck_name=deck.name,
            current_card_idx=idx,
            current_card_id=created_card.id,
            current_card_text=new_front,
            processed_cards=global_c_idx,
            processed_decks=1
        )

        if req.delay > 0:
            await asyncio.sleep(req.delay)

    task_info["status"] = "completed"
    task_info["logs"].append(f"🎉 Массовое добавление завершено: успешно создано {created_count} карточек в колоде «{deck.name}»!")
    task_manager.update_task_progress(task_id, status="completed", log_msg=f"🎉 Завершено ({created_count} карточек)")


@app.post("/api/admin/cards/bulk-create")
def start_bulk_card_creation_endpoint(req: BulkCreateCardsRequest, background_tasks: BackgroundTasks):
    """Starts background bulk card creation + optional AI and TTS generation."""
    global regen_tasks
    if not req.phrases:
        raise HTTPException(status_code=400, detail="Phrases list is empty")

    task_id = f"bulk_create_{int(time.time())}"
    task_data = {
        "task_id": task_id,
        "is_batch": True,
        "task_type": "bulk_create",
        "status": "pending",
        "control": "run",
        "total_decks": 1,
        "processed_decks": 0,
        "current_deck_id": str(req.deck_id or ""),
        "current_deck_name": req.new_deck_name or "",
        "total_cards": len(req.phrases),
        "processed_cards": 0,
        "current_card": "",
        "logs": [],
        "dry_run_results": [],
        "is_dry_run": False,
        "is_audio_only": False,
        "voice": req.voice,
        "options": req.dict(),
        "start_time": time.time()
    }
    regen_tasks[task_id] = task_data
    task_manager.register_task(task_id, task_data)
    background_tasks.add_task(run_bulk_card_creation, task_id, req)
    return {"status": "ok", "task_id": task_id, "total_cards": len(req.phrases), "message": "Bulk card creation started"}


@app.post("/api/admin/cards/bulk-suggest-words")
async def suggest_topic_words_endpoint(req: SuggestWordsRequest):
    """Generates a list of words/phrases for a given topic and level using AI."""
    topic = req.topic.strip()
    if not topic:
        raise HTTPException(status_code=400, detail="Topic cannot be empty")

    count = max(5, min(req.count or 20, 60))
    lvl = req.level or "A1"
    target_lang = req.target_lang or "de"

    system_prompt = (
        f"You are an expert language teacher. Generate a clean list of exactly {count} essential vocabulary words "
        f"and useful short phrases for the topic '{topic}' in target language '{target_lang}' appropriate for CEFR level {lvl}. "
        f"Return ONLY a valid JSON array of strings, without explanations, markdown or extra text. Example format: [\"das Wort 1\", \"die Phrase 2\"]."
    )

    try:
        from api.ai_service import get_ai_config, AIService
        provider, ai_key, ai_model = get_ai_config()
        if not ai_key and provider != "ollama":
            return {"words": [f"{topic} - слово 1", f"{topic} - слово 2"], "count": 2, "topic": topic, "warning": "AI key not configured"}

        client = AIService(provider=provider, api_key=ai_key)
        resp, success = await client.chat_completion(
            system_prompt=system_prompt,
            user_message=f"Topic: {topic}, Level: {lvl}, Count: {count}",
            model=ai_model
        )

        if success and resp:
            cleaned = resp.strip()
            if cleaned.startswith("```"):
                lines = cleaned.split("\n")
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].startswith("```"):
                    lines = lines[:-1]
                cleaned = "\n".join(lines).strip()

            import json as _j
            words = _j.loads(cleaned)
            if isinstance(words, list):
                clean_words = [str(w).strip() for w in words if str(w).strip()]
                return {"words": clean_words, "count": len(clean_words), "topic": topic}
    except Exception as e:
        logger.error(f"Error suggesting topic words: {e}")

    return {
        "words": [],
        "count": 0,
        "topic": topic,
        "error": "Не удалось автоматически сгенерировать слова через ИИ. Введите слова вручную."
    }


@app.get("/api/admin/tasks/checkpoint")
def get_task_checkpoint():
    """Returns the last saved checkpoint state and whether it can be resumed."""
    ckpt = task_manager.load_task_checkpoint()
    if not ckpt:
        return {"has_checkpoint": False, "checkpoint": None, "can_resume": False}

    status = ckpt.get("status", "")
    can_resume = status in ("paused", "stopped", "failed", "running")
    return {
        "has_checkpoint": True,
        "can_resume": can_resume,
        "checkpoint": ckpt
    }


@app.post("/api/admin/tasks/clear-checkpoint")
def clear_task_checkpoint_endpoint():
    """Clears saved checkpoint from disk."""
    task_manager.clear_task_checkpoint()
    return {"status": "ok", "message": "Checkpoint cleared"}


@app.post("/api/admin/tasks/resume")
def resume_task_endpoint(req: ResumeTaskRequest, background_tasks: BackgroundTasks):
    """Resumes interrupted/stopped task from checkpoint or requested indices."""
    global regen_tasks
    ckpt = task_manager.load_task_checkpoint()
    if not ckpt:
        raise HTTPException(status_code=400, detail="No task checkpoint found to resume")

    task_type = ckpt.get("task_type", "")
    orig_options = ckpt.get("options", {})
    start_d_idx = req.start_deck_idx or ckpt.get("current_deck_idx") or 1
    start_c_idx = req.start_card_idx or ckpt.get("current_card_idx") or 1

    task_id = f"resumed_{int(time.time())}"
    task_info = dict(ckpt)
    task_info["task_id"] = task_id
    task_info["status"] = "running"
    task_info["control"] = "run"
    task_info["logs"] = list(ckpt.get("logs", []))
    task_info["logs"].append(f"▶ Возобновление задачи с колоды #{start_d_idx} / карточки #{start_c_idx}...")
    regen_tasks[task_id] = task_info
    task_manager.register_task(task_id, task_info)

    if task_type == "batch_ai":
        opt_req = BatchRegenerateDeckRequest(**orig_options)
        opt_req.start_deck_idx = start_d_idx
        opt_req.start_card_idx = start_c_idx
        background_tasks.add_task(run_batch_ai_regeneration, task_id, opt_req)
    elif task_type == "batch_audio":
        opt_req = BatchRegenerateAudioRequest(**orig_options)
        opt_req.start_deck_idx = start_d_idx
        opt_req.start_card_idx = start_c_idx
        background_tasks.add_task(run_batch_audio_regeneration, task_id, opt_req)
    elif task_type == "single_ai":
        deck_id = ckpt.get("deck_id") or ckpt.get("current_deck_id")
        opt_req = RegenerateDeckRequest(**orig_options)
        opt_req.start_card_idx = start_c_idx
        regen_tasks[deck_id] = task_info
        background_tasks.add_task(run_ai_regeneration, deck_id, opt_req)
    elif task_type == "single_audio":
        deck_id = ckpt.get("deck_id") or ckpt.get("current_deck_id")
        opt_req = RegenerateAudioRequest(**orig_options)
        opt_req.start_card_idx = start_c_idx
        regen_tasks[deck_id] = task_info
        background_tasks.add_task(run_audio_regeneration, deck_id, opt_req)
    elif task_type == "bulk_create":
        opt_req = BulkCreateCardsRequest(**orig_options)
        opt_req.start_card_idx = start_c_idx
        background_tasks.add_task(run_bulk_card_creation, task_id, opt_req)
    elif task_type == "classification":
        opt_req = ClassificationRequest(**orig_options)
        background_tasks.add_task(run_classification_task, task_id, opt_req)
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported task type for resume: {task_type}")

    return {
        "status": "resumed",
        "task_id": task_id,
        "task_type": task_type,
        "resumed_from_deck": start_d_idx,
        "resumed_from_card": start_c_idx,
        "message": "Task resumed successfully"
    }


@app.post("/api/admin/decks/batch/regenerate")
def start_batch_regeneration(req: BatchRegenerateDeckRequest, background_tasks: BackgroundTasks):
    """Starts background AI regeneration for multiple staged decks."""
    global regen_tasks
    if not req.deck_ids:
        raise HTTPException(status_code=400, detail="No decks provided for batch regeneration")

    task_id = f"batch_ai_{int(time.time())}"
    task_data = {
        "task_id": task_id,
        "is_batch": True,
        "task_type": "batch_ai",
        "status": "pending",
        "control": "run",
        "total_decks": len(req.deck_ids),
        "processed_decks": 0,
        "current_deck_id": "",
        "current_deck_name": "",
        "total_cards": 0,
        "processed_cards": 0,
        "current_card": "",
        "logs": [],
        "dry_run_results": [],
        "is_dry_run": req.dry_run,
        "is_audio_only": False,
        "voice": req.voice,
        "options": req.dict(),
        "start_time": time.time()
    }
    regen_tasks[task_id] = task_data
    task_manager.register_task(task_id, task_data)
    background_tasks.add_task(run_batch_ai_regeneration, task_id, req)
    return {"status": "ok", "task_id": task_id, "total_decks": len(req.deck_ids), "message": "Batch AI regeneration started"}


@app.post("/api/admin/decks/batch/regenerate-audio")
def start_batch_audio_regeneration(req: BatchRegenerateAudioRequest, background_tasks: BackgroundTasks):
    """Starts background audio regeneration for multiple staged decks."""
    global regen_tasks
    if not req.deck_ids:
        raise HTTPException(status_code=400, detail="No decks provided for batch regeneration")

    task_id = f"batch_audio_{int(time.time())}"
    task_data = {
        "task_id": task_id,
        "is_batch": True,
        "task_type": "batch_audio",
        "status": "pending",
        "control": "run",
        "total_decks": len(req.deck_ids),
        "processed_decks": 0,
        "current_deck_id": "",
        "current_deck_name": "",
        "total_cards": 0,
        "processed_cards": 0,
        "current_card": "",
        "logs": [],
        "dry_run_results": [],
        "is_dry_run": False,
        "is_audio_only": True,
        "voice": req.voice,
        "options": req.dict(),
        "start_time": time.time()
    }
    regen_tasks[task_id] = task_data
    task_manager.register_task(task_id, task_data)
    background_tasks.add_task(run_batch_audio_regeneration, task_id, req)
    return {"status": "ok", "task_id": task_id, "total_decks": len(req.deck_ids), "message": "Batch audio regeneration started"}


@app.get("/api/admin/decks/batch/{task_id}/status")
def get_batch_regen_status(task_id: str):
    """Returns progress and logs of a batch regeneration task."""
    global regen_tasks
    status_info = regen_tasks.get(task_id) or task_manager.get_task(task_id)
    if not status_info:
        return {"status": "idle", "processed_decks": 0, "total_decks": 0, "processed_cards": 0, "total_cards": 0, "logs": []}
    return status_info


@app.post("/api/admin/decks/batch/{task_id}/control")
def control_batch_regeneration(task_id: str, req: BatchControlRequest):
    """Controls running batch regeneration (pause, resume, stop) or commits dry-run results to DB."""
    global regen_tasks
    task_info = regen_tasks.get(task_id) or task_manager.get_task(task_id)
    if not task_info:
        raise HTTPException(status_code=404, detail="Batch regeneration task not found")

    action = req.action.lower()
    if action == "pause":
        task_info["control"] = "pause"
        task_info["status"] = "paused"
        task_info["logs"].append("⏸ Пакетная перегенерация приостановлена.")
        task_manager.update_task_progress(task_id, status="paused")
    elif action == "resume":
        task_info["control"] = "run"
        task_info["status"] = "running"
        task_info["logs"].append("▶ Пакетная перегенерация возобновлена.")
        task_manager.update_task_progress(task_id, status="running")
    elif action == "stop":
        task_info["control"] = "stop"
        task_info["status"] = "stopped"
        task_info["logs"].append("🛑 Сигнал остановки отправлен.")
        task_manager.update_task_progress(task_id, status="stopped")
    elif action == "commit_dry_run":
        results = task_info.get("dry_run_results", [])
        if not results:
            return {"status": "ok", "committed_count": 0, "message": "Нет результатов Dry-Run для сохранения"}

        count = 0
        sync_total = 0
        now = datetime.datetime.now()
        for item in results:
            deck_id = item["deck_id"]
            deck, _, is_lib = get_deck_and_cards(deck_id)
            card_model = models.Card if is_lib else models.TMA_Card
            card = card_model.get_or_none(card_model.id == item["card_id"])
            if card:
                orig_front = card.front_text
                card.front_text = item["front"]
                card.back_text = item["back"]
                card.context = item["context"]
                if item.get("level"):
                    curr_tags = card.tags or ""
                    cleaned = ",".join([t for t in curr_tags.split(",") if t and t.upper() not in {"A1","A2","B1","B2","C1","C2"}])
                    card.tags = f"{cleaned},{item['level']}".strip(",") if cleaned else item['level']
                card.updated_at = now
                card.save()
                count += 1

                if task_info.get("sync_copies") and deck:
                    _, sc = sync_card_updates_to_matching_decks(deck, orig_front, item["front"], item["back"], item["context"], item.get("level"))
                    sync_total += sc

        sync_msg = f" (и синхронизировано {sync_total} карточек у других колод)" if sync_total > 0 else ""
        task_info["logs"].append(f"💾 Результаты Dry-Run успешно записаны в БД для {count} карточек{sync_msg}!")
        task_manager.save_task_checkpoint(task_info)
        return {"status": "ok", "committed_count": count, "synced_count": sync_total}

    return {"status": "ok", "current_control": task_info.get("control"), "task_status": task_info.get("status")}


@app.post("/api/admin/classification/start")
def start_classification(req: ClassificationRequest, background_tasks: BackgroundTasks):
    """Starts a background CEFR classification audit, dry-run, or DB update."""
    global regen_tasks
    mode = (req.mode or "audit").lower().strip()
    if mode not in {"audit", "dry_run", "run"}:
        raise HTTPException(status_code=400, detail="Mode must be audit, dry_run, or run")
    if (req.lang or "de").lower().strip() != "de" and mode == "audit":
        raise HTTPException(status_code=400, detail="Only German local audit is supported right now")

    task_id = f"classification_{int(time.time())}"
    task_data = {
        "task_id": task_id,
        "is_batch": True,
        "task_type": "classification",
        "status": "pending",
        "control": "run",
        "mode": mode,
        "lang": req.lang,
        "vocab_profile": req.vocab_profile,
        "overwrite": req.overwrite,
        "clear_uncertain_local": req.clear_uncertain_local,
        "include_library": req.include_library,
        "cards_scanned": 0,
        "total_cards": 0,
        "processed_cards": 0,
        "unique_phrases": 0,
        "duplicate_saved": 0,
        "local_unique": 0,
        "ai_unique": 0,
        "ai_cards": 0,
        "processed_ai_chunks": 0,
        "total_ai_chunks": 0,
        "updated_cards": 0,
        "cleared_unique": 0,
        "cleared_cards": 0,
        "current_card": "",
        "logs": [],
        "classification_results": [],
        "level_counts": {},
        "existing_level_counts": {},
        "local_level_counts": {},
        "local_fallback_counts": {},
        "source_counts": {},
        "options": req.dict(),
        "start_time": time.time(),
    }
    regen_tasks[task_id] = task_data
    task_manager.register_task(task_id, task_data)
    background_tasks.add_task(run_classification_task, task_id, req)
    return {"status": "ok", "task_id": task_id, "message": "Classification task started"}


@app.get("/api/admin/classification/{task_id}/status")
def get_classification_status(task_id: str):
    """Returns progress and logs of a CEFR classification task."""
    global regen_tasks
    status_info = regen_tasks.get(task_id) or task_manager.get_task(task_id)
    return status_info or empty_classification_status()


@app.post("/api/admin/classification/{task_id}/control")
def control_classification(task_id: str, req: BatchControlRequest):
    """Pauses, resumes, or stops a CEFR classification task."""
    global regen_tasks
    task_info = regen_tasks.get(task_id) or task_manager.get_task(task_id)
    if not task_info:
        raise HTTPException(status_code=404, detail="Classification task not found")

    action = (req.action or "").lower().strip()
    if action == "pause":
        task_info["control"] = "pause"
        task_info["status"] = "paused"
        _append_classification_log(task_info, "Classification paused.")
    elif action == "resume":
        task_info["control"] = "run"
        task_info["status"] = "running"
        _append_classification_log(task_info, "Classification resumed.")
    elif action == "stop":
        task_info["control"] = "stop"
        task_info["status"] = "stopped"
        _append_classification_log(task_info, "Stop signal sent.")
    else:
        raise HTTPException(status_code=400, detail="Action must be pause, resume, or stop")

    _save_classification_task(task_id, task_info)
    return {"status": "ok", "current_control": task_info.get("control"), "task_status": task_info.get("status")}


@app.post("/api/admin/decks/{deck_id}/deduplicate")
def deduplicate_deck_cards(deck_id: str):
    """Removes duplicate cards (matching front_text) from a deck, keeping the first/newest card."""
    deck, cards, is_lib = get_deck_and_cards(deck_id)
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    seen_fronts = set()
    removed_count = 0
    now = datetime.datetime.now()
    
    for c in cards:
        front = (c.front_text or "").strip().lower()
        if not front:
            continue
        if front in seen_fronts:
            c.is_deleted = True
            c.updated_at = now
            c.save()
            removed_count += 1
        else:
            seen_fronts.add(front)

    return {
        "status": "ok",
        "deck_id": deck_id,
        "removed_duplicates": removed_count,
        "remaining_cards": len(seen_fronts),
        "message": f"Удалено {removed_count} дубликатов карточек! Осталось {len(seen_fronts)} уникальных."
    }


@app.post("/api/admin/decks/{deck_id}/set-default")
def set_default_deck(deck_id: str, req: SetDefaultDeckRequest):
    """Marks deck as default and optionally distributes copies to all users."""
    deck, cards, is_lib = get_deck_and_cards(deck_id)
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    if is_lib:
        deck.is_default = req.is_default
        deck.save()
    else:
        meta = {}
        try:
            meta = json.loads(deck.metadata or "{}")
        except Exception:
            pass
        meta["is_default"] = req.is_default
        deck.metadata = json.dumps(meta)
        deck.save()

    copied_count = 0
    if req.is_default and req.copy_to_existing:
        all_users = models.TMAUser.select()
        for u in all_users:
            if not hasattr(deck, 'user_id') or u.user_id != getattr(deck, 'user_id', None):
                existing = models.TMA_Deck.get_or_none(
                    (models.TMA_Deck.user_id == u.user_id) & 
                    (models.TMA_Deck.is_deleted == False) &
                    (models.TMA_Deck.name == deck.name)
                )
                if not existing:
                    new_deck = models.TMA_Deck.create(
                        user_id=u.user_id,
                        name=deck.name,
                        target_language=deck.target_language,
                        level=deck.level,
                        topic=deck.topic,
                        metadata=json.dumps({"source_deck_id": deck.id, "is_default": True})
                    )
                    for c in cards:
                        models.TMA_Card.create(
                            deck=new_deck,
                            front_text=c.front_text,
                            back_text=c.back_text,
                            context=c.context,
                            tags=c.tags,
                            audio_path=c.audio_path,
                            audio_back_path=c.audio_back_path,
                            card_type=getattr(c, 'card_type', 'translation'),
                            creator_id=getattr(deck, 'user_id', 0)
                        )
                    copied_count += 1

    return {"status": "ok", "is_default": req.is_default, "copied_to_users": copied_count}


@app.post("/api/admin/decks/{deck_id}/assign")
def assign_deck(deck_id: str, req: AssignDeckRequest):
    """Assigns deck to a specific list of user IDs or saves to Master Library."""
    deck, cards, is_lib = get_deck_and_cards(deck_id)
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    processed_users = 0
    clean_name = deck.name.replace("⭐ ", "").strip()

    if req.mode == "library":
        # Search for existing master deck in models.Deck
        target_library_deck = models.Deck.get_or_none(
            (models.Deck.is_deleted == False) &
            ((models.Deck.name == deck.name) | (models.Deck.name == clean_name) | (models.Deck.name == f"⭐ {clean_name}"))
        )

        if target_library_deck:
            # Delete old cards in existing library deck
            models.Card.update(is_deleted=True).where(models.Card.deck == target_library_deck).execute()

            # Copy cards from source deck into library deck
            now = datetime.datetime.now()
            for c in cards:
                models.Card.create(
                    deck=target_library_deck,
                    front_text=c.front_text,
                    back_text=c.back_text,
                    context=c.context,
                    tags=c.tags,
                    audio_path=c.audio_path,
                    audio_back_path=c.audio_back_path,
                    card_type=getattr(c, 'card_type', 'translation'),
                    source=getattr(c, 'source', '') or "",
                    created_at=now,
                    updated_at=now
                )
            
            target_library_deck.is_default = True
            target_library_deck.updated_at = now
            target_library_deck.save()
            return {"status": "ok", "mode": "library", "action": "updated", "message": f"Колода '{deck.name}' успешно обновлена в Библиотеке (заменено карточек: {len(cards)})!"}

        else:
            now = datetime.datetime.now()
            new_lib_deck = models.Deck.create(
                name=clean_name,
                target_language=deck.target_language or 'de',
                level=deck.level,
                topic=deck.topic,
                is_default=True,
                created_at=now,
                updated_at=now
            )
            for c in cards:
                models.Card.create(
                    deck=new_lib_deck,
                    front_text=c.front_text,
                    back_text=c.back_text,
                    context=c.context,
                    tags=c.tags,
                    audio_path=c.audio_path,
                    audio_back_path=c.audio_back_path,
                    card_type=getattr(c, 'card_type', 'translation'),
                    source=getattr(c, 'source', '') or "",
                    created_at=now,
                    updated_at=now
                )
            return {"status": "ok", "mode": "library", "action": "created", "message": f"Колода '{clean_name}' добавлена в Библиотеку как мастер-дефолтная!"}

    for target_user_id in req.user_ids:
        if req.mode == "collaborate":
            models.TMA_Collaborator.get_or_create(
                target_type="deck",
                target_id=deck.id,
                user_id=target_user_id,
                defaults={"role": "editor", "added_by": deck.user_id}
            )
            processed_users += 1
        else:
            new_deck = models.TMA_Deck.create(
                user_id=target_user_id,
                name=deck.name,
                target_language=deck.target_language,
                level=deck.level,
                topic=deck.topic,
                metadata=json.dumps({"assigned_from_deck_id": deck.id})
            )
            for c in cards:
                models.TMA_Card.create(
                    deck=new_deck,
                    front_text=c.front_text,
                    back_text=c.back_text,
                    context=c.context,
                    tags=c.tags,
                    audio_path=c.audio_path,
                    audio_back_path=c.audio_back_path,
                    card_type=c.card_type,
                    creator_id=deck.user_id
                )
            processed_users += 1

    return {"status": "ok", "mode": req.mode, "users_processed": processed_users}


def get_all_users_with_meta(search=None):
    users = list(models.TMAUser.select())
    result = []
    processed_uids = set()

    for u in users:
        if search:
            if not (search.lower() in (u.username or "").lower() or 
                    search.lower() in (u.first_name or "").lower() or 
                    str(u.user_id) == search):
                continue
        
        processed_uids.add(u.user_id)
        deck_count = models.TMA_Deck.select().where(
            (models.TMA_Deck.user_id == u.user_id) & (models.TMA_Deck.is_deleted == False)
        ).count()
        
        last_act = u.updated_at or u.created_at
        result.append({
            "id": u.user_id,
            "user_id": u.user_id,
            "username": u.username or "",
            "first_name": u.first_name or "",
            "last_name": u.last_name or "",
            "created_at": str(u.created_at) if u.created_at else None,
            "last_activity": str(last_act) if last_act else None,
            "deck_count": deck_count
        })
        
    return {"users": result}


def save_audio_to_db_or_cloud(res_audio: str) -> Optional[str]:
    """Ensures audio file bytes are stored in TMAMedia or returns cloud URL."""
    if not res_audio:
        return None
    if res_audio.startswith("http"):
        return res_audio
    
    filename = os.path.basename(res_audio)
    if os.path.exists(res_audio):
        try:
            with open(res_audio, "rb") as f:
                content = f.read()
            models.TMAMedia.get_or_create(
                filename=filename,
                folder='audio',
                defaults={'content': content}
            )
            try:
                os.remove(res_audio)
            except Exception:
                pass
        except Exception as e:
            logger.error(f"Error saving audio to TMAMedia: {e}")
    return filename


def card_has_valid_audio(card) -> bool:
    if not card.audio_path or not str(card.audio_path).strip():
        return False
    if card.audio_path.startswith("http"):
        return True
    filename = os.path.basename(card.audio_path)
    try:
        return models.TMAMedia.select(models.TMAMedia.id).where(
            (models.TMAMedia.filename == filename) &
            (models.TMAMedia.folder == 'audio')
        ).exists()
    except Exception:
        return False


def card_is_fully_completed(card) -> bool:
    """Returns True if card has non-empty front, non-empty back, non-empty context, and valid audio."""
    front = (getattr(card, 'front_text', '') or '').strip()
    back = (getattr(card, 'back_text', '') or '').strip()
    ctx = (getattr(card, 'context', '') or '').strip()
    return bool(front and back and ctx and card_has_valid_audio(card))


def sync_card_audio_to_matching_decks(source_deck, front_query, audio_path):
    """Propagates updated card audio_path to all decks with the same name across all users and library templates."""
    clean_name = source_deck.name.replace("⭐ ", "").strip()
    now = datetime.datetime.now()
    
    # 1. Sync to TMA user decks
    matching_tma_decks = list(
        models.TMA_Deck.select().where(
            (
                (models.TMA_Deck.name == source_deck.name) |
                (models.TMA_Deck.name == clean_name) |
                (models.TMA_Deck.name == f"⭐ {clean_name}")
            ) &
            (models.TMA_Deck.id != getattr(source_deck, 'id', 0)) &
            (models.TMA_Deck.is_deleted == False)
        )
    )
    synced_count = 0
    for d in matching_tma_decks:
        cards = list(models.TMA_Card.select().where(
            (models.TMA_Card.deck_id == d.id) &
            (models.TMA_Card.is_deleted == False) &
            (models.TMA_Card.front_text == front_query)
        ))
        for c in cards:
            c.audio_path = audio_path
            c.updated_at = now
            c.save()
            synced_count += 1

    # 2. Sync to Library decks in models.Deck
    matching_lib_decks = list(
        models.Deck.select().where(
            (
                (models.Deck.name == source_deck.name) |
                (models.Deck.name == clean_name) |
                (models.Deck.name == f"⭐ {clean_name}")
            ) &
            (models.Deck.id != getattr(source_deck, 'id', 0)) &
            (models.Deck.is_deleted == False)
        )
    )
    for ld in matching_lib_decks:
        cards = list(models.Card.select().where(
            (models.Card.deck == ld) &
            (models.Card.is_deleted == False) &
            (models.Card.front_text == front_query)
        ))
        for c in cards:
            c.audio_path = audio_path
            c.updated_at = now
            c.save()
            synced_count += 1

    total_matching_decks = len(matching_tma_decks) + len(matching_lib_decks)
    return total_matching_decks, synced_count


def sync_card_updates_to_matching_decks(source_deck, front_query, new_front, new_back, new_context, new_level=None, new_audio_path=None):
    """Propagates updated card content to all decks with the same name across all users and library templates."""
    clean_name = source_deck.name.replace("⭐ ", "").strip()
    now = datetime.datetime.now()

    # 1. Matching TMA user decks
    matching_tma_decks = list(
        models.TMA_Deck.select().where(
            (
                (models.TMA_Deck.name == source_deck.name) |
                (models.TMA_Deck.name == clean_name) |
                (models.TMA_Deck.name == f"⭐ {clean_name}")
            ) &
            (models.TMA_Deck.id != getattr(source_deck, 'id', 0)) &
            (models.TMA_Deck.is_deleted == False)
        )
    )
    synced_cards_count = 0
    for d in matching_tma_decks:
        cards = list(models.TMA_Card.select().where(
            (models.TMA_Card.deck_id == d.id) &
            (models.TMA_Card.is_deleted == False) &
            ((models.TMA_Card.front_text == front_query) | (models.TMA_Card.front_text == new_front))
        ))
        for c in cards:
            c.front_text = new_front
            c.back_text = new_back
            c.context = new_context
            if new_audio_path:
                c.audio_path = new_audio_path
            if new_level:
                curr_tags = c.tags or ""
                cleaned = ",".join([t for t in curr_tags.split(",") if t and t.upper() not in {"A1","A2","B1","B2","C1","C2"}])
                c.tags = f"{cleaned},{new_level}".strip(",") if cleaned else new_level
            c.updated_at = now
            c.save()
            synced_cards_count += 1

    # 2. Matching Library decks in models.Deck
    matching_lib_decks = list(
        models.Deck.select().where(
            (
                (models.Deck.name == source_deck.name) |
                (models.Deck.name == clean_name) |
                (models.Deck.name == f"⭐ {clean_name}")
            ) &
            (models.Deck.id != getattr(source_deck, 'id', 0)) &
            (models.Deck.is_deleted == False)
        )
    )
    for ld in matching_lib_decks:
        cards = list(models.Card.select().where(
            (models.Card.deck == ld) &
            (models.Card.is_deleted == False) &
            ((models.Card.front_text == front_query) | (models.Card.front_text == new_front))
        ))
        for c in cards:
            c.front_text = new_front
            c.back_text = new_back
            c.context = new_context
            if new_audio_path:
                c.audio_path = new_audio_path
            if new_level:
                curr_tags = c.tags or ""
                cleaned = ",".join([t for t in curr_tags.split(",") if t and t.upper() not in {"A1","A2","B1","B2","C1","C2"}])
                c.tags = f"{cleaned},{new_level}".strip(",") if cleaned else new_level
            c.updated_at = now
            c.save()
            synced_cards_count += 1

    total_decks = len(matching_tma_decks) + len(matching_lib_decks)
    return total_decks, synced_cards_count


async def run_ai_regeneration(deck_id: str, options: RegenerateDeckRequest):
    global regen_tasks
    task_info = regen_tasks.get(deck_id)
    if not task_info:
        return

    deck, cards, is_lib = get_deck_and_cards(deck_id)
    if not deck:
        task_info["status"] = "failed"
        task_info["logs"].append("❌ Ошибка: Колода не найдена")
        task_manager.save_task_checkpoint(task_info)
        return

    # Process excluded card IDs and position range strings
    excluded_pos = set()
    if options.exclude_range_str:
        parts = options.exclude_range_str.replace(" ", "").split(",")
        for p in parts:
            if not p:
                continue
            if "-" in p:
                sub = p.split("-")
                if len(sub) == 2 and sub[0].isdigit() and sub[1].isdigit():
                    start_idx, end_idx = int(sub[0]), int(sub[1])
                    for i in range(start_idx, end_idx + 1):
                        excluded_pos.add(i)
            elif p.isdigit():
                excluded_pos.add(int(p))

    ex_ids = set(options.exclude_card_ids or [])
    
    filtered_cards = []
    skipped_count = 0

    for idx, c in enumerate(cards, 1):
        if c.id in ex_ids or idx in excluded_pos:
            skipped_count += 1
            continue
        filtered_cards.append(c)

    cards = filtered_cards

    if skipped_count > 0:
        task_info["logs"].append(f"🛡️ Пропущено карточек по исключению: {skipped_count}")

    if options.skip_completed:
        before_len = len(cards)
        cards = [c for c in cards if not card_is_fully_completed(c)]
        skipped_comp = before_len - len(cards)
        if skipped_comp > 0:
            task_info["logs"].append(f"🛡️ Пропущено уже полностью заполненных карточек: {skipped_comp}")

    if options.only_empty:
        cards = [c for c in cards if not c.back_text or not c.context]

    if options.only_no_context:
        cards = [c for c in cards if not c.context or not str(c.context).strip()]

    # Slicing: strictly 3 cards for Dry-Run test, or all selected cards for full production
    if options.dry_run:
        cards = cards[:3]
    elif options.limit and options.limit > 0:
        cards = cards[:options.limit]

    start_c_idx = (options.start_card_idx - 1) if (options.start_card_idx and options.start_card_idx > 1) else 0
    if start_c_idx > 0 and start_c_idx < len(cards):
        cards = cards[start_c_idx:]

    task_info["total"] = len(cards)
    task_info["status"] = "running"
    task_info["control"] = "run"
    task_info["dry_run_results"] = []
    task_info["is_dry_run"] = options.dry_run
    task_info["sync_copies"] = options.sync_copies
    task_info["voice"] = options.voice or "de-DE-KatjaNeural"
    task_info["no_audio"] = options.no_audio
    task_info["options"] = options.dict()
    task_info["task_type"] = "single_ai"
    task_info["deck_id"] = str(deck_id)
    task_info["current_deck_id"] = str(deck_id)
    task_info["current_deck_name"] = deck.name
    
    mode_str = "🧪 ТЕСТ (3 карточки / Dry-Run)" if options.dry_run else f"🚀 ПОЛНАЯ ПЕРЕГЕНЕРАЦИЯ ({len(cards)} карточек)"
    task_info["logs"].append(f"Запуск: {mode_str} (Голос: {options.voice or 'Default'})...")

    target_lang = getattr(deck, 'target_language', 'de') or "de"
    native_lang = options.native_lang or "uk"
    user_id_val = getattr(deck, 'user_id', 0)

    for idx, card in enumerate(cards, start_c_idx + 1):
        while task_info.get("control") == "pause":
            task_info["status"] = "paused"
            task_manager.update_task_progress(deck_id, status="paused")
            await asyncio.sleep(0.5)
            
        if task_info.get("control") == "stop":
            task_info["status"] = "stopped"
            task_info["logs"].append("🛑 Процесс остановлен пользователем.")
            task_manager.update_task_progress(deck_id, status="stopped", log_msg="🛑 Остановлено")
            return

        task_info["status"] = "running"
        front = (card.front_text or "").strip()
        if not front:
            continue

        task_info["processed"] = idx
        task_info["current_card"] = front[:30]

        task_manager.update_task_progress(
            deck_id,
            status="running",
            current_deck_idx=1,
            current_deck_id=str(deck_id),
            current_deck_name=deck.name,
            current_card_idx=idx,
            current_card_id=card.id,
            current_card_text=front,
            processed_cards=idx,
            processed_decks=1
        )

        try:
            res = await ai_service.generate_card_fields(
                user_id=user_id_val,
                phrase=front,
                target_language=target_lang,
                native_language=native_lang,
                action_type="full_card"
            )

            if isinstance(res, dict) and "error" in res:
                task_info["logs"].append(f"[{idx}/{len(cards)}] ❌ {front[:20]}: {res['error']}")
                continue

            new_front = res.get("front") or front
            new_back = res.get("back") or ""
            new_context = res.get("context") or ""
            new_level = res.get("level")

            if options.dry_run:
                task_info["dry_run_results"].append({
                    "card_id": card.id,
                    "front": new_front,
                    "back": new_back,
                    "context": new_context,
                    "level": new_level
                })
            else:
                card.front_text = new_front
                card.back_text = new_back
                card.context = new_context
                if new_level:
                    curr_tags = card.tags or ""
                    cleaned = ",".join([t for t in curr_tags.split(",") if t and t.upper() not in {"A1","A2","B1","B2","C1","C2"}])
                    card.tags = f"{cleaned},{new_level}".strip(",") if cleaned else new_level
                card.updated_at = datetime.datetime.now()
                card.save()

                if not options.no_audio:
                    try:
                        from api.utils.audio import generate_audio
                        res_audio = await generate_audio(new_front, voice=options.voice or "de-DE-KatjaNeural", rate=options.rate or "+0%")
                        if isinstance(res_audio, tuple):
                            res_audio = res_audio[0]
                        if res_audio:
                            saved_audio = save_audio_to_db_or_cloud(res_audio)
                            if saved_audio:
                                card.audio_path = saved_audio
                                card.save()
                    except Exception as err:
                        task_info["logs"].append(f"  ⚠️ [TTS] Ошибка озвучки: {err}")

                if options.sync_copies:
                    d_count, c_count = sync_card_updates_to_matching_decks(
                        deck, front, new_front, new_back, new_context, new_level, card.audio_path
                    )
                    if c_count > 0:
                        task_info["logs"].append(f"  ↪ 🔄 Синхронизировано с {d_count} другими колодами ({c_count} карточек)")

            task_info["logs"].append(f"[{idx}/{len(cards)}] ✅ {new_front[:20]} -> {new_back[:20]}")

        except Exception as e:
            task_info["logs"].append(f"[{idx}/{len(cards)}] ❌ Исключение: {str(e)}")

        if options.delay > 0:
            await asyncio.sleep(options.delay)

    task_info["status"] = "completed"
    task_info["logs"].append("🎉 Перегенерация успешно завершена!")
    task_manager.update_task_progress(deck_id, status="completed", log_msg="🎉 Завершено")


class ControlRegenRequest(BaseModel):
    action: str  # "pause", "resume", "stop", "commit_dry_run"


@app.post("/api/admin/decks/{deck_id}/regen-control")
def control_regeneration(deck_id: str, req: ControlRegenRequest):
    """Controls running regeneration (pause, resume, stop) or commits dry-run results to DB."""
    global regen_tasks
    task_info = regen_tasks.get(deck_id) or task_manager.get_task(deck_id)
    if not task_info:
        raise HTTPException(status_code=404, detail="Regeneration task not found")

    action = req.action.lower()
    if action == "pause":
        task_info["control"] = "pause"
        task_info["status"] = "paused"
        task_info["logs"].append("⏸ Перегенерация приостановлена.")
        task_manager.update_task_progress(deck_id, status="paused")
    elif action == "resume":
        task_info["control"] = "run"
        task_info["status"] = "running"
        task_info["logs"].append("▶ Перегенерация возобновлена.")
        task_manager.update_task_progress(deck_id, status="running")
    elif action == "stop":
        task_info["control"] = "stop"
        task_info["status"] = "stopped"
        task_info["logs"].append("🛑 Сигнал остановки отправлен.")
        task_manager.update_task_progress(deck_id, status="stopped")
    elif action == "commit_dry_run":
        results = task_info.get("dry_run_results", [])
        if not results:
            return {"status": "ok", "committed_count": 0, "message": "Нет результатов Dry-Run для сохранения"}

        deck, _, is_lib = get_deck_and_cards(deck_id)
        count = 0
        sync_total = 0
        card_model = models.Card if is_lib else models.TMA_Card
        for item in results:
            card = card_model.get_or_none(card_model.id == item["card_id"])
            if card:
                orig_front = card.front_text
                card.front_text = item["front"]
                card.back_text = item["back"]
                card.context = item["context"]
                if item.get("level"):
                    curr_tags = card.tags or ""
                    cleaned = ",".join([t for t in curr_tags.split(",") if t and t.upper() not in {"A1","A2","B1","B2","C1","C2"}])
                    card.tags = f"{cleaned},{item['level']}".strip(",") if cleaned else item['level']
                card.updated_at = datetime.datetime.now()
                card.save()
                count += 1

                if task_info.get("sync_copies") and deck:
                    _, sc = sync_card_updates_to_matching_decks(deck, orig_front, item["front"], item["back"], item["context"], item.get("level"))
                    sync_total += sc

        sync_msg = f" (и синхронизировано {sync_total} карточек у других колод)" if sync_total > 0 else ""
        task_info["logs"].append(f"💾 Результаты Dry-Run успешно записаны в БД для {count} карточек{sync_msg}!")
        task_manager.save_task_checkpoint(task_info)
        return {"status": "ok", "committed_count": count, "synced_count": sync_total}

    return {"status": "ok", "current_control": task_info.get("control"), "task_status": task_info.get("status")}


VOICE_SAMPLE_PHRASES = {
    "de": "Hallo! Ich lerne Deutsch mit der Lerne App. Wie geht es dir heute?",
    "en": "Hello! I am learning languages with the Lerne App. How are you today?",
    "nb": "Hei! Jeg lærer språk med Lerne App. Hvordan har du det i dag?",
    "no": "Hei! Jeg lærer språk med Lerne App. Hvordan har du det i dag?",
    "uk": "Привіт! Я вивчаю іноземні мови разом з додатком Lerne. Як твої справи?",
    "ru": "Привет! Я изучаю иностранные языки вместе с приложением Lerne.",
}

@app.get("/api/admin/voice-preview")
async def get_voice_preview(voice: str = Query("de-DE-KatjaNeural"), text: Optional[str] = Query(None), rate: Optional[str] = Query("+0%")):
    """Generates on-the-fly voice preview audio for the chosen TTS voice and speed rate."""
    clean_voice = voice.strip()
    clean_rate = (rate or "+0%").strip()
    if not clean_rate.startswith(("+", "-")):
        clean_rate = f"+{clean_rate}"
    if not clean_rate.endswith("%"):
        clean_rate = f"{clean_rate}%"

    if not text or not text.strip():
        prefix = clean_voice[:2].lower()
        phrase = VOICE_SAMPLE_PHRASES.get(prefix, "Hallo! Ich lerne Sprachen mit der Lerne App.")
    else:
        phrase = text.strip()

    try:
        import edge_tts
        communicate = edge_tts.Communicate(phrase, clean_voice, rate=clean_rate)
        audio_chunks = []
        async for event in communicate.stream():
            if event["type"] == "audio":
                audio_chunks.append(event["data"])
        
        audio_bytes = b"".join(audio_chunks)
        if not audio_bytes:
            raise HTTPException(status_code=500, detail="Failed to synthesize voice preview")
        
        return Response(
            content=audio_bytes,
            media_type="audio/mpeg",
            headers={
                "Cache-Control": "no-cache",
                "Content-Disposition": f'inline; filename="preview_{clean_voice}.mp3"'
            }
        )
    except Exception as e:
        logger.error(f"Voice preview error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Voice preview error: {str(e)}")


@app.get("/api/media/audio/{filename:path}")
def get_admin_audio(filename: str):
    """Serves audio files from TMAMedia or pending audio cache for admin preview."""
    clean_name = os.path.basename(filename)
    media = models.TMAMedia.get_or_none(
        (models.TMAMedia.filename == clean_name) & 
        (models.TMAMedia.folder == 'audio')
    )
    if media and media.content:
        return Response(
            content=bytes(media.content),
            media_type="audio/mpeg",
            headers={"Cache-Control": "public, max-age=604800"}
        )
    
    # Check pending_audio folder on disk
    local_path = os.path.join(project_root, "user_files", "pending_audio", clean_name)
    if os.path.exists(local_path):
        return FileResponse(local_path, media_type="audio/mpeg")
        
    raise HTTPException(status_code=404, detail="Audio file not found")


async def run_audio_regeneration(deck_id: str, options: RegenerateAudioRequest):
    global regen_tasks
    task_info = regen_tasks.get(deck_id)
    if not task_info:
        return

    deck, cards, is_lib = get_deck_and_cards(deck_id)
    if not deck:
        task_info["status"] = "failed"
        task_info["logs"].append("❌ Ошибка: Колода не найдена")
        task_manager.save_task_checkpoint(task_info)
        return

    # Process excluded card IDs and position range strings
    excluded_pos = set()
    if options.exclude_range_str:
        parts = options.exclude_range_str.replace(" ", "").split(",")
        for p in parts:
            if not p:
                continue
            if "-" in p:
                sub = p.split("-")
                if len(sub) == 2 and sub[0].isdigit() and sub[1].isdigit():
                    start_idx, end_idx = int(sub[0]), int(sub[1])
                    for i in range(start_idx, end_idx + 1):
                        excluded_pos.add(i)
            elif p.isdigit():
                excluded_pos.add(int(p))

    ex_ids = set(options.exclude_card_ids or [])
    
    filtered_cards = []
    skipped_count = 0

    for idx, c in enumerate(cards, 1):
        if c.id in ex_ids or idx in excluded_pos:
            skipped_count += 1
            continue
        if options.skip_completed and card_is_fully_completed(c):
            skipped_count += 1
            continue
        if options.only_missing_audio and card_has_valid_audio(c):
            skipped_count += 1
            continue
        filtered_cards.append(c)

    cards = filtered_cards

    if skipped_count > 0:
        task_info["logs"].append(f"🛡️ Пропущено карточек (исключения / уже с озвучкой): {skipped_count}")

    if options.limit and options.limit > 0:
        cards = cards[:options.limit]

    start_c_idx = (options.start_card_idx - 1) if (options.start_card_idx and options.start_card_idx > 1) else 0
    if start_c_idx > 0 and start_c_idx < len(cards):
        cards = cards[start_c_idx:]

    task_info["total"] = len(cards)
    task_info["status"] = "running"
    task_info["control"] = "run"
    task_info["voice"] = options.voice or "de-DE-KatjaNeural"
    task_info["rate"] = options.rate or "+0%"
    task_info["sync_copies"] = options.sync_copies
    task_info["options"] = options.dict()
    task_info["task_type"] = "single_audio"
    task_info["deck_id"] = str(deck_id)
    task_info["current_deck_id"] = str(deck_id)
    task_info["current_deck_name"] = deck.name
    
    voice_str = options.voice or "de-DE-KatjaNeural"
    rate_str = options.rate or "+0%"
    task_info["logs"].append(f"🎙️ Запуск генерации озвучки: {len(cards)} карточек (Голос: {voice_str}, Скорость: {rate_str})...")

    from api.utils.audio import generate_audio

    for idx, card in enumerate(cards, start_c_idx + 1):
        while task_info.get("control") == "pause":
            task_info["status"] = "paused"
            task_manager.update_task_progress(deck_id, status="paused")
            await asyncio.sleep(0.5)
            
        if task_info.get("control") == "stop":
            task_info["status"] = "stopped"
            task_info["logs"].append("🛑 Озвучивание остановлено пользователем.")
            task_manager.update_task_progress(deck_id, status="stopped", log_msg="🛑 Остановлено")
            return

        task_info["status"] = "running"
        front = (card.front_text or "").strip()
        if not front:
            continue

        task_info["processed"] = idx
        task_info["current_card"] = front[:30]

        task_manager.update_task_progress(
            deck_id,
            status="running",
            current_deck_idx=1,
            current_deck_id=str(deck_id),
            current_deck_name=deck.name,
            current_card_idx=idx,
            current_card_id=card.id,
            current_card_text=front,
            processed_cards=idx,
            processed_decks=1
        )

        try:
            res_audio = await generate_audio(front, voice=voice_str, rate=rate_str)
            if isinstance(res_audio, tuple):
                res_audio = res_audio[0]

            if res_audio:
                saved_audio = save_audio_to_db_or_cloud(res_audio)
                if saved_audio:
                    card.audio_path = saved_audio
                    card.updated_at = datetime.datetime.now()
                    card.save()

                    if options.sync_copies:
                        d_count, c_count = sync_card_audio_to_matching_decks(deck, front, saved_audio)
                        if c_count > 0:
                            task_info["logs"].append(f"  ↪ 🔄 Аудио синхронизировано с {d_count} другими колодами ({c_count} карточек)")

                    task_info["logs"].append(f"[{idx}/{len(cards)}] 🎙️ {front[:25]} -> {saved_audio}")
                else:
                    task_info["logs"].append(f"[{idx}/{len(cards)}] ❌ Не удалось сохранить аудио: {front[:20]}")
            else:
                task_info["logs"].append(f"[{idx}/{len(cards)}] ❌ Пустой результат TTS для: {front[:20]}")

        except Exception as e:
            task_info["logs"].append(f"[{idx}/{len(cards)}] ❌ Ошибка озвучки: {str(e)}")

        if options.delay > 0:
            await asyncio.sleep(options.delay)

    task_info["status"] = "completed"
    task_info["logs"].append("🎉 Генерация озвучки успешно завершена!")
    task_manager.update_task_progress(deck_id, status="completed", log_msg="🎉 Завершено")


@app.post("/api/admin/decks/{deck_id}/regenerate-audio")
def start_audio_regeneration_endpoint(deck_id: str, req: RegenerateAudioRequest, background_tasks: BackgroundTasks):
    """Starts background audio regeneration for cards in the deck."""
    global regen_tasks
    task_data = {
        "deck_id": deck_id,
        "task_id": deck_id,
        "task_type": "single_audio",
        "status": "pending",
        "control": "run",
        "processed": 0,
        "total": 0,
        "current_card": "",
        "logs": [],
        "dry_run_results": [],
        "is_dry_run": False,
        "is_audio_only": True,
        "voice": req.voice,
        "options": req.dict(),
        "start_time": time.time()
    }
    regen_tasks[deck_id] = task_data
    task_manager.register_task(deck_id, task_data)
    background_tasks.add_task(run_audio_regeneration, deck_id, req)
    return {"status": "ok", "message": f"Audio regeneration queued for deck {deck_id}"}


@app.post("/api/admin/decks/{deck_id}/regenerate")
def start_regeneration(deck_id: str, req: RegenerateDeckRequest, background_tasks: BackgroundTasks):
    """Starts background AI regeneration of cards for the deck."""
    global regen_tasks
    task_data = {
        "deck_id": deck_id,
        "task_id": deck_id,
        "task_type": "single_ai",
        "status": "pending",
        "control": "run",
        "processed": 0,
        "total": 0,
        "current_card": "",
        "logs": [],
        "dry_run_results": [],
        "is_dry_run": req.dry_run,
        "options": req.dict(),
        "start_time": time.time()
    }
    regen_tasks[deck_id] = task_data
    task_manager.register_task(deck_id, task_data)
    background_tasks.add_task(run_ai_regeneration, deck_id, req)
    return {"status": "ok", "message": f"Regeneration queued for deck {deck_id}"}


@app.get("/api/admin/decks/{deck_id}/regen-status")
def get_regen_status(deck_id: str):
    """Returns progress and logs of an active or recent regeneration task."""
    global regen_tasks
    status_info = regen_tasks.get(deck_id) or task_manager.get_task(deck_id)
    if not status_info:
        return {"status": "idle", "processed": 0, "total": 0, "logs": []}
    return status_info


class BackupSettingsRequest(BaseModel):
    custom_dir: str

def get_admin_config_path():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "admin_config.json")

def load_admin_config():
    p = get_admin_config_path()
    if os.path.exists(p):
        try:
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"custom_backup_dir": ""}

def save_admin_config(data):
    p = get_admin_config_path()
    try:
        with open(p, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

@app.get("/api/admin/backups")
def get_backups():
    """Lists all backup files in system backup folders and custom folder."""
    cfg = load_admin_config()
    custom_dir = cfg.get("custom_backup_dir", "").strip()

    search_dirs = [
        os.path.join(project_root, "api", "data", "backups"),
        os.path.join(project_root, "backups")
    ]
    if custom_dir and os.path.exists(custom_dir):
        search_dirs.append(custom_dir)

    backup_files = []
    total_bytes = 0

    for d in search_dirs:
        if not os.path.exists(d):
            continue
        for fname in os.listdir(d):
            if fname.endswith((".json", ".db", ".sql")):
                fpath = os.path.join(d, fname)
                try:
                    stat = os.stat(fpath)
                    size = stat.st_size
                    total_bytes += size
                    mtime = datetime.datetime.fromtimestamp(stat.st_mtime)

                    b_type = "Снимок колоды" if "deck_" in fname else "Полная БД"
                    card_count = None
                    deck_name = None

                    if fname.endswith(".json") and size < 10000000:
                        try:
                            with open(fpath, "r", encoding="utf-8") as jf:
                                jdata = json.load(jf)
                                if isinstance(jdata, dict):
                                    if "cards_count" in jdata:
                                        card_count = jdata["cards_count"]
                                    if "deck" in jdata and "name" in jdata["deck"]:
                                        deck_name = jdata["deck"]["name"]
                                    elif "cards" in jdata:
                                        card_count = len(jdata["cards"])
                        except Exception:
                            pass

                    backup_files.append({
                        "filename": fname,
                        "folder": d,
                        "filepath": fpath,
                        "size_kb": round(size / 1024, 1),
                        "size_mb": round(size / (1024 * 1024), 2),
                        "type": b_type,
                        "card_count": card_count,
                        "deck_name": deck_name,
                        "created_at": mtime.strftime("%Y-%m-%d %H:%M:%S")
                    })
                except Exception:
                    pass

    backup_files.sort(key=lambda x: x["created_at"], reverse=True)

    return {
        "backups": backup_files,
        "total_count": len(backup_files),
        "total_size_mb": round(total_bytes / (1024 * 1024), 2),
        "custom_dir": custom_dir
    }


@app.post("/api/admin/backups/settings")
def save_backup_settings(req: BackupSettingsRequest):
    """Saves custom local backup directory path."""
    target_dir = req.custom_dir.strip()
    if target_dir and not os.path.exists(target_dir):
        try:
            os.makedirs(target_dir, exist_ok=True)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Cannot create directory: {str(e)}")

    cfg = load_admin_config()
    cfg["custom_backup_dir"] = target_dir
    save_admin_config(cfg)
    return {"status": "ok", "custom_backup_dir": target_dir}


@app.post("/api/admin/backups/create")
def create_full_db_backup():
    """Creates a full JSON snapshot of all database tables."""
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    fname = f"full_db_backup_{timestamp}.json"
    
    backup_dir = os.path.join(project_root, "backups")
    os.makedirs(backup_dir, exist_ok=True)
    fpath = os.path.join(backup_dir, fname)

    users = [u.__data__ for u in models.TMAUser.select()]
    for u in users:
        if isinstance(u.get("created_at"), datetime.datetime):
            u["created_at"] = str(u["created_at"])
        if isinstance(u.get("updated_at"), datetime.datetime):
            u["updated_at"] = str(u["updated_at"])

    decks = [d.__data__ for d in models.TMA_Deck.select() if not d.is_deleted]
    for d in decks:
        if isinstance(d.get("created_at"), datetime.datetime):
            d["created_at"] = str(d["created_at"])
        if isinstance(d.get("updated_at"), datetime.datetime):
            d["updated_at"] = str(d["updated_at"])

    cards = [c.__data__ for c in models.TMA_Card.select() if not c.is_deleted]
    for c in cards:
        if isinstance(c.get("created_at"), datetime.datetime):
            c["created_at"] = str(c["created_at"])
        if isinstance(c.get("updated_at"), datetime.datetime):
            c["updated_at"] = str(c["updated_at"])
        if isinstance(c.get("image_data"), bytes):
            c.pop("image_data", None)

    dump_data = {
        "timestamp": timestamp,
        "users_count": len(users),
        "decks_count": len(decks),
        "cards_count": len(cards),
        "users": users,
        "decks": decks,
        "cards": cards
    }

    with open(fpath, "w", encoding="utf-8") as f:
        json.dump(dump_data, f, ensure_ascii=False, indent=2)

    cfg = load_admin_config()
    custom_dir = cfg.get("custom_backup_dir", "").strip()
    if custom_dir and os.path.exists(custom_dir):
        custom_fpath = os.path.join(custom_dir, fname)
        try:
            with open(custom_fpath, "w", encoding="utf-8") as cf:
                json.dump(dump_data, cf, ensure_ascii=False, indent=2)
        except Exception:
            pass

    return {
        "status": "ok",
        "filename": fname,
        "filepath": fpath,
        "users_count": len(users),
        "decks_count": len(decks),
        "cards_count": len(cards)
    }


@app.get("/api/admin/backups/download/{filename}")
def download_backup_file(filename: str):
    """Serves a backup file for downloading."""
    cfg = load_admin_config()
    custom_dir = cfg.get("custom_backup_dir", "").strip()

    search_dirs = [
        os.path.join(project_root, "api", "data", "backups"),
        os.path.join(project_root, "backups")
    ]
    if custom_dir and os.path.exists(custom_dir):
        search_dirs.append(custom_dir)

    for d in search_dirs:
        fp = os.path.join(d, filename)
        if os.path.exists(fp):
            return FileResponse(fp, filename=filename)

    raise HTTPException(status_code=404, detail="Backup file not found")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("tools.admin.server:app", host="127.0.0.1", port=8050, reload=True)
