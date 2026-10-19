import sys
import os
import logging
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.exception_handlers import http_exception_handler
from starlette.exceptions import HTTPException as StarletteHTTPException

app = FastAPI()
logger = logging.getLogger(__name__)

try:
    current_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(current_dir)
    if project_root not in sys.path:
        sys.path.insert(0, project_root)
    if current_dir not in sys.path:
        sys.path.insert(0, current_dir)

    if os.getenv('LERNE_DEPLOYMENT') == 'game-test':
        from api.game_test import app as main_app
    else:
        from api.main import app as main_app
    app = main_app

    @app.exception_handler(StarletteHTTPException)
    async def safe_http_error(request: Request, exc: StarletteHTTPException):
        # Auth v2 uses this public code to explain which sign-in method to use.
        if exc.status_code >= 500 and not (
            exc.status_code == 503 and exc.detail == 'provider_not_configured'
        ):
            return JSONResponse(status_code=exc.status_code, content={'detail': 'service_unavailable'})
        return await http_exception_handler(request, exc)

    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        logger.exception('Unhandled API error')
        return JSONResponse(
            status_code=500,
            content={
                "status": "runtime_error",
                "error": "internal_server_error"
            }
        )
except Exception:
    logger.error('API startup failed', exc_info=True)

    @app.api_route("/{full_path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"])
    async def error_report(request: Request, full_path: str = ""):
        return JSONResponse(
            status_code=500,
            content={
                "status": "startup_error",
                "error": "service_unavailable"
            }
        )

handler = app
