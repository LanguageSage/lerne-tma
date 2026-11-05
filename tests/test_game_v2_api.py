"""Authenticated Game HTTP contract; fixtures are synthetic and disposable."""
import unittest
from pathlib import Path
from uuid import uuid4
from unittest.mock import AsyncMock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from peewee import SqliteDatabase
from api import models
from api.routers import game_v2, auth_v2
from api.services.game_v2 import dialogue

class GameModeV2TestCase(unittest.TestCase):
    def setUp(self):
        import os
        from peewee import PostgresqlDatabase
        self.path = Path('local/test-data') / f'game-{uuid4().hex}.sqlite3'
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = (PostgresqlDatabase(os.environ['GAME_TEST_DATABASE'], user='lerne_local',
                   password=os.environ['GAME_TEST_PASSWORD'], host='127.0.0.1', port=55432)
                   if os.environ.get('GAME_TEST_DATABASE') else SqliteDatabase(str(self.path)))
        self.previous = models.tma_db.obj, models.lerne_db.obj
        models.tma_db.initialize(self.db)
        models.lerne_db.initialize(self.db)
        self.db.create_tables([models.TMAUser, models.TMAOfflineBatch, models.TMASetting,
            models.TMAAuthAccount, models.TMAAuthIdentity, models.TMAAuthSession,
            models.TMAAuthToken, models.TMAAuthProof, models.TMAAuthChallenge,
            models.TMAAuthPassword, models.TMAAuthPasswordThrottle])
        app = FastAPI()
        for router in (auth_v2.router, game_v2.router):
            app.include_router(router, prefix='/api')
        self.server = None
        if os.environ.get('GAME_TEST_DATABASE'):
            import socket, threading, time, uvicorn, httpx
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0))
                port = probe.getsockname()[1]
            self.server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, log_level='error'))
            self.thread = threading.Thread(target=self.server.run, daemon=True)
            self.thread.start()
            for _ in range(100):
                if self.server.started: break
                time.sleep(.05)
            self.client = httpx.Client(base_url=f'http://127.0.0.1:{port}', timeout=30, trust_env=False)
        else:
            self.client = TestClient(app)
        self.headers = []
        for index in range(2):
            response = self.client.post('/api/auth/v2/email-password/register', json={
                'email': f'game-{uuid4().hex}@example.invalid', 'password': 'synthetic game password'})
            self.assertEqual(response.status_code, 200, response.text)
            self.headers.append({'Authorization': 'Bearer ' + response.json()['access_token']})
        self.db.close()

    def tearDown(self):
        self.client.close()
        if self.server:
            self.server.should_exit = True
            self.thread.join(5)
        self.db.close()
        models.tma_db.initialize(self.previous[0])
        models.lerne_db.initialize(self.previous[1])
        self.path.unlink(missing_ok=True)

    def start(self):
        response = self.client.post('/api/game/v2/session/start', headers=self.headers[0])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn('Guten Tag', response.json()['greeting'])
        return '/api/game/v2/session/' + response.json()['session_id']

    def test_auth_ownership_and_end(self):
        self.assertEqual(self.client.post('/api/game/v2/session/start').status_code, 401)
        url = self.start()
        self.assertEqual(self.client.get(url, headers=self.headers[1]).status_code, 404)
        self.assertEqual(self.client.post(url+'/end', headers=self.headers[1]).status_code, 404)
        self.assertEqual(self.client.get(url, headers=self.headers[0]).status_code, 200)
        self.assertEqual(self.client.post(url+'/end', headers=self.headers[0]).status_code, 200)
        self.assertEqual(self.client.post(url+'/message', headers=self.headers[0], json={'message':'Hallo'}).status_code, 400)

    def test_failure_retry_and_persistence(self):
        url = self.start()
        with patch.object(dialogue, 'generate_assistant_reply', AsyncMock(side_effect=dialogue.DialogueUnavailable('unavailable'))):
            self.assertEqual(self.client.post(url+'/message', headers=self.headers[0], json={'message':'Hallo'}).status_code, 503)
        self.assertEqual(len(self.client.get(url, headers=self.headers[0]).json()['history']), 1)
        with patch.object(dialogue, 'generate_assistant_reply', AsyncMock(return_value='Willkommen!')):
            result = self.client.post(url+'/message', headers=self.headers[0], json={'message':'Hallo'})
            self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(len(self.client.get(url, headers=self.headers[0]).json()['history']), 3)

    def test_close_during_ai_does_not_reopen(self):
        import asyncio
        from api.db_workers import run_db
        url = self.start()
        session_id = url.rsplit('/', 1)[1]
        user_id = self.client.get(url, headers=self.headers[0]).json()['user_id']
        async def reply(_history):
            await run_db(dialogue.close_session, session_id, user_id)
            return 'Hallo!'
        with patch.object(dialogue, 'generate_assistant_reply', reply):
            response = self.client.post(url+'/message', headers=self.headers[0], json={'message':'Hallo'})
            self.assertEqual(response.status_code, 503)
        self.assertEqual(self.client.get(url, headers=self.headers[0]).json()['status'], 'closed')
