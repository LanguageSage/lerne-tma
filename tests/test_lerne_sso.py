"""Two disposable DBs, real signatures and Auth v2. Run via test_game_mvp3.py."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import timedelta
import ast
import json
import logging
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
import uuid
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI
from fastapi.testclient import TestClient
from peewee import IntegrityError, SqliteDatabase

from api import models
from api.auth import service, lerne_sso
from api.auth.errors import AuthError
from api.auth.sso_migration import migrate_lerne_sso
from api.routers.auth_v2 import router


class LerneSsoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = Ed25519PrivateKey.generate()
        cls.private = cls.key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                            serialization.NoEncryption()).decode()
        cls.public = cls.key.public_key().public_bytes(serialization.Encoding.PEM,
                                                      serialization.PublicFormat.SubjectPublicKeyInfo).decode()

    def setUp(self):
        scratch = Path('scratch')
        scratch.mkdir(exist_ok=True)
        self.paths = [scratch / f'sso-{uuid.uuid4().hex}.sqlite' for _ in range(2)]
        self.dbs = [SqliteDatabase(str(path), pragmas={'foreign_keys': 1}) for path in self.paths]
        self.previous = models.tma_db.obj
        for db in self.dbs:
            models.tma_db.initialize(db)
            db.create_tables([models.TMAUser, *models.AUTH_MODELS])
            db.execute_sql('CREATE TABLE tma_migration_history (migration_id INTEGER PRIMARY KEY)')
        self.environment = patch.dict(os.environ, {
            'LERNE_SSO_ISSUER_ORIGIN': 'https://lerne.example',
            'LERNE_SSO_CLIENT_ORIGIN': 'https://game.example',
            'LERNE_SSO_PRIVATE_KEY': self.private, 'LERNE_SSO_PUBLIC_KEY': self.public,
        })
        self.environment.start()
        with self.side('issuer'):
            self.main_tokens = service.register_email_password('existing@example.test', 'existing-main-password')
        app = FastAPI()
        app.include_router(router)
        self.http = TestClient(app)

    def tearDown(self):
        self.environment.stop()
        for db in self.dbs:
            if not db.is_closed():
                db.close()
        models.tma_db.initialize(self.previous)
        for path in self.paths:
            path.unlink(missing_ok=True)

    @contextmanager
    def side(self, role):
        previous = models.tma_db.obj
        models.tma_db.initialize(self.dbs[0 if role == 'issuer' else 1])
        with patch.dict(os.environ, {'LERNE_SSO_ROLE': role,
                                    'LERNE_DEPLOYMENT': '' if role == 'issuer' else 'game-test'}):
            try:
                yield
            finally:
                models.tma_db.initialize(previous)

    def start(self, purpose='login', access_token=None):
        with self.side('client'):
            return service.create_challenge('lerne', purpose, access_token=access_token)

    def assertion(self, challenge):
        with self.side('issuer'):
            result = lerne_sso.issue_confirmation(self.main_tokens.access_token, challenge.id, challenge.nonce)
            url = urlsplit(result['return_url'])
            self.assertEqual(url.scheme + '://' + url.netloc, 'https://game.example')
            self.assertEqual(url.path, '/lerne-sso-callback.html')
            self.assertEqual(url.query, '')
            self.assertNotIn(self.main_tokens.access_token, result['return_url'])
            self.assertNotIn(self.main_tokens.refresh_token, result['return_url'])
            return parse_qs(url.fragment)['assertion'][0]

    def exchange(self, challenge, assertion, **kwargs):
        with self.side('client'):
            return service.exchange_challenge(challenge.id, challenge.secret, assertion=assertion, **kwargs)

    def test_init_keeps_authenticated_account_without_display_name(self):
        # Exercise the real consolidated response: Auth v2 /me alone cannot
        # catch a later /init response incorrectly replacing it with a guest.
        # Load the actual handler without starting unrelated provider SDKs or DBs.
        path = Path(__file__).resolve().parents[1] / 'api/main.py'
        function = next(node for node in ast.parse(path.read_text(encoding='utf-8')).body
                        if isinstance(node, ast.FunctionDef) and node.name == 'get_init_data')
        function.decorator_list = []
        scope = {'models': models, 'os': os, 'logger': logging.getLogger(__name__),
                 'Depends': lambda dependency: None, 'get_user_id': None,
                 'services': SimpleNamespace(ensure_starter_decks=lambda user: None,
                     get_active_decks=lambda *args, **kwargs: [], get_active_folders=lambda *args, **kwargs: [])}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(path), 'exec'), scope)
        challenge = self.start()
        tokens = self.exchange(challenge, self.assertion(challenge))['tokens']
        with self.side('client'):
            self.dbs[1].create_tables([models.TMA_Folder])
            profile = scope['get_init_data'](user_id=tokens.account_id)['user_info']
            self.assertEqual(profile['user_id'], tokens.account_id)
            self.assertIsNone(profile['first_name'])
            self.assertFalse(profile['is_guest'])

    def resign(self, assertion, **claims):
        payload = json.loads(lerne_sso._decode(assertion.split('.')[0]))
        payload.update(claims)
        encoded = lerne_sso._encode(json.dumps(payload, separators=(',', ':')).encode())
        return encoded + '.' + lerne_sso._encode(self.key.sign(lerne_sso.SIGNING_CONTEXT + encoded.encode()))

    def test_existing_main_account_gets_stable_separate_test_account_and_sessions(self):
        challenge = self.start()
        assertion = self.assertion(challenge)
        first = self.exchange(challenge, assertion)['tokens']
        again = self.start()
        second = self.exchange(again, self.assertion(again))['tokens']
        self.assertEqual(first.account_id, second.account_id)
        self.assertNotEqual(first.account_id, self.main_tokens.account_id)
        with self.side('client'):
            self.assertEqual(service.authenticate(second.access_token).account_id, first.account_id)
            self.assertEqual(models.TMAAuthPassword.select().count(), 0)
            self.assertEqual(models.TMAAuthIdentity.select().count(), 1)
            self.assertEqual(models.TMAUser.select().count(), 1)
            self.assertFalse(service.password_settings(second.access_token)['can_reset_password'])
            with self.assertRaises(AuthError):
                service.authenticate(self.main_tokens.access_token)
        with self.side('issuer'):
            self.assertEqual(models.TMAAuthSession.select().count(), 1)
            self.assertEqual(models.TMAAuthToken.select().count(), 2)
            self.assertEqual(models.TMAUser.select().count(), 1)
            with self.assertRaises(AuthError):
                service.authenticate(first.access_token)

    def test_secret_request_binding_and_atomic_one_time_consumption(self):
        challenge, other = self.start(), self.start()
        assertion = self.assertion(challenge)
        with self.side('client'):
            with self.assertRaises(AuthError):
                service.exchange_challenge(challenge.id, 'intercepted-without-tab-secret', assertion=assertion)
        with self.assertRaises(AuthError):
            self.exchange(other, assertion)
        self.exchange(challenge, assertion)
        with self.assertRaises(AuthError):
            self.exchange(challenge, assertion)
        # Even a second signed envelope with the same jti cannot reuse a proof.
        replay = self.resign(assertion, request_id=other.id, nonce=other.nonce)
        with self.assertRaises(AuthError) as error:
            self.exchange(other, replay)
        self.assertEqual(error.exception.code, 'provider_proof_replayed')
        with self.side('client'):
            self.assertEqual(models.TMAAuthSession.select().count(), 1)

    def test_invalid_signature_issuer_audience_time_and_nonce(self):
        challenge = self.start()
        assertion = self.assertion(challenge)
        payload, signature = assertion.split('.')
        claims = json.loads(lerne_sso._decode(payload))
        invalid = [payload + '.' + ('A' if signature[0] != 'A' else 'B') + signature[1:],
                   'malformed', self.resign(assertion, iss='https://attacker.example'),
                   self.resign(assertion, aud='https://other.example'),
                   self.resign(assertion, nonce='no_' + 'a' * 43),
                   self.resign(assertion, iat=claims['iat'] - 120, exp=claims['iat'] - 60),
                   self.resign(assertion, iat=claims['iat'] + 120, exp=claims['iat'] + 180),
                   self.resign(assertion, exp=claims['iat'] + 3600),
                   self.resign(assertion, sub=True), self.resign(assertion, sub=str(2**52))]
        for value in invalid:
            with self.subTest(value=value[:12]), self.assertRaises(AuthError):
                self.exchange(challenge, value)
        self.exchange(challenge, assertion)

    def test_simultaneous_exchange_creates_exactly_one_session(self):
        challenge = self.start()
        assertion = self.assertion(challenge)
        def exchange():
            try:
                service.exchange_challenge(challenge.id, challenge.secret, assertion=assertion)
                return 'ok'
            except AuthError as error:
                return error.code
            finally:
                if not self.dbs[1].is_closed():
                    self.dbs[1].close()
        with self.side('client'):
            with ThreadPoolExecutor(max_workers=2) as pool:
                self.assertCountEqual(list(pool.map(lambda _: exchange(), range(2))), ['ok', 'invalid_challenge'])
            self.assertEqual(models.TMAAuthSession.select().count(), 1)

    def test_expired_challenge_and_expired_assertion_are_rejected(self):
        challenge = self.start()
        assertion = self.assertion(challenge)
        future = models.auth_utcnow() + timedelta(seconds=61)
        with patch('api.auth.lerne_sso.auth_utcnow', return_value=future), self.assertRaises(AuthError):
            self.exchange(challenge, assertion)
        with self.side('client'):
            models.TMAAuthChallenge.update(expires_at=models.auth_utcnow() - timedelta(seconds=1)).execute()
        with self.assertRaises(AuthError):
            self.exchange(challenge, assertion)

    def test_failure_rolls_back_identity_proof_session_and_challenge(self):
        challenge = self.start()
        assertion = self.assertion(challenge)
        with patch('api.auth.service._mint_tokens', side_effect=RuntimeError('synthetic failure')):
            with self.assertRaises(RuntimeError):
                self.exchange(challenge, assertion)
        with self.side('client'):
            for model in (models.TMAAuthAccount, models.TMAAuthIdentity, models.TMAAuthSession, models.TMAAuthProof):
                self.assertEqual(model.select().count(), 0)
            self.assertIsNone(models.TMAAuthChallenge.get_by_id(challenge.id).completed_at)
        self.exchange(challenge, assertion)

    def test_linking_keeps_existing_test_password_and_cannot_merge_other_account(self):
        with self.side('client'):
            existing = service.register_email_password('old-test@example.test', 'old-test-password')
        challenge = self.start('link', existing.access_token)
        self.exchange(challenge, self.assertion(challenge), access_token=existing.access_token)
        login = self.start()
        self.assertEqual(self.exchange(login, self.assertion(login))['tokens'].account_id, existing.account_id)
        with self.side('client'):
            self.assertEqual(service.login_email_password('old-test@example.test', 'old-test-password').account_id,
                             existing.account_id)
            other = service.register_email_password('other-test@example.test', 'other-test-password')
        conflict = self.start('link', other.access_token)
        with self.assertRaises(AuthError) as error:
            self.exchange(conflict, self.assertion(conflict), access_token=other.access_token)
        self.assertEqual(error.exception.code, 'identity_conflict')

    def test_issuer_requires_main_bearer_and_client_cannot_issue(self):
        challenge = self.start()
        body = {'request_id': challenge.id, 'nonce': challenge.nonce}
        with self.side('issuer'):
            response = self.http.post('/auth/v2/lerne/confirm', json=body,
                                      headers={'X-User-ID': str(self.main_tokens.account_id)})
            self.assertEqual(response.status_code, 401)
            response = self.http.post('/auth/v2/lerne/confirm', json=body,
                                      headers={'Authorization': 'Bearer ' + self.main_tokens.access_token})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['cache-control'], 'no-store')
            self.assertNotIn('access_token', response.text)
            with self.assertRaises(AuthError):
                service.create_challenge('lerne', 'login')
        with self.side('client'):
            response = self.http.post('/auth/v2/lerne/confirm', json=body,
                                      headers={'Authorization': 'Bearer ' + self.main_tokens.access_token})
            self.assertEqual(response.status_code, 503)
            with patch.dict(os.environ, {'LERNE_SSO_ROLE': 'issuer'}), self.assertRaises(AuthError):
                lerne_sso.configuration('issuer')

    def test_http_exchange_redacts_input_and_ignores_profile_identity_hints(self):
        challenge = self.start()
        assertion = self.assertion(challenge)
        with self.side('client'):
            response = self.http.post(f'/auth/v2/challenges/{challenge.id}/exchange', json={
                'secret': challenge.secret, 'assertion': assertion, 'user_id': 101, 'email': 'untrusted@example.test'})
            self.assertEqual(response.status_code, 200)
            principal = service.authenticate(response.json()['access_token'])
            self.assertNotEqual(principal.account_id, 101)
            bad = self.http.post(f'/auth/v2/challenges/{challenge.id}/exchange', json={
                'secret': challenge.secret, 'assertion': assertion * 10})
            self.assertEqual(bad.status_code, 422)
            self.assertNotIn(assertion, bad.text)

    def old_schema(self):
        for model in (models.TMAAuthIdentity, models.TMAAuthChallenge):
            model.drop_table()
            sql, params = model._schema._create_table(safe=False).query()
            self.dbs[1].execute_sql(sql.replace(", 'lerne'", ''), params)
            model._schema.create_indexes(safe=False)

    def test_migration_preserves_credentials_and_pending_challenges_and_is_repeatable(self):
        with self.side('client'):
            self.old_schema()
            existing = service.register_email_password('old@example.test', 'old-test-password')
            pending = service.create_challenge('google', 'login')
            models.TMAAuthIdentity.create(account=existing.account_id, provider='google', subject='old-google')
            before = [list(model.select().dicts()) for model in models.AUTH_MODELS]
            self.assertTrue(migrate_lerne_sso(self.dbs[1])['applied'])
            self.assertEqual(before, [list(model.select().dicts()) for model in models.AUTH_MODELS])
            self.assertFalse(migrate_lerne_sso(self.dbs[1])['applied'])
            self.assertEqual(service.login_email_password('old@example.test', 'old-test-password').account_id, existing.account_id)
            self.assertEqual(models.TMAAuthChallenge.get_by_id(pending.id).provider, 'google')
            service.create_challenge('lerne', 'login')
            models.TMAAuthIdentity.create(account=existing.account_id, provider='lerne', subject='main-account')
            with self.dbs[1].atomic(), self.assertRaises(IntegrityError):
                models.TMAAuthIdentity.create(account=existing.account_id, provider='lerne', subject='another-account')

    def test_migration_failure_rolls_back_schema_and_history(self):
        with self.side('client'):
            self.old_schema()
            execute = self.dbs[1].execute_sql
            def fail_marker(sql, *args, **kwargs):
                if sql.startswith('INSERT INTO tma_migration_history'):
                    raise RuntimeError('synthetic migration failure')
                return execute(sql, *args, **kwargs)
            with patch.object(self.dbs[1], 'execute_sql', side_effect=fail_marker), self.assertRaises(RuntimeError):
                migrate_lerne_sso(self.dbs[1])
            self.assertEqual(self.dbs[1].execute_sql('SELECT COUNT(*) FROM tma_migration_history').fetchone()[0], 0)
            with self.assertRaises(IntegrityError):
                service.create_challenge('lerne', 'login')


if __name__ == '__main__':
    unittest.main()
