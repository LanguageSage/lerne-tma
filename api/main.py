import os
import sys
import logging
from pathlib import Path
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

# --- Добавляем путь для импортов через tma.api ---
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
if str(PROJECT_ROOT.parent) not in sys.path:
    sys.path.append(str(PROJECT_ROOT.parent))

from tma.api import models, services, srs, ai_service

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Lerne TMA API")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Настройка путей ---
MEDIA_DIR = models.TMA_DATA_DIR / "media"

# Инициализация БД при старте
@app.on_event("startup")
async def startup_event():
    logger.info("Starting TMA API...")
    models.init_tma_db()
    # Создаем локальные папки для медиа
    for d in ["images", "audio"]:
        path = MEDIA_DIR / d
        path.mkdir(parents=True, exist_ok=True)
        logger.info(f"Directory ready: {path}")

# --- Схемы ---

class GradeRequest(BaseModel):
    card_id: int
    deck_id: int
    grade: int

class CardSaveRequest(BaseModel):
    card_id: int | None = None
    deck_id: int | None = None
    front: str
    back: str
    context: str | None = ""
    image_path: str | None = None
    audio_path: str | None = None

class DeckCreateRequest(BaseModel):
    name: str

class AIAdminSettingsRequest(BaseModel):
    provider: str
    ollama_url: str | None = None
    api_key: str | None = None
    default_model: str | None = None
    tts_voice: str | None = None
    admin_secret: str | None = None

class UserPromptRequest(BaseModel):
    translation_prompt: str
    context_prompt: str

class AIGenerateRequest(BaseModel):
    phrase: str

# --- Эндпоинты ---

@app.get("/api/decks")
async def list_decks(x_user_id: int = Header(...)):
    return services.get_active_decks(x_user_id)

@app.post("/api/decks")
async def create_deck(req: DeckCreateRequest, x_user_id: int = Header(...)):
    try:
        new_deck = models.Deck.create(name=req.name, level="A1", topic="User")
        return {"id": new_deck.id, "name": new_deck.name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/decks/{deck_id}")
async def delete_deck(deck_id: int):
    if services.delete_deck(deck_id):
        return {"status": "ok"}
    raise HTTPException(status_code=404, detail="Deck not found")

@app.get("/api/decks/{deck_id}/next")
async def get_next_card(deck_id: int, x_user_id: int = Header(...)):
    card, progress = services.get_next_card(x_user_id, deck_id)
    if not card: return {"finished": True}
    return {
        "id": card.id,
        "front": card.front_text,
        "back": card.back_text,
        "context": card.context,
        "image_url": services.resolve_media_url(card.image_path, "images"),
        "audio_url": services.resolve_media_url(card.audio_path, "audio"),
        "intervals": srs.get_next_intervals(progress)
    }

@app.post("/api/study/grade")
async def submit_grade(req: GradeRequest, x_user_id: int = Header(...)):
    progress = models.TMAProgress.get_or_none(models.TMAProgress.card_id == req.card_id, models.TMAProgress.user_id == x_user_id)
    if not progress: raise HTTPException(status_code=404, detail="Progress record not found")
    
    srs.review_card(progress, req.grade)
    models.TMAReviewHistory.create(user_id=x_user_id, card_id=req.card_id, rating=req.grade, scheduled_interval=progress.interval or 0)
    
    # След. карта
    card, next_progress = services.get_next_card(x_user_id, req.deck_id)
    if not card: return {"finished": True}
    return {
        "id": card.id,
        "front": card.front_text,
        "back": card.back_text,
        "context": card.context,
        "image_url": services.resolve_media_url(card.image_path, "images"),
        "audio_url": services.resolve_media_url(card.audio_path, "audio"),
        "intervals": srs.get_next_intervals(next_progress)
    }

@app.get("/api/decks/{deck_id}/cards")
async def list_deck_cards(deck_id: int):
    return await services.get_deck_cards_full(deck_id)

@app.post("/api/cards/save")
async def save_card(req: CardSaveRequest):
    """Прямое сохранение или обновление карточки."""
    data = req.dict(exclude={'card_id', 'deck_id'})
    
    if req.card_id:
        card = services.update_card(req.card_id, data)
    elif req.deck_id:
        card = services.create_card(req.deck_id, data)
    else:
        raise HTTPException(status_code=400, detail="Missing card_id or deck_id")
        
    if not card:
        raise HTTPException(status_code=404, detail="Operation failed")
        
    return {"status": "ok", "id": card.id}

@app.delete("/api/cards/{card_id}")
async def delete_card(card_id: int):
    if services.delete_card(card_id):
        return {"status": "ok"}
    raise HTTPException(status_code=404, detail="Card not found")

@app.post("/api/media/generate-audio")
async def generate_audio_endpoint(text: str, lang: str = "de"):
    try:
        from tma.api.utils.audio import generate_audio as standalone_gen
        voice_setting = models.TMASetting.get_or_none(models.TMASetting.key == "TTS_VOICE")
        voice = voice_setting.value if voice_setting else None
        
        # Сохраняем СРАЗУ в основную папку аудио
        output_dir = MEDIA_DIR / "audio"
        abs_path = await standalone_gen(text, voice=voice, output_dir=str(output_dir))
        
        if abs_path and os.path.exists(abs_path):
            filename = os.path.basename(abs_path)
            rel_path = f"audio/{filename}"
            return {"url": services.resolve_media_url(rel_path, "audio"), "path": rel_path}
            
        raise Exception("Edge TTS generation failed")
    except Exception as e:
        logger.error(f"Audio Gen Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/external/decks")
async def list_external_decks():
    decks = services.get_external_decks()
    return [{"id": d.id, "name": d.name, "topic": d.topic} for d in decks]

@app.post("/api/external/import/{deck_id}")
async def import_deck(deck_id: int):
    new_deck = services.import_deck(deck_id)
    if not new_deck: raise HTTPException(status_code=404, detail="Deck not found")
    return {"id": new_deck.id, "name": new_deck.name}

@app.get("/api/user/prompts")
async def get_user_prompts(x_user_id: int = Header(...)):
    prompt = models.TMAUserPrompt.get_or_none(models.TMAUserPrompt.user_id == x_user_id)
    if not prompt: return {"translation_prompt": ai_service.DEFAULT_TRANSLATION_PROMPT, "context_prompt": ""}
    return {"translation_prompt": prompt.translation_prompt, "context_prompt": prompt.context_prompt}

@app.post("/api/user/prompts")
async def update_user_prompts(req: UserPromptRequest, x_user_id: int = Header(...)):
    prompt, _ = models.TMAUserPrompt.get_or_create(user_id=x_user_id)
    prompt.translation_prompt = req.translation_prompt
    prompt.context_prompt = req.context_prompt
    prompt.updated_at = models.datetime.datetime.now()
    prompt.save()
    return {"status": "ok"}

@app.post("/api/cards/ai-generate")
async def ai_generate_card(req: AIGenerateRequest, x_user_id: int = Header(...)):
    result = await ai_service.generate_card_fields(x_user_id, req.phrase)
    if "error" in result: raise HTTPException(status_code=500, detail=result["error"])
    return result

@app.get("/api/admin/settings")
async def get_admin_settings(admin_key: str | None = None):
    secret = models.TMASetting.get_or_none(models.TMASetting.key == "ADMIN_SECRET")
    if not secret or admin_key != secret.value: raise HTTPException(status_code=403, detail="Forbidden")
    return {s.key: s.value for s in models.TMASetting.select()}

@app.post("/api/admin/settings")
async def update_admin_settings(req: AIAdminSettingsRequest, admin_key: str | None = None):
    secret = models.TMASetting.get_or_none(models.TMASetting.key == "ADMIN_SECRET")
    if not secret or admin_key != secret.value: raise HTTPException(status_code=403, detail="Forbidden")
    data = req.dict(exclude_unset=True)
    for k, v in data.items():
        if v is not None:
            s, _ = models.TMASetting.get_or_create(key=k.upper())
            s.value = str(v)
            s.save()
    return {"status": "ok"}

app.mount("/api/media", StaticFiles(directory=str(MEDIA_DIR)), name="media")

FRONTEND_DIR = BASE_DIR.parent / "app" / "dist"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
