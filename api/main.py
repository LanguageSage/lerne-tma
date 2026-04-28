import os
import sys
import logging
from pathlib import Path

# ВАЖНО: Добавляем текущую папку в пути поиска модулей для Vercel
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.append(current_dir)

from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from api.dependencies.auth import get_user_id

import models
import services

# Импорт роутеров
from api.routers import decks, cards, study, settings, ai, media

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Models initializes the database on import, no need for second call
# models.initialize_database()

app = FastAPI(title="Lerne TMA API")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Подключение роутеров
app.include_router(decks.router, prefix="/api")
app.include_router(cards.router, prefix="/api")
app.include_router(study.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(media.router, prefix="/api")

# --- Consolidated Init Endpoint ---
@app.get("/api/init")
def get_init_data(user_id: int = Depends(get_user_id)):
    """Returns all initial data needed by the app in a single request."""
    decks = services.get_active_decks(user_id)
    
    # Get settings
    settings = {}
    try:
        for s in models.TMASetting.select():
            settings[s.key] = s.value
    except: pass
        
    # Get prompts
    prompts = {"translation_prompt": "", "context_prompt": ""}
    try:
        p = models.TMAUserPrompt.get_or_none(models.TMAUserPrompt.user_id == user_id)
        if p:
            prompts = {
                "translation_prompt": p.translation_prompt or "",
                "context_prompt": p.context_prompt or ""
            }
    except: pass
        
    return {
        "decks": decks,
        "settings": settings,
        "prompts": prompts
    }

# --- Базовые Эндпоинты ---
@app.get("/api/health")
def health_check():
    db_ok = not models.tma_db.is_closed()
    return {
        "status": "ok",
        "database_connected": db_ok,
    }

# --- Дебаг Эндпоинты ---
@app.get("/api/debug/test-import/{deck_id}")
def debug_import(deck_id: int, x_user_id: int = Header(None)):
    if not x_user_id:
        return {"error": "X-User-ID missing"}
    
    logs = []
    def log(msg):
        logger.info(f"DEBUG: {msg}")
        logs.append(msg)
    
    log(f"Starting debug import for deck {deck_id}, user {x_user_id}")
    try:
        from api import models
        log(f"DB Connection: {models.tma_db.is_closed()}")
        
        ext_deck = models.Deck.get_or_none(models.Deck.id == deck_id)
        if not ext_deck:
            log(f"ERROR: Deck {deck_id} not found in library")
            return {"logs": logs}
        log(f"Found library deck: {ext_deck.name}")
        
        cards_list = list(models.Card.select().where(models.Card.deck == deck_id))
        log(f"Peewee found {len(cards_list)} cards")
        
        cursor = models.tma_db.execute_sql(f"SELECT count(*) FROM card WHERE deck_id = {deck_id}")
        raw_count = cursor.fetchone()[0]
        log(f"Raw SQL found {raw_count} cards")
        
        result = services.import_deck(deck_id, x_user_id)
        log(f"Import result: {'Success' if result else 'Failed'}")
        
        if result:
            count_after = models.TMA_Card.select().where(models.TMA_Card.deck_id == result.id).count()
            log(f"Cards in TMA deck after import: {count_after}")
            
        return {"logs": logs, "success": result is not None}
        
    except Exception as e:
        log(f"EXCEPTION: {str(e)}")
        import traceback
        log(traceback.format_exc())
        return {"logs": logs, "error": str(e)}

@app.get("/api/debug/test-audio")
async def debug_audio(text: str = "Test", voice: str = "de-DE-KatjaNeural"):
    logs = []
    logs.append(f"Starting debug audio for text: '{text}', voice: '{voice}'")
    try:
        from api.utils import audio
        import os
        
        result = await audio.generate_audio(text, voice)
        logs.append(f"Result path/url: {result}")
        
        if result and not result.startswith("http"):
            exists = os.path.exists(result)
            size = os.path.getsize(result) if exists else 0
            logs.append(f"File exists: {exists}, Size: {size}")
            
            with open(result, "rb") as f:
                data = f.read(100)
            logs.append(f"Read success, first 100 bytes length: {len(data)}")
            
        return {"logs": logs, "success": result is not None}
    except Exception as e:
        import traceback
        err = traceback.format_exc()
        logs.append(f"CRITICAL ERROR: {err}")
        return {"logs": logs, "success": False, "error": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
