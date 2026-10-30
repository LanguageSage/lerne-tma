"""Personal Design V2 writes use the existing settings row and a permanent source backup."""
import datetime
import json

from fastapi import HTTPException
from peewee import PostgresqlDatabase, SqliteDatabase

from api import models


def read_user_settings(user_id):
    setting = models.TMASetting.get_or_none(models.TMASetting.key == f"USER_SETTINGS_{user_id}")
    value = json.loads(setting.value) if setting and setting.value else {}
    if not isinstance(value, dict):
        raise ValueError('Invalid stored user settings')
    return value


def _validate_design(design):
    if (not isinstance(design, dict) or design.get('schemaVersion') != 2
            or type(design.get('revision')) is not int or design['revision'] < 0
            or not isinstance(design.get('config'), dict)
            or 'preset' not in design
            or design['preset'] is not None and not isinstance(design['preset'], dict)):
        raise HTTPException(400, 'Invalid personal Design V2 document')


def save_user_settings(user_id, data):
    incoming = data.get('designV2')
    if 'designV2' in data:
        _validate_design(incoming)
    database = models.TMASetting._meta.database
    database = getattr(database, 'obj', database)
    options = {'lock_type': 'IMMEDIATE'} if isinstance(database, SqliteDatabase) else {}
    with database.atomic(**options):
        now = datetime.datetime.now()
        key = f'USER_SETTINGS_{user_id}'
        models.TMASetting.get_or_create(key=key, defaults={'value': '{}', 'updated_at': now})
        query = models.TMASetting.select().where(models.TMASetting.key == key)
        if isinstance(database, PostgresqlDatabase):
            query = query.for_update()
        setting = query.get()
        # A damaged source is an error, never an empty account that can be overwritten.
        current = json.loads(setting.value)
        if not isinstance(current, dict):
            raise ValueError('Invalid stored user settings')
        updates = dict(data)
        if incoming is not None:
            previous = current.get('designV2')
            if previous is not None:
                _validate_design(previous)
            revision = previous['revision'] if previous else 0
            same = previous and all(incoming[k] == previous[k] for k in ('config', 'preset'))
            if not same and incoming['revision'] != revision:
                raise HTTPException(409, 'Personal design revision conflict; fetch and retry')
            if previous is None:
                # Unique key + transaction: backup and migration both commit, or neither does.
                models.TMASetting.get_or_create(key=f'USER_DESIGN_V1_BACKUP_{user_id}',
                    defaults={'value': setting.value, 'updated_at': now})
            updates['designV2'] = {**incoming, 'revision': revision if same else revision + 1}
        # Older clients may still save V1/study fields; they cannot remove an existing V2 document.
        current.update(updates)
        setting.value = json.dumps(current, ensure_ascii=False)
        setting.updated_at = now
        setting.save()
        return current


def read_design_backup(user_id):
    setting = models.TMASetting.get_or_none(models.TMASetting.key == f'USER_DESIGN_V1_BACKUP_{user_id}')
    return {'raw': setting.value} if setting else {}
