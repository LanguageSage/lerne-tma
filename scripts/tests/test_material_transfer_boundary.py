"""HTTP/configuration boundaries. SQLite only; worker execution is stubbed."""
import json
import io
import os
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from peewee import SqliteDatabase

from api import models
from api.dependencies.auth import get_user_id
from local import router as local_routes
from tools.admin import server
from tools.admin.routers import material_transfer as routes
from tools.admin.transfer_worker import configuration
from scripts.tests.test_local_dev import SyntheticDirectory
from scripts.tests.test_material_transfer import TABLES


class TransferBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.directory = SyntheticDirectory(); self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.config = self.root / 'transfer.json'
        self.config.write_text(json.dumps({'enabled': True, 'allow_cloud_write': False, 'project_ref': 'a' * 20,
            'environment': 'staging', 'cloud_user_id': 84, 'storage_url': f'https://{"a" * 20}.supabase.co',
            'storage_key': 'never-expose', 'database_url': f'postgresql://postgres:fake@db.{"a" * 20}.supabase.co:5432/postgres?sslmode=require'}), encoding='utf-8')
        (self.root / 'local.json').write_text(json.dumps({'database_url':
            'postgresql://local:synthetic@127.0.0.1:55432/lerne_tma_local', 'media': str(self.root / 'media')}), encoding='utf-8')
        self.db = SqliteDatabase(':memory:', thread_safe=False, check_same_thread=False)
        models.tma_db.initialize(self.db); models.lerne_db.initialize(self.db)
        self.db.create_tables(TABLES); self.addCleanup(self.db.close)
        models.TMAUser.create(user_id=900000001, is_guest=False)
        self.deck = models.TMA_Deck.create(user_id=900000001, name='Synthetic')
        self.card = models.TMA_Card.create(deck=self.deck, front_text='Synthetic', back_text='Синтетика')
        server.app.dependency_overrides[server.db_session_scope] = lambda: None
        self.addCleanup(server.app.dependency_overrides.clear)
        self.client = TestClient(server.app, base_url='http://127.0.0.1:8050',
                                 client=('127.0.0.1', 51000), headers={'Origin': 'http://127.0.0.1:8050'})
        routes._catalog_cache.clear(); routes._previews.clear(); routes._active.clear()

    def test_config_is_explicit_disabled_by_default_and_never_exposes_credentials(self):
        with patch.object(routes, 'is_local', return_value=False):
            self.assertEqual(self.client.get('/api/admin/transfer/config').status_code, 403)
        with patch.object(routes, 'config_path', return_value=self.config):
            result = self.client.get('/api/admin/transfer/config')
            self.assertEqual(result.status_code, 200)
            self.assertNotIn('never-expose', result.text); self.assertNotIn('database_url', result.text)
            self.assertFalse(result.json()['allow_cloud_write'])
        data = json.loads(self.config.read_text())
        for change in ({'enabled': False}, {'project_ref': 'b' * 20},
                       {'database_url': 'postgresql://x:y@127.0.0.1/postgres'},
                       {'storage_url': 'https://evil.invalid'}, {'environment': 'unknown'}):
            self.config.write_text(json.dumps({**data, **change}))
            with self.assertRaises(ValueError): configuration(self.config)
        self.config.write_text(json.dumps(data))
        self.assertEqual(configuration(self.config)[0]['project_ref'], 'a' * 20)

    def test_origin_validation_and_browser_cannot_set_actor_or_send_progress(self):
        options = {'direction': 'publish', 'selection': {'kind': 'card', 'ids': [self.card.id]}}
        with patch.object(routes, 'worker', return_value={'rows': []}) as worker:
            self.assertEqual(self.client.post('/api/admin/transfer/preview', json=options,
                headers={'Origin': 'https://evil.invalid'}).status_code, 403)
            for extra in ({'cloud_user_id': 84}, {'progress': []}, {'database_url': 'bad'}, {'confirmed': True}):
                self.assertEqual(self.client.post('/api/admin/transfer/preview', json={**options, **extra}).status_code, 422)
            self.assertEqual(self.client.post('/api/admin/transfer/preview', json={**options,
                'selection': {'kind': 'card', 'ids': [-1]}}).status_code, 422)
            worker.assert_not_called()

    def test_worker_environment_does_not_inherit_local_guard_or_cloud_secrets(self):
        with patch.object(routes, 'config_path', return_value=self.config), \
                patch.object(routes, 'local_config', return_value={'database_url': 'synthetic-local', 'media': self.root / 'media'}), \
                patch.dict(os.environ, {'LERNE_MODE': 'LOCAL', 'SUPABASE_KEY': 'never-expose', 'ADMIN_USER_ID': '999'}), \
                patch('subprocess.run', return_value=Mock(stdout='{"ok":true,"result":{}}')) as process:
            self.assertEqual(routes.worker({'command': 'catalog'}), {})
            env = process.call_args.kwargs['env']
            self.assertNotIn('LERNE_MODE', env); self.assertNotIn('SUPABASE_KEY', env)
            self.assertNotIn('ADMIN_USER_ID', env)
            self.assertEqual(env['PYTHON_DOTENV_DISABLED'], '1')
            self.assertNotIn('never-expose', process.call_args.kwargs['input'])

    def test_card_entry_uses_verified_local_identity_and_mutation_permission(self):
        app = FastAPI(); app.include_router(local_routes.router, prefix='/api')
        app.dependency_overrides[get_user_id] = lambda: 900000001
        client = TestClient(app)
        with patch.object(local_routes, 'is_local', return_value=True):
            self.assertEqual(client.get(f'/api/local/transfer-card/{self.card.id}').json()['url'],
                             f'http://127.0.0.1:8050/?publish_card={self.card.id}')
            models.TMA_Deck.update(user_id=99).where(models.TMA_Deck.id == self.deck.id).execute()
            models.TMA_Collaborator.create(target_type='deck', target_id=self.deck.id, user_id=900000001, role='viewer')
            self.assertEqual(client.get(f'/api/local/transfer-card/{self.card.id}').status_code, 403)
        with patch.object(local_routes, 'is_local', return_value=False):
            self.assertEqual(client.get(f'/api/local/transfer-card/{self.card.id}').status_code, 404)

    def test_catalogs_can_read_both_sides_concurrently_but_writes_are_exclusive(self):
        from tools.admin import transfer_worker
        for command in ('catalog', 'preview', 'apply'):
            request = json.dumps({'command': command, 'config_path': str(self.config)})
            with patch.object(transfer_worker, 'create_transfer') as create, \
                    patch.object(transfer_worker, 'execute', return_value={}), \
                    patch('sys.stdin', io.StringIO(request)), patch('sys.stdout', io.StringIO()), \
                    patch.dict(os.environ, {'LERNE_MODE': '', 'SUPABASE_DB_URL': ''}):
                transfer_worker.main()
                self.assertEqual(create.call_args.kwargs['exclusive'], command != 'catalog')

    def test_catalog_cache_avoids_cloud_calls_and_expires_or_changes_with_config(self):
        url = '/api/admin/transfer/catalog?direction=download&kind=folder'
        with patch.object(routes, 'config_path', return_value=self.config), \
                patch.object(routes, 'worker', return_value={'items': [{'id': 1, 'name': 'Course'}], 'has_more': False}) as worker, \
                patch.object(routes.time, 'monotonic', return_value=100) as clock:
            self.assertFalse(self.client.get(url).json()['cached'])
            self.assertTrue(self.client.get(url).json()['cached'])
            self.assertEqual(worker.call_count, 1)
            clock.return_value = 401
            self.assertFalse(self.client.get(url).json()['cached'])
            self.assertEqual(worker.call_count, 2)
            data = json.loads(self.config.read_text()); data['project_ref'] = 'another-project'
            self.config.write_text(json.dumps(data))
            self.client.get(url)
            self.assertEqual(worker.call_count, 3)

    def test_background_preview_polling_and_repeat_do_not_requery_cloud(self):
        from fastapi import HTTPException
        options = {'direction': 'download', 'selection': {'kind': 'folder', 'ids': [1]}}
        with patch.object(routes, 'config_path', return_value=self.config), \
                patch.object(routes, 'worker', side_effect=HTTPException(413, 'Больше 2000 карточек. Выберите вложенную папку.')) as worker:
            result = self.client.post('/api/admin/transfer/preview', json=options)
            self.assertEqual(result.status_code, 202)
            identifier = result.json()['id']
            for _ in range(3):
                status = self.client.get('/api/admin/transfer/previews/' + identifier).json()
                self.assertEqual(status['status'], 'error')
                self.assertIn('2000', status['error'])
            repeated = self.client.post('/api/admin/transfer/preview', json=options)
            self.assertEqual(repeated.json()['id'], identifier)
            self.assertEqual(worker.call_count, 1)
        with patch.object(routes, 'config_path', return_value=self.config), \
                patch.object(routes, 'worker', return_value={'id': 'saved-job'}) as worker:
            options['selection']['ids'] = [2]
            result = self.client.post('/api/admin/transfer/preview', json=options)
            status = self.client.get('/api/admin/transfer/previews/' + result.json()['id']).json()
            self.assertEqual(status['job_id'], 'saved-job')
            self.assertEqual(self.client.post('/api/admin/transfer/preview', json=options).json()['id'], result.json()['id'])
            self.assertEqual(worker.call_count, 1)


if __name__ == '__main__': unittest.main()
