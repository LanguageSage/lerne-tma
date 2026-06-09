import os
import sys
import logging
from pathlib import Path

# ВАЖНО: Добавляем корень проекта в пути поиска модулей
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
if project_root not in sys.path:
    sys.path.append(project_root)
if current_dir not in sys.path:
    sys.path.append(current_dir)

from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from api.dependencies.auth import get_user_id

from api import models, services

# Импорт роутеров
from api.routers import decks, cards, study, settings, ai, media, bot, feedback, auth, share, debug, trash, sync, folders

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

# Управление жизненным циклом соединений с базой данных (Peewee Connection Pool)
@app.middleware("http")
async def db_session_middleware(request, call_next):
    # Убеждаемся, что перед началом запроса соединения закрыты/сброшены, если они остались в сталом состоянии от прошлых потоков/сна
    try:
        if not models.tma_db.is_closed():
            models.tma_db.close()
        if not models.lerne_db.is_closed():
            models.lerne_db.close()
        models.tma_db.connect(reuse_if_open=True)
        models.lerne_db.connect(reuse_if_open=True)
    except Exception as e:
        logger.error(f"Error resetting DB connections before request: {e}")
        try:
            models.initialize_database()
            models.tma_db.connect(reuse_if_open=True)
            models.lerne_db.connect(reuse_if_open=True)
        except Exception as e2:
            logger.error(f"CRITICAL: DB reconnect failed: {e2}")

    try:
        response = await call_next(request)
        path = request.url.path
        if path.startswith("/api") and not path.startswith("/api/media"):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response
    finally:
        try:
            if not models.tma_db.is_closed():
                models.tma_db.close()
            if not models.lerne_db.is_closed():
                models.lerne_db.close()
        except Exception as e:
            logger.error(f"Error closing DB connections in middleware: {e}")

# Подключение роутеров
app.include_router(decks.router, prefix="/api")
app.include_router(cards.router, prefix="/api")
app.include_router(study.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(media.router, prefix="/api")
app.include_router(bot.router, prefix="/api")
app.include_router(feedback.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(share.router, prefix="/api")
app.include_router(debug.router, prefix="/api")
app.include_router(trash.router, prefix="/api")
app.include_router(sync.router, prefix="/api")
app.include_router(folders.router, prefix="/api")

# --- Consolidated Init Endpoint ---
@app.get("/api/init")
def get_init_data(user_id: int = Depends(get_user_id)):
    """Returns all initial data needed by the app in a single request."""
    decks = services.get_active_decks(user_id)
    folders = services.get_active_folders(user_id)
    
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
        "folders": folders,
        "settings": settings,
        "prompts": prompts
    }

# --- Базовые Эндпоинты ---
@app.get("/api/health")
def health_check():
    try:
        models.tma_db.connect(reuse_if_open=True)
        db_ok = True
    except:
        db_ok = False
    return {
        "status": "ok",
        "database_connected": db_ok,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
