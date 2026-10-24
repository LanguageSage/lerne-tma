"""Offline query/transfer regressions. No remote DB, no persistent SQLite."""
import asyncio
import json
import os
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from peewee import SqliteDatabase

from api import models
from api.utils.storage_keys import storage_key
from scripts import migrate_images_to_storage as migration
from scripts.tests.test_local_dev import SyntheticDirectory


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

    def restore(self):
        self.db.close()
        models.tma_db.initialize(self.previous[0])
        models.lerne_db.initialize(self.previous[1])


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
        with SyntheticDirectory() as directory, patch.dict(os.environ,
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
        with SyntheticDirectory() as directory, patch.dict(os.environ,
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
