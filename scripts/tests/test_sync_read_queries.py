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
from api.routers.sync import OfflinePushRequest, PushRequest
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


@contextmanager
def services_at_ref(ref):
    """Load only the old service code; models, data and dependencies stay equal."""
    names = ['collaborative_service', 'sync_service', 'offline_sync']
    with patch.dict(sys.modules):
        with patch.multiple('api.services', **{name: None for name in names}):
            loaded = {}
            for name in names:
                source = subprocess.run(
                    ['git', 'show', f'{ref}:api/services/{name}.py'], cwd=ROOT,
                    check=True, capture_output=True, encoding='utf-8').stdout
                module = types.ModuleType(f'api.services.{name}')
                module.__package__ = 'api.services'
                sys.modules[module.__name__] = module
                setattr(importlib.import_module('api.services'), name, module)
                exec(compile(source, f'{ref}/{name}.py', 'exec'), module.__dict__)
                loaded[name] = module
            yield loaded


class SyncFixture(unittest.TestCase):
    def setUp(self):
        self.db = SqliteDatabase(':memory:', pragmas={'foreign_keys': 1},
                                 thread_safe=False, check_same_thread=False)
        self.previous = models.tma_db.obj, models.lerne_db.obj
        models.tma_db.initialize(self.db)
        models.lerne_db.initialize(self.db)
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
                card = models.TMA_Card.create(deck=deck, front_text=f'Front {i}', back_text='Back',
                    context='Context', image_data=self.blob, image_path='old.png', audio_path='old.mp3',
                    tags='["A1"]', metadata='{"kind":"quiz"}', card_type='quiz', history='["keep"]',
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

    @staticmethod
    def pulls(services=None):
        services = services or {'offline_sync': offline_sync, 'sync_service': sync_service,
                                'collaborative_service': collaborative_service}

        def collab(uid):
            result = services['sync_service'].execute_collab_pull(SINCE, uid)
            # Include the router's access-version query in endpoint accounting.
            result['access_version'] = services['collaborative_service'].get_access_version(uid)
            return result

        return {
            'v2': lambda uid: services['offline_sync'].pull_offline(uid),
            'legacy': lambda uid: services['sync_service'].execute_sync_pull(SINCE, uid),
            'collab': collab,
        }


class SyncReadTests(SyncFixture):
    def test_http_pull_routes_keep_their_contracts_and_light_queries(self):
        app = FastAPI()
        app.include_router(sync_router.router)
        app.dependency_overrides[get_user_id] = lambda: 1
        for path in ('/sync/v2/pull', '/sync/pull', '/sync/collab-pull'):
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
            for kind, pull in self.pulls().items():
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
                    self.assertTrue(all('metadata' in c and 'tags' in c for c in data['cards']))
                elif kind == 'legacy':
                    self.assertEqual({d['id'] for d in data['decks']},
                        {d.id for d in [*self.decks, self.hidden_deck, self.deleted_shared] if d.user_id == uid})
                if 'progress' in data:
                    self.assertTrue(all(p['flag'] == 3 and p['interval'] == 7 for p in data['progress']))

    def test_pull_query_count_does_not_grow_with_cards_or_folder_expansion(self):
        for kind, pull in self.pulls().items():
            with capture_reads(self.db) as small:
                pull(1)
            for i in range(8):
                models.TMA_Card.create(deck=self.decks[0], front_text=f'Extra {kind} {i}', back_text='x', updated_at=NOW)
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

    def test_push_preserves_unselected_content_and_media_rules(self):
        card = models.TMA_Card.get(models.TMA_Card.deck_id == self.decks[0].id)
        for kind in ('v2', 'legacy'):
            values = {'cards': [{'id': card.id, 'deck_id': card.deck_id, 'front_text': kind,
                'back_text': 'Changed', 'updated_at': '2099-01-01T00:00:00Z', 'image_path': None}]}
            with capture_reads(self.db) as reads:
                if kind == 'v2':
                    offline_sync.push_offline(OfflinePushRequest(request_id=uuid4(), **values), 1)
                else:
                    sync_service.execute_sync_push(PushRequest(**values), 1)
            self.assert_light_reads(reads)
            actual = models.TMA_Card.get_by_id(card.id)
            self.assertEqual(actual.front_text, kind)
            self.assertEqual(actual.image_data, self.blob)
            self.assertEqual(actual.history, '["keep"]')
            self.assertEqual(actual.source, 'library')
            self.assertEqual(actual.creator_id, 2)
            self.assertEqual(actual.tags, '["A1"]')
            self.assertEqual(actual.metadata, '{"kind":"quiz"}')
            self.assertEqual(actual.card_type, 'quiz')
            self.assertEqual(actual.audio_path, 'old.mp3')
            self.assertIsNone(actual.image_path)
        # Legacy preserves an existing media path when the client omits it.
        models.TMA_Card.update(image_path='preserve.png').where(models.TMA_Card.id == card.id).execute()
        sync_service.execute_sync_push(PushRequest(cards=[dict(values['cards'][0], updated_at='2100-01-01')]), 1)
        self.assertEqual(models.TMA_Card.get_by_id(card.id).image_path, 'preserve.png')

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
        self.assertEqual(error.exception.status_code, 403)

    def test_postgres_projection_compiles_without_connecting(self):
        pg = PostgresqlDatabase('never-connect')
        fields = [getattr(models.TMA_Card, f) for f in offline_sync.PULL_FIELDS['cards']]
        for projection in (fields, sync_service.CARD_PULL_FIELDS, sync_service.CARD_PUSH_FIELDS):
            sql, params = models.TMA_Card.select(*projection).where(models.TMA_Card.deck_id == 42).bind(pg).sql()
            self.assertNotIn('"image_data"', sql)
            self.assertIn('%s', sql)
            self.assertEqual(params, [42])

    def test_legacy_study_uses_one_card_lookup_and_viewer_cannot_edit(self):
        cards = list(models.TMA_Card.select(models.TMA_Card.id).where(models.TMA_Card.deck_id == self.shared_deck.id))
        request = PushRequest(progress=[{'card_id': c.id, 'queue': 'review', 'interval': 10,
            'ease_factor': 2.5, 'repetitions': 2, 'lapses': 0, 'updated_at': '2099-01-01'} for c in cards])
        with capture_reads(self.db) as reads:
            sync_service.execute_sync_push(request, 3)
        self.assert_light_reads(reads)
        self.assertEqual(sum('FROM "tma_card"' in r['sql'] for r in reads), 1)
        with self.assertRaises(HTTPException) as error:
            sync_service.execute_sync_push(PushRequest(cards=[{'id': cards[0].id,
                'deck_id': self.shared_deck.id, 'front_text': 'Forbidden', 'back_text': 'x'}]), 3)
        self.assertEqual(error.exception.status_code, 403)


if '--compare-ref' in sys.argv:
    class SyncBaselineComparison(SyncFixture):
        # Only the comparison is needed here; regular regressions run above.
        def test_compare_baseline(self):
            ref = sys.argv[sys.argv.index('--compare-ref') + 1]
            self.db.drop_tables(TABLES)
            self.db.create_tables(TABLES)
            self.make_fixture(cards_per_deck=4, blob_size=1024 * 1024)
            owned_cards = list(models.TMA_Card.select(models.TMA_Card.id).where(
                models.TMA_Card.deck_id == self.decks[0].id))
            shared_cards = list(models.TMA_Card.select(models.TMA_Card.id).where(
                models.TMA_Card.deck_id == self.shared_deck.id))
            card_changes = [{'id': c.id, 'deck_id': self.decks[0].id, 'front_text': 'Edited',
                             'back_text': 'Changed', 'updated_at': '2099-01-01'} for c in owned_cards]
            study_changes = [{'card_id': c.id, 'queue': 'review', 'interval': 10,
                'ease_factor': 2.5, 'repetitions': 2, 'lapses': 0, 'updated_at': '2099-01-01'} for c in shared_cards]
            push_cases = {
                'v2_push': ('offline_sync', OfflinePushRequest(request_id=uuid4(), cards=card_changes), 1),
                'legacy_push': ('sync_service', PushRequest(cards=card_changes), 1),
                'v2_study': ('offline_sync', OfflinePushRequest(request_id=uuid4(), progress=study_changes,
                    reviews=[{'card_id': c.id, 'rating': 3, 'review_time': NOW.isoformat(), 'scheduled_interval': 10}
                             for c in shared_cards for _ in range(3)]), 3),
                'legacy_study': ('sync_service', PushRequest(progress=study_changes), 3),
            }

            def measure_push(services, case):
                module, request, uid = case
                handler = services[module].push_offline if module == 'offline_sync' else services[module].execute_sync_push
                with self.db.atomic() as transaction:
                    with capture_reads(self.db) as reads:
                        result = handler(request, uid)
                    transaction.rollback()  # The next implementation sees exactly the same data.
                return result, reads

            def changed_foreign_folder_error(pull):
                with self.db.atomic() as transaction:
                    models.TMA_Folder.update(updated_at=NOW).where(models.TMA_Folder.user_id == 2).execute()
                    with self.assertLogs('api.services.sync_service', level='ERROR'), self.assertRaises(HTTPException) as error:
                        pull(1)
                    transaction.rollback()
                return error.exception.status_code, error.exception.detail

            before = {}
            with services_at_ref(ref) as services:
                for uid in (1, 2, 3, 4):
                    for kind, pull in self.pulls(services).items():
                        with capture_reads(self.db) as reads:
                            data = pull(uid)
                        data.pop('server_time')
                        before[uid, kind] = data, reads
                before_push = {name: measure_push(services, case) for name, case in push_cases.items()}
                old_folder_error = changed_foreign_folder_error(self.pulls(services)['collab'])
            report = {}
            for uid in (1, 2, 3, 4):
                for kind, pull in self.pulls().items():
                    with capture_reads(self.db) as reads:
                        data = pull(uid)
                    data.pop('server_time')
                    expected, old_reads = before[uid, kind]
                    self.assertEqual(data, expected, (uid, kind))
                    if data['cards']:
                        self.assertTrue(any('"image_data"' in r['sql'] and r['rows'] for r in old_reads))
                    self.assert_light_reads(reads)
                    report[f'{uid}/{kind}'] = {
                        'before_queries': len(old_reads), 'after_queries': len(reads),
                        'before_bytes': sum(r['bytes'] for r in old_reads),
                        'after_bytes': sum(r['bytes'] for r in reads),
                    }
                    if uid == 1:
                        report[f'{uid}/{kind}']['before_card_sql'] = next(r['sql'] for r in old_reads if 'FROM "tma_card"' in r['sql'])
                        report[f'{uid}/{kind}']['after_card_sql'] = next(r['sql'] for r in reads if 'FROM "tma_card"' in r['sql'])
            current_services = {'offline_sync': offline_sync, 'sync_service': sync_service}
            for name, case in push_cases.items():
                result, reads = measure_push(current_services, case)
                expected, old_reads = before_push[name]
                self.assertEqual(result, expected)
                self.assert_light_reads(reads)
                report[name] = {'before_queries': len(old_reads), 'after_queries': len(reads),
                    'before_bytes': sum(r['bytes'] for r in old_reads),
                    'after_bytes': sum(r['bytes'] for r in reads)}
            self.assertEqual(changed_foreign_folder_error(self.pulls()['collab']), old_folder_error)
            report['unchanged_foreign_folder_error'] = old_folder_error
            print('\nSYNC_READ_COMPARISON ' + json.dumps(report, ensure_ascii=True), flush=True)
