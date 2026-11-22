"""Synthetic boundary checks for acceptance-only account selection."""
import json
import os
from pathlib import Path
import shutil
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.testclient import TestClient
from peewee import SqliteDatabase
from local import preview, runtime as local_runtime


class PreviewBoundaryTests(unittest.TestCase):
    def test_unavailable_outside_local(self):
        with patch.object(preview, 'is_local', return_value=False):
            with self.assertRaises(HTTPException) as error:
                preview.require_preview()
        self.assertEqual(error.exception.status_code, 404)

    def test_ordinary_local_config_cannot_select_accounts(self):
        with patch.object(preview, 'is_local', return_value=True), \
                patch.object(preview, 'local_config', return_value={'purpose': 'ordinary'}):
            with self.assertRaises(HTTPException) as error:
                preview.require_preview()
        self.assertEqual(error.exception.status_code, 404)

    def test_separate_server_identity_and_marker_required(self):
        from api import models
        root = Path('C:/synthetic/v2-preview').resolve()
        config = {'purpose': 'native-v2-preview', 'data_root': root}
        with patch.object(preview, 'is_local', return_value=True), \
                patch.object(preview, 'local_config', return_value=config), \
                patch.object(models, 'tma_db') as database, \
                patch.object(models.TMASetting, 'get_or_none') as marker:
            query = database.execute_sql
            query.return_value.fetchone.return_value = ('lerne_tma_local', 55432, str(root / 'postgres'))
            with self.assertRaises(HTTPException):
                preview.require_preview()
            query.return_value.fetchone.return_value = ('lerne_tma_local', 55433, str(root / 'postgres'))
            marker.return_value = None
            with self.assertRaises(HTTPException):
                preview.require_preview()
            marker.return_value = SimpleNamespace(value='native-v2-preview')
            self.assertEqual(preview.require_preview(), config)

    def test_origin_and_secret_are_both_required(self):
        request = Mock(client=SimpleNamespace(host='127.0.0.1'),
                       headers={'origin': 'http://127.0.0.1:5174'})
        with patch.object(preview, 'require_preview', return_value={'login_secret': 'synthetic'}):
            preview.authorize_preview(request, 'synthetic')
            with self.assertRaises(HTTPException):
                preview.authorize_preview(request, 'wrong')
            request.headers['origin'] = 'https://example.invalid'
            with self.assertRaises(HTTPException):
                preview.authorize_preview(request, 'synthetic')

    def test_admin_opener_keeps_fixed_loopback_destination(self):
        from local.router import preview_admin
        request = Mock()
        with patch.object(preview, 'authorize_preview') as authorize, \
                patch('webbrowser.open', return_value=True) as opener:
            self.assertEqual(preview_admin.__wrapped__(request, 'synthetic'), {'opened': True})
        authorize.assert_called_once_with(request, 'synthetic')
        opener.assert_called_once_with('http://127.0.0.1:8051/')

    def test_admin_environment_prepends_checkout_src(self):
        import os
        import tempfile
        from local import v2_preview

        with tempfile.TemporaryDirectory() as tmp:
            admin_dir = Path(tmp) / 'lerne-admin'
            src_dir = admin_dir / 'src'
            src_dir.mkdir(parents=True)
            base_env = {'LERNE_V2_PREVIEW': '1', 'PYTHONPATH': f'C:/other{os.pathsep}{src_dir}'}
            result = v2_preview.admin_environment(base_env, admin_dir)
            self.assertEqual(result['PYTHONPATH'], f'{src_dir}{os.pathsep}C:/other')
            self.assertEqual(base_env['PYTHONPATH'], f'C:/other{os.pathsep}{src_dir}')


class PreviewAdminDesignTests(unittest.TestCase):
    def _make_config(self, root, **extra):
        (root / 'config').mkdir(parents=True, exist_ok=True)
        cfg = {
            'driver': 'native',
            'pg_bin': str(root / 'pg_bin'),
            'login_secret': 'synthetic-preview-login-secret-32chars',
            'database_url': 'postgresql://cards_test:synthetic@127.0.0.1:55433/lerne_tma_local',
            **extra,
        }
        cfg_path = root / 'config' / 'local.json'
        cfg_path.write_text(json.dumps(cfg), encoding='utf-8')
        return cfg_path

    def test_preview_runtime_preserves_real_admin_and_ordinary_local_keeps_synthetic_admin(self):
        from api.permissions import is_admin

        root = Path(tempfile.gettempdir()).resolve() / ('lerne-v2-preview-test-' + uuid4().hex)
        root.mkdir()
        self.addCleanup(lambda: shutil.rmtree(root, ignore_errors=True))

        preview_cfg = self._make_config(root / 'preview', purpose='native-v2-preview')
        with patch.dict(os.environ, {
            'LERNE_MODE': 'LOCAL',
            'LERNE_DATA_ROOT': str(root / 'preview'),
            'LERNE_LOCAL_CONFIG': str(preview_cfg),
            'ADMIN_USER_ID': str(local_runtime.LOCAL_USER_ID),
        }, clear=True), patch.object(local_runtime, '_configured', False), patch('sys.addaudithook'):
            local_runtime.configure_local()
            self.assertNotIn('ADMIN_USER_ID', os.environ)
            self.assertTrue(is_admin(642478257))
            self.assertFalse(is_admin(local_runtime.LOCAL_USER_ID))
            self.assertFalse(is_admin(885574402))

        explicit_cfg = self._make_config(root / 'explicit', purpose='native-v2-preview', admin_user_id=777)
        with patch.dict(os.environ, {
            'LERNE_MODE': 'LOCAL',
            'LERNE_DATA_ROOT': str(root / 'explicit'),
            'LERNE_LOCAL_CONFIG': str(explicit_cfg),
        }, clear=True), patch.object(local_runtime, '_configured', False), patch('sys.addaudithook'):
            local_runtime.configure_local()
            self.assertEqual(os.environ.get('ADMIN_USER_ID'), '777')
            self.assertTrue(is_admin(777))
            self.assertFalse(is_admin(642478257))

        for bad_admin in (True, 0, -5, '642478257'):
            bad_cfg = self._make_config(root / f'bad-{type(bad_admin).__name__}', purpose='native-v2-preview', admin_user_id=bad_admin)
            with self.subTest(bad_admin=bad_admin), patch.dict(os.environ, {
                'LERNE_MODE': 'LOCAL',
                'LERNE_DATA_ROOT': str(root / f'bad-{type(bad_admin).__name__}'),
                'LERNE_LOCAL_CONFIG': str(bad_cfg),
            }, clear=True), patch.object(local_runtime, '_configured', False), patch('sys.addaudithook'):
                with self.assertRaises(RuntimeError):
                    local_runtime.configure_local()

        ordinary_cfg = self._make_config(root / 'ordinary')
        with patch.dict(os.environ, {
            'LERNE_MODE': 'LOCAL',
            'LERNE_DATA_ROOT': str(root / 'ordinary'),
            'LERNE_LOCAL_CONFIG': str(ordinary_cfg),
        }, clear=True), patch.object(local_runtime, '_configured', False), patch('sys.addaudithook'):
            local_runtime.configure_local()
            self.assertEqual(os.environ.get('ADMIN_USER_ID'), str(local_runtime.LOCAL_USER_ID))
            self.assertTrue(is_admin(local_runtime.LOCAL_USER_ID))
            self.assertFalse(is_admin(642478257))

    def test_preview_admin_can_load_save_and_publish_design_v2(self):
        import sys
        from api import models
        from api.auth import service
        from api.routers import auth_v2, settings

        with patch.dict(sys.modules, {'api.routers.bot': SimpleNamespace(router=APIRouter())}), \
                patch.object(models, 'initialize_database'), patch.object(models, 'create_all_tables'):
            from api.main import get_init_data

        previous = (models.tma_db.obj, models.lerne_db.obj)
        scratch = Path(__file__).resolve().parents[2] / 'local/test-data/v2-preview-test'
        scratch.mkdir(parents=True, exist_ok=True)
        db_path = scratch / f'{uuid4().hex}.sqlite3'
        db = SqliteDatabase(str(db_path), thread_safe=False, check_same_thread=False)
        models.tma_db.initialize(db)
        models.lerne_db.initialize(db)

        def cleanup():
            db.close()
            db_path.unlink(missing_ok=True)
            models.tma_db.initialize(previous[0])
            models.lerne_db.initialize(previous[1])

        self.addCleanup(cleanup)
        db.create_tables([
            models.TMAUser, models.TMAAuthAccount, models.TMAAuthSession, models.TMAAuthToken,
            models.TMA_Folder, models.TMA_Deck, models.TMA_Card, models.TMA_Collaborator,
            models.TMASetting, models.TMACustomPrompt, models.TMAProgress, models.Deck, models.Card,
        ])

        headers = {}
        for uid in (642478257, 885574402):
            models.TMAUser.create(user_id=uid, first_name=f'User {uid}', is_guest=False)
            account = models.TMAAuthAccount.create(user=uid)
            tokens = service._create_session(account, models.auth_utcnow())
            headers[uid] = {'Authorization': 'Bearer ' + tokens.access_token}

        app = FastAPI()
        app.include_router(auth_v2.router, prefix='/api')
        app.include_router(settings.router, prefix='/api')
        app.get('/api/init')(get_init_data)
        client = TestClient(app)
        self.addCleanup(client.close)

        root = Path(tempfile.gettempdir()).resolve() / ('lerne-v2-preview-http-' + uuid4().hex)
        root.mkdir()
        self.addCleanup(lambda: shutil.rmtree(root, ignore_errors=True))
        preview_cfg = self._make_config(root, purpose='native-v2-preview')

        with patch.dict(os.environ, {
            'LERNE_MODE': 'LOCAL',
            'LERNE_DATA_ROOT': str(root),
            'LERNE_LOCAL_CONFIG': str(preview_cfg),
            'ENVIRONMENT': 'development',
        }, clear=True), patch.object(local_runtime, '_configured', False), patch('sys.addaudithook'):
            local_runtime.configure_local()

            self.assertTrue(client.get('/api/auth/v2/me', headers=headers[642478257]).json()['is_admin'])
            self.assertFalse(client.get('/api/auth/v2/me', headers=headers[885574402]).json()['is_admin'])

            init_admin = client.get('/api/init', headers=headers[642478257])
            self.assertEqual(init_admin.status_code, 200)
            self.assertTrue(init_admin.json()['is_admin'])

            init_regular = client.get('/api/init', headers=headers[885574402])
            self.assertEqual(init_regular.status_code, 200)
            self.assertFalse(init_regular.json()['is_admin'])

            sample_config = {'schemaVersion': 2, 'global': {'accentColor': '#38bdf8'}}
            save_draft = client.post('/api/admin/design/draft', json={'config': sample_config}, headers=headers[642478257])
            self.assertEqual(save_draft.status_code, 200)
            self.assertEqual(client.get('/api/admin/design/draft', headers=headers[642478257]).json(), {'config': sample_config})

            pub = client.post('/api/admin/design/publish', json={'config': sample_config}, headers=headers[642478257])
            self.assertEqual(pub.status_code, 200)
            self.assertEqual(pub.json()['config'], sample_config)
            self.assertEqual(client.get('/api/init', headers=headers[642478257]).json()['global_design_v2']['config'], sample_config)

            self.assertEqual(client.get('/api/admin/design/draft', headers=headers[885574402]).status_code, 403)
            self.assertEqual(client.post('/api/admin/design/draft', json={'config': sample_config}, headers=headers[885574402]).status_code, 403)
            self.assertEqual(client.post('/api/admin/design/publish', json={'config': sample_config}, headers=headers[885574402]).status_code, 403)


if __name__ == '__main__':
    unittest.main()
