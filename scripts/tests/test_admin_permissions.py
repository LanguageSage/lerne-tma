"""Admin ID policy through real HTTP dependencies and disposable SQLite only."""
import os
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.testclient import TestClient
from peewee import SqliteDatabase

from api import models
from api.auth import service
from api.permissions import is_admin
from api.routers import auth, auth_v2, collaborative, debug, decks, settings
from api.services import collaborative_service

# Bot integration is outside this suite; importing init must not require Telegram.
# Disable application startup, migrations and DB setup while loading the handler.
with patch.dict(sys.modules, {'api.routers.bot': SimpleNamespace(router=APIRouter())}), \
        patch.object(models, 'initialize_database'), patch.object(models, 'create_all_tables'):
    from api.main import get_init_data


class AdminPolicyTests(unittest.TestCase):
    def test_configured_id_replaces_the_historical_default(self):
        with patch.dict(os.environ, ADMIN_USER_ID='101'):
            self.assertTrue(is_admin(101))
            self.assertFalse(is_admin(202))
            self.assertFalse(is_admin(642478257))

    def test_missing_configuration_preserves_the_existing_admin(self):
        with patch.dict(os.environ):
            os.environ.pop('ADMIN_USER_ID', None)
            self.assertTrue(is_admin(642478257))
            self.assertFalse(is_admin(101))

    def test_invalid_configuration_denies_admin_access(self):
        for value in ('', 'invalid'):
            with self.subTest(value=value), patch.dict(os.environ, ADMIN_USER_ID=value):
                self.assertFalse(is_admin(101))
                self.assertFalse(is_admin(642478257))


class AdminPermissionsTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, ADMIN_USER_ID='101', ENVIRONMENT='development')
        self.env.start()
        self.addCleanup(self.env.stop)
        self.previous = (models.tma_db.obj, models.lerne_db.obj)
        self.db = SqliteDatabase(':memory:', thread_safe=False, check_same_thread=False)
        models.tma_db.initialize(self.db)
        models.lerne_db.initialize(self.db)
        self.addCleanup(self.cleanup_database)
        self.db.create_tables([
            models.TMAUser, models.TMAAuthAccount, models.TMAAuthSession, models.TMAAuthToken,
            models.TMA_Folder, models.TMA_Deck, models.TMA_Card, models.TMA_Collaborator,
            models.TMASetting, models.TMACustomPrompt,
        ])
        self.headers = {}
        for user_id in (101, 202):
            models.TMAUser.create(user_id=user_id, first_name='Synthetic user', is_guest=False)
            account = models.TMAAuthAccount.create(user=user_id)
            tokens = service._create_session(account, models.auth_utcnow())
            self.headers[user_id] = {'Authorization': 'Bearer ' + tokens.access_token}
        app = FastAPI()
        for router in (auth.router, auth_v2.router, settings.router, decks.router,
                       collaborative.router, debug.router):
            app.include_router(router, prefix='/api')
        app.get('/api/init')(get_init_data)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def cleanup_database(self):
        self.db.close()
        models.tma_db.initialize(self.previous[0])
        models.lerne_db.initialize(self.previous[1])

    def assert_profiles(self, user_id, expected):
        headers = self.headers[user_id]
        for path in ('/api/auth/me', '/api/auth/v2/me'):
            response = self.client.get(path, headers=headers)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertIs(response.json()['is_admin'], expected, path)
        response = self.client.post('/api/auth/sync', headers=headers, json={})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIs(response.json()['user']['is_admin'], expected)
        response = self.client.post('/api/user/language', headers=headers, json={})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIs(response.json()['is_admin'], expected)
        with patch('api.main.services.ensure_starter_decks'), \
                patch('api.main.services.get_active_decks', return_value=[]), \
                patch('api.main.services.get_active_folders', return_value=[]):
            response = self.client.get('/api/init', headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIs(response.json()['is_admin'], expected)

    def test_admin_profiles_do_not_require_a_username(self):
        self.assert_profiles(101, True)
        models.TMAUser.update(username='renamed_admin').where(models.TMAUser.user_id == 101).execute()
        self.assert_profiles(101, True)

    def test_former_admin_usernames_do_not_grant_rights(self):
        for username in ('Nimaypumpay', 'Aruna27', 'Chintamanichapliuk'):
            with self.subTest(username=username):
                response = self.client.post('/api/auth/sync', headers=self.headers[202],
                                            json={'username': username})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertIs(response.json()['user']['is_admin'], False)
                self.assert_profiles(202, False)
                self.assertEqual(self.client.get('/api/admin/settings',
                                                 headers=self.headers[202]).status_code, 403)

    def test_admin_can_read_and_save_settings_and_design(self):
        headers = self.headers[101]
        response = self.client.post('/api/admin/settings', headers=headers, json={'TEST_SETTING': 'ok'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.get('/api/admin/settings', headers=headers).json()['TEST_SETTING'], 'ok')
        response = self.client.post('/api/admin/design/draft', headers=headers, json={'config': {'test': True}})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.get('/api/admin/design/draft', headers=headers).json()['config'], {'test': True})
        self.assertEqual(self.client.get('/api/admin/presets', headers=headers).status_code, 200)

    def test_regular_user_is_denied_at_every_admin_settings_guard(self):
        routes = [
            ('GET', '/admin/settings', None), ('POST', '/admin/settings', {'TEST_SETTING': 'bad'}),
            ('GET', '/settings/models', None), ('GET', '/settings/test-ai', None),
            ('GET', '/admin/presets', None), ('GET', '/admin/community/decks', None),
            ('POST', '/admin/community/promote/1', None), ('GET', '/admin/prompts/all', None),
            ('POST', '/admin/prompts/set-global/0', None),
            ('POST', '/admin/design/publish', {'config': {'test': True}}),
            ('GET', '/admin/design/draft', None),
            ('POST', '/admin/design/draft', {'config': {'test': True}}),
        ]
        for method, path, payload in routes:
            with self.subTest(path=path, method=method):
                response = self.client.request(method, '/api' + path,
                                               headers=self.headers[202], json=payload)
                self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(models.TMASetting.select().count(), 0)

    def test_library_and_bulk_delete_use_configured_admin_id(self):
        for path, payload, target, result in (
            ('/api/decks/external/1/toggle-default', None,
             'api.routers.decks.services.toggle_default_deck', True),
            ('/api/collaborative/admin/folders/bulk-delete', {'folder_ids': [1], 'user_ids': [202]},
             'api.routers.collaborative.collaborative_service.admin_bulk_delete_folders', {'status': 'ok'}),
        ):
            with self.subTest(path=path), patch(target, return_value=result) as operation:
                response = self.client.post(path, headers=self.headers[202], json=payload)
                self.assertEqual(response.status_code, 403, response.text)
                operation.assert_not_called()
                response = self.client.post(path, headers=self.headers[101], json=payload)
                self.assertEqual(response.status_code, 200, response.text)
                operation.assert_called_once()

    def test_published_content_keeps_admin_editor_and_user_viewer_access(self):
        folder = models.TMA_Folder.create(user_id=202, name='Synthetic folder')
        deck = models.TMA_Deck.create(user_id=202, name='Synthetic deck', folder=folder)
        path = f'/api/collaborative/admin/folders/{folder.id}/access-scope'
        payload = {'access_scope': 'global_readonly'}
        self.assertEqual(self.client.post(path, headers=self.headers[202], json=payload).status_code, 403)
        self.assertEqual(models.TMA_Folder.get_by_id(folder.id).access_scope, 'private')
        self.assertEqual(self.client.post(path, headers=self.headers[101], json=payload).status_code, 200)
        for user_id, role in ((101, 'editor'), (202, 'owner'), (303, 'viewer')):
            for target, target_id in (('folder', folder.id), ('deck', deck.id)):
                self.assertEqual(collaborative_service.get_effective_user_role(user_id, target, target_id), role)
            info = collaborative_service.get_batch_collaborative_info(user_id, decks=[deck], folders=[folder])
            self.assertEqual(info['folders'][folder.id]['role'], role)
            self.assertEqual(info['decks'][deck.id]['role'], role)
        self.assertEqual(models.TMA_Folder.get_by_id(folder.id).user_id, 202)

    def test_debug_is_admin_only_and_hidden_in_production(self):
        debug.ensure_debug_access(101)
        with self.assertRaises(HTTPException) as denied:
            debug.ensure_debug_access(202)
        self.assertEqual(denied.exception.status_code, 403)
        with patch.dict(os.environ, ENVIRONMENT='production'):
            for user_id in (101, 202):
                with self.assertRaises(HTTPException) as hidden:
                    debug.ensure_debug_access(user_id)
                self.assertEqual(hidden.exception.status_code, 404)
