import sys
import os
import traceback
from fastapi.responses import JSONResponse

# Добавляем корень проекта и текущую папку в sys.path
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
if project_root not in sys.path:
    sys.path.insert(0, project_root)
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

try:
    from api.main import app
except Exception as e:
    from fastapi import FastAPI, Request
    app = FastAPI()
    error_trace = traceback.format_exc()
    
    @app.api_route("/api/{full_path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"])
    async def error_report(request: Request, full_path: str = ""):
        return JSONResponse(
            status_code=500,
            content={
                "status": "startup_error",
                "error": str(e),
                "traceback": error_trace
            }
        )

# Для Vercel
handler = app

