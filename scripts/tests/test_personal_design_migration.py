"""Transactional settings migration on disposable SQLite; never the configured database."""
import json
import sys
import types
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from peewee import SqliteDatabase

from test_offline_sync import models
from api.services.user_settings import save_user_settings, read_user_settings, read_design_backup

with patch.dict(sys.modules, {'api.ai_service': types.ModuleType('api.ai_service')}):
    from api.routers import settings as router

def design(revision=0, font='serif'):
    return {'schemaVersion': 2, 'revision': revision, 'config': {'front': {'mainText': {'font': font}}},
            'preset': {'front': {'card': {'background': 'custom_saved'}}}}


class PersonalDesignMigrationTests(unittest.TestCase):
    def setUp(self):
        self.database = SqliteDatabase(f'file:design-{uuid4()}?mode=memory&cache=shared', uri=True)
        self.previous_db = models.TMASetting._meta.database
        self.database.bind([models.TMASetting])
        self.database.create_tables([models.TMASetting])
        self.raw = '{ "cardFont": "Georgia", "userDesign": {"extra": [1,2]}, "studyMode": "speak", "unknown": true }'
        models.TMASetting.create(key='USER_SETTINGS_1', value=self.raw)

    def tearDown(self):
        self.database.close()
        models.TMASetting.bind(self.previous_db)

    def test_exact_backup_idempotency_and_older_client(self):
        result = save_user_settings(1, {'designV2': design()})
        self.assertEqual(result['designV2']['revision'], 1)
        self.assertEqual(read_design_backup(1)['raw'], self.raw)
        self.assertEqual(result['userDesign'], {'extra': [1, 2]})
        self.assertTrue(result['unknown'])
        # Repeat the same payload after a lost response, including its old revision.
        self.assertEqual(save_user_settings(1, {'designV2': design()})['designV2']['revision'], 1)
        result = save_user_settings(1, {'cardFont': 'old-client', 'studyMode': 'classic'})
        self.assertEqual(result['designV2']['config']['front']['mainText']['font'], 'serif')
        self.assertEqual(read_design_backup(1)['raw'], self.raw)
        self.assertEqual(models.TMASetting.select().count(), 2)

    def test_stale_device_cannot_overwrite_design_or_other_settings(self):
        save_user_settings(1, {'designV2': design()})
        save_user_settings(1, {'designV2': design(1, 'monospace')})
        with self.assertRaises(HTTPException) as caught:
            save_user_settings(1, {'designV2': design(1, 'Georgia'), 'studyMode': 'lost'})
        self.assertEqual(caught.exception.status_code, 409)
        result = read_user_settings(1)
        self.assertEqual(result['designV2']['revision'], 2)
        self.assertEqual(result['studyMode'], 'speak')

    def test_backup_and_target_roll_back_together(self):
        original_save = models.TMASetting.save

        def fail_target(record, *args, **kwargs):
            if record.key == 'USER_SETTINGS_1':
                raise RuntimeError('write failed after backup')
            return original_save(record, *args, **kwargs)

        with patch.object(models.TMASetting, 'save', new=fail_target):
            with self.assertRaises(RuntimeError):
                save_user_settings(1, {'designV2': design()})
        self.assertEqual(read_design_backup(1), {})
        self.assertEqual(models.TMASetting.get(models.TMASetting.key == 'USER_SETTINGS_1').value, self.raw)
        save_user_settings(1, {'designV2': design()})
        self.assertEqual(read_design_backup(1)['raw'], self.raw)

    def test_damaged_source_is_never_replaced_with_empty_defaults(self):
        models.TMASetting.update(value='{broken').where(models.TMASetting.key == 'USER_SETTINGS_1').execute()
        with self.assertRaises(ValueError):
            save_user_settings(1, {'designV2': design()})
        self.assertEqual(read_design_backup(1), {})
        self.assertEqual(models.TMASetting.get(models.TMASetting.key == 'USER_SETTINGS_1').value, '{broken')

    def test_new_account_and_invalid_documents(self):
        for invalid in (None, [], {}, {**design(), 'schemaVersion': 3}, {**design(), 'revision': True},
                        {**design(), 'revision': -1}, {**design(), 'preset': []}):
            with self.subTest(invalid=invalid), self.assertRaises(HTTPException):
                save_user_settings(2, {'designV2': invalid})
        self.assertEqual(read_user_settings(2), {})
        self.assertEqual(models.TMASetting.select().count(), 1)
        self.assertEqual(save_user_settings(2, {'designV2': design()})['designV2']['revision'], 1)
        self.assertEqual(json.loads(read_design_backup(2)['raw']), {})

    def test_restore_is_a_new_revision_and_preserves_original_backup(self):
        first = save_user_settings(1, {'designV2': design()})['designV2']
        changed = save_user_settings(1, {'designV2': design(first['revision'], 'monospace')})['designV2']
        restored = save_user_settings(1, {'designV2': {**first, 'revision': changed['revision']}})['designV2']
        self.assertEqual(restored['revision'], 3)
        self.assertEqual(restored['config'], first['config'])
        self.assertEqual(read_design_backup(1)['raw'], self.raw)

    def test_http_settings_and_backup_are_scoped_to_authenticated_account(self):
        save_user_settings(1, {'designV2': design()})
        app = FastAPI()
        app.include_router(router.router, prefix='/api')
        account = 2

        def authenticate():
            if account is None:
                raise HTTPException(401, 'Authentication required')
            return account

        app.dependency_overrides[router.get_user_id] = authenticate
        with TestClient(app) as client:
            self.assertEqual(client.get('/api/user/settings/design-backup').json(), {})
            payload = {'designV2': design()}
            result = client.post('/api/user/settings?user_id=1', json=payload)
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json()['settings']['designV2']['revision'], 1)
            self.assertEqual(json.loads(read_design_backup(2)['raw']), {})
            account = 1
            self.assertEqual(client.get('/api/user/settings/design-backup').json()['raw'], self.raw)
            account = None
            self.assertEqual(client.get('/api/user/settings').status_code, 401)
            self.assertEqual(client.get('/api/user/settings/design-backup').status_code, 401)
            self.assertEqual(client.post('/api/user/settings', json=payload).status_code, 401)


if __name__ == '__main__':
    unittest.main()
