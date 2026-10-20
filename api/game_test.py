"""Standalone Game Test: conversations and speech, without account routes."""
from fastapi import FastAPI
from api import models
from api.routers import game, media

models.initialize_database()
app = FastAPI(title='Lerne Game Test')
app.include_router(game.router, prefix='/api')
app.add_api_route('/api/media/generate-audio', media.generate_audio_endpoint, methods=['POST'])
app.add_api_route('/api/media/audio/{filename:path}', media.get_audio, methods=['GET'])


@app.get('/api/health')
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


@app.middleware('http')
async def database_connection(request, call_next):
    try:
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        return response
    finally:
        if models.tma_db.obj is not None and not models.tma_db.is_closed():
            models.tma_db.close()
