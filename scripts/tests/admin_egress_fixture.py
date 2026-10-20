"""Disposable local admin UI fixture. Never opens a remote database."""
import os

# Set before any application imports; dotenv cannot replace existing empty values.
os.environ['SUPABASE_DB_URL'] = ''
os.environ['SUPABASE_URL'] = ''
os.environ['VERCEL'] = '1'
os.environ['RUN_MIGRATIONS'] = 'false'

from peewee import SqliteDatabase
from api import models
from scripts.tests.test_admin_egress import TABLES
from tools.admin.server import app, db_session_scope
from tools.admin.services.diagnostics import instrument_database

db = SqliteDatabase(':memory:', thread_safe=False, check_same_thread=False)
models.tma_db.initialize(db)
models.lerne_db.initialize(db)
db.create_tables(TABLES)
instrument_database(db)
app.dependency_overrides[db_session_scope] = lambda: None
for number in range(1, 62):
    models.TMAUser.create(user_id=number, first_name=f'Тест {number}', is_guest=False)
    folder = models.TMA_Folder.create(user_id=number, name=f'Папка {number}')
    deck = models.TMA_Deck.create(user_id=number, folder=folder, name=f'Колода {number}')
    for index in range(65 if number == 1 else 1):
        models.TMA_Card.create(deck=deck, front_text=f'Front {index}', back_text='Back',
            context='Контекст ' * 80, metadata='{"version":2,"parts":[{"id":"p1"}]}')

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=8050, access_log=False)
