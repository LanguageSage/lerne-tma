"""Synthetic Native V2 fixtures for SQL business/HTTP unit tests.

SQLite represents JSONB as JSON text and has no SELECT FOR UPDATE. This adapter
is only for unit tests of permissions, worker ownership and serialization. Native
storage guards, constraints and row locking are tested by structured_cards_postgres.
No runtime fallback or conversion of legacy requests is provided.
"""
import json
from unittest.mock import patch

from peewee import ModelSelect, SqliteDatabase
from api import models
from api.services.structured_cards_v2 import normalize_card


def content(prompt='Haus', answer='дом', **fields):
    return {'schema_version': 2, 'card': normalize_card({'type': 'standard',
        'data': {'prompt': prompt, 'answer': answer}, **fields})}


def sqlite_native(case, database, *, writes=False):
    if not isinstance(database, SqliteDatabase):
        raise AssertionError('SQLite adapter must not affect PostgreSQL tests')
    for model in (models.TMA_Card, models.Card):
        field = model.content_v2
        case.enterContext(patch.object(field, 'db_value', side_effect=lambda value:
            None if value is None else json.dumps(value, ensure_ascii=False)))
        case.enterContext(patch.object(field, 'python_value', side_effect=lambda value:
            json.loads(value) if isinstance(value, str) else value))
    if writes:
        case.enterContext(patch('api.services.structured_card_storage._postgres', return_value=database))
        case.enterContext(patch('api.services.library_import._require_library_schema'))
        case.enterContext(patch.object(ModelSelect, 'for_update', lambda self, *_args, **_kwargs: self))
