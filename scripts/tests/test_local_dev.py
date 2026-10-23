"""LOCAL boundary regressions. SQLite fixtures, synthetic secrets, no live PostgreSQL."""
import asyncio
import importlib
import os
from pathlib import Path
import tempfile
import shutil
from uuid import uuid4
import unittest
from unittest.mock import patch, AsyncMock
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.testclient import TestClient
from peewee import SqliteDatabase

from api import models
from local import runtime as local_runtime
from api.auth import service
from api.auth.errors import AuthError
from local import router as local
from api.routers import auth_v2, media, cards, study, folders, decks
from scripts import local_dev

URL = 'postgresql://lerne_local:synthetic@127.0.0.1:55432/lerne_tma_local'


class SyntheticDirectory:
    """Inherit Windows ACLs (Python 3.14 mkdtemp uses a private owner-only ACL)."""
    def __init__(self):
        self.path = Path(tempfile.gettempdir()).resolve() / ('lerne-local-test-' + uuid4().hex)
        self.path.mkdir()
        self.name = str(self.path)

    def __enter__(self):
        return self.name

    def __exit__(self, *_args):
        self.cleanup()

    def cleanup(self):
        assert self.path.resolve().parent == Path(tempfile.gettempdir()).resolve()
        assert self.path.name.startswith('lerne-local-test-')
        if self.path.exists():
            shutil.rmtree(self.path)


class LocalConfigurationTests(unittest.TestCase):
    def test_misspelled_mode_cannot_fall_back_to_cloud(self):
        with patch.dict(os.environ, {'LERNE_MODE': 'LOACL'}, clear=True), self.assertRaises(RuntimeError):
            local_runtime.is_local()

    def test_configuration_discards_cloud_credentials_and_installs_network_guard(self):
        with SyntheticDirectory() as directory, patch.dict(os.environ, {'LERNE_DATA_ROOT': directory}, clear=True):
            local_dev.initialize_config()
            os.environ.update(LERNE_MODE='LOCAL', SUPABASE_DB_URL='synthetic-cloud', SUPABASE_KEY='synthetic',
                              BOT_TOKEN='synthetic', GOOGLE_OAUTH_CLIENT_SECRET='synthetic')
            with patch.object(local_runtime, '_configured', False), patch('sys.addaudithook') as audit:
                local_runtime.configure_local()
            self.assertNotIn('SUPABASE_DB_URL', os.environ)
            self.assertNotIn('SUPABASE_KEY', os.environ)
            self.assertNotIn('BOT_TOKEN', os.environ)
            self.assertNotIn('GOOGLE_OAUTH_CLIENT_SECRET', os.environ)
            self.assertEqual(os.environ['PYTHON_DOTENV_DISABLED'], '1')
            audit.assert_called_once_with(local_runtime._network_audit)

    def test_only_explicit_loopback_postgres_database_is_allowed(self):
        for host in ('localhost', '127.0.0.1', '[::1]'):
            local_runtime.validate_database_url(URL.replace('127.0.0.1', host))
        for value in (URL.replace('127.0.0.1', 'example.invalid'), URL.replace('127.0.0.1', '127.0.0.1.evil.invalid'),
                      URL + '?host=example.invalid', URL + '?service=production', URL + '#x',
                      URL.replace('lerne_tma_local', 'postgres'), URL.replace('postgresql:', 'sqlite:'),
                      URL.replace(':synthetic', ''), ''):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                local_runtime.validate_database_url(value)

    def test_persistent_paths_cannot_be_in_repository(self):
        for path in (local_runtime.PROJECT_ROOT, local_runtime.PROJECT_ROOT / 'scratch/data', Path('relative')):
            with self.assertRaises(RuntimeError):
                local_runtime.external_path(path)

    def test_startup_creates_external_directories_and_never_loads_cloud_url(self):
        with SyntheticDirectory() as directory, patch.dict(os.environ, {
                'LERNE_DATA_ROOT': directory, 'SUPABASE_DB_URL': 'do-not-use'}, clear=True):
            config = local_dev.initialize_config()
            self.assertEqual(config['data_root'], Path(directory).resolve())
            for key in ('media', 'backups', 'test_data', 'postgres'):
                self.assertTrue(config[key].is_dir())
            saved = config['config_path'].read_bytes()
            local_dev.initialize_config()
            self.assertEqual(saved, config['config_path'].read_bytes())
            env = local_dev.environment(config)
            self.assertNotIn('SUPABASE_DB_URL', env)
            self.assertEqual(env['VITE_API_URL'], '/api')

    def test_rejects_external_url_before_creating_directories(self):
        with SyntheticDirectory() as directory, patch.dict(os.environ, {
                'LERNE_DATA_ROOT': directory, 'LERNE_LOCAL_DATABASE_URL': URL.replace('127.0.0.1', 'example.invalid')}, clear=True):
            with self.assertRaises(RuntimeError):
                local_runtime.local_config()
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_production_local_is_rejected(self):
        for key in ('VERCEL', 'VERCEL_ENV', 'ENVIRONMENT', 'NODE_ENV'):
            with patch.dict(os.environ, {'LERNE_MODE': 'LOCAL', key: 'production'}, clear=True), \
                    patch.object(local_runtime, '_configured', False), self.assertRaises(RuntimeError):
                local_runtime.configure_local()

    def test_network_boundary_denies_dns_connect_and_udp(self):
        for event, args in [('socket.getaddrinfo', ('example.invalid', 443)),
                            ('socket.connect', (None, ('203.0.113.1', 443))),
                            ('socket.sendto', (None, b'data', ('203.0.113.1', 53)))]:
            with self.assertRaises(RuntimeError):
                local_runtime._network_audit(event, args)
        local_runtime._network_audit('socket.connect', (None, ('127.0.0.1', 55432)))

    def test_reset_requires_confirmation_before_backup_or_mutation(self):
        with patch('builtins.input', return_value='no'), patch.object(local_dev, 'backup') as backup:
            with self.assertRaises(RuntimeError):
                local_dev.reset({})
            backup.assert_not_called()

    def test_backup_never_publishes_partial_dump(self):
        with SyntheticDirectory() as directory, \
                patch.object(local_dev, 'database'), patch.object(local_dev, 'verify_database'), \
                patch.object(local_dev, 'pg_command', return_value=['pg_dump']), \
                patch.object(local_dev, 'run', side_effect=RuntimeError('failed')):
            with self.assertRaises(RuntimeError):
                local_dev.backup({'backups': Path(directory)})
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_restore_is_transactional_and_has_recovery_backup(self):
        with SyntheticDirectory() as directory:
            path = Path(directory) / 'fixture.dump'
            path.write_bytes(b'PGDMP synthetic')
            commands = []
            with patch.object(local_dev, 'confirm') as confirm, patch.object(local_dev, 'backup') as backup, \
                    patch.object(local_dev, 'database'), patch.object(local_dev, 'verify_database'), \
                    patch.object(local_dev, 'run'), \
                    patch.object(local_dev, 'pg_command', side_effect=lambda _config, name, *args: commands.append((name, args)) or [name]):
                local_dev.restore({}, path)
            confirm.assert_called_once()
            backup.assert_called_once()
            self.assertIn('--single-transaction', commands[-1][1])
            self.assertIn('--exit-on-error', commands[-1][1])


class LocalHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = SyntheticDirectory()
        self.addCleanup(self.temp.cleanup)
        self.config = {'login_secret': 'synthetic-local-secret', 'media': Path(self.temp.name),
                       'database_url': URL}
        for folder in ('images', 'audio', 'videos', 'backgrounds'):
            (self.config['media'] / folder).mkdir()
        self.env = patch.dict(os.environ, {'LERNE_MODE': 'LOCAL'}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.config_patch = patch.object(local_runtime, 'local_config', return_value=self.config)
        self.config_patch.start()
        self.addCleanup(self.config_patch.stop)
        self.db = SqliteDatabase(':memory:', thread_safe=False, check_same_thread=False,
                                 pragmas={'foreign_keys': 1})
        self.previous = (models.tma_db.obj, models.lerne_db.obj)
        models.tma_db.initialize(self.db)
        models.lerne_db.initialize(self.db)
        self.db.create_tables([models.TMAUser, models.TMASetting, models.TMA_Folder, models.TMA_Deck,
            models.TMA_Card, models.TMAProgress, models.TMAReviewHistory, models.TMAMedia,
            models.TMA_Collaborator, models.TMAOfflineBatch, *models.AUTH_FOUNDATION_MODELS,
            *models.AUTH_CHALLENGE_MODELS, *models.AUTH_PASSWORD_MODELS])
        self.addCleanup(self.close_database)
        models.TMAUser.create(user_id=local_runtime.LOCAL_USER_ID, first_name='Synthetic', is_guest=False,
                             default_decks_initialized=True)
        models.TMAAuthAccount.create(user=local_runtime.LOCAL_USER_ID)
        app = FastAPI()
        for router in (local.router, auth_v2.router, media.router, cards.router, study.router, folders.router, decks.router):
            app.include_router(router, prefix='/api')
        self.client = TestClient(app, client=('127.0.0.1', 50000))
        self.addCleanup(self.client.close)

    def close_database(self):
        self.db.close()
        models.tma_db.initialize(self.previous[0])
        models.lerne_db.initialize(self.previous[1])

    def login(self, **overrides):
        return self.client.post('/api/auth/local/login', headers={
            'Origin': 'http://127.0.0.1:5173', 'X-Lerne-Local-Secret': 'synthetic-local-secret', **overrides})

    def headers(self):
        response = self.login()
        self.assertEqual(response.status_code, 200, response.text)
        return {'Authorization': 'Bearer ' + response.json()['access_token']}

    def test_local_login_issues_real_revocable_bearer_session(self):
        response = self.login()
        self.assertEqual(response.status_code, 200, response.text)
        headers = {'Authorization': 'Bearer ' + response.json()['access_token']}
        self.assertEqual(self.client.get('/api/auth/v2/me', headers=headers).json()['user_id'], local_runtime.LOCAL_USER_ID)
        self.assertEqual(self.client.get('/api/auth/v2/me', headers={'X-User-ID': str(local_runtime.LOCAL_USER_ID)}).status_code, 401)
        self.assertEqual(self.client.post('/api/auth/v2/logout', headers=headers, json={}).status_code, 204)
        self.assertEqual(self.client.get('/api/auth/v2/me', headers=headers).status_code, 401)

    def test_local_login_rejects_missing_secret_and_foreign_origin(self):
        self.assertEqual(self.login(**{'X-Lerne-Local-Secret': ''}).status_code, 401)
        self.assertEqual(self.login(Origin='https://example.invalid').status_code, 403)
        with patch.dict(os.environ, {'LERNE_MODE': ''}):
            self.assertEqual(self.login().status_code, 404)
            with self.assertRaises(AuthError):
                service.login_local_test('synthetic-local-secret')

    def test_media_upload_and_read_are_external_files_and_missing_media_never_redirects(self):
        response = self.client.post('/api/media/upload-audio', headers=self.headers(),
            files={'file': ('synthetic.mp3', b'ID3' + b'\x01' * 130, 'audio/mpeg')})
        self.assertEqual(response.status_code, 200, response.text)
        path = response.json()['path']
        self.assertTrue((self.config['media'] / path).is_file())
        self.assertIsNone(models.TMAMedia.get().content)
        self.assertEqual(self.client.get(response.json()['url']).content, b'ID3' + b'\x01' * 130)
        for folder in ('audio', 'images', 'videos', 'backgrounds'):
            missing = self.client.get(f'/api/media/{folder}/missing.mp3', follow_redirects=False)
            self.assertEqual(missing.status_code, 404)
            self.assertNotIn('location', missing.headers)

    def test_local_crud_markdown_study_and_access_control(self):
        headers = self.headers()
        folder = self.client.post('/api/folders', headers=headers, json={'name': 'Synthetic folder'}).json()
        self.assertIn('id', folder, folder)
        deck = self.client.post('/api/decks', headers=headers, json={'name': 'Synthetic deck', 'folder_id': folder['id']}).json()
        self.assertIn('id', deck, deck)
        card = self.client.post('/api/cards/save', headers=headers, json={
            'deck_id': deck['id'], 'front': 'Haus', 'back': '**дом**\n\n- Markdown',
            'context': '## Context\n\nEin **Haus**.', 'auto_generate_audio': False})
        self.assertEqual(card.status_code, 200, card.text)
        card_id = card.json()['id']
        self.assertIn('**дом**', models.TMA_Card.get_by_id(card_id).back_text)
        next_card = self.client.get(f'/api/decks/{deck["id"]}/next', headers=headers)
        self.assertEqual(next_card.status_code, 200, next_card.text)
        grade = self.client.post('/api/study/grade', headers=headers,
            json={'card_id': card_id, 'deck_id': deck['id'], 'grade': 2, 'return_next': False})
        self.assertEqual(grade.status_code, 200, grade.text)
        self.assertEqual(models.TMAReviewHistory.select().count(), 1)
        self.assertEqual(self.client.post(f'/api/decks/{deck["id"]}/rename', headers=headers, json={'name': 'Edited'}).status_code, 200)
        self.assertEqual(self.client.post(f'/api/folders/{folder["id"]}/rename', headers=headers, json={'name': 'Edited'}).status_code, 200)
        self.assertEqual(self.client.post('/api/cards/save', headers=headers, json={
            'card_id': card_id, 'deck_id': deck['id'], 'front': 'Haustür', 'back': '**дверь**',
            'auto_generate_audio': False}).status_code, 200)
        imported = self.client.post('/api/cards/bulk-save', headers=headers, json={'cards': [{
            'deck_id': deck['id'], 'front': 'Buch', 'back': '**книга**', 'context': '## Markdown',
        }]})
        self.assertEqual(imported.status_code, 200, imported.text)
        self.assertEqual(models.TMA_Card.get(models.TMA_Card.front_text == 'Buch').context, '## Markdown')
        self.assertEqual(self.client.delete(f'/api/cards/{card_id}', headers=headers).status_code, 200)
        self.assertEqual(self.client.delete(f'/api/decks/{deck["id"]}', headers=headers).status_code, 200)
        self.assertEqual(self.client.delete(f'/api/folders/{folder["id"]}', headers=headers).status_code, 200)

    def test_local_user_cannot_mutate_another_users_deck(self):
        deck = models.TMA_Deck.create(user_id=12345, name='Other synthetic user')
        card = models.TMA_Card.create(deck=deck, front_text='Synthetic', back_text='Synthetic')
        headers = self.headers()
        self.assertEqual(self.client.post('/api/cards/save', headers=headers, json={
            'card_id': card.id, 'deck_id': deck.id, 'front': 'Spoof', 'back': 'Spoof',
            'auto_generate_audio': False}).status_code, 403)
        self.assertEqual(self.client.post('/api/study/grade', headers=headers, json={
            'card_id': card.id, 'deck_id': deck.id, 'grade': 2, 'return_next': False}).status_code, 403)

    def test_seed_rerun_does_not_recreate_removed_data(self):
        with patch.object(local_dev, 'database', return_value=models), \
                patch.object(local_dev, 'verify_database'), patch.object(models, 'create_all_tables'), \
                patch.object(models.tma_db.obj, 'close'):
            local_dev.prepare(self.config)
            self.assertEqual(models.TMA_Deck.select().count(), 2)
            models.TMA_Deck.update(is_deleted=True).execute()
            local_dev.prepare(self.config)
            self.assertEqual(models.TMA_Deck.select().count(), 2)
            self.assertEqual(models.TMA_Deck.select().where(models.TMA_Deck.is_deleted == False).count(), 0)

    def test_tts_and_ai_are_disabled_before_provider_calls(self):
        from api.ai_clients import AIService
        from api.utils.audio import generate_audio
        result = asyncio.run(AIService().chat_completion('synthetic', 'synthetic', 'synthetic'))
        self.assertFalse(result[1])
        with self.assertRaisesRegex(RuntimeError, 'LOCAL'):
            asyncio.run(generate_audio('Synthetic'))

    def test_real_app_guard_rejects_external_services_and_redirects(self):
        with patch.object(local_dev, 'prepare'), patch.object(local_runtime, 'configure_local'):
            main = importlib.import_module('api.main')
        for path in ('/api/ai/evaluate-answer', '/api/cards/ai-generate', '/api/auth/v2/challenges',
                     '/api/auth/v2/google/callback', '/api/media/generate-audio', '/api/bot/webhook'):
            handler = AsyncMock()
            request = SimpleNamespace(url=SimpleNamespace(path=path), client=SimpleNamespace(host='127.0.0.1'))
            response = asyncio.run(main.local_services_guard(request, handler))
            self.assertEqual(response.status_code, 503, path)
            handler.assert_not_awaited()
        request = SimpleNamespace(url=SimpleNamespace(path='/api/media/audio/test'), client=SimpleNamespace(host='127.0.0.1'))
        handler = AsyncMock(return_value=RedirectResponse('https://example.invalid/media'))
        self.assertEqual(asyncio.run(main.local_services_guard(request, handler)).status_code, 503)
        request.client.host = '203.0.113.1'
        self.assertEqual(asyncio.run(main.local_services_guard(request, handler)).status_code, 403)


if __name__ == '__main__':
    unittest.main()
