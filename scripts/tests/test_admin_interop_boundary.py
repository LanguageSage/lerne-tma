"""TMA-owned link/redirect behavior remains tested without importing admin."""
import os
import unittest
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from peewee import SqliteDatabase
from api import models
from api.dependencies.auth import get_user_id
from local import router as local_routes


class InteropTests(unittest.TestCase):
    def setUp(self):
        self.database = SqliteDatabase(':memory:', thread_safe=False, check_same_thread=False)
        models.tma_db.initialize(self.database)
        models.lerne_db.initialize(self.database)
        self.database.create_tables([models.TMAUser, models.TMA_Folder, models.TMA_Deck,
                                     models.TMA_Card, models.TMA_Collaborator, models.TMAMedia])
        self.addCleanup(self.database.close)

    def test_local_card_link_checks_identity_and_permission(self):
        uid = 900000001
        models.TMAUser.create(user_id=uid, is_guest=False)
        deck = models.TMA_Deck.create(user_id=uid, name='Synthetic')
        card = models.TMA_Card.create(deck=deck, creator_id=uid, front_text='Synthetic', back_text='Fixture')
        app = FastAPI(); app.include_router(local_routes.router, prefix='/api')
        app.dependency_overrides[get_user_id] = lambda: uid
        client = TestClient(app)
        with patch.object(local_routes, 'is_local', return_value=True):
            self.assertEqual(client.get(f'/api/local/transfer-card/{card.id}').json()['url'],
                             f'http://127.0.0.1:8050/?publish_card={card.id}')
            models.TMA_Deck.update(user_id=99).where(models.TMA_Deck.id == deck.id).execute()
            models.TMA_Collaborator.create(target_type='deck', target_id=deck.id, user_id=uid, role='viewer')
            self.assertEqual(client.get(f'/api/local/transfer-card/{card.id}').status_code, 403)
        with patch.object(local_routes, 'is_local', return_value=False):
            self.assertEqual(client.get(f'/api/local/transfer-card/{card.id}').status_code, 404)

    def test_cyrillic_media_redirect_uses_stable_storage_key(self):
        from api.routers import media
        from api.utils.storage_keys import storage_object_path
        name = 'Без названия.png'
        models.TMAMedia.create(folder='images', filename=name, content=None)
        with patch.dict(os.environ, SUPABASE_URL='https://example.invalid'), patch.object(media._media_cache, 'get', return_value=None):
            response = media.get_image(name, None)
        self.assertTrue(response.headers['location'].endswith(storage_object_path(name)))


if __name__ == '__main__':
    unittest.main()
