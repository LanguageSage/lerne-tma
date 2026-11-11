"""Real sync services over disposable SQLite, with cursor-level read accounting.

Run through scripts/test_backend.py. Add --compare-ref <git-ref> to compare the
three sync services with that revision on exactly the same fixture (no network).
Bytes count consumed SQL values, not PostgreSQL wire framing or disk/TOAST I/O.
"""
from contextlib import contextmanager
import datetime as dt
import importlib
import json
from pathlib import Path
import random
import subprocess
import sys
import types
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from peewee import PostgresqlDatabase, SqliteDatabase

from api import models
from api.routers.sync import OfflinePushRequest
from native_fixture import content, sqlite_native
from api.routers import sync as sync_router
from api.dependencies.auth import get_user_id
from api.services import collaborative_service, offline_sync, sync_service

ROOT = Path(__file__).resolve().parents[2]
TABLES = [models.TMAUser, models.TMA_Folder, models.TMA_Deck, models.TMA_Card,
          models.TMAProgress, models.TMAReviewHistory, models.TMAOfflineBatch,
          models.TMASetting, models.TMA_Collaborator, models.TMAMedia]
SINCE = '2026-01-02T00:00:00Z'
NOW = dt.datetime(2026, 1, 3)


@contextmanager
def capture_reads(database):
    """Observe rows actually fetched by Peewee, without issuing extra SELECTs."""
    reads = []
    original = database.execute_sql

    class Cursor:
        def __init__(self, cursor, entry):
            self.cursor, self.entry = cursor, entry

        def __getattr__(self, name):
            return getattr(self.cursor, name)

        def count(self, row):
            if row is not None:
                self.entry['rows'] += 1
                self.entry['bytes'] += sum(
                    len(v) if isinstance(v, (bytes, memoryview)) else
                    len(str(v).encode('utf-8')) if v is not None else 0
                    for v in row)
            return row

        def fetchone(self):
            return self.count(self.cursor.fetchone())

        def fetchmany(self, *args):
            return [self.count(row) for row in self.cursor.fetchmany(*args)]

        def fetchall(self):
            return [self.count(row) for row in self.cursor.fetchall()]

    def execute(sql, params=None, *args, **kwargs):
        cursor = original(sql, params, *args, **kwargs)
        if sql.lstrip().upper().startswith('SELECT'):
            entry = {'sql': sql, 'rows': 0, 'bytes': 0}
            reads.append(entry)
            return Cursor(cursor, entry)
        return cursor

    with patch.object(database, 'execute_sql', execute):
        yield reads




class SyncFixture(unittest.TestCase):
    def setUp(self):
        # The test connection keeps the shared in-memory fixture alive while
        # HTTP handlers open and close their own worker connections.
        self.db = SqliteDatabase(f'file:sync-read-{uuid4().hex}?mode=memory&cache=shared', uri=True,
                                 pragmas={'foreign_keys': 1})
        self.previous = models.tma_db.obj, models.lerne_db.obj
        models.tma_db.initialize(self.db)
        models.lerne_db.initialize(self.db)
        sqlite_native(self, self.db)
        self.db.create_tables(TABLES)
        self.addCleanup(self.cleanup_db)
        self.make_fixture()

    def cleanup_db(self):
        self.db.close()
        models.tma_db.initialize(self.previous[0])
        models.lerne_db.initialize(self.previous[1])

    def make_fixture(self, cards_per_deck=2, blob_size=64 * 1024):
        for uid in (1, 2, 3, 4):
            models.TMAUser.create(user_id=uid, default_decks_initialized=True)
        self.decks = []
        for i in range(6):
            folder = models.TMA_Folder.create(user_id=1, name=f'Owned {i}', updated_at=NOW)
            self.decks.append(models.TMA_Deck.create(user_id=1, folder=folder,
                name=f'Owned {i}', metadata='{"is_learning":true,"resources":[]}', updated_at=NOW))
        shared = models.TMA_Folder.create(user_id=2, name='Shared', updated_at=dt.datetime(2026, 1, 1))
        child = models.TMA_Folder.create(user_id=2, name='Child', parent=shared,
                                         updated_at=dt.datetime(2026, 1, 1))
        for uid, role in ((1, 'editor'), (3, 'viewer')):
            models.TMA_Collaborator.create(target_type='folder', target_id=shared.id, user_id=uid, role=role)
        self.shared_deck = models.TMA_Deck.create(user_id=2, folder=child, name='Shared', updated_at=NOW)
        self.decks.append(self.shared_deck)
        public = models.TMA_Folder.create(user_id=2, name='Public', access_scope='global_readonly',
                                          updated_at=dt.datetime(2026, 1, 1))
        self.public_deck = models.TMA_Deck.create(user_id=2, folder=public, name='Public', updated_at=NOW)
        self.decks.append(self.public_deck)
        self.direct_deck = models.TMA_Deck.create(user_id=2, name='Direct', updated_at=NOW)
        models.TMA_Collaborator.create(target_type='deck', target_id=self.direct_deck.id, user_id=1, role='viewer')
        self.decks.append(self.direct_deck)
        self.deleted_folder = models.TMA_Folder.create(user_id=1, name='Deleted', is_deleted=True, updated_at=NOW)
        self.deleted_deck = models.TMA_Deck.create(user_id=1, folder=self.deleted_folder,
                                                  name='Deleted', is_deleted=True, updated_at=NOW)
        self.decks.append(self.deleted_deck)
        self.hidden_deck = models.TMA_Deck.create(user_id=2, name='Private', updated_at=NOW)
        self.deleted_shared = models.TMA_Deck.create(user_id=2, folder=child, name='Deleted shared',
                                                    is_deleted=True, updated_at=NOW)
        self.blob = random.Random(0).randbytes(blob_size)
        for deck in [*self.decks, self.hidden_deck, self.deleted_shared]:
            for i in range(cards_per_deck):
                card = models.TMA_Card.create(deck=deck, content_v2=content(f'Front {i}', 'Back', explanation='Context', metadata={'kind': 'standard', 'tags': ['A1']}), card_type=None, image_data=self.blob, image_path='old.png', audio_path='old.mp3',
                    history='["keep"]',
                    source='library', creator_id=2, position=i, is_deleted=(i == 1), updated_at=NOW)
                for uid in (1, 2, 3):
                    models.TMAProgress.create(card_id=card.id, user_id=uid, queue='review',
                        interval=7, flag=3, want_to_learn=True, updated_at=NOW)
        # Explicit personal off/on; the third deck deliberately has no setting.
        models.TMASetting.create(key=f'DECK_LEARNING_1_{self.decks[0].id}', value='0')
        models.TMASetting.create(key=f'DECK_LEARNING_1_{self.decks[1].id}', value='1')

    def assert_light_reads(self, reads):
        self.assertTrue(reads)
        self.assertFalse(any('"image_data"' in row['sql'] for row in reads))
        self.assertFalse(any('"history"' in row['sql'] for row in reads))



class SyncReadTests(SyncFixture):
    def test_http_pull_routes_keep_their_contracts_and_light_queries(self):
        app = FastAPI()
        app.include_router(sync_router.router)
        app.dependency_overrides[get_user_id] = lambda: 1
        for path in ('/sync/v2/pull', '/sync/collab-pull'):
            with TestClient(app) as client, capture_reads(self.db) as reads:
                response = client.get(path, params={'since': SINCE})
            self.assertEqual(response.status_code, 200, response.text)
            self.assert_light_reads(reads)
            data = response.json()
            self.assertIn('server_time', data)
            if path == '/sync/v2/pull':
                self.assertEqual(data['protocol'], 2)
            elif path == '/sync/collab-pull':
                self.assertTrue(data['has_changes'])
                self.assertEqual(data['access_version'], collaborative_service.get_access_version(1))

    def test_pull_permissions_tombstones_progress_and_wire_fields(self):
        for uid in (1, 2, 3, 4):
            for kind, pull in {'v2': offline_sync.pull_offline}.items():
                with self.subTest(uid=uid, kind=kind), capture_reads(self.db) as reads:
                    data = pull(uid)
                self.assert_light_reads(reads)
                if data['cards']:
                    self.assertTrue(any(c['is_deleted'] for c in data['cards']))
                if kind == 'v2':
                    decks = {d['id']: d for d in data['decks']}
                    self.assertEqual(decks[self.public_deck.id]['role'], 'owner' if uid == 2 else 'viewer')
                    self.assertEqual(self.deleted_shared.id in decks, uid == 2)
                    self.assertEqual(self.shared_deck.id in decks, uid in (1, 2, 3))
                    if uid == 1:
                        self.assertEqual(decks[self.shared_deck.id]['role'], 'editor')
                        self.assertEqual(decks[self.direct_deck.id]['role'], 'viewer')
                        self.assertIn(self.deleted_deck.id, decks)
                        self.assertFalse(decks[self.decks[0].id]['is_learning'])
                        self.assertTrue(decks[self.decks[1].id]['is_learning'])
                        self.assertFalse(decks[self.decks[2].id]['is_learning'])
                    elif uid == 2:
                        self.assertFalse(decks[self.shared_deck.id]['is_learning'])
                    self.assertTrue(all(p['user_id'] == uid for p in data['progress']))
                    self.assertTrue(all('content_v2' in c and 'front_text' not in c for c in data['cards']))
                    self.assertTrue(all(c['content_v2']['card']['metadata']['tags'] == ['A1'] for c in data['cards']))
                elif kind == 'legacy':
                    self.assertEqual({d['id'] for d in data['decks']},
                        {d.id for d in [*self.decks, self.hidden_deck, self.deleted_shared] if d.user_id == uid})
                if 'progress' in data:
                    self.assertTrue(all(p['flag'] == 3 and p['interval'] == 7 for p in data['progress']))

    def test_pull_query_count_does_not_grow_with_cards_or_folder_expansion(self):
        for kind, pull in {'v2': offline_sync.pull_offline}.items():
            with capture_reads(self.db) as small:
                pull(1)
            for i in range(8):
                models.TMA_Card.create(deck=self.decks[0], content_v2=content(f'Extra {kind} {i}', 'x'), card_type=None, updated_at=NOW)
                models.TMA_Folder.create(user_id=1, name=f'Extra folder {kind} {i}', updated_at=NOW)
            with capture_reads(self.db) as large:
                pull(1)
            self.assertEqual(len(small), len(large), kind)
            # A single active hierarchy scan per request, even for nested/shared roots.
            hierarchy_reads = [r for r in large if 'FROM "tma_folder"' in r['sql'] and '"access_scope"' in r['sql']]
            self.assertEqual(len(hierarchy_reads), 0 if kind == 'legacy' else 1)
            self.assertEqual(sum('FROM "tma_card"' in r['sql'] for r in large), 1)

    def test_v2_learning_flag_does_not_read_media_from_deck_metadata(self):
        # Raw metadata is transported unchanged; personal settings alone select learning.
        # Distinct paths defeat the media helper's per-filename cache.
        from api.services.media import _check_media_exists
        _check_media_exists.cache_clear()
        for deck in self.decks[:6]:
            models.TMA_Deck.update(metadata=json.dumps({'is_learning': True, 'resources': [
                {'type': 'image', 'path': f'{deck.id}-{i}.png'} for i in range(4)]})).where(
                    models.TMA_Deck.id == deck.id).execute()
            for i in range(4):
                models.TMAMedia.create(filename=f'{deck.id}-{i}.png', folder='images', content=self.blob)
        with capture_reads(self.db) as reads:
            result = offline_sync.pull_offline(1)
        self.assertFalse(any('"tmamedia"' in r['sql'] for r in reads))
        owned = {d['id']: d for d in result['decks']}
        self.assertFalse(owned[self.decks[0].id]['is_learning'])  # Per-user override.
        self.assertTrue(owned[self.decks[1].id]['is_learning'])
        self.assertFalse(owned[self.decks[2].id]['is_learning'])
        self.assertEqual(json.loads(owned[self.decks[1].id]['metadata'])['resources'][0]['path'],
                         f'{self.decks[1].id}-0.png')

    def test_personal_learning_is_independent_for_owner_editor_and_viewer(self):
        from api.services.decks import toggle_deck_learning
        deck_id = self.shared_deck.id  # owner=2, editor=1, viewer=3, outsider=4.
        models.TMA_Deck.update(metadata='{"is_learning":true}').where(models.TMA_Deck.id == deck_id).execute()
        for uid in (1, 2, 3):
            row = next(d for d in offline_sync.pull_offline(uid)['decks'] if d['id'] == deck_id)
            self.assertFalse(row['is_learning'])
        self.assertIsNone(toggle_deck_learning(deck_id, 4, True))
        self.assertTrue(toggle_deck_learning(deck_id, 1, True))
        self.assertTrue(toggle_deck_learning(deck_id, 3, True))
        self.assertFalse(toggle_deck_learning(deck_id, 1, False))
        for uid, expected in ((1, False), (2, False), (3, True)):
            row = next(d for d in offline_sync.pull_offline(uid)['decks'] if d['id'] == deck_id)
            self.assertIs(row['is_learning'], expected)
        self.assertFalse(models.TMASetting.select().where(
            models.TMASetting.key == f'DECK_LEARNING_4_{deck_id}').exists())

    def test_learning_toggle_and_pull_preserve_existing_srs_history_and_content(self):
        from api.services.decks import toggle_deck_learning
        card = models.TMA_Card.get(models.TMA_Card.deck == self.shared_deck.id)
        models.TMAReviewHistory.create(user_id=1, card_id=card.id, rating=3, scheduled_interval=7, review_time=NOW)
        tables = [models.TMA_Deck, models.TMA_Card, models.TMAProgress, models.TMAReviewHistory]
        def snapshot():
            return {model._meta.table_name: list(model.select().order_by(model._meta.primary_key).dicts())
                    for model in tables}
        before = snapshot()
        self.assertTrue(toggle_deck_learning(self.shared_deck.id, 1, True))
        self.assertTrue(toggle_deck_learning(self.shared_deck.id, 3, True))
        active = offline_sync.pull_offline(1)
        self.assertTrue(next(d for d in active['decks'] if d['id'] == self.shared_deck.id)['is_learning'])
        self.assertFalse(toggle_deck_learning(self.shared_deck.id, 1, False))
        paused = offline_sync.pull_offline(1)
        self.assertFalse(next(d for d in paused['decks'] if d['id'] == self.shared_deck.id)['is_learning'])
        self.assertEqual(active['progress'], paused['progress'])
        self.assertEqual(snapshot(), before)


    def test_v2_study_card_lookup_is_batched_and_permissions_are_preserved(self):
        cards = list(models.TMA_Card.select(models.TMA_Card.id).where(models.TMA_Card.deck_id == self.shared_deck.id))
        request = OfflinePushRequest(request_id=uuid4(),
            progress=[{'card_id': c.id, 'queue': 'review', 'interval': 10, 'ease_factor': 2.5,
                       'repetitions': 2, 'lapses': 0} for c in cards],
            reviews=[{'card_id': c.id, 'rating': 3, 'review_time': NOW.isoformat(), 'scheduled_interval': 10}
                     for c in cards for _ in range(3)])
        with capture_reads(self.db) as reads:
            result = offline_sync.push_offline(request, 3)  # viewer may study
        self.assert_light_reads(reads)
        self.assertEqual(result['review_count'], 6)
        self.assertEqual(sum('FROM "tma_card"' in r['sql'] for r in reads), 1)
        self.assertEqual(offline_sync.push_offline(request, 3), result)
        with self.assertRaises(HTTPException) as error:
            offline_sync.push_offline(OfflinePushRequest(request_id=uuid4(), cards=[{
                'id': cards[0].id, 'deck_id': self.shared_deck.id, 'front_text': 'Forbidden', 'back_text': 'x'}]), 3)
        self.assertEqual(error.exception.status_code, 409)

    def test_collaboration_only_invalidates_and_old_route_is_absent(self):
        app = FastAPI()
        app.include_router(sync_router.router)
        app.dependency_overrides[get_user_id] = lambda: 1
        with TestClient(app) as client:
            self.assertEqual(client.get('/sync/pull').status_code, 404)
            self.assertEqual(client.post('/sync/push', json={}).status_code, 404)
        with capture_reads(self.db) as reads:
            result = sync_service.execute_collab_pull(SINCE, 1)
        self.assertEqual(set(result), {'has_changes', 'server_time'})
        self.assertTrue(result['has_changes'])
        self.assert_light_reads(reads)
        self.assertLess(sum(r['bytes'] for r in reads), 20000)

    def test_collaboration_watermark_quiesces_after_native_writes(self):
        models.TMA_Card.update(updated_at=dt.datetime.now()).where(
            models.TMA_Card.deck_id == self.shared_deck.id).execute()
        first = sync_service.execute_collab_pull(SINCE, 1)
        self.assertTrue(first['has_changes'])
        self.assertFalse(sync_service.execute_collab_pull(first['server_time'], 1)['has_changes'])

    def test_postgres_projection_compiles_without_connecting(self):
        pg = PostgresqlDatabase('never-connect')
        fields = [models.TMA_Card.content_v2, models.TMA_Card.id, models.TMA_Card.deck_id]
        sql, params = models.TMA_Card.select(*fields).where(models.TMA_Card.deck_id == 42).bind(pg).sql()
        self.assertNotIn('"image_data"', sql)
        self.assertIn('"content_v2"', sql)
        self.assertIn('%s', sql)
        self.assertEqual(params, [42])


if __name__ == '__main__':
    unittest.main()
