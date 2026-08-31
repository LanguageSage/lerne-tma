import os
import sys
import json
import asyncio
import datetime
import time
from typing import List, Optional

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

class RegenerateAudioRequest(BaseModel):
    voice: Optional[str] = "de-DE-KatjaNeural"
    rate: Optional[str] = "+0%"
    only_missing_audio: bool = False
    sync_copies: bool = True
    delay: float = 0.3
    limit: Optional[int] = None
    exclude_card_ids: Optional[List[int]] = None
    exclude_range_str: Optional[str] = None

class BatchRegenerateDeckRequest(BaseModel):
    deck_ids: List[str]
    dry_run: bool = False
    only_empty: bool = False
    only_no_context: bool = False
    no_audio: bool = False
    sync_copies: bool = False
    voice: Optional[str] = "de-DE-KatjaNeural"
    rate: Optional[str] = "+0%"
    delay: float = 1.5
    prompt_id: Optional[str] = "preset_b1"
    native_lang: Optional[str] = "uk"
    target_lang: Optional[str] = "de"
    cards_per_deck_limit: Optional[int] = None

class BatchRegenerateAudioRequest(BaseModel):
    deck_ids: List[str]
    voice: Optional[str] = "de-DE-KatjaNeural"
    rate: Optional[str] = "+0%"
    only_missing_audio: bool = False
    sync_copies: bool = True
    delay: float = 0.3
    cards_per_deck_limit: Optional[int] = None

class BatchSummaryRequest(BaseModel):
    deck_ids: List[str]

class BatchControlRequest(BaseModel):
    action: str  # "pause", "resume", "stop", "commit_dry_run"



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
    """Returns all active decks in the database (including master library decks and user decks)."""
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

        for d in lib_decks:
            c_count = lib_card_counts.get(d.id, 0)
            is_def = bool(getattr(d, 'is_default', False))
            result.append({
                "id": f"lib_{d.id}",
                "user_id": "Библиотека ⭐",
                "name": d.name,
                "level": d.level,
                "topic": d.topic,
                "target_language": d.target_language or "de",
                "card_count": c_count,
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

    for d in tma_decks:
        c_count = tma_card_counts.get(d.id, 0)
        meta = {}
        try:
            meta = json.loads(d.metadata or "{}")
        except Exception:
            pass

        is_def = bool(meta.get("is_default", False))
        result.append({
            "id": d.id,
            "user_id": d.user_id,
            "name": d.name,
            "level": d.level,
            "topic": d.topic,
            "target_language": d.target_language or "de",
            "card_count": c_count,
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
    """Returns list of all active cards in a deck for selection."""
    deck, cards, is_lib = get_deck_and_cards(deck_id)
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    result = []
    for idx, c in enumerate(cards, 1):
        has_aud = bool(c.audio_path and str(c.audio_path).strip())
        result.append({
            "id": c.id,
            "position": idx,
            "front": c.front_text or "",
            "back": c.back_text or "",
            "has_context": bool(c.context and str(c.context).strip()),
            "has_audio": has_aud,
            "audio_path": c.audio_path or ""
        })

    return {"cards": result, "deck_name": deck.name, "total": len(result)}


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

    task_info["total_decks"] = len(decks_to_process)
    task_info["total_cards"] = total_cards_count
    task_info["status"] = "running"
    task_info["control"] = "run"
    task_info["dry_run_results"] = []
    task_info["is_dry_run"] = options.dry_run
    task_info["sync_copies"] = options.sync_copies
    task_info["voice"] = options.voice or "de-DE-KatjaNeural"
    task_info["no_audio"] = options.no_audio

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

    for d_idx, (deck_id, deck, cards, is_lib) in enumerate(decks_to_process, 1):
        task_info["current_deck_id"] = str(deck_id)
        task_info["current_deck_name"] = deck.name
        task_info["processed_decks"] = d_idx - 1

        target_lang = getattr(deck, 'target_language', 'de') or options.target_lang or "de"
        native_lang = options.native_lang or "uk"
        user_id_val = getattr(deck, 'user_id', 0) if hasattr(deck, 'user_id') and isinstance(getattr(deck, 'user_id'), int) else 0

        task_info["logs"].append(f"📦 [{d_idx}/{len(decks_to_process)}] Колода: «{deck.name}» (#{deck_id}) — {len(cards)} карточек...")

        for c_idx, card in enumerate(cards, 1):
            while task_info.get("control") == "pause":
                task_info["status"] = "paused"
                await asyncio.sleep(0.5)

            if task_info.get("control") == "stop":
                task_info["status"] = "stopped"
                task_info["logs"].append("🛑 Пакетная перегенерация остановлена пользователем.")
                return

            task_info["status"] = "running"
            front = (card.front_text or "").strip()
            if not front:
                global_card_idx += 1
                task_info["processed_cards"] = global_card_idx
                continue

            # Update current_card BEFORE AI call so UI shows what's being processed
            global_card_idx += 1
            task_info["current_card"] = f"⏳ [{c_idx}/{len(cards)}] {front[:30]}..."

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
                task_info["processed_cards"] = global_card_idx
                task_info["current_card"] = f"[{c_idx}/{len(cards)}] {front[:30]}"
                task_info["logs"].append(f"  [{c_idx}/{len(cards)}] ⏰ Таймаут 90с: {front[:25]} — пропускаем")
                if options.delay > 0:
                    await asyncio.sleep(min(options.delay, 0.5))
                continue
            except Exception as e:
                task_info["processed_cards"] = global_card_idx
                task_info["current_card"] = f"[{c_idx}/{len(cards)}] {front[:30]}"
                task_info["logs"].append(f"  [{c_idx}/{len(cards)}] ❌ Исключение AI: {str(e)[:60]}")
                if options.delay > 0:
                    await asyncio.sleep(min(options.delay, 0.5))
                continue

            # Update processed counter AFTER AI responds
            task_info["processed_cards"] = global_card_idx
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

        if options.only_missing_audio:
            cards = [c for c in cards if not card_has_valid_audio(c)]

        if options.cards_per_deck_limit and options.cards_per_deck_limit > 0:
            cards = cards[:options.cards_per_deck_limit]

        if cards:
            decks_to_process.append((deck_id, deck, cards, is_lib))
            total_cards_count += len(cards)

    task_info["total_decks"] = len(decks_to_process)
    task_info["total_cards"] = total_cards_count
    task_info["status"] = "running"
    task_info["control"] = "run"
    task_info["voice"] = options.voice or "de-DE-KatjaNeural"
    task_info["rate"] = options.rate or "+0%"
    task_info["sync_copies"] = options.sync_copies

    voice_str = options.voice or "de-DE-KatjaNeural"
    rate_str = options.rate or "+0%"
    task_info["logs"].append(f"🎙️ Запуск пакетного озвучивания: {len(decks_to_process)} колод, {total_cards_count} карточек (Голос: {voice_str}, Скорость: {rate_str})...")

    global_card_idx = 0

    for d_idx, (deck_id, deck, cards, is_lib) in enumerate(decks_to_process, 1):
        task_info["current_deck_id"] = str(deck_id)
        task_info["current_deck_name"] = deck.name
        task_info["processed_decks"] = d_idx - 1

        task_info["logs"].append(f"📦 [{d_idx}/{len(decks_to_process)}] Озвучка колоды: «{deck.name}» (#{deck_id}) — {len(cards)} карточек...")

        for c_idx, card in enumerate(cards, 1):
            while task_info.get("control") == "pause":
                task_info["status"] = "paused"
                await asyncio.sleep(0.5)

            if task_info.get("control") == "stop":
                task_info["status"] = "stopped"
                task_info["logs"].append("🛑 Пакетное озвучивание остановлено пользователем.")
                return

            task_info["status"] = "running"
            front = (card.front_text or "").strip()
            if not front:
                global_card_idx += 1
                task_info["processed_cards"] = global_card_idx
                continue

            # Show what's being processed BEFORE the TTS call
            global_card_idx += 1
            task_info["current_card"] = f"⏳ [{c_idx}/{len(cards)}] {front[:30]}..."

            try:
                res_audio = await asyncio.wait_for(
                    generate_audio(front, voice=voice_str, rate=rate_str),
                    timeout=60.0  # 60s hard timeout per TTS call
                )
                if isinstance(res_audio, tuple):
                    res_audio = res_audio[0]

                # Update counter AFTER TTS responds
                task_info["processed_cards"] = global_card_idx
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
                task_info["processed_cards"] = global_card_idx
                task_info["current_card"] = f"[{c_idx}/{len(cards)}] {front[:30]}"
                task_info["logs"].append(f"  [{c_idx}/{len(cards)}] ⏰ Таймаут TTS 60с: {front[:25]} — пропускаем")
            except Exception as e:
                task_info["processed_cards"] = global_card_idx
                task_info["current_card"] = f"[{c_idx}/{len(cards)}] {front[:30]}"
                task_info["logs"].append(f"  [{c_idx}/{len(cards)}] ❌ Ошибка TTS: {str(e)[:60]}")

            if options.delay > 0:
                await asyncio.sleep(options.delay)

        task_info["processed_decks"] = d_idx

    task_info["status"] = "completed"
    task_info["logs"].append(f"🎉 Пакетная озвучка {len(decks_to_process)} колод ({global_card_idx} карточек) успешно завершена!")


@app.post("/api/admin/decks/batch/regenerate")
def start_batch_regeneration(req: BatchRegenerateDeckRequest, background_tasks: BackgroundTasks):
    """Starts background AI regeneration for multiple staged decks."""
    global regen_tasks
    if not req.deck_ids:
        raise HTTPException(status_code=400, detail="No decks provided for batch regeneration")

    task_id = f"batch_ai_{int(time.time())}"
    regen_tasks[task_id] = {
        "task_id": task_id,
        "is_batch": True,
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
        "start_time": time.time()
    }
    background_tasks.add_task(run_batch_ai_regeneration, task_id, req)
    return {"status": "ok", "task_id": task_id, "total_decks": len(req.deck_ids), "message": "Batch AI regeneration started"}


@app.post("/api/admin/decks/batch/regenerate-audio")
def start_batch_audio_regeneration(req: BatchRegenerateAudioRequest, background_tasks: BackgroundTasks):
    """Starts background audio regeneration for multiple staged decks."""
    global regen_tasks
    if not req.deck_ids:
        raise HTTPException(status_code=400, detail="No decks provided for batch regeneration")

    task_id = f"batch_audio_{int(time.time())}"
    regen_tasks[task_id] = {
        "task_id": task_id,
        "is_batch": True,
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
        "start_time": time.time()
    }
    background_tasks.add_task(run_batch_audio_regeneration, task_id, req)
    return {"status": "ok", "task_id": task_id, "total_decks": len(req.deck_ids), "message": "Batch audio regeneration started"}


@app.get("/api/admin/decks/batch/{task_id}/status")
def get_batch_regen_status(task_id: str):
    """Returns progress and logs of a batch regeneration task."""
    global regen_tasks
    status_info = regen_tasks.get(task_id)
    if not status_info:
        return {"status": "idle", "processed_decks": 0, "total_decks": 0, "processed_cards": 0, "total_cards": 0, "logs": []}
    return status_info


@app.post("/api/admin/decks/batch/{task_id}/control")
def control_batch_regeneration(task_id: str, req: BatchControlRequest):
    """Controls running batch regeneration (pause, resume, stop) or commits dry-run results to DB."""
    global regen_tasks
    task_info = regen_tasks.get(task_id)
    if not task_info:
        raise HTTPException(status_code=404, detail="Batch regeneration task not found")

    action = req.action.lower()
    if action == "pause":
        task_info["control"] = "pause"
        task_info["status"] = "paused"
        task_info["logs"].append("⏸ Пакетная перегенерация приостановлена.")
    elif action == "resume":
        task_info["control"] = "run"
        task_info["status"] = "running"
        task_info["logs"].append("▶ Пакетная перегенерация возобновлена.")
    elif action == "stop":
        task_info["control"] = "stop"
        task_info["status"] = "stopped"
        task_info["logs"].append("🛑 Сигнал остановки отправлен.")
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
        return {"status": "ok", "committed_count": count, "synced_count": sync_total}

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

    if options.only_empty:
        cards = [c for c in cards if not c.back_text or not c.context]

    if options.only_no_context:
        cards = [c for c in cards if not c.context or not str(c.context).strip()]

    # Slicing: strictly 3 cards for Dry-Run test, or all selected cards for full production
    if options.dry_run:
        cards = cards[:3]
    elif options.limit and options.limit > 0:
        cards = cards[:options.limit]

    task_info["total"] = len(cards)
    task_info["status"] = "running"
    task_info["control"] = "run"
    task_info["dry_run_results"] = []
    task_info["is_dry_run"] = options.dry_run
    task_info["sync_copies"] = options.sync_copies
    task_info["voice"] = options.voice or "de-DE-KatjaNeural"
    task_info["no_audio"] = options.no_audio
    
    mode_str = "🧪 ТЕСТ (3 карточки / Dry-Run)" if options.dry_run else f"🚀 ПОЛНАЯ ПЕРЕГЕНЕРАЦИЯ ({len(cards)} карточек)"
    task_info["logs"].append(f"Запуск: {mode_str} (Голос: {options.voice or 'Default'})...")

    target_lang = getattr(deck, 'target_language', 'de') or "de"
    native_lang = options.native_lang or "uk"
    user_id_val = getattr(deck, 'user_id', 0)

    for idx, card in enumerate(cards, 1):
        # Check control actions
        while task_info.get("control") == "pause":
            task_info["status"] = "paused"
            await asyncio.sleep(0.5)
            
        if task_info.get("control") == "stop":
            task_info["status"] = "stopped"
            task_info["logs"].append("🛑 Процесс остановлен пользователем.")
            return

        task_info["status"] = "running"
        front = (card.front_text or "").strip()
        if not front:
            continue

        task_info["processed"] = idx
        task_info["current_card"] = front[:30]

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


class ControlRegenRequest(BaseModel):
    action: str  # "pause", "resume", "stop", "commit_dry_run"


@app.post("/api/admin/decks/{deck_id}/regen-control")
def control_regeneration(deck_id: str, req: ControlRegenRequest):
    """Controls running regeneration (pause, resume, stop) or commits dry-run results to DB."""
    global regen_tasks
    task_info = regen_tasks.get(deck_id)
    if not task_info:
        raise HTTPException(status_code=404, detail="Regeneration task not found")

    action = req.action.lower()
    if action == "pause":
        task_info["control"] = "pause"
        task_info["status"] = "paused"
        task_info["logs"].append("⏸ Перегенерация приостановлена.")
    elif action == "resume":
        task_info["control"] = "run"
        task_info["status"] = "running"
        task_info["logs"].append("▶ Перегенерация возобновлена.")
    elif action == "stop":
        task_info["control"] = "stop"
        task_info["status"] = "stopped"
        task_info["logs"].append("🛑 Сигнал остановки отправлен.")
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
        if options.only_missing_audio and card_has_valid_audio(c):
            skipped_count += 1
            continue
        filtered_cards.append(c)

    cards = filtered_cards

    if skipped_count > 0:
        task_info["logs"].append(f"🛡️ Пропущено карточек (исключения / уже с озвучкой): {skipped_count}")

    if options.limit and options.limit > 0:
        cards = cards[:options.limit]

    task_info["total"] = len(cards)
    task_info["status"] = "running"
    task_info["control"] = "run"
    task_info["voice"] = options.voice or "de-DE-KatjaNeural"
    task_info["rate"] = options.rate or "+0%"
    task_info["sync_copies"] = options.sync_copies
    
    voice_str = options.voice or "de-DE-KatjaNeural"
    rate_str = options.rate or "+0%"
    task_info["logs"].append(f"🎙️ Запуск генерации озвучки: {len(cards)} карточек (Голос: {voice_str}, Скорость: {rate_str})...")

    from api.utils.audio import generate_audio

    for idx, card in enumerate(cards, 1):
        while task_info.get("control") == "pause":
            task_info["status"] = "paused"
            await asyncio.sleep(0.5)
            
        if task_info.get("control") == "stop":
            task_info["status"] = "stopped"
            task_info["logs"].append("🛑 Озвучивание остановлено пользователем.")
            return

        task_info["status"] = "running"
        front = (card.front_text or "").strip()
        if not front:
            continue

        task_info["processed"] = idx
        task_info["current_card"] = front[:30]

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


@app.post("/api/admin/decks/{deck_id}/regenerate-audio")
def start_audio_regeneration_endpoint(deck_id: str, req: RegenerateAudioRequest, background_tasks: BackgroundTasks):
    """Starts background audio regeneration for cards in the deck."""
    global regen_tasks
    regen_tasks[deck_id] = {
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
        "start_time": time.time()
    }
    background_tasks.add_task(run_audio_regeneration, deck_id, req)
    return {"status": "ok", "message": f"Audio regeneration queued for deck {deck_id}"}


@app.post("/api/admin/decks/{deck_id}/regenerate")
def start_regeneration(deck_id: str, req: RegenerateDeckRequest, background_tasks: BackgroundTasks):
    """Starts background AI regeneration of cards for the deck."""
    global regen_tasks
    regen_tasks[deck_id] = {
        "status": "pending",
        "control": "run",
        "processed": 0,
        "total": 0,
        "current_card": "",
        "logs": [],
        "dry_run_results": [],
        "is_dry_run": req.dry_run,
        "start_time": time.time()
    }
    background_tasks.add_task(run_ai_regeneration, deck_id, req)
    return {"status": "ok", "message": f"Regeneration queued for deck {deck_id}"}


@app.get("/api/admin/decks/{deck_id}/regen-status")
def get_regen_status(deck_id: str):
    """Returns progress and logs of an active or recent regeneration task."""
    global regen_tasks
    status_info = regen_tasks.get(deck_id)
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
