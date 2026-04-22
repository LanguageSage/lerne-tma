import sys
import os
import traceback
from fastapi.responses import JSONResponse

# Добавляем путь к текущей папке
sys.path.append(os.path.dirname(__file__))

try:
    from main import app
except Exception as e:
    # Если даже после всех фиксов падает - выводим причину
    from fastapi import FastAPI
    app = FastAPI()
    error_trace = traceback.format_exc()
    
    @app.get("/api/health")
    @app.get("/api/decks")
    def error_report():
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
