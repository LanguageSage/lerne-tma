"""Lerne TMA Admin Console — FastAPI application entry point.

All route logic lives in tools/admin/routers/. All business logic lives in tools/admin/services/.
This file only wires the app together: middleware, startup, static mount, and include_router calls.
"""
import os
import sys
import logging
import threading
import webbrowser
from ipaddress import ip_address
from urllib.parse import urlsplit

# Add project root to sys.path so `api` and `tools` packages are importable.
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

os.environ.setdefault('PGCONNECT_TIMEOUT', '10')
os.environ.setdefault('PGOPTIONS', '-c statement_timeout=30000 -c lock_timeout=5000')

from api import models
from tools.admin.services import diagnostics
from tools.admin.services.deck_import_limits import ImportBodyLimitMiddleware

logger = logging.getLogger(__name__)


def db_session_scope():
    """Per-request database session management to return pooled connections."""
    try:
        if not getattr(models.tma_db, "obj", None):
            models.initialize_database()
        elif models.tma_db.is_closed():
            models.tma_db.connect(reuse_if_open=True)
        for proxy in (models.tma_db, models.lerne_db):
            if proxy.obj:
                diagnostics.instrument_database(proxy.obj)
        yield
    except Exception as exc:
        if "exceeded maximum connections" in str(exc).lower():
            logger.warning("MaxConnectionsExceeded detected, resetting database pool...")
            actual = getattr(models.tma_db, "obj", None)
            if actual and hasattr(actual, "close_all"):
                try:
                    actual.close_all()
                except Exception:
                    pass
        raise exc
    finally:
        try:
            if hasattr(models.tma_db, "obj") and models.tma_db.obj:
                if not models.tma_db.is_closed():
                    models.tma_db.close()
        except Exception:
            pass
        try:
            if hasattr(models.lerne_db, "obj") and models.lerne_db.obj:
                if not models.lerne_db.is_closed():
                    models.lerne_db.close()
        except Exception:
            pass


app = FastAPI(title="Lerne TMA Admin Console", version="2.0.0", dependencies=[Depends(db_session_scope)])

app.add_middleware(diagnostics.DiagnosticsMiddleware)
app.add_middleware(ImportBodyLimitMiddleware)


@app.get("/api/admin/diagnostics")
def admin_diagnostics():
    return diagnostics.snapshot()


ADMIN_HOSTS = {"127.0.0.1:8050", "localhost:8050"}
ADMIN_ORIGINS = {f"http://{host}" for host in ADMIN_HOSTS}

app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(ADMIN_ORIGINS),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def protect_local_admin(request: Request, call_next):
    """Reject untrusted requests before CORS, dependencies, or any route executes."""
    denied = JSONResponse({"detail": "Local admin requests only"}, status_code=403)
    try:
        if request.client is None or not ip_address(request.client.host).is_loopback:
            return denied
    except ValueError:
        return denied

    # Exact authority (including port) prevents DNS rebinding. Never trust forwarded headers.
    if any(len(request.headers.getlist(h)) > 1 for h in ("host", "origin", "referer", "sec-fetch-site")):
        return denied
    if request.headers.get("host", "").lower() not in ADMIN_HOSTS:
        return denied
    fetch_site = request.headers.get("sec-fetch-site")
    if fetch_site is not None and fetch_site not in {"same-origin", "none"}:
        return denied

    source = request.headers.get("origin")
    if source is None and "referer" in request.headers:
        try:
            referrer = urlsplit(request.headers["referer"])
            source = f"{referrer.scheme}://{referrer.netloc}"
        except ValueError:
            return denied
    if source is not None and source not in ADMIN_ORIGINS:
        return denied
    # API GETs also include generation/downloads. Fail closed without browser source
    # evidence; native scripts can explicitly supply a local Origin header.
    if request.url.path.startswith("/api/") or request.method not in {"GET", "HEAD", "OPTIONS"}:
        if source is None and fetch_site != "same-origin":
            return denied

    response = await call_next(request)
    response.headers["X-Frame-Options"] = "DENY"
    if request.url.path.startswith("/static") or request.url.path == "/":
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


@app.on_event("startup")
def startup_db():
    if not models.tma_db.obj:
        models.initialize_database()


# Serve the React/Vite admin UI
_static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(_static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=_static_dir), name="static")


@app.get("/")
def get_admin_ui():
    index_path = os.path.join(_static_dir, "index.html")
    if os.path.exists(index_path):
        resp = FileResponse(index_path)
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp
    return JSONResponse({"message": "Admin UI index.html not found"}, status_code=404)


# ─── Register routers ─────────────────────────────────────────────────────────
from tools.admin.routers import prompts, users, decks, cards, folders, tasks, classification, media, backups, author, deck_import, material_transfer  # noqa: E402

app.include_router(prompts.router)
app.include_router(users.router)
app.include_router(decks.router)
app.include_router(cards.router)
app.include_router(folders.router)
app.include_router(tasks.router)
app.include_router(classification.router)
app.include_router(media.router)
app.include_router(backups.router)
app.include_router(author.router)
app.include_router(deck_import.router)
app.include_router(material_transfer.router)


# ─── Dev launch ──────────────────────────────────────────────────────────────
def _open_browser():
    import time
    time.sleep(1.2)
    try:
        webbrowser.open("http://127.0.0.1:8050")
    except Exception:
        pass


if __name__ == "__main__":
    import uvicorn
    should_reload = "--reload" in sys.argv
    if not should_reload:
        threading.Thread(target=_open_browser, daemon=True).start()
    uvicorn.run("tools.admin.server:app", host="127.0.0.1", port=8050,
                reload=should_reload, proxy_headers=False)

