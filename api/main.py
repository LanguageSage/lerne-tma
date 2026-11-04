import json
import os
import sys
import logging
from api.local_runtime import configure_local, is_local, local_config

configure_local()


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
from starlette.concurrency import run_in_threadpool
from api.dependencies.auth import get_user_id
from api.db_workers import db_phases, db_worker, run_db
from api.permissions import is_admin

from api import models, services

from api.routers import decks, cards, study, settings, ai, media, bot, feedback, auth, auth_v2, share, debug, trash, sync, folders, collaborative, lid, knowledge, card_notes, card_ratings, messages

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def initialize_startup_database(app):
    if getattr(app.state, "database_ready", False):
        return
    if is_local():
        from local.dev import prepare
        prepare(local_config())
    else:
        if not models.initialize_database():
            raise RuntimeError("Database configuration failed")
        try:
            models.create_all_tables()
        finally:
            if not models.tma_db.is_closed():
                models.tma_db.close()
    app.state.database_ready = True
    logger.info("DATABASE: Startup initialization complete.")


@asynccontextmanager
async def lifespan(app):
    await run_in_threadpool(initialize_startup_database, app)
    yield

app = FastAPI(title="Lerne TMA API", lifespan=lifespan)

if is_local():
    from local.router import router as local_router
    from fastapi.responses import JSONResponse
    app.include_router(local_router, prefix='/api')

    @app.middleware('http')
    async def local_services_guard(request, call_next):
        if not request.client or request.client.host not in ('127.0.0.1', '::1'):
            return JSONResponse({'detail': 'LOCAL accepts only loopback clients'}, status_code=403)
        path = request.url.path
        if (path.startswith(('/api/bot', '/api/webhook', '/api/auth/v2/challenges',
                             '/api/auth/v2/google', '/api/auth/v2/telegram', '/api/auth/v2/lerne'))
                or path.startswith('/api/ai') or '/ai-' in path
                or path.startswith('/api/media/generate')):
            return JSONResponse({'detail': 'External services are unavailable in LOCAL'}, status_code=503)
        response = await call_next(request)
        if response.status_code in (301, 302, 303, 307, 308):
            location = response.headers.get('location', '')
            if location.startswith(('http:', 'https:', '//')):
                return JSONResponse({'detail': 'External redirects disabled in LOCAL'}, status_code=503)
        return response

# CORS
cors_origins_env = os.environ.get("CORS_ORIGINS", "")
if cors_origins_env:
    allowed_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()]
else:
    allowed_origins = [
        "https://localhost",
        "http://localhost",
        "capacitor://localhost",
        "ionic://localhost",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "https://tma-amber.vercel.app",
        "https://web.telegram.org",
        "https://telegram.org",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://127.0.0.1:5173', 'http://localhost:5173'] if is_local() else allowed_origins,
    allow_origin_regex=None if is_local() else r"^(https?://.*\.vercel\.app|https?://localhost(:[0-9]+)?|capacitor://localhost|ionic://localhost)$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def cache_headers_middleware(request, call_next):
    response = await call_next(request)
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
app.include_router(auth_v2.router, prefix="/api")
app.include_router(share.router, prefix="/api")

# Only mount debug routes in non-production environments
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
if ENVIRONMENT != "production":
    app.include_router(debug.router, prefix="/api")
app.include_router(trash.router, prefix="/api")
app.include_router(sync.router, prefix="/api")
app.include_router(folders.router, prefix="/api")
app.include_router(collaborative.router, prefix="/api")
app.include_router(lid.router, prefix="/api")
app.include_router(knowledge.router, prefix="/api")
app.include_router(card_notes.router, prefix="/api")
app.include_router(card_ratings.router, prefix="/api")
app.include_router(messages.router, prefix="/api")

# --- Consolidated Init Endpoint ---
@app.get("/api/init")
@db_worker
def get_init_data(user_id: int = Depends(get_user_id)):
    """Returns all initial data needed by the app in a single request."""
    decks = services.get_active_decks(user_id, strict=True)
    folders = services.get_active_folders(user_id)

    # Shared settings exclude credentials and per-account records.
    settings = {}
    sensitive_terms = ("KEY", "SECRET", "TOKEN", "PASSWORD", "PASSWD", "CREDENTIAL")
    personal_prefixes = (
        "USER_SETTINGS_", "USER_DESIGN_V1_BACKUP_", "DECK_LEARNING_",
        "REMINDER_SETTINGS_", "LAST_REMINDER_SLOTS_", "LAST_REMINDER_ATTEMPT_",
    )
    for s in models.TMASetting.select():
        key_upper = s.key.upper()
        if key_upper.startswith(personal_prefixes) or any(term in key_upper for term in sensitive_terms):
            continue
        settings[s.key] = s.value

    # Get prompts
    prompts = []
    for cp in models.TMACustomPrompt.select().where(models.TMACustomPrompt.user_id == user_id):
        prompts.append({
            "id": cp.id,
            "name": cp.name,
            "translation_prompt": cp.translation_prompt or "",
            "context_prompt": cp.context_prompt or "",
            "is_active": cp.is_active,
            "prompt_type": cp.prompt_type
        })

    # Get user language and profile
    user_info = {"active_language": "de", "native_language": "uk", "has_selected_language": False}
    user = models.TMAUser.get_or_none(models.TMAUser.user_id == user_id)
    if user:
        clean_first_name = user.first_name if (user.first_name and user.first_name != "Пользователь") else (user.username or None)
        has_identity = bool(clean_first_name or user.username)
        is_guest = bool(user.is_guest) if has_identity else True
        user_info = {
            "user_id": user.user_id,
            "first_name": clean_first_name,
            "last_name": user.last_name,
            "username": user.username,
            "photo_url": user.photo_url,
            "phone": user.phone,
            "is_guest": is_guest,
            "active_language": user.active_language or "de",
            "native_language": getattr(user, 'native_language', None) or "uk",
            "has_selected_language": bool(user.has_selected_language)
        }

    # Get user settings
    from api.services.user_settings import read_user_settings
    user_settings = read_user_settings(user_id)

    # Global Design V2
    global_design_v2 = {}
    gd = models.TMASetting.get_or_none(models.TMASetting.key == "GLOBAL_DESIGN_V2")
    if gd and gd.value:
        try:
            global_design_v2 = json.loads(gd.value)
        except json.JSONDecodeError:
            pass

    return {
        "decks": decks,
        "folders": folders,
        "settings": settings,
        "user_settings": user_settings,
        "prompts": prompts,
        "user_info": user_info,
        "global_design_v2": global_design_v2,
        "is_admin": is_admin(user_id),
    }

# --- Базовые Эндпоинты ---
@app.get("/api/health")
@db_phases
async def health_check():
    try:
        await run_db(lambda: models.tma_db.execute_sql("SELECT 1").fetchone())
        db_ok = True
    except Exception:
        db_ok = False
    return {
        "status": "ok",
        "database_connected": db_ok,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1" if is_local() else "0.0.0.0", port=8001)
