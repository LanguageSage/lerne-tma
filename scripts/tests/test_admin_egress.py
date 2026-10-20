"""Offline query/transfer regressions. No remote DB, no persistent SQLite."""
import asyncio
import json
import os
import subprocess
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from peewee import SqliteDatabase
from fastapi.testclient import TestClient

from api import models
from api.utils.storage_keys import storage_key
from tools.admin.services import diagnostics as diag
from tools.admin.routers import decks, folders, users, cards, media
from tools.admin import server
from scripts import migrate_images_to_storage as migration


TABLES = [models.TMAUser, models.TMA_Folder, models.TMA_Deck, models.TMA_Card,
          models.LibraryCategory, models.Deck, models.Card, models.TMAMedia]


class OfflineDatabase(unittest.TestCase):
    def setUp(self):
        self.previous = models.tma_db.obj, models.lerne_db.obj
        self.db = SqliteDatabase(':memory:', thread_safe=False, check_same_thread=False)
        models.tma_db.initialize(self.db)
        models.lerne_db.initialize(self.db)
        self.db.create_tables(TABLES)
        self.addCleanup(self.restore)
        diag.invalidate()

    def restore(self):
        self.db.close()
        models.tma_db.initialize(self.previous[0])
        models.lerne_db.initialize(self.previous[1])
        diag.invalidate()

    def measure(self, call):
        diag.instrument_database(self.db)
        metrics = dict(queries=0, rows=0, read_bytes=0, sql_ms=0.0)
        token = diag.current.set(metrics)
        try:
            result = call()
        finally:
            diag.current.reset(token)
        metrics['response_bytes'] = len(json.dumps(result, ensure_ascii=False).encode())
        return result, metrics


class AdminEgressTests(OfflineDatabase):
    def seed(self, count=120):
        models.TMAUser.create(user_id=1, first_name='Example', phone='PRIVATE_PHONE', is_guest=False)
        folder = models.TMA_Folder.create(user_id=1, name='Folder')
        deck = models.TMA_Deck.create(user_id=1, name='Deck', folder=folder)
        models.TMAMedia.create(folder='audio', filename='test.mp3', content=b'audio')
        for index in range(count):
            models.TMA_Card.create(deck=deck, front_text=f'Front {index}', back_text='Back',
                context='🎯 📖 ' + ('payload ' * 2000), image_data=b'x' * 32768,
                audio_path='test.mp3', tags='["B1"]', metadata='{"version":2,"parts":[{"id":"p1"}]}')
        return deck

    def test_preview_bounded_pages_and_constant_queries(self):
        deck = self.seed()
        data, cold = self.measure(lambda: decks.get_deck_cards(str(deck.id), limit=20))
        self.assertEqual(len(data['cards']), 20)
        self.assertEqual(data['deck']['card_count'], 120)
        self.assertEqual(data['deck']['with_audio_count'], 120)
        self.assertLessEqual(cold['queries'], 3)
        self.assertLess(cold['read_bytes'], 100000)
        self.assertNotIn('image_data', data['cards'][0])
        self.assertLessEqual(len(data['cards'][0]['context']), 240)
        second, warm = self.measure(lambda: decks.get_deck_cards(str(deck.id), page=2, limit=20))
        self.assertEqual(warm['queries'], 0)
        self.assertFalse({c['id'] for c in data['cards']} & {c['id'] for c in second['cards']})
        # Search must reach full text beyond the snippet and across pages.
        models.TMA_Card.update(context='x' * 300 + ' needle').where(models.TMA_Card.id == 120).execute()
        found = decks.get_deck_cards(str(deck.id), search='needle')
        self.assertEqual([c['id'] for c in found['cards']], [120])
        self.assertEqual(decks.get_deck_cards(str(deck.id), mode='missing_audio')['total'], 0)

    def test_lazy_detail_preserves_v2_and_library_id_collision(self):
        deck = self.seed(1)
        lib = models.Deck.create(name='Library')
        models.Card.create(id=1, deck=lib, front_text='Library front', back_text='Library back', context='full ' * 300)
        response = cards.get_card_detail(1, 'lib_1')
        self.assertEqual(response['front'], 'Library front')
        cards.update_card_endpoint(1, cards.UpdateCardRequest(front_text='Edited'), deck_id='lib_1')
        self.assertEqual(models.Card.get_by_id(1).front_text, 'Edited')
        self.assertEqual(models.TMA_Card.get_by_id(1).front_text, 'Front 0')
        cards.update_card_endpoint(1, cards.UpdateCardRequest(context='Changed'), deck_id=str(deck.id))
        self.assertEqual(json.loads(models.TMA_Card.get_by_id(1).metadata)['version'], 2)
        self.assertEqual(len(models.TMA_Card.get_by_id(1).image_data), 32768)

    def test_cyrillic_image_redirect_and_download_use_stable_key(self):
        name = 'Без названия.png'
        models.TMAMedia.create(folder='images', filename=name, content=None)
        with patch.dict(os.environ, SUPABASE_URL='https://example.invalid'):
            response = media.get_admin_image(name)
            self.assertTrue(response.headers['location'].endswith(storage_key(name)))
            from api.routers import media as tma_media
            with patch.object(tma_media._media_cache, 'get', return_value=None):
                response = tma_media.get_image(name, None)
            self.assertTrue(response.headers['location'].endswith(storage_key(name)))
        with patch.object(media, '_read_image_bytes', return_value=b'image'):
            response = media.download_single_image(name)
            self.assertEqual(response.body, b'image')
            self.assertIn('UTF-8', response.headers['content-disposition'])

    def test_lists_pagination_search_stats_and_cache_invalidation(self):
        self.seed(2)
        for index in range(2, 8):
            models.TMAUser.create(user_id=index, first_name=f'Name {index}', is_guest=index % 2 == 0)
            models.TMA_Deck.create(user_id=index, name=f'Deck {index}')
            models.TMA_Folder.create(user_id=index, name=f'Folder {index}')
        _, initial = self.measure(lambda: users.get_users(limit=2))
        data, warm = self.measure(lambda: users.get_users(page=2, limit=2))
        self.assertEqual(data['total_count'], 7)
        self.assertEqual(len(data['users']), 2)
        self.assertEqual(warm['queries'], 0)
        self.assertNotIn('PRIVATE_PHONE', json.dumps(data))
        self.assertEqual(users.get_users(search='Name 7')['total'], 1)
        self.assertEqual(folders.get_admin_folders(search='Folder 7')['total'], 1)
        self.assertEqual(decks.get_all_decks(search='Deck 7')['total'], 1)
        self.assertEqual(decks.get_all_decks(limit=2)['total'], 7)
        self.assertEqual(folders.get_admin_folders(limit=2)['stats']['folders'], 7)
        self.assertEqual(len(decks.get_user_decks(1, limit=1)['decks']), 1)
        models.TMAUser.create(user_id=20, first_name='New')
        self.assertEqual(users.get_users()['total_count'], 8)
        with self.assertRaises(Exception):
            decks.get_all_decks(limit=201)
        self.assertGreater(initial['queries'], 0)

    def test_diagnostics_http_contains_numbers_and_templates_only(self):
        self.seed(1)
        previous = server.app.dependency_overrides.copy()
        server.app.dependency_overrides[server.db_session_scope] = lambda: diag.instrument_database(self.db)
        try:
            with TestClient(server.app, base_url='http://127.0.0.1:8050', client=('127.0.0.1', 1234)) as client:
                # No lifespan startup in this app performs remote access when proxies are bound.
                response = client.get('/api/admin/users?search=Example', headers={'Origin': 'http://127.0.0.1:8050'})
                self.assertEqual(response.status_code, 200)
                report = client.get('/api/admin/diagnostics', headers={'Origin': 'http://127.0.0.1:8050'}).json()
                self.assertGreater(report['queries'], 0)
                self.assertGreater(report['response_bytes'], 0)
                self.assertNotIn('Example', json.dumps(report))
                self.assertNotIn('PRIVATE_PHONE', json.dumps(report))
        finally:
            server.app.dependency_overrides.clear()
            server.app.dependency_overrides.update(previous)

    def test_offline_before_after_report(self):
        deck = self.seed()
        # Execute baseline functions directly from HEAD with the same in-memory fixture.
        baseline = subprocess.check_output(['git', 'show', '0ffd2b37318ce741d2706385fd1a3823ce39b7f4:tools/admin/routers/decks.py'], text=True, encoding='utf-8')
        namespace = {'__name__': 'baseline_admin_decks'}
        exec(compile(baseline, '<baseline>', 'exec'), namespace)
        before, old = self.measure(lambda: namespace['get_deck_cards'](str(deck.id)))
        after, new = self.measure(lambda: decks.get_deck_cards(str(deck.id), limit=50))
        _, warm = self.measure(lambda: decks.get_deck_cards(str(deck.id), page=2, limit=50))
        self.assertEqual(before['total'], after['deck']['card_count'])
        self.assertLess(new['queries'], old['queries'] / 10)
        self.assertLess(new['read_bytes'], old['read_bytes'] / 10)
        print('OFFLINE_PREVIEW_BENCHMARK ' + json.dumps({'before': old, 'after_cold': new, 'after_warm': warm}))

    def test_list_before_after_report(self):
        self.seed(1)
        for number in range(2, 62):
            models.TMAUser.create(user_id=number, first_name=f'Fixture {number}', is_guest=False)
            folder = models.TMA_Folder.create(user_id=number, name=f'Folder {number}')
            models.TMA_Deck.create(user_id=number, folder=folder, name=f'Deck {number}')
        for name, function in (('users', 'get_users'), ('decks', 'get_all_decks'), ('folders', 'get_admin_folders')):
            baseline = subprocess.check_output(['git', 'show',
                f'0ffd2b37318ce741d2706385fd1a3823ce39b7f4:tools/admin/routers/{name}.py'], text=True, encoding='utf-8')
            namespace = {'__name__': f'baseline_{name}'}
            exec(compile(baseline, '<baseline>', 'exec'), namespace)
            _, old = self.measure(namespace[function])
            target = getattr({'users': users, 'decks': decks, 'folders': folders}[name], function)
            data, cold = self.measure(target)
            _, warm = self.measure(lambda: target(page=2))
            self.assertEqual(len(data[name]), 50)
            self.assertEqual(warm['queries'], 0)
            self.assertLess(cold['response_bytes'], old['response_bytes'])
            self.assertLess(cold['read_bytes'], old['read_bytes'])
            print('OFFLINE_LIST_BENCHMARK ' + name + ' ' + json.dumps({'before': old, 'after_cold': cold, 'after_warm': warm}))


class Response:
    def __init__(self, status, content=b''):
        self.status = status
        self.content = self
        self.raw = content

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def read(self, size):
        chunk, self.raw = self.raw[:size], self.raw[size:]
        return chunk


class Session:
    def __init__(self, status=400, data=b'image', verify_status=200):
        self.status, self.data, self.verify_status = status, data, verify_status
        self.posts, self.gets = 0, 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    def post(self, *args, **kwargs):
        self.posts += 1
        return Response(self.status)

    def get(self, *args, **kwargs):
        self.gets += 1
        return Response(self.verify_status, self.data)


class MigrationTests(OfflineDatabase):
    def run_migration(self, session, **kwargs):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ,
                SUPABASE_URL='https://example.invalid', SUPABASE_KEY='not-a-real-key'), \
                patch.object(migration.aiohttp, 'ClientSession', return_value=session):
            report = asyncio.run(migration.migrate(initialize=False, clear_content=True, report_path=str(Path(directory) / 'report.json'), **kwargs))
            self.assertEqual(report, json.loads((Path(directory) / 'report.json').read_text()))
            return report

    def test_repeated_400_advances_and_retains_every_blob(self):
        for n in range(4):
            models.TMAMedia.create(folder='images', filename=f'{n}.png', content=b'image')
        session = Session(400, verify_status=404)
        report = self.run_migration(session, max_records=3)
        self.assertEqual(report['processed'], 3)
        self.assertEqual(len(report['failed']), 3)
        self.assertEqual(session.posts, 3)
        self.assertEqual(report['stop'], 'record_limit')
        self.assertEqual(models.TMAMedia.select().where(models.TMAMedia.content.is_null(False)).count(), 4)

    def test_transient_errors_have_finite_attempts(self):
        models.TMAMedia.create(folder='images', filename='a.png', content=b'image')
        with patch.object(migration.asyncio, 'sleep', new=async_noop):
            session = Session(500)
            report = self.run_migration(session, attempts=2)
        self.assertEqual(session.posts, 2)
        self.assertEqual(len(report['failed']), 1)

    def test_byte_limit_before_blob_download_or_upload(self):
        models.TMAMedia.create(folder='images', filename='a.png', content=b'image' * 100)
        session = Session(200)
        report = self.run_migration(session, max_bytes=10)
        self.assertEqual(report['stop'], 'byte_limit')
        self.assertEqual(session.posts, 0)
        self.assertEqual(report['bytes_reserved'], 0)

    def test_default_run_verifies_without_clearing_source(self):
        item = models.TMAMedia.create(folder='images', filename='a.png', content=b'image')
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ,
                SUPABASE_URL='https://example.invalid', SUPABASE_KEY='test'), \
                patch.object(migration.aiohttp, 'ClientSession', return_value=Session(200)):
            report = asyncio.run(migration.migrate(initialize=False, report_path=str(Path(directory) / 'report.json')))
        self.assertEqual(report['verified'], 1)
        self.assertEqual(report['migrated'], 0)
        self.assertEqual(models.TMAMedia.get_by_id(item.id).content, b'image')

    def test_unavailable_storage_and_concurrent_change_preserve_source(self):
        item = models.TMAMedia.create(folder='images', filename='a.png', content=b'image')
        self.run_migration(Session(200, verify_status=404), attempts=1)
        self.assertEqual(models.TMAMedia.get_by_id(item.id).content, b'image')
        session = Session(200)
        original = session.get

        def concurrent_get(*args, **kwargs):
            models.TMAMedia.update(content=b'new image').where(models.TMAMedia.id == item.id).execute()
            return original(*args, **kwargs)

        session.get = concurrent_get
        report = self.run_migration(session)
        self.assertEqual(report['failed'][0]['reason'], 'concurrent_change')
        self.assertEqual(models.TMAMedia.get_by_id(item.id).content, b'new image')

    def test_invalid_limits_and_deadline(self):
        with self.assertRaises(ValueError):
            asyncio.run(migration.migrate(max_records=0))
        models.TMAMedia.create(folder='images', filename='a.png', content=b'image')
        with patch.object(migration, 'time', types.SimpleNamespace(monotonic=iter([0, 2]).__next__)):
            report = self.run_migration(Session(200), max_seconds=1)
        self.assertEqual(report['stop'], 'time_limit')
        self.assertEqual(report['processed'], 0)

    def test_retry_bytes_and_verification_failure_keep_source(self):
        item = models.TMAMedia.create(folder='images', filename='a.png', content=b'image')
        report = self.run_migration(Session(200, data=b'wrong'))
        self.assertEqual(report['failed'][0]['reason'], 'verify_checksum_mismatch')
        self.assertEqual(models.TMAMedia.get_by_id(item.id).content, b'image')
        report = self.run_migration(Session(500), max_bytes=10)
        self.assertEqual(report['stop'], 'byte_limit')

    def test_cyrillic_verified_rerun_keeps_all_references(self):
        name = 'Без названия.png'
        models.TMAMedia.create(folder='images', filename=name, content=b'image')
        folder = models.TMA_Deck.create(user_id=1, name='Deck')
        card = models.TMA_Card.create(deck=folder, front_text=f'![x]({name})', back_text='x',
            image_path=name, metadata=json.dumps({'version': 2, 'image': name}))
        self.assertTrue(storage_key(name).isascii())
        self.assertEqual(storage_key('old file.png'), 'old file.png')
        self.assertEqual(self.run_migration(Session(409))['migrated'], 1)
        second = Session(200)
        self.assertEqual(self.run_migration(second)['processed'], 0)
        self.assertEqual(second.posts, 0)
        self.assertEqual(models.TMA_Card.get_by_id(card.id).image_path, name)
        self.assertEqual(models.TMA_Card.get_by_id(card.id).metadata, card.metadata)
        self.assertEqual(models.TMAMedia.get().filename, name)


async def async_noop(*args):
    pass


if __name__ == '__main__':
    unittest.main()
