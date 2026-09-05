"""Loopback-only manual test server using a separate SQLite file and real sync handlers."""
from pathlib import Path
import sys

from fastapi import FastAPI, Header
from fastapi.middleware.cors import CORSMiddleware

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_offline_sync import database, models, sync, Request, TABLES, ROOT

(ROOT / 'scratch').mkdir(exist_ok=True)
database.init(str(ROOT / 'scratch/offline-sandbox.sqlite3'))
database.connect(reuse_if_open=True)
database.create_tables(TABLES, safe=True)
user, _ = models.TMAUser.get_or_create(user_id=1, defaults={
    'first_name': 'Тест', 'is_guest': False, 'default_decks_initialized': True,
    'has_selected_language': True, 'active_language': 'de', 'native_language': 'ru',
})
if not models.TMA_Deck.select().exists():
    deck = models.TMA_Deck.create(user_id=1, name='Офлайн-проверка', target_language='de')
    for position, (front, back) in enumerate([('Guten Morgen', 'Доброе утро'), ('Danke', 'Спасибо'), ('Bis morgen', 'До завтра')]):
        models.TMA_Card.create(deck=deck, front_text=front, back_text=back, position=position)
database.close()

app = FastAPI(title='Lerne isolated offline sandbox')
app.add_middleware(CORSMiddleware, allow_origins=['http://127.0.0.1:5199', 'http://localhost:5199'],
                   allow_methods=['*'], allow_headers=['*'])


@app.get('/api/sync/v2/pull')
def pull(user_id: int = Header(default=1, alias='X-User-ID')) -> dict:
    with database.connection_context():
        return sync.pull_offline(user_id)


@app.post('/api/sync/v2/push')
def push(request: Request, user_id: int = Header(default=1, alias='X-User-ID')) -> dict:
    with database.connection_context():
        return sync.push_offline(request, user_id)


@app.post('/api/auth/sync')
def profile() -> dict:
    return {'status': 'ok', 'user': {'user_id': 1, 'first_name': 'Тест', 'is_guest': False,
        'has_selected_language': True, 'active_language': 'de', 'native_language': 'ru'}}


@app.post('/api/user/language')
def language() -> dict:
    return {'status': 'ok'}


@app.get('/api/health')
def health() -> dict:
    return {'status': 'ok', 'mode': 'isolated-offline-sandbox'}


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=8199)
