"""Entrypoint error contracts; no production app, database or provider startup."""
import builtins
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient

from api.auth.errors import AuthError
from api.dependencies.auth import get_user_id
from api.routers import auth_v2


SECRET = 'synthetic-private-database-host'
ENTRYPOINT = Path(__file__).resolve().parents[2] / 'api' / 'index.py'


def load_entrypoint(app):
    spec = importlib.util.spec_from_file_location('api.index', ENTRYPOINT)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {'api.main': SimpleNamespace(app=app)}), \
            patch.object(sys, 'path', sys.path.copy()):
        spec.loader.exec_module(module)
    return module


class ApiErrorTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()

        @app.get('/boom')
        def boom():
            raise RuntimeError(SECRET)

        @app.get('/http/{status_code}')
        def http_error(status_code: int):
            raise HTTPException(status_code, detail=SECRET, headers={'Retry-After': '7'})

        @app.get('/classic')
        def classic(user_id: int = Depends(get_user_id)):
            return {'user_id': user_id}

        app.include_router(auth_v2.router, prefix='/api')
        self.entrypoint = load_entrypoint(app)
        self.assertIs(self.entrypoint.handler, app)
        self.client = TestClient(self.entrypoint.handler, raise_server_exceptions=False)
        self.addCleanup(self.client.close)

    def assert_private_trace_logged(self, captured):
        output = '\n'.join(captured.output)
        self.assertIn('Traceback (most recent call last)', output)
        self.assertIn(SECRET, output)

    def test_unexpected_error_is_safe_and_traceback_is_logged(self):
        with self.assertLogs('api.index', level='ERROR') as captured:
            response = self.client.get('/boom')
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json(), {
            'status': 'runtime_error', 'error': 'internal_server_error'})
        self.assert_private_trace_logged(captured)

    def test_expected_http_errors_keep_status_detail_and_headers(self):
        for status_code in (400, 401, 403, 404):
            with self.subTest(status_code=status_code):
                response = self.client.get(f'/http/{status_code}')
                self.assertEqual(response.status_code, status_code)
                self.assertEqual(response.json(), {'detail': SECRET})
                self.assertEqual(response.headers['Retry-After'], '7')
        missing = self.client.get('/missing')
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.json(), {'detail': 'Not Found'})

    def test_http_server_errors_hide_details_and_log_traceback(self):
        for status_code in (500, 502, 503):
            with self.subTest(status_code=status_code):
                with self.assertLogs('api.index', level='ERROR') as captured:
                    response = self.client.get(f'/http/{status_code}')
                self.assertEqual(response.status_code, status_code)
                self.assertEqual(response.json(), {'detail': 'service_unavailable'})
                self.assert_private_trace_logged(captured)

    def test_auth_messages_and_bearer_challenge_are_preserved(self):
        for path, headers, detail in (
            ('/classic', {}, 'authentication_required'),
            ('/api/auth/v2/me', {}, 'authentication_required'),
            ('/api/auth/v2/me', {'Authorization': 'Bearer'}, 'invalid_session'),
        ):
            with self.subTest(path=path, detail=detail):
                response = self.client.get(path, headers=headers)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.json(), {'detail': detail})
                self.assertEqual(response.headers['WWW-Authenticate'], 'Bearer')
        with patch.object(auth_v2.service, 'create_challenge',
                          side_effect=AuthError('provider_not_configured', 503)):
            response = self.client.post('/api/auth/v2/challenges', json={'provider': 'google'})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {'detail': 'provider_not_configured'})

    def test_import_failure_is_safe_for_all_methods_and_logged_at_startup(self):
        original_import = builtins.__import__

        def fail_main_import(name, *args, **kwargs):
            if name == 'api.main':
                raise RuntimeError(SECRET)
            return original_import(name, *args, **kwargs)

        with patch('builtins.__import__', side_effect=fail_main_import), \
                self.assertLogs('api.index', level='ERROR') as captured:
            entrypoint = load_entrypoint(None)
        self.assert_private_trace_logged(captured)
        with TestClient(entrypoint.handler, raise_server_exceptions=False) as client:
            for method in ('GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH'):
                with self.subTest(method=method):
                    response = client.request(method, '/api/anything')
                    self.assertEqual(response.status_code, 500)
                    if method == 'HEAD':
                        self.assertEqual(response.content, b'')
                    else:
                        self.assertEqual(response.json(), {
                            'status': 'startup_error', 'error': 'service_unavailable'})


if __name__ == '__main__':
    unittest.main()
