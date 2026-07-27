import os
import sys
import logging


# ВАЖНО: Добавляем корень проекта в пути поиска модулей
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
if project_root not in sys.path:
    sys.path.append(project_root)
if current_dir not in sys.path:
    sys.path.append(current_dir)

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from api.dependencies.auth import get_user_id

from api import models, services

# Импорт роутеров
from api.routers import decks, cards, study, settings, ai, media, bot, feedback, auth, share, debug, trash, sync, folders

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app):
    """Initialize database on startup (traditional servers)."""
    if not models.tma_db.obj:
        models.initialize_database()
        models.create_all_tables()
    logger.info("DATABASE: Startup initialization complete.")
    yield

# Also initialize at module level for Vercel serverless cold starts
try:
    models.initialize_database()
    models.create_all_tables()
    logger.info("DATABASE: Module-level initialization complete.")
except Exception as _db_init_err:
    logger.error(f"DATABASE: Module-level initialization FAILED: {_db_init_err}")

app = FastAPI(title="Lerne TMA API", lifespan=lifespan)

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
    try:
        if hasattr(models.tma_db, 'obj') and models.tma_db.obj is not None:
            if models.tma_db.is_closed():
                models.tma_db.connect(reuse_if_open=True)
        if hasattr(models.lerne_db, 'obj') and models.lerne_db.obj is not None:
            if models.lerne_db.is_closed():
                models.lerne_db.connect(reuse_if_open=True)
    except Exception as e:
        logger.error(f"Error checking DB connection before request: {e}")
        try:
            models.initialize_database()
        except Exception as e2:
            logger.error(f"CRITICAL: DB initialize failed: {e2}")

    try:
        response = await call_next(request)
    except Exception as exc:
        exc_str = str(exc).lower()
        if "closed" in exc_str or "terminated" in exc_str or "connection" in exc_str:
            logger.warning(f"DB connection reset due to error: {exc}")
            try:
                if hasattr(models.tma_db, 'obj') and models.tma_db.obj:
                    models.tma_db.close()
                    models.tma_db.connect(reuse_if_open=True)
            except Exception:
                pass
        raise exc

    path = request.url.path
    if path.startswith("/api") and not path.startswith("/api/media"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

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
    except Exception: pass
        
    # Get prompts
    prompts = []
    try:
        for cp in models.TMACustomPrompt.select().where(models.TMACustomPrompt.user_id == user_id):
            prompts.append({
                "id": cp.id,
                "name": cp.name,
                "translation_prompt": cp.translation_prompt or "",
                "context_prompt": cp.context_prompt or "",
                "is_active": cp.is_active,
                "prompt_type": cp.prompt_type
            })
    except Exception: pass
        
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
    except Exception:
        db_ok = False
    return {
        "status": "ok",
        "database_connected": db_ok,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
