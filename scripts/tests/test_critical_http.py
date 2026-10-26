"""Real Classic/auth-v2 HTTP boundaries over a disposable SQLite database.

No dependency overrides: exercise the verified authentication wired by routes.
"""
from pathlib import Path
import unittest
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from peewee import SqliteDatabase

from api import models
from api.routers import auth_v2, cards, study, sync, card_notes, messages
from api.migrations import run_card_notes_migration


class CriticalHttpTests(unittest.TestCase):
    def setUp(self):
        scratch = Path(__file__).resolve().parents[2] / 'local' / 'test-data'
        scratch.mkdir(exist_ok=True)
        self.path = scratch / f'critical-http-{uuid4().hex}.sqlite3'
        self.db = SqliteDatabase(str(self.path), pragmas={'foreign_keys': 1}, timeout=10,
                                 thread_safe=False, check_same_thread=False)
        self.previous = (models.tma_db.obj, models.lerne_db.obj)
        models.tma_db.initialize(self.db)
        models.lerne_db.initialize(self.db)
        tables = [models.TMAUser, models.TMA_Folder, models.TMA_Deck, models.TMA_Card,
                  models.TMAProgress, models.TMAReviewHistory, models.TMA_Collaborator,
                  models.TMAOfflineBatch, models.TMASetting, models.TMAMedia,
                  models.TMAAuthAccount, models.TMAAuthIdentity, models.TMAAuthSession,
                  models.TMAAuthToken, models.TMAAuthProof, models.TMAAuthChallenge,
                  models.TMAAuthPassword, models.TMAAuthPasswordThrottle]
        self.db.create_tables(tables)
        app = FastAPI()
        for router in (auth_v2.router, cards.router, study.router, sync.router, card_notes.router, messages.router):
            app.include_router(router, prefix='/api')
        self.client = TestClient(app)
        self.addCleanup(self.cleanup)
        self.owner = self.register('owner@example.invalid')
        self.other = self.register('other@example.invalid')
        profile = self.client.get('/api/auth/v2/me', headers=self.headers())
        self.assertEqual(profile.status_code, 200, profile.text)
        self.deck = models.TMA_Deck.create(user_id=profile.json()['user_id'], name='Synthetic deck')

    def cleanup(self):
        self.client.close()
        self.db.close()
        models.tma_db.initialize(self.previous[0])
        models.lerne_db.initialize(self.previous[1])
        self.path.unlink(missing_ok=True)

    def register(self, email):
        response = self.client.post('/api/auth/v2/email-password/register', json={
            'email': email, 'password': 'synthetic test password'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        return response.json()

    def headers(self, session=None):
        return {'Authorization': 'Bearer ' + (session or self.owner)['access_token']}

    def save(self, **values):
        return self.client.post('/api/cards/save', headers=self.headers(), json={
            'deck_id': self.deck.id, 'front': 'Haus', 'back': 'дом',
            'auto_generate_audio': False, **values})

    def test_missing_notes_table_returns_503_without_blocking_cards_grades_or_sync(self):
        response = self.save()
        self.assertEqual(response.status_code, 200, response.text)
        card_id = response.json()['id']
        self.assertFalse(self.db.table_exists('tma_card_note'))
        self.assertEqual(self.client.get('/api/messages', headers=self.headers()).status_code, 503)
        for method, url, options in (
            ('get', f'/api/card-notes/{card_id}', {}),
            ('put', f'/api/card-notes/{card_id}/{uuid4()}', {'json': {'kind': 'note', 'text': 'Keep locally'}}),
        ):
            with self.subTest(method=method):
                result = getattr(self.client, method)(url, headers=self.headers(), **options)
                self.assertEqual(result.status_code, 503, result.text)
        self.assertEqual(self.save(card_id=card_id, front='Edited').status_code, 200)
        grade = self.client.post('/api/study/grade', headers=self.headers(), json={
            'card_id': card_id, 'deck_id': self.deck.id, 'grade': 2, 'return_next': False})
        self.assertEqual(grade.status_code, 200, grade.text)
        self.assertEqual(self.client.get('/api/sync/v2/pull', headers=self.headers()).status_code, 200)
        self.assertEqual(models.TMAReviewHistory.select().count(), 1)
        self.assertFalse(self.db.table_exists('tma_card_note'))

    def test_create_edit_study_grade_and_pull_persist_the_same_card(self):
        response = self.save()
        self.assertEqual(response.status_code, 200, response.text)
        card_id = response.json()['id']
        edited = self.save(card_id=card_id, front='Haustür')
        self.assertEqual(edited.status_code, 200, edited.text)
        self.assertEqual(models.TMA_Card.select().count(), 1)
        response = self.client.get(f'/api/decks/{self.deck.id}/next', headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['id'], card_id)
        self.assertEqual(response.json()['front'], 'Haustür')
        grade = self.client.post('/api/study/grade', headers=self.headers(), json={
            'card_id': card_id, 'deck_id': self.deck.id, 'grade': 2, 'return_next': False})
        self.assertEqual(grade.status_code, 200, grade.text)
        progress = models.TMAProgress.get(models.TMAProgress.card_id == card_id)
        self.assertIsNotNone(progress.last_reviewed)
        self.assertEqual(models.TMAReviewHistory.select().count(), 1)
        pulled = self.client.get('/api/sync/v2/pull', headers=self.headers())
        self.assertEqual(pulled.status_code, 200, pulled.text)
        self.assertEqual(pulled.json()['cards'][0]['front_text'], 'Haustür')
        self.assertEqual(pulled.json()['progress'][0]['card_id'], card_id)

    def test_foreign_account_cannot_edit_grade_or_pull_private_card(self):
        response = self.save()
        self.assertEqual(response.status_code, 200, response.text)
        card_id = response.json()['id']
        headers = self.headers(self.other)
        edited = self.client.post('/api/cards/save', headers=headers, json={
            'deck_id': self.deck.id, 'card_id': card_id, 'front': 'Forbidden',
            'auto_generate_audio': False})
        self.assertEqual(edited.status_code, 403, edited.text)
        graded = self.client.post('/api/study/grade', headers=headers, json={
            'card_id': card_id, 'deck_id': self.deck.id, 'grade': 2})
        self.assertEqual(graded.status_code, 403, graded.text)
        self.assertEqual(models.TMA_Card.get_by_id(card_id).front_text, 'Haus')
        self.assertEqual(models.TMAReviewHistory.select().count(), 0)
        response = self.client.get('/api/sync/v2/pull', headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['cards'], [])
        self.assertEqual(response.json()['progress'], [])

    def test_message_http_auth_owner_and_retry(self):
        run_card_notes_migration(self.db)
        card_id = self.save().json()['id']
        message_id = str(uuid4())
        url = f'/api/messages/{message_id}'
        payload = {'text': 'Исправьте карточку', 'card_id': card_id}
        self.assertEqual(self.client.put(url, json=payload).status_code, 401)
        response = self.client.put(url, headers=self.headers(), json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['kind'], 'suggestion')
        self.assertEqual(self.client.put(url, headers=self.headers(), json=payload).status_code, 200)
        self.assertEqual(self.client.get(url, headers=self.headers(self.other)).status_code, 404)
        self.assertEqual(self.client.put(url, headers=self.headers(self.other), json=payload).status_code, 409)
        self.assertEqual(models.TMAUserMessage.select().count(), 1)

    def test_missing_auth_and_invalid_grade_do_not_write(self):
        response = self.save()
        self.assertEqual(response.status_code, 200, response.text)
        card_id = response.json()['id']
        for path in ('/api/sync/v2/pull', f'/api/study/card/{card_id}'):
            self.assertEqual(self.client.get(path).status_code, 401)
        payload = {'card_id': card_id, 'deck_id': self.deck.id, 'grade': 2}
        self.assertEqual(self.client.post('/api/study/grade', json=payload).status_code, 401)
        for grade in (-1, 4, 8):
            response = self.client.post('/api/study/grade', headers=self.headers(),
                                        json={**payload, 'grade': grade})
            self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(models.TMAReviewHistory.select().count(), 0)

    def test_forged_user_header_cannot_read_create_update_delete_or_sync(self):
        response = self.save()
        self.assertEqual(response.status_code, 200, response.text)
        card_id = response.json()['id']
        for authorization in (None, 'Bearer invalid', 'Basic invalid'):
            headers = {'X-User-ID': str(self.deck.user_id)}
            if authorization:
                headers['Authorization'] = authorization
            requests = (
                ('GET', f'/api/study/card/{card_id}', None),
                ('GET', '/api/sync/v2/pull', None),
                ('POST', '/api/cards/save', {'deck_id': self.deck.id, 'front': 'forged'}),
                ('POST', '/api/cards/save', {'deck_id': self.deck.id, 'card_id': card_id,
                                           'front': 'forged'}),
                ('DELETE', f'/api/cards/{card_id}', None),
                ('POST', '/api/sync/v2/push', {'request_id': str(uuid4()), 'cards': []}),
            )
            for method, path, payload in requests:
                with self.subTest(authorization=authorization, method=method, path=path):
                    result = self.client.request(method, path, headers=headers, json=payload)
                    self.assertEqual(result.status_code, 401, result.text)
        self.assertEqual(models.TMA_Card.select().count(), 1)
        card = models.TMA_Card.get_by_id(card_id)
        self.assertEqual(card.front_text, 'Haus')
        self.assertFalse(card.is_deleted)
        self.assertEqual(models.TMAOfflineBatch.select().count(), 0)

    def test_valid_bearer_owns_identity_and_logout_cannot_fall_back_to_header(self):
        other_headers = {**self.headers(self.other), 'X-User-ID': str(self.deck.user_id)}
        response = self.client.post('/api/cards/save', headers=other_headers, json={
            'deck_id': self.deck.id, 'front': 'forged', 'auto_generate_audio': False})
        self.assertEqual(response.status_code, 403, response.text)
        headers = {**self.headers(), 'X-User-ID': str(self.deck.user_id)}
        self.assertEqual(self.client.get('/api/sync/v2/pull', headers=headers).status_code, 200)
        self.assertEqual(self.client.post('/api/auth/v2/logout', headers=headers, json={}).status_code, 204)
        self.assertEqual(self.client.get('/api/sync/v2/pull', headers=headers).status_code, 401)

    def test_delete_requires_owner_and_soft_deletion_removes_card_from_study(self):
        response = self.save()
        self.assertEqual(response.status_code, 200, response.text)
        card_id = response.json()['id']
        path = f'/api/cards/{card_id}'
        self.assertEqual(self.client.delete(path, headers=self.headers(self.other)).status_code, 403)
        self.assertFalse(models.TMA_Card.get_by_id(card_id).is_deleted)
        self.assertEqual(self.client.delete(path, headers=self.headers()).status_code, 200)
        self.assertTrue(models.TMA_Card.get_by_id(card_id).is_deleted)
        response = self.client.get(f'/api/decks/{self.deck.id}/next', headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {'finished': True})

    def test_refresh_and_logout_revoke_http_access(self):
        refreshed = self.client.post('/api/auth/v2/refresh', json={
            'refresh_token': self.owner['refresh_token']})
        self.assertEqual(refreshed.status_code, 200, refreshed.text)
        session = refreshed.json()
        self.assertNotEqual(session['access_token'], self.owner['access_token'])
        headers = self.headers(session)
        self.assertEqual(self.client.get('/api/auth/v2/me', headers=headers).status_code, 200)
        self.assertEqual(self.client.post('/api/auth/v2/logout', headers=headers, json={}).status_code, 204)
        self.assertEqual(self.client.get('/api/sync/v2/pull', headers=headers).status_code, 401)
        self.assertEqual(self.client.get('/api/auth/v2/me', headers=self.headers()).status_code, 401)

    def test_http_sync_retry_creates_one_card_and_rejects_changed_payload(self):
        payload = {'request_id': str(uuid4()), 'cards': [{
            'id': -1, 'deck_id': self.deck.id, 'front_text': 'Hallo', 'back_text': 'Привет'}]}
        first = self.client.post('/api/sync/v2/push', headers=self.headers(), json=payload)
        self.assertEqual(first.status_code, 200, first.text)
        retry = self.client.post('/api/sync/v2/push', headers=self.headers(), json=payload)
        self.assertEqual(retry.status_code, 200, retry.text)
        self.assertEqual(retry.json(), first.json())
        self.assertEqual(models.TMA_Card.select().count(), 1)
        payload['cards'][0]['front_text'] = 'Changed'
        response = self.client.post('/api/sync/v2/push', headers=self.headers(), json=payload)
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(models.TMA_Card.get().front_text, 'Hallo')
