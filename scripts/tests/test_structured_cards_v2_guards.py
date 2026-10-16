"""Stage 3A: real writers on disposable SQLite, with no bootstrap or migrations.

Run this module in its own process, also with STRUCTURED_CARDS_V2_SCHEMA_READY=true.
V2 fixtures bypass the inactive schema gate ONLY in this in-memory test database.
"""
import importlib
import json
import os
from pathlib import Path
import re
import sys
from types import ModuleType
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from peewee import SqliteDatabase

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.update(VERCEL='1', RUN_MIGRATIONS='false', FORCE_LOCAL_DB='false')
database = SqliteDatabase(':memory:', pragmas={'foreign_keys': 1},
                          thread_safe=False, check_same_thread=False)
db_module = ModuleType('api.database')
db_module.tma_db = db_module.lerne_db = database
db_module.initialize_database = lambda: None
sys.modules['api.database'] = db_module
services = ModuleType('api.services')
services.__path__ = [str(ROOT / 'api/services')]
sys.modules['api.services'] = services
decks_module = ModuleType('api.services.decks')
decks_module.ensure_inbox_deck = lambda user: models.TMA_Deck.create(user_id=user, name='Inbox')
sys.modules['api.services.decks'] = decks_module
auth_module = ModuleType('api.dependencies.auth')
auth_module.get_user_id = lambda: 1
sys.modules['api.dependencies.auth'] = auth_module

models = importlib.import_module('api.models')
cards = importlib.import_module('api.services.cards')
offline = importlib.import_module('api.services.offline_sync')
legacy_sync = importlib.import_module('api.services.sync_service')
text_update = importlib.import_module('api.services.card_text_update')
guard = importlib.import_module('api.services.legacy_card_writes')
sync_router = importlib.import_module('api.routers.sync')
cards_router = importlib.import_module('api.routers.cards')
services.save_card = cards.save_card
services.bulk_save_cards = cards.bulk_save_cards
services.format_card_for_study = cards.format_card_for_study
services.ensure_card_audio = lambda *args: None
TABLES = [models.TMAUser, models.TMA_Folder, models.TMA_Deck, models.TMA_Card,
          models.TMAProgress, models.TMAReviewHistory, models.TMAOfflineBatch,
          models.TMA_Collaborator, models.TMASetting, models.TMAMedia]


class StructuredWriteGuardTests(unittest.TestCase):
    def setUp(self):
        database.connect(reuse_if_open=True)
        self.addCleanup(database.close)
        # No migration is executed; only disposable fixture DDL is used.
        with patch.object(models.TMA_Card._meta, 'constraints', []):
            database.create_tables(TABLES)
        if 'content_version' not in models.TMA_Card._meta.fields:
            database.execute_sql('ALTER TABLE tma_card ADD COLUMN content_version SMALLINT DEFAULT 1')
            database.execute_sql('ALTER TABLE tma_card ADD COLUMN content_v2 TEXT')
            database.execute_sql('ALTER TABLE tma_card ADD COLUMN card_revision BIGINT DEFAULT 1')
        models.TMAUser.create(user_id=1, is_guest=False)
        models.TMAUser.create(user_id=2, is_guest=False)
        self.folder = models.TMA_Folder.create(user_id=1, name='Root')
        self.deck = models.TMA_Deck.create(user_id=1, folder=self.folder, name='Target')
        self.other = models.TMA_Deck.create(user_id=1, folder=self.folder, name='Second')
        self.legacy = models.TMA_Card.create(deck=self.deck, front_text='@quiz\n[[literal]]',
                                             back_text='Answer', position=1)
        self.native = models.TMA_Card.create(deck=self.other, front_text='Plain projection',
            back_text='Cache', metadata='{"author":42}', history='[{"old":"answer"}]',
            audio_path='front.mp3', audio_back_path='back.mp3', position=8)
        self.make_native(self.native.id)
        for card in (self.legacy, self.native):
            models.TMAProgress.create(user_id=1, card_id=card.id, queue='review', interval=19, repetitions=4)
            models.TMAReviewHistory.create(user_id=1, card_id=card.id, rating=3, scheduled_interval=19)
        app = FastAPI()
        app.include_router(cards_router.router)
        app.include_router(sync_router.router)
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        database.drop_tables(TABLES)
        database.close()

    def make_native(self, card_id, version=2):
        database.execute_sql('UPDATE tma_card SET content_version=?, content_v2=?, card_revision=7 WHERE id=?',
                             (version, json.dumps({'type': 'quiz', 'data': {'prompt': '@free [[literal]]',
                              'options': [{'text': 'A', 'correct': True}, {'text': 'B', 'correct': True}]}}), card_id))

    def snapshot(self):
        # Raw rows include V2 columns even when optional ORM fields are absent.
        return {model._meta.table_name: database.execute_sql(
            f'SELECT * FROM "{model._meta.table_name}" ORDER BY 1').fetchall() for model in TABLES}

    def blocked(self, operation):
        before = self.snapshot()
        with self.assertRaises(HTTPException) as failure:
            operation()
        self.assertEqual(failure.exception.status_code, 409)
        self.assertEqual(failure.exception.detail['code'], 'legacy_card_write_blocked')
        self.assertEqual(self.snapshot(), before)

    def payload(self, card=None, **changes):
        card = card or self.native
        return {'id': card.id, 'deck_id': card.deck_id, 'front_text': 'Changed',
                'back_text': 'Changed answer', **changes}

    def item(self, card, number=1, **changes):
        return {'number': number, 'card_id': card.id, 'deck_id': card.deck_id,
                'front': card.front_text, 'back': card.back_text, 'context': '',
                'level': None, 'topics': '', 'card_type': 'standard', **changes}

    def test_single_save_checks_storage_before_all_side_effects(self):
        for payload in [self.payload(), {'card_id': str(self.native.id), 'front': 'x'},
                        {'id': self.native.id, 'content_version': 1, 'content_v2': None},
                        {'id': self.native.id}, self.payload(is_deleted=True, deck_id=self.deck.id)]:
            with self.subTest(payload=payload):
                self.blocked(lambda: cards.save_card(payload, 1))

    def test_post_put_patch_and_body_alias_cannot_redirect_target(self):
        for method, path, payload in [
            ('post', '/cards/save', self.payload()),
            ('put', f'/cards/{self.native.id}', {'card_id': self.legacy.id, 'front': 'x'}),
            ('patch', f'/cards/{self.native.id}', {'id': -1, 'front': 'x'})]:
            before = self.snapshot()
            result = getattr(self.client, method)(path, json=payload)
            self.assertEqual(result.status_code, 409, result.text)
            self.assertEqual(result.json()['detail']['code'], 'legacy_card_write_blocked')
            self.assertEqual(self.snapshot(), before)

    def test_bulk_mixed_multideck_duplicate_and_string_ids_fail_before_writes(self):
        for index in (0, 1, 3):
            payload = [self.payload(self.legacy), {'deck_id': self.deck.id, 'front': 'New', 'back': 'A'},
                       {'id': -123, 'deck_id': self.deck.id, 'front': 'Temp', 'back': 'A'}]
            payload.insert(index, {'card_id': str(self.native.id), 'front': 'Lost JSON'})
            payload.append(self.payload())
            request_id = str(uuid4())
            for _ in range(2):
                self.blocked(lambda: cards.bulk_save_cards(payload, 1, request_id))

    def test_bulk_http_is_whole_request_conflict(self):
        before = self.snapshot()
        result = self.client.post('/cards/bulk-save', json={'import_id': str(uuid4()),
            'cards': [self.payload(self.legacy), self.payload()]})
        self.assertEqual(result.status_code, 409, result.text)
        self.assertEqual(self.snapshot(), before)

    def test_mixed_requests_refuse_before_executing_any_dml(self):
        items = [self.item(self.legacy, front='Edited'), self.item(self.native, number=2)]
        operations = [lambda: cards.save_card(self.payload(), 1),
            lambda: cards.bulk_save_cards([self.payload(self.legacy), self.payload()], 1, str(uuid4())),
            lambda: offline.push_offline(sync_router.OfflinePushRequest(request_id=uuid4(),
                decks=[{'id': -1, 'name': 'New'}], cards=[self.payload(self.legacy), self.payload()]), 1),
            lambda: legacy_sync.execute_sync_push(sync_router.PushRequest(
                decks=[{'id': -1, 'name': 'New'}], cards=[self.payload(self.legacy), self.payload()]), 1),
            lambda: text_update.apply_text_update(self.other.id, 1, [items[1]], 'stale', str(uuid4())),
            lambda: text_update.apply_folder_text_update(self.folder.id, 1, items, 'stale', str(uuid4()))]
        for operation in operations:
            statements = []
            database.connection().set_trace_callback(statements.append)
            try:
                self.blocked(operation)
            finally:
                database.connection().set_trace_callback(None)
            self.assertEqual([sql for sql in statements if re.match(r'\s*(INSERT|UPDATE|DELETE)\b', sql, re.I)], [])

    def test_bulk_new_card_receipt_rechecks_saved_ids_on_retry(self):
        payload = [{'deck_id': self.deck.id, 'front': 'New', 'back': 'A'}]
        request_id = str(uuid4())
        result = cards.bulk_save_cards(payload, 1, request_id)
        self.assertEqual(cards.bulk_save_cards(payload, 1, request_id), result)
        self.make_native(result['cards'][0]['id'])
        self.blocked(lambda: cards.bulk_save_cards(payload, 1, request_id))

    def test_guard_error_inside_bulk_is_never_partial_success(self):
        original = cards.save_card
        def late_block(data, *args, **kwargs):
            if data.get('front') == 'late':
                raise guard.LegacyCardWriteBlocked()
            return original(data, *args, **kwargs)
        payload = [{'deck_id': self.deck.id, 'front': front, 'back': 'A'} for front in ('first', 'late')]
        with patch.object(cards, 'save_card', side_effect=late_block):
            self.blocked(lambda: cards.bulk_save_cards(payload, 1, str(uuid4())))

    def test_legacy_only_bulk_keeps_partial_success_and_receipt(self):
        private = models.TMA_Deck.create(user_id=2, name='Private')
        forbidden = models.TMA_Card.create(deck=private, front_text='Private', back_text='A')
        payload = [{'deck_id': self.deck.id, 'front': 'First', 'back': 'A'},
                   self.payload(forbidden), {'deck_id': self.deck.id, 'front': 'Last', 'back': 'A'}]
        request_id = str(uuid4())
        result = cards.bulk_save_cards(payload, 1, request_id)
        self.assertEqual((result['created_count'], result['failed_count']), (2, 1))
        self.assertEqual(cards.bulk_save_cards(payload, 1, request_id), result)
        self.assertEqual(models.TMA_Card.get_by_id(forbidden.id).front_text, 'Private')

    def test_both_sync_paths_reject_mixed_batch_before_any_mutation(self):
        for route in ('/sync/push', '/sync/v2/push'):
            payload = {'request_id': str(uuid4()),
                'folders': [{'id': -10, 'name': 'New folder'}],
                'decks': [{'id': self.deck.id, 'name': 'Changed deck'},
                          {'id': -11, 'name': 'New deck', 'folder_id': -10}],
                'cards': [self.payload(self.legacy), self.payload(id=-12, deck_id=-11), self.payload()],
                'progress': [{'card_id': self.legacy.id, 'queue': 'new', 'interval': 0,
                              'ease_factor': 1.3, 'repetitions': 0, 'lapses': 0}],
                'reviews': [{'card_id': self.native.id, 'rating': 2, 'review_time': '2026-10-01T12:00:00Z',
                             'scheduled_interval': 0}]}
            for _ in range(2):
                before = self.snapshot()
                result = self.client.post(route, json=payload)
                self.assertEqual(result.status_code, 409, result.text)
                self.assertEqual(result.json()['detail']['code'], 'legacy_card_write_blocked')
                self.assertEqual(self.snapshot(), before)

    def test_sync_tombstones_stale_timestamps_and_duplicate_targets_are_blocked(self):
        for request_type, operation in [(sync_router.PushRequest, legacy_sync.execute_sync_push),
                                        (sync_router.OfflinePushRequest, offline.push_offline)]:
            request = request_type(request_id=uuid4(), cards=[
                self.payload(is_deleted=True, updated_at='2000-01-01T00:00:00Z'), self.payload()])
            self.blocked(lambda: operation(request, 1))

    def test_offline_replay_resolves_temp_id_to_now_native_row(self):
        request = sync_router.OfflinePushRequest(request_id=uuid4(), cards=[self.payload(id=-33)])
        result = offline.push_offline(request, 1)
        self.assertEqual(offline.push_offline(request, 1), result)
        self.make_native(result['mappings']['cards']['-33'])
        self.blocked(lambda: offline.push_offline(request, 1))

    def test_pure_progress_and_review_are_allowed_without_content_writes(self):
        before = database.execute_sql('SELECT * FROM tma_card ORDER BY id').fetchall()
        request = sync_router.OfflinePushRequest(request_id=uuid4(),
            progress=[{'card_id': self.native.id, 'queue': 'review', 'interval': 20,
                       'ease_factor': 2.5, 'repetitions': 5, 'lapses': 0}],
            reviews=[{'card_id': self.native.id, 'rating': 3, 'review_time': '2026-10-01T12:00:00Z',
                      'scheduled_interval': 19}])
        result = offline.push_offline(request, 1)
        self.assertEqual(offline.push_offline(request, 1), result)
        self.assertEqual(models.TMAReviewHistory.select().count(), 3)
        self.assertEqual(database.execute_sql('SELECT * FROM tma_card ORDER BY id').fetchall(), before)

    def test_text_preview_and_apply_reject_native_and_mixed_folder(self):
        items = [self.item(self.legacy, front='Legacy change'), self.item(self.native, number=2)]
        self.blocked(lambda: text_update.preview_text_update(self.other.id, 1, [items[1]]))
        self.blocked(lambda: text_update.apply_text_update(self.other.id, 1, [items[1]], 'stale', str(uuid4())))
        self.blocked(lambda: text_update.preview_folder_text_update(self.folder.id, 1, items))
        request_id = str(uuid4())
        for _ in range(2):
            self.blocked(lambda: text_update.apply_folder_text_update(
                self.folder.id, 1, items, 'stale', request_id, include_new=True))

    def test_stale_text_preview_and_success_receipt_recheck_version(self):
        items = [self.item(self.legacy, front='Updated legacy')]
        preview = text_update.preview_text_update(self.deck.id, 1, items)
        request_id = str(uuid4())
        result = text_update.apply_text_update(self.deck.id, 1, items, preview['preview_token'], request_id)
        self.assertEqual(text_update.apply_text_update(self.deck.id, 1, items,
                         preview['preview_token'], request_id), result)
        self.make_native(self.legacy.id)
        self.blocked(lambda: text_update.apply_text_update(self.deck.id, 1, items,
                     preview['preview_token'], request_id))
        self.blocked(lambda: text_update.apply_text_update(self.deck.id, 1, items,
                     preview['preview_token'], str(uuid4())))

    def test_folder_success_receipt_rechecks_version(self):
        items = [self.item(self.legacy, front='Updated legacy')]
        preview = text_update.preview_folder_text_update(self.folder.id, 1, items)
        request_id = str(uuid4())
        result = text_update.apply_folder_text_update(self.folder.id, 1, items, preview['preview_token'], request_id)
        self.assertEqual(text_update.apply_folder_text_update(self.folder.id, 1, items,
                         preview['preview_token'], request_id), result)
        self.make_native(self.legacy.id)
        self.blocked(lambda: text_update.apply_folder_text_update(self.folder.id, 1, items,
                     preview['preview_token'], request_id))

    def test_unknown_version_fails_closed(self):
        self.make_native(self.native.id, version=99)
        self.blocked(lambda: cards.save_card(self.payload(), 1))

    def test_invalid_native_json_is_not_reinterpreted_as_legacy(self):
        database.execute_sql('UPDATE tma_card SET content_v2=? WHERE id=?', ('broken JSON', self.native.id))
        with patch.object(cards, '_save_legacy_card', side_effect=AssertionError('legacy parser reached')):
            self.blocked(lambda: cards.save_card(self.payload(), 1))

    def test_many_ids_are_all_checked_even_across_query_chunks(self):
        with database.atomic():
            self.blocked(lambda: guard.require_legacy_cards([*range(-700, 0), self.native.id]))

    def test_legacy_marker_text_does_not_define_version(self):
        cards.save_card({'id': self.legacy.id, 'front': '@free\n[[literal]]', 'card_type': 'free_text'}, 1)
        self.assertEqual(models.TMA_Card.get_by_id(self.legacy.id).front_text, '@free\n[[literal]]')

    def test_missing_columns_legacy_save_bulk_sync_and_text_update(self):
        if 'content_version' in models.TMA_Card._meta.fields:
            self.skipTest('Pre-migration database uses the default flag-off model')
        for name in ('content_version', 'content_v2', 'card_revision'):
            database.execute_sql(f'ALTER TABLE tma_card DROP COLUMN {name}')
        cards.save_card({'id': self.legacy.id, 'front': 'Edited'}, 1)
        self.assertEqual(cards.bulk_save_cards([{'deck_id': self.deck.id, 'front': 'New', 'back': 'A'}], 1)['created'], 1)
        for request_type, operation in [(sync_router.PushRequest, legacy_sync.execute_sync_push),
                                        (sync_router.OfflinePushRequest, offline.push_offline)]:
            request = request_type(request_id=uuid4(), cards=[self.payload(self.legacy, updated_at='2099-01-01T00:00:00Z')])
            self.assertEqual(operation(request, 1)['status'], 'success')
        items = [self.item(self.legacy, front='Text updated')]
        preview = text_update.preview_text_update(self.deck.id, 1, items)
        self.assertEqual(text_update.apply_text_update(self.deck.id, 1, items,
                         preview['preview_token'], str(uuid4()))['updated'], 1)


if __name__ == '__main__':
    unittest.main()
