"""Disposable admin browser fixture; SQLite and simulated Storage only."""
import os
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch

# Set before application imports. No .env credentials or remote services.
os.environ.update(SUPABASE_DB_URL='', SUPABASE_URL='http://127.0.0.1:8059',
                  SUPABASE_KEY='browser-fixture', AUTHOR_USER_ID='42', VERCEL='1', RUN_MIGRATIONS='false')

from fastapi import HTTPException, Response
from peewee import SqliteDatabase
from api import models
from scripts.tests.test_admin_folder_import import TABLES
from tools.admin import server
from tools.admin.server import app, db_session_scope

# Separate port from the user's running console; perimeter remains loopback-only.
server.ADMIN_HOSTS = {'127.0.0.1:8059', 'localhost:8059'}
server.ADMIN_ORIGINS = {f'http://{host}' for host in server.ADMIN_HOSTS}

fixture_dir = tempfile.TemporaryDirectory(prefix='lerne-admin-import-fixture-')
database = SqliteDatabase(str(Path(fixture_dir.name) / 'admin.sqlite3'))
models.tma_db.initialize(database)
models.lerne_db.initialize(database)
database.create_tables([*TABLES, models.LibraryCategory, models.Deck, models.Card])
app.dependency_overrides[db_session_scope] = lambda: None
models.TMAUser.create(user_id=42, first_name='Тест', is_guest=False)
folder = models.TMA_Folder.create(user_id=42, name='Тестовая папка')
deck = models.TMA_Deck.create(user_id=42, name='Существующая колода', folder=folder)
models.TMA_Card.create(deck=deck, creator_id=99, front_text='Original', back_text='Сохранить',
                       image_path='https://example.invalid/old.webp')
storage = {}


def fake_upload(url, *, data, headers, timeout):
    prefix = 'http://127.0.0.1:8059/storage/v1/object/'
    if not url.startswith(prefix):
        raise AssertionError('External service disabled in browser fixture')
    storage[url[len(prefix):]] = (bytes(data), headers['Content-Type'])
    return Mock(status_code=201)


@app.get('/storage/v1/object/public/{path:path}')
def get_fake_storage(path: str):
    if path not in storage:
        raise HTTPException(404)
    data, mime = storage[path]
    return Response(data, media_type=mime)


if __name__ == '__main__':
    import uvicorn
    with patch('requests.post', side_effect=fake_upload):
        uvicorn.run(app, host='127.0.0.1', port=8059, access_log=False)
