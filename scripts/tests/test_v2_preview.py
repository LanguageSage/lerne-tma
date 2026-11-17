"""Synthetic boundary checks for acceptance-only account selection."""
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException
from local import preview


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


if __name__ == '__main__':
    unittest.main()
