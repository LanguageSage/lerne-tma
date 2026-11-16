"""Synthetic exporter checks; HTTP and database transports are isolated fakes."""
import asyncio
from contextlib import ExitStack
import hashlib
import json
from pathlib import Path
import shutil
import unittest
from unittest.mock import patch
from uuid import uuid4

from tools import backup_supabase_storage as exporter


class Content:
    def __init__(self, data):
        self.data = data

    async def iter_chunked(self, size):
        yield self.data


class Response:
    def __init__(self, data=b'synthetic', status=200):
        self.status = status
        self.content = Content(data)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass


class Session:
    def __init__(self, response=None):
        self.response = response or Response()
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.response


class Connection:
    def close(self):
        pass

    def rollback(self):
        pass

    def set_session(self, **kwargs):
        assert kwargs['readonly'] is True


class StorageExportTests(unittest.TestCase):
    def setUp(self):
        self.root = exporter.ROOT / 'local/test-data' / ('storage-export-test-' + uuid4().hex)
        self.root.mkdir()
        def cleanup():
            assert self.root.resolve().parent == (exporter.ROOT / 'local/test-data').resolve()
            assert self.root.name.startswith('storage-export-test-')
            shutil.rmtree(self.root)
        self.addCleanup(cleanup)

    def test_download_checks_size_and_sha_and_restore_reads_destination(self):
        item = {'bucket': 'audio', 'name': 'nested/ü.mp3', 'size': 9}
        session = Session()
        result = asyncio.run(exporter.download_worker(session, asyncio.Semaphore(1), item, self.root, 'https://storage.invalid'))
        self.assertEqual(result['sha256'], hashlib.sha256(b'synthetic').hexdigest())
        self.assertIn('/authenticated/audio/nested/%C3%BC.mp3', session.calls[0][0])
        self.assertFalse(session.calls[0][1]['allow_redirects'])
        self.assertTrue(exporter.verify_restore(self.root, self.root / 'restore', {'files': [result]}))
        (self.root / 'audio/nested/ü.mp3').write_bytes(b'corrupted')
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            exporter.verify_restore(self.root, self.root / 'second-restore', {'files': [result]})

    def test_size_error_and_access_error_do_not_retry_or_publish_final_file(self):
        for index, response in enumerate((Response(b'wrong'), Response(status=403), Response(status=404), Response(status=500))):
            session = Session(response)
            item = {'bucket': 'images', 'name': f'{index}.webp', 'size': 9}
            with self.assertRaises((RuntimeError, ValueError)):
                asyncio.run(exporter.download_worker(session, asyncio.Semaphore(1), item, self.root, 'https://storage.invalid'))
            self.assertEqual(len(session.calls), 1)
            self.assertFalse((self.root / 'images' / item['name']).exists())

    def test_allowlist_and_path_traversal_windows_aliases(self):
        for bucket, name in (('tma-audio', 'old.mp3'), ('audio', '../outside'), ('audio', '/outside'),
                ('images', 'C:/outside'), ('audio', 'folder\\outside'), ('images', 'foo:stream'),
                ('images', 'folder./file'), ('images', 'CON.webp')):
            with self.assertRaises(ValueError):
                exporter.safe_path(self.root, bucket, name)

    def test_inventory_query_only_reads_active_buckets(self):
        class Cursor:
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
            def execute(self, query, params):
                self.query, self.params = query, params
            def fetchall(self):
                return [('audio', 'file.mp3', 9, 'now')]
        cursor = Cursor()
        class DB:
            def cursor(self):
                return cursor
        self.assertEqual(exporter.get_objects_from_db(DB())[0]['bucket'], 'audio')
        self.assertIn('WHERE bucket_id=ANY', cursor.query)
        self.assertEqual(cursor.params, (['audio', 'images'],))

    def test_nested_v2_and_legacy_resources_and_external_origins(self):
        row = {'id': 7, 'audio_path': 'user_files/old.mp3',
               'image_path': 'images/path with spaces.webp',
               'front_text': '![inline](/api/media/images/inline.webp)',
               'image_data': '\\xabcdef',
               'content_v2': {'card': {'data': {'audio': 'audio/native.mp3'},
                    'media': {'audio_back': {'path': 'nested/back.mp3'}},
                    'layout': [{'type': 'image', 'path': 'nested/native.webp', 'id': 'not-a-media-path'}]}},
               'metadata': json.dumps({'resources': [{'url': 'https://storage.invalid/storage/v1/object/public/images/a.webp'},
                                                     {'url': 'https://external.invalid/a.webp'}]})}
        class Cursor:
            def __init__(self):
                self.count = 0
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
            def execute(self, *args):
                self.count += 1
            def fetchall(self):
                return [('tma_card',)] if self.count == 1 else [(row,)]
        cursor = Cursor()
        class DB:
            def cursor(self):
                return cursor
        refs, uncovered = exporter.media_references(DB(), 'https://storage.invalid')
        self.assertEqual({(r['bucket'], r['name']) for r in refs},
                         {('audio', 'user_files/old.mp3'), ('audio', 'native.mp3'), ('images', 'a.webp'),
                          ('audio', 'nested/back.mp3'), ('images', 'nested/native.webp'),
                          ('images', 'path with spaces.webp'), ('images', 'inline.webp')})
        self.assertEqual(uncovered[0]['reason'], 'external_origin')

    def run_export(self, label, references, failure=None, inventory_changed=False):
        config = {'SUPABASE_DB_URL': 'postgresql://role:secret@db.invalid/app',
                  'SUPABASE_URL': 'https://storage.invalid', 'SUPABASE_KEY': 'secret'}
        item = {'bucket': 'audio', 'name': 'present.mp3', 'size': 9, 'updated_at': 'frozen'}
        output = self.root / label
        restore = self.root / (label + '-restore')
        argv = ['--source-env-file', str(self.root / 'explicit.env'), '--storage-url', config['SUPABASE_URL'],
                '--expected-host', 'db.invalid', '--expected-database', 'app', '--output', str(output),
                '--restore-check', str(restore)]
        async def download(objects, destination, origin, key):
            self.assertEqual(key, 'secret')
            if failure:
                return [failure]
            target = exporter.safe_path(destination, 'audio', 'present.mp3')
            target.parent.mkdir(parents=True)
            target.write_bytes(b'synthetic')
            return [{**item, 'sha256': exporter.digest(target), 'status': 'downloaded_verified'}]
        with ExitStack() as stack:
            stack.enter_context(patch.object(exporter, 'dotenv_values', return_value=config))
            connect = stack.enter_context(patch.object(exporter.psycopg2, 'connect', return_value=Connection()))
            stack.enter_context(patch.object(exporter, 'get_objects_from_db', side_effect=[[item], [] if inventory_changed else [item]]))
            stack.enter_context(patch.object(exporter, 'media_references', return_value=(references, [])))
            stack.enter_context(patch.object(exporter, 'download_all', side_effect=download))
            rc = exporter.main(argv)
            self.assertIn('default_transaction_read_only=on', connect.call_args.kwargs['options'])
        return rc, json.loads((output / 'manifest.json').read_text(encoding='utf-8'))

    def test_manifest_accepts_already_missing_audio_and_preserves_its_reference(self):
        rc, manifest = self.run_export('missing-audio', [{'bucket': 'audio', 'name': 'old.mp3', 'location': 'card:1.audio_path'}])
        self.assertEqual(rc, 0)
        self.assertEqual(manifest['missing_audio_accepted'], 1)
        self.assertEqual(manifest['downloaded_count'], 1)
        self.assertTrue(manifest['restore_verified'])
        self.assertEqual(manifest['missing'][0]['name'], 'old.mp3')

    def test_manifest_persists_download_access_failure_and_missing_images_and_inventory_drift(self):
        rc, manifest = self.run_export('access-failure', [], failure=RuntimeError('HTTP 403'))
        self.assertEqual(rc, 1)
        self.assertEqual(len(manifest['failed']), 1)
        self.assertFalse(manifest['missing'])
        rc, manifest = self.run_export('missing-image', [{'bucket': 'images', 'name': 'lost.webp'}])
        self.assertEqual(rc, 1)
        self.assertFalse(manifest['ok'])
        rc, manifest = self.run_export('drift', [], inventory_changed=True)
        self.assertEqual(rc, 1)
        self.assertIn('Storage inventory changed', manifest['errors'][0])


if __name__ == '__main__':
    unittest.main()
