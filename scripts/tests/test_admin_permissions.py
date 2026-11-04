"""Admin ID policy through real HTTP dependencies and disposable SQLite only."""
import json
import os
import sys
from pathlib import Path
import socket
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.testclient import TestClient
from peewee import SqliteDatabase

from api import models
from api.auth import service
from api.permissions import is_admin
from api.routers import ai, auth, auth_v2, collaborative, debug, decks, settings
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


class ProviderTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_dns_answers_are_pinned_and_redirects_are_disabled(self):
        import asyncio
        from unittest.mock import MagicMock
        from api.ai_clients import AIService
        from api.provider_url import resolve_public_provider_url

        loop = asyncio.get_running_loop()
        public = (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, '', ('93.184.216.34', 443))
        private = (socket.AF_INET6, socket.SOCK_STREAM, socket.IPPROTO_TCP, '', ('fd00::1', 443, 0, 0))
        with patch.object(loop, 'getaddrinfo', new=AsyncMock(side_effect=[[public, private], [public]])) as dns:
            with self.assertRaises(ValueError):
                await resolve_public_provider_url('https://public.example')
            url, resolver = await resolve_public_provider_url('https://public.example')
            self.assertEqual((await resolver.resolve('public.example', 443))[0]['host'], '93.184.216.34')
            with self.assertRaises(OSError):
                await resolver.resolve('private.example', 443)
            self.assertEqual(dns.await_count, 2)

        session = MagicMock()
        session.__aenter__.return_value = session
        response = session.request.return_value.__aenter__.return_value
        response.status = 302
        response.headers = {'Location': 'http://169.254.169.254/'}
        response.json = AsyncMock(return_value={})
        with patch('api.ai_clients.aiohttp.TCPConnector') as connector, \
                patch('api.ai_clients.aiohttp.ClientSession', return_value=session):
            service = AIService(provider='ollama', ollama_url=url, ollama_resolver=resolver)
            self.assertEqual(await service.get_models(), ['llama3', 'mistral'])
        connector.assert_called_once_with(resolver=resolver)
        session.request.assert_called_once_with('GET', 'https://public.example/api/tags',
                                                headers=None, json=None, allow_redirects=False)

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
        scratch = Path(__file__).resolve().parents[2] / 'local/test-data/admin-permissions'
        scratch.mkdir(parents=True, exist_ok=True)
        self.db_path = scratch / f'{uuid4().hex}.sqlite3'
        self.db = SqliteDatabase(str(self.db_path), thread_safe=False, check_same_thread=False)
        models.tma_db.initialize(self.db)
        models.lerne_db.initialize(self.db)
        self.addCleanup(self.cleanup_database)
        self.db.create_tables([
            models.TMAUser, models.TMAAuthAccount, models.TMAAuthSession, models.TMAAuthToken,
            models.TMA_Folder, models.TMA_Deck, models.TMA_Card, models.TMA_Collaborator,
            models.TMASetting, models.TMACustomPrompt, models.TMAProgress, models.Deck, models.Card,
        ])
        self.headers = {}
        for user_id in (101, 202):
            models.TMAUser.create(user_id=user_id, first_name='Synthetic user', is_guest=False)
            account = models.TMAAuthAccount.create(user=user_id)
            tokens = service._create_session(account, models.auth_utcnow())
            self.headers[user_id] = {'Authorization': 'Bearer ' + tokens.access_token}
        app = FastAPI()
        for router in (auth.router, auth_v2.router, settings.router, ai.router, decks.router,
                       collaborative.router, debug.router):
            app.include_router(router, prefix='/api')
        app.get('/api/init')(get_init_data)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def cleanup_database(self):
        self.db.close()
        self.db_path.unlink(missing_ok=True)
        models.tma_db.initialize(self.previous[0])
        models.lerne_db.initialize(self.previous[1])

    def test_init_keeps_personal_settings_private(self):
        personal = {101: {'autoplay': True}, 202: {'autoplay': False}}
        for user_id, settings_payload in personal.items():
            models.TMASetting.insert_many([
                {'key': f'USER_SETTINGS_{user_id}', 'value': json.dumps(settings_payload)},
                {'key': f'USER_DESIGN_V1_BACKUP_{user_id}', 'value': f'backup-{user_id}'},
                {'key': f'DECK_LEARNING_{user_id}_1', 'value': '1'},
                {'key': f'REMINDER_SETTINGS_{user_id}', 'value': f'reminders-{user_id}'},
                {'key': f'LAST_REMINDER_SLOTS_{user_id}', 'value': f'slots-{user_id}'},
                {'key': f'LAST_REMINDER_ATTEMPT_{user_id}', 'value': f'attempt-{user_id}'},
            ]).execute()
        models.TMASetting.create(key='TTS_VOICE', value='synthetic-voice')
        models.TMASetting.create(key='GOOGLE_API_KEY', value='synthetic-secret')

        for user_id, expected in personal.items():
            with self.subTest(user_id=user_id):
                response = self.client.get('/api/init', headers=self.headers[user_id])
                self.assertEqual(response.status_code, 200, response.text)
                payload = response.json()
                self.assertEqual(payload['user_settings'], expected)
                self.assertEqual(payload['settings'], {'TTS_VOICE': 'synthetic-voice'})

        response = self.client.get('/api/init')
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json(), {'detail': 'authentication_required'})

    def test_legacy_ai_admin_endpoints_require_verified_admin(self):
        from api.ai_clients import AIService

        endpoints = (
            ('GET', '/api/admin/models/google', {}),
            ('POST', '/api/admin/test-ai', {'json': {
                'provider': 'google', 'model': 'gemini-fixture', 'api_key': 'synthetic'}}),
        )
        with patch.object(AIService, 'get_models', new=AsyncMock(return_value=['gemini-fixture'])) as listing, \
                patch.object(AIService, 'chat_completion', new=AsyncMock(return_value=('OK', True))) as chat:
            for method, path, kwargs in endpoints:
                self.assertEqual(self.client.request(method, path, headers={'X-User-Id': '101'}, **kwargs).status_code, 401)
                self.assertEqual(self.client.request(method, path, headers=self.headers[202], **kwargs).status_code, 403)
            listing.assert_not_awaited()
            chat.assert_not_awaited()
            listed = self.client.get(endpoints[0][1], headers=self.headers[101])
            tested = self.client.post(endpoints[1][1], headers=self.headers[101], **endpoints[1][2])
            self.assertEqual(listed.status_code, 200)
            self.assertEqual(listed.json(), ['gemini-fixture'])
            self.assertEqual(tested.status_code, 200)
            self.assertEqual(tested.json(), {'status': 'success', 'message': 'Connection successful!'})
            listing.assert_awaited_once()
            chat.assert_awaited_once()

    def test_ollama_urls_are_checked_in_both_admin_endpoints(self):
        from api.ai_clients import AIService

        def requests(value):
            params = {} if value is None else {'url': value}
            body = {'provider': 'ollama', 'model': 'fixture'}
            if value is not None:
                body['ollama_url'] = value
            return (
                self.client.get('/api/admin/models/ollama', params=params, headers=self.headers[101]),
                self.client.post('/api/admin/test-ai', headers=self.headers[101], json=body),
            )

        async def resolve(_loop, host, port, **_options):
            address = '10.0.0.4' if host == 'private.example' else '93.184.216.34'
            return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, '', (address, port))]

        from asyncio import BaseEventLoop
        with patch.object(BaseEventLoop, 'getaddrinfo', resolve), \
                patch.object(AIService, '_make_request', new=AsyncMock()) as outbound:
            for url in (None, 'file:///etc/hosts', 'http://127.0.0.1', 'http://127.1', 'http://169.254.169.254',
                        'http://[::ffff:127.0.0.1]', 'http://[64:ff9b::a00:4]', 'http://192.168.1.1',
                        'http://private.example', 'http://user:pass@public.example', 'https://public.example/?q=1'):
                with self.subTest(url=url):
                    self.assertEqual([response.status_code for response in requests(url)], [400, 400])
            fallback = self.client.post('/api/admin/test-ai', headers=self.headers[101],
                json={'provider': 'custom', 'model': 'ollama/fixture', 'api_key': 'synthetic'})
            self.assertEqual(fallback.status_code, 400)
            outbound.assert_not_awaited()
            outbound.side_effect = [({'models': [{'name': 'fixture'}]}, True),
                                    ({'message': {'content': 'OK'}}, True)]
            listed, tested = requests('https://public.example:11434/ollama/')
            self.assertEqual(listed.json(), ['fixture'])
            self.assertEqual(tested.json()['status'], 'success')
            self.assertEqual([call.args[0] for call in outbound.await_args_list], [
                'https://public.example:11434/ollama/api/tags', 'https://public.example:11434/ollama/api/chat'])

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
        services = get_init_data.__globals__['services']
        with patch.object(services, 'ensure_starter_decks'), \
                patch.object(services, 'get_active_decks', return_value=[]), \
                patch.object(services, 'get_active_folders', return_value=[]):
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
