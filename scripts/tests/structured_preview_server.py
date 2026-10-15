"""Isolated browser fixture: actual V2 upload route/static UI, no DB or write routes."""
import os
from pathlib import Path
from unittest.mock import patch

os.environ.update(VERCEL='1', RUN_MIGRATIONS='false', FORCE_LOCAL_DB='false')

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

with patch('api.database.initialize_database'):
    from tools.admin.routers.author import router

app = FastAPI()
app.router.routes.extend(route for route in router.routes if route.path.endswith('/v2-preview'))
static = Path(__file__).resolve().parents[2] / 'tools/admin/static'
app.mount('/static', StaticFiles(directory=static))


@app.get('/')
def index():
    return FileResponse(static / 'index.html')
