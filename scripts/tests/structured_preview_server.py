"""Isolated browser fixture: actual V2 upload route/static UI, no DB or write routes."""
import os
import json
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
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


@app.post('/__v2-evaluate')
async def evaluate_projection(payload: dict):
    """Test-only transport: real context loader/evaluator with memory-only reads.

    No saved card, credentials, real learner history or paid AI is involved.
    """
    from api import models
    from api.services.answer_evaluation import load_answer_context, evaluate_answer
    projected = payload['card']
    card = SimpleNamespace(id=901, deck_id=1, front_text=projected['front'],
        back_text=projected['back'], context=projected['context'], metadata=json.dumps(projected['metadata']),
        deck=SimpleNamespace(is_deleted=False, target_language='de', level='B1'))
    with (patch.object(models, 'tma_db') as database,
          patch.object(models.TMA_Card, 'get_or_none', return_value=card),
          patch.object(models.TMACardKnowledgeItem, 'get_or_none', return_value=None),
          patch('api.services.offline_sync.require_access')):
        database.connection_context.return_value = nullcontext()
        database.execute_sql.side_effect = AssertionError('No SQL')
        database.connect.side_effect = AssertionError('No database')
        context, policy = load_answer_context(card.id, 7, 'ru')
    result = await evaluate_answer(context, policy, payload['answer'], ai_factory=lambda: None)
    return {'result': result.model_dump(), 'grading_policy': policy.model_dump()}
