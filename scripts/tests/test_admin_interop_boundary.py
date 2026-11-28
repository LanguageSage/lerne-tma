"""TMA media redirects use the same storage keys as the admin importer."""
import os
import asyncio
from pathlib import Path
import unittest
from unittest.mock import patch
from uuid import uuid4
from peewee import SqliteDatabase
from api import models


class InteropTests(unittest.TestCase):
    def setUp(self):
        # Keep the schema available across the worker's per-request connections.
        scratch = Path(__file__).resolve().parents[2] / 'local' / 'test-data'
        scratch.mkdir(parents=True, exist_ok=True)
        database_path = scratch / f'lerne-admin-interop-{uuid4().hex}.sqlite3'
        self.database = SqliteDatabase(str(database_path))
        self.addCleanup(database_path.unlink, missing_ok=True)
        self.addCleanup(self.database.close)
        models.tma_db.initialize(self.database)
        models.lerne_db.initialize(self.database)
        self.database.create_tables([models.TMAMedia])

    def test_cyrillic_media_redirect_uses_stable_storage_key(self):
        from api.routers import media
        from api.utils.storage_keys import storage_object_path
        name = 'Без названия.png'
        models.TMAMedia.create(folder='images', filename=name, content=None)
        with patch.dict(os.environ, SUPABASE_URL='https://example.invalid'), patch.object(media._media_cache, 'get', return_value=None):
            response = asyncio.run(media.get_image(name, None))
        self.assertTrue(response.headers['location'].endswith(storage_object_path(name)))


if __name__ == '__main__':
    unittest.main()
