"""AI/settings HTTP regressions with real SQL and synthetic provider I/O."""
import asyncio
from pathlib import Path
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI, Header

from api import ai_service, models
from api.dependencies.auth import get_user_id
from api.routers import ai, settings
from scripts.tests import test_db_workers as fixtures
from native_fixture import sqlite_native


class AiSettingsDbWorkerTests(fixtures.DbPhaseAssertions, unittest.TestCase):
    database_factory = None

    def setUp(self):
        scratch = Path(__file__).resolve().parents[2] / 'local/test-data/ai-db-workers'
        scratch.mkdir(parents=True, exist_ok=True)
        self.path = scratch / f'{uuid4().hex}.sqlite3'
        self.db = self.database_factory() if self.database_factory else fixtures.TrackedDatabase(self.path)
        sqlite_native(self, self.db, writes=True)
        previous = models.tma_db.obj, models.lerne_db.obj

        def restore():
            self.db.close()
            if hasattr(self.db, 'close_all'):
                self.db.close_all()
            models.tma_db.initialize(previous[0])
            models.lerne_db.initialize(previous[1])
            self.path.unlink(missing_ok=True)
            ai_service.invalidate_ai_config_cache()

        self.addCleanup(restore)
        models.tma_db.initialize(self.db)
        models.lerne_db.initialize(self.db)
        ai_service.invalidate_ai_config_cache()
        with self.db.connection_context():
            self.db.create_tables([models.TMAUser, models.TMASetting, models.TMACustomPrompt, models.TMA_Folder,
                models.TMA_Deck, models.TMA_Card, models.TMA_Collaborator, models.TMAOfflineBatch,
                models.TMAProgress])
            for uid in (1, 2):
                models.TMAUser.create(user_id=uid, is_guest=False)
            self.deck = models.TMA_Deck.create(user_id=1, name='Fixture', target_language='de')
            for key, value in {'AI_PROVIDER': 'google', 'GOOGLE_API_KEY': 'synthetic-key',
                               'DEFAULT_MODEL': 'fixture-old', 'AI_DETECT_LEVEL': 'false'}.items():
                models.TMASetting.create(key=key, value=value)
        self.app = FastAPI()
        self.app.middleware('http')(fixtures.cache_headers_middleware)
        for module in (ai, settings):
            self.app.include_router(module.router, prefix='/api')

        def account(x_test_user: int = Header(default=1)):
            return x_test_user

        self.app.dependency_overrides[get_user_id] = account
        admin = patch.dict('os.environ', ADMIN_USER_ID='1')
        admin.start()
        self.addCleanup(admin.stop)

    def test_prompt_crud_isolation_and_config_change_during_generation(self):
        async def exercise(client):
            other = {'X-Test-User': '2'}
            prompt = {'name': 'Fixture prompt', 'prompt': 'fixture-one JSON {phrase}'}
            created = await client.post('/api/user/prompts', json=prompt)
            pid = created.json()['id']
            endpoint = f'/api/user/prompts/{pid}'
            self.assertEqual((await client.post('/api/user/prompts', headers=other, json={**prompt, 'id': pid})).status_code, 404)
            self.assertEqual((await client.post(endpoint + '/activate')).status_code, 200)
            self.assertEqual((await client.get('/api/settings/test-ai', headers=other)).status_code, 403)
            self.assertEqual((await client.post('/api/admin/settings', headers=other, json={'DEFAULT_MODEL': 'bad'})).status_code, 403)

            started, release = asyncio.Event(), asyncio.Event()
            calls = []

            async def complete(**kwargs):
                self.assert_released()
                calls.append(kwargs)
                if len(calls) == 1:
                    started.set()
                    await release.wait()
                return '{"front":"Hallo","back":"Привет","context":"Fixture"}', True

            payload = {'phrase': 'Hallo'}
            with patch.object(ai_service.AIService, 'chat_completion', side_effect=complete):
                running = asyncio.create_task(client.post('/api/ai/generate', json=payload))
                try:
                    await asyncio.wait_for(started.wait(), 5)
                    self.assertEqual((await client.post('/api/admin/settings', json={'DEFAULT_MODEL': 'fixture-new'})).status_code, 200)
                    self.assertEqual((await client.post('/api/user/prompts', json={**prompt, 'id': pid, 'prompt': 'fixture-two JSON {phrase}'})).status_code, 200)
                    next_result = await client.post('/api/cards/ai-generate', json=payload)
                    self.assertEqual(next_result.json()['content_v2']['card']['data']['answer'], 'Привет')
                    await client.post('/api/ai/generate', headers=other, json=payload)
                finally:
                    release.set()
                    result = await running
            self.assertEqual(result.json()['content_v2']['card']['data']['prompt'], 'Hallo')
            self.assertEqual([call['model'] for call in calls], ['fixture-old', 'fixture-new', 'fixture-new'])
            self.assertIn('fixture-one JSON Hallo', calls[0]['system_prompt'])
            self.assertIn('fixture-two JSON Hallo', calls[1]['system_prompt'])
            self.assertNotIn('fixture-two', calls[2]['system_prompt'])
            self.assertEqual((await client.delete(endpoint)).status_code, 200)
            self.assertEqual((await client.delete(endpoint)).status_code, 404)
        self.run_asgi(exercise)

    def test_batch_permission_error_and_receipt_replay(self):
        async def exercise(client):
            payload = {'text': 'Hallo', 'deck_id': self.deck.id, 'import_id': str(uuid4())}
            replies = iter([('synthetic provider failure', False),
                ('[{"front":"Hallo","back":"Привет","context":"Fixture"}]', True)])

            async def complete(**_kwargs):
                self.assert_released()
                return next(replies)

            with patch.object(ai_service.AIService, 'chat_completion', side_effect=complete) as provider:
                other = await client.post('/api/ai/generate-batch', headers={'X-Test-User': '2'}, json=payload)
                self.assertEqual(other.status_code, 403)
                failed = await client.post('/api/ai/generate-batch', json=payload)
                self.assertGreaterEqual(failed.status_code, 400)
                saved = await client.post('/api/ai/generate-batch', json=payload)
                self.assertEqual(saved.status_code, 200, saved.text)
                self.assertEqual(len(saved.json()['saved_cards']), 1)
                repeated = await client.post('/api/ai/generate-batch', json=payload)
                self.assertEqual(repeated.json(), saved.json())
                changed = await client.post('/api/ai/generate-batch', json={**payload, 'text': 'Anders'})
                self.assertEqual(changed.status_code, 409)
                self.assertEqual(provider.await_count, 2)
        self.run_asgi(exercise)

    def test_test_ai_and_admin_settings_omit_raw_keys_over_sql(self):
        async def exercise(client):
            get_res = await client.get('/api/admin/settings')
            self.assertEqual(get_res.status_code, 200, get_res.text)
            self.assertNotIn('GOOGLE_API_KEY', get_res.json())
            self.assertNotIn('synthetic-key', get_res.text)
            self.assertEqual(get_res.json()['EFFECTIVE_AI_CONFIG']['model'], 'fixture-old')

            async def complete(**kwargs):
                self.assert_released()
                self.assertEqual(kwargs['model'], 'fixture-old')
                return 'OK', True

            with patch.object(ai_service.AIService, 'chat_completion', side_effect=complete):
                test_res = await client.get('/api/settings/test-ai')
            self.assertEqual(test_res.status_code, 200, test_res.text)
            data = test_res.json()
            self.assertEqual(data['model'], 'fixture-old')
            self.assertNotIn('synthetic-key', test_res.text)
            self.assertNotIn('key_raw', data['keys'][0])

            del_res = await client.post('/api/admin/settings/keys', json={
                'provider': 'google', 'action': 'delete', 'key_id': data['keys'][0]['key_id'],
            })
            self.assertEqual(del_res.status_code, 200)
            self.assertEqual(del_res.json()['AI_KEYS_STATUS']['google']['total'], 0)
            no_key = await client.get('/api/settings/test-ai')
            self.assertEqual(no_key.json()['status'], 'error')
            self.assertEqual(no_key.json()['total_keys'], 0)
        self.run_asgi(exercise)
