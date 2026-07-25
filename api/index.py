import sys
import os
import traceback
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

# Инициализируем базовый fallback app
app = FastAPI()

try:
    current_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(current_dir)
    if project_root not in sys.path:
        sys.path.insert(0, project_root)
    if current_dir not in sys.path:
        sys.path.insert(0, current_dir)

    from api.main import app as main_app
    app = main_app
except Exception as e:
    error_trace = traceback.format_exc()
    error_msg = str(e)

    @app.api_route("/{full_path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"])
    async def error_report(request: Request, full_path: str = ""):
        return JSONResponse(
            status_code=500,
            content={
                "status": "startup_error",
                "error": error_msg,
                "traceback": error_trace
            }
        )

handler = app


