"""Disposable real admin UI with two SQLite databases and simulated bridge I/O."""
import json
import os
import asyncio
from pathlib import Path
import threading
from unittest.mock import patch

os.environ.update(PYTHON_DOTENV_DISABLED='1', SUPABASE_DB_URL='', LERNE_SKIP_SCHEMA_INIT='1',
                  VERCEL='1', RUN_MIGRATIONS='false')

from peewee import SqliteDatabase
from api import models
from tools.admin import server
from tools.admin.routers import material_transfer as routes
from tools.admin.services.material_transfer import Endpoint, Transfer
from tools.admin.transfer_worker import execute
from scripts.tests.test_local_dev import SyntheticDirectory
from scripts.tests.test_material_transfer import TABLES

temporary = SyntheticDirectory()
root = Path(temporary.name)
config = root / 'transfer.json'
config.write_text(json.dumps({'enabled': True, 'allow_cloud_write': True, 'project_ref': 'fixture',
                              'environment': 'staging', 'storage_key': 'must-never-appear-in-browser'}), encoding='utf-8')
databases = [SqliteDatabase(str(root / f'{side}.sqlite'), thread_safe=False, check_same_thread=False) for side in ('local', 'cloud')]
for database, actor in zip(databases, (42, 84)):
    models.tma_db.initialize(database); models.lerne_db.initialize(database)
    database.create_tables(TABLES + [models.LibraryCategory, models.Deck, models.Card])
    models.TMAUser.create(user_id=actor, is_guest=False)
    folder = models.TMA_Folder.create(user_id=actor, name='A1 · Длинное название учебного курса Grundlagen der deutschen Sprache')
    deck = models.TMA_Deck.create(user_id=actor, name='Урок 1', folder=folder)
    models.TMA_Card.create(deck=deck, creator_id=actor, front_text='Guten Morgen', back_text='Доброе утро')
local = Endpoint(databases[0], 'LOCAL:fixture', 42, media_root=root / 'media')
cloud = Endpoint(databases[1], 'Supabase:fixture', 84,
                 storage={'url': 'https://fixture.supabase.co', 'key': 'fake'})
transfer = Transfer(local, cloud, allow_cloud_write=True)
models.tma_db.initialize(databases[0]); models.lerne_db.initialize(databases[0])
lock = threading.Lock()


def simulated_worker(request):
    with lock:
        return execute(transfer, request)


server.ADMIN_HOSTS = {'127.0.0.1:8061', 'localhost:8061'}
server.ADMIN_ORIGINS = {f'http://{host}' for host in server.ADMIN_HOSTS}
server.app.dependency_overrides[server.db_session_scope] = lambda: None


class SerialFixture:
    """The simulated bridge rebinds proxies in-process; serialize the entire
    request including BackgroundTasks. Production uses a separate worker process.
    """
    def __init__(self, app):
        self.app, self.lock = app, asyncio.Lock()

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        async with self.lock:
            await self.app(scope, receive, send)

if __name__ == '__main__':
    import uvicorn
    try:
        with patch.object(routes, 'config_path', return_value=config), patch.object(routes, 'worker', side_effect=simulated_worker):
            uvicorn.run(SerialFixture(server.app), host='127.0.0.1', port=8061, access_log=False)
    finally:
        for database in databases:
            database.close()
        temporary.cleanup()
