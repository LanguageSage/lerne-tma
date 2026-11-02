"""Library import contracts over synthetic SQLite data; no external services."""
import datetime as dt
import json
import unittest
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from peewee import SqliteDatabase

from api import models, services
from api.dependencies.auth import get_user_id
from api.routers import decks as router
from api.services import decks, offline_sync, sync_service


OLD = dt.datetime(2020, 1, 1)
NEW = dt.datetime(2021, 1, 1)
TABLES = [models.TMAUser, models.TMA_Folder, models.TMA_Deck, models.TMA_Card,
          models.TMAProgress, models.TMAReviewHistory, models.TMASetting,
          models.TMA_Collaborator, models.LibraryCategory, models.Deck, models.Card]


class LibraryImportTests(unittest.TestCase):
    def setUp(self):
        self.db = SqliteDatabase(':memory:', thread_safe=False, check_same_thread=False)
        previous = (models.tma_db.obj, models.lerne_db.obj)
        for proxy, old in zip((models.tma_db, models.lerne_db), previous):
            proxy.initialize(self.db)
            self.addCleanup(proxy.initialize, old)
        self.addCleanup(self.db.close)
        self.db.create_tables(TABLES)
        for uid in (1, 2, 3):
            models.TMAUser.create(user_id=uid, default_decks_initialized=True)
        self.library = models.Deck.create(name='Synthetic library', target_language='uk',
                                          level='A2', topic='Synthetic', updated_at=NEW)

    def remote_card(self, front='Remote', **values):
        return models.Card.create(deck=self.library, front_text=front, back_text='Remote back',
            context='Remote context', image_path='synthetic.webp', audio_path='synthetic.mp3',
            tags='["remote"]', metadata='{"synthetic": true}', updated_at=NEW, **values)

    def local_deck(self, **values):
        return models.TMA_Deck.create(user_id=1, name=self.library.name, updated_at=OLD, **values)

    def local_card(self, deck, front='Local', **values):
        return models.TMA_Card.create(deck=deck, front_text=front, back_text='Local back',
            creator_id=3, tags='["local"]', metadata='{"local": true}', updated_at=OLD, **values)

    def progress(self, card):
        models.TMAProgress.create(card_id=card.id, user_id=1, queue='review', interval=17,
            ease_factor=2.3, repetitions=4, lapses=2, flag=3, want_to_learn=True,
            next_review=NEW, updated_at=OLD)
        models.TMAReviewHistory.create(card_id=card.id, user_id=1, rating=3,
                                      scheduled_interval=17, review_time=OLD)

    def snapshot(self, *tables):
        return [list(table.select().order_by(table._meta.primary_key).dicts()) for table in tables]

    def client(self, uid=1):
        app = FastAPI()
        app.dependency_overrides[get_user_id] = lambda: uid
        app.include_router(router.router, prefix='/api')
        client = TestClient(app)
        self.addCleanup(client.close)
        return client

    def test_existing_imports_expose_the_library_implementation(self):
        from api.services import library_import
        for name in ('import_deck', 'import_decks_batch', 'sync_deck_with_library',
                     '_bulk_copy_cards_from_library', '_save_source_library_id'):
            self.assertIs(getattr(decks, name), getattr(library_import, name))
            if not name.startswith('_'):
                self.assertIs(getattr(services, name), getattr(library_import, name))

    def test_fast_merge_copies_only_active_cards_and_preserves_metadata(self):
        self.remote_card()
        self.remote_card('Deleted', is_deleted=True)
        local = self.local_deck(metadata='{"resources": [], "custom": 7}')
        result = decks.import_deck(self.library.id, 1)
        self.assertEqual(result.id, local.id)
        self.assertEqual((result.target_language, result.level), ('uk', None))
        self.assertEqual(json.loads(result.metadata), {
            'resources': [], 'custom': 7, 'source_library_id': self.library.id})
        card = models.TMA_Card.get(models.TMA_Card.deck == local)
        self.assertEqual((card.front_text, card.back_text, card.context),
                         ('Remote', 'Remote back', 'Remote context'))
        self.assertEqual((card.image_path, card.audio_path, card.source, card.card_type),
                         ('synthetic.webp', 'synthetic.mp3', 'library', 'translation'))
        self.assertEqual((card.tags, card.topics, card.metadata),
                         ('[]', '[]', '{"synthetic": true}'))
        self.assertIn('Imported from library', json.loads(card.history)[0])
        self.assertGreater(card.updated_at, OLD)
        self.assertGreater(result.updated_at, OLD)

    def test_incremental_merge_keeps_card_identity_progress_and_local_only_content(self):
        local = self.local_deck()
        matching = self.local_card(local, 'Remote')
        retained = self.local_card(local, 'Local only')
        restored = self.local_card(local, 'Restore', is_deleted=True)
        self.remote_card()
        self.remote_card('Restore')
        self.remote_card('New')
        self.remote_card('Not imported', is_deleted=True)
        self.progress(matching)
        before = self.snapshot(models.TMAProgress, models.TMAReviewHistory)
        retained_before = dict(models.TMA_Card.get_by_id(retained.id).__data__)
        decks.import_deck(self.library.id, 1)
        self.assertEqual(self.snapshot(models.TMAProgress, models.TMAReviewHistory), before)
        saved = models.TMA_Card.get_by_id(matching.id)
        self.assertEqual((saved.back_text, saved.creator_id, saved.metadata),
                         ('Remote back', 3, matching.metadata))
        self.assertCountEqual(json.loads(saved.tags), ['local', 'remote'])
        self.assertIn('Updated from library', json.loads(saved.history)[0])
        self.assertEqual(models.TMA_Card.get_by_id(retained.id).__data__, retained_before)
        self.assertFalse(models.TMA_Card.get_by_id(restored.id).is_deleted)
        added = models.TMA_Card.get(models.TMA_Card.front_text == 'New')
        self.assertEqual((added.tags, added.metadata), ('["remote"]', '{"synthetic": true}'))
        self.assertEqual(models.TMA_Card.select().count(), 4)

    def test_merge_restores_older_remote_without_overwriting_newer_local_content(self):
        local = self.local_deck()
        matching = self.local_card(local, 'Remote', is_deleted=True)
        matching.updated_at = NEW
        matching.save()
        self.local_card(local, 'Keep fast_path_disabled')
        remote = self.remote_card()
        remote.updated_at = OLD
        remote.save()
        decks.import_deck(self.library.id, 1)
        saved = models.TMA_Card.get_by_id(matching.id)
        self.assertFalse(saved.is_deleted)
        self.assertEqual((saved.back_text, saved.tags, saved.updated_at),
                         ('Local back', '["local"]', NEW))

    def test_copy_reuses_v2_deck_and_appends_cards_on_repeat(self):
        self.remote_card()
        original = self.local_deck()
        self.local_card(original)
        before = self.snapshot(models.TMA_Card)
        result = decks.import_deck(self.library.id, 1, mode='copy')
        self.assertEqual((result.name, result.level, result.topic, result.target_language),
                         (self.library.name + ' (v2)', 'A2', 'Synthetic', 'uk'))
        result.is_deleted = True
        result.save()
        again = decks.import_deck(self.library.id, 1, mode='copy')
        self.assertEqual(again.id, result.id)
        self.assertFalse(again.is_deleted)
        copied = list(models.TMA_Card.select().where(models.TMA_Card.deck == result))
        self.assertEqual(len(copied), 2)
        self.assertTrue(all('Imported as copy' in json.loads(c.history)[0] for c in copied))
        self.assertEqual(self.snapshot(models.TMA_Card)[0][:1], before[0])

    def test_replace_and_empty_merge_remove_old_cards_and_progress_only(self):
        self.remote_card()
        for mode in ('replace', 'merge'):
            with self.subTest(mode=mode):
                local = self.local_deck()
                old = self.local_card(local, is_deleted=mode == 'merge')
                self.progress(old)
                history = self.snapshot(models.TMAReviewHistory)
                result = decks.import_deck(self.library.id, 1, mode=mode, local_deck_id=local.id)
                self.assertEqual(result.id, local.id)
                saved = models.TMA_Card.get(models.TMA_Card.deck == local)
                self.assertEqual(saved.front_text, 'Remote')
                self.assertFalse(models.TMAProgress.select().where(
                    models.TMAProgress.card_id == old.id).exists())
                self.assertEqual(self.snapshot(models.TMAReviewHistory), history)

    def test_trash_conflict_response_and_forced_reimport(self):
        self.remote_card()
        local = self.local_deck(is_deleted=True)
        old = self.local_card(local, is_deleted=True)
        self.progress(old)
        before = self.snapshot(*TABLES)
        for mode in ('merge', 'replace'):
            self.assertEqual(decks.import_deck(self.library.id, 1, mode=mode), {
                'status': 'in_trash', 'name': self.library.name, 'deck_name': self.library.name,
                'deck_id': self.library.id, 'trash_deck_id': local.id})
            self.assertEqual(self.snapshot(*TABLES), before)
        result = decks.import_deck(self.library.id, 1, force_trash=True)
        self.assertFalse(result.is_deleted)
        self.assertEqual(models.TMA_Deck.select().count(), 1)
        self.assertEqual([c.front_text for c in models.TMA_Card.select()], ['Remote'])
        self.assertEqual(models.TMAProgress.select().count(), 0)

    def test_explicit_destination_authorization_precedes_card_writes(self):
        self.remote_card()
        folder = models.TMA_Folder.create(user_id=1, name='Shared')
        local = self.local_deck(folder=folder)
        self.local_card(local)
        models.TMA_Collaborator.create(target_type='folder', target_id=folder.id,
                                       user_id=2, role='viewer', added_by=1)
        for mode in ('merge', 'replace'):
            for uid in (2, 3):
                with self.subTest(mode=mode, uid=uid):
                    before = self.snapshot(*TABLES)
                    with self.assertRaises(HTTPException) as error:
                        decks.import_deck(self.library.id, uid, mode=mode, local_deck_id=local.id)
                    self.assertEqual(error.exception.status_code, 403)
                    self.assertEqual(self.snapshot(*TABLES), before)
        grant = models.TMA_Collaborator.get(models.TMA_Collaborator.user_id == 2)
        grant.role = 'editor'
        grant.save()
        self.assertEqual(decks.import_deck(self.library.id, 2, local_deck_id=local.id).id, local.id)

    def test_bulk_copy_rolls_back_all_chunks_on_late_insert_failure(self):
        local = self.local_deck()
        for i in range(101):
            self.remote_card(f'Bulk {i}')
        insert = models.TMA_Card.insert_many
        calls = []

        def fail_second_chunk(rows):
            calls.append(len(rows))
            if len(calls) == 2:
                raise RuntimeError('Synthetic late insert failure')
            return insert(rows)

        with patch.object(models.TMA_Card, 'insert_many', side_effect=fail_second_chunk):
            with self.assertRaisesRegex(RuntimeError, 'Synthetic late insert failure'):
                decks._bulk_copy_cards_from_library(local.id, self.library.id)
        self.assertEqual(calls, [100, 1])
        self.assertEqual(models.TMA_Card.select().count(), 0)
        self.assertEqual(decks._bulk_copy_cards_from_library(local.id, self.library.id), 101)

    def test_batch_skips_trash_and_failures_and_continues(self):
        self.local_deck(is_deleted=True)
        other = models.Deck.create(name='Other synthetic')
        with self.assertLogs('api.services.decks', level='ERROR') as logs:
            result = services.import_decks_batch([self.library.id, 99999, other.id], 1)
        self.assertIn('Error importing batch deck 99999', '\n'.join(logs.output))
        self.assertEqual(len(result), 1)
        self.assertEqual(models.TMA_Deck.get_by_id(result[0]).name, other.name)

    def test_sync_keeps_existing_bool_error_contract(self):
        self.remote_card()
        local = self.local_deck()
        self.assertTrue(services.sync_deck_with_library(1, local.id))
        with self.assertLogs('api.services.decks', level='ERROR'):
            self.assertFalse(services.sync_deck_with_library(2, local.id))
        local.name = 'No library match'
        local.save()
        with self.assertLogs('api.services.decks', level='WARNING'):
            self.assertFalse(services.sync_deck_with_library(1, local.id))
        with self.assertLogs('api.services.decks', level='ERROR'):
            self.assertFalse(services.sync_deck_with_library(1, 99999))

    def test_import_changes_reach_owner_and_collaborator_pull_paths(self):
        self.remote_card()
        local = self.local_deck()
        models.TMA_Collaborator.create(target_type='deck', target_id=local.id,
                                       user_id=2, role='viewer', added_by=1)
        decks.import_deck(self.library.id, 1)
        for kind, pull in (
                ('legacy', sync_service.execute_sync_pull('2020-01-02T00:00:00Z', 1)),
                ('collab', sync_service.execute_collab_pull('2020-01-02T00:00:00Z', 2)),
                ('v2', offline_sync.pull_offline(1)), ('v2', offline_sync.pull_offline(2))):
            with self.subTest(kind=kind):
                self.assertEqual([c['front_text'] for c in pull['cards']], ['Remote'])
                self.assertEqual(pull['cards'][0]['deck_id'], local.id)
                imported = next(d for d in pull['decks'] if d['id'] == local.id)
                if kind == 'v2':
                    metadata = imported['metadata']
                    if isinstance(metadata, str):
                        metadata = json.loads(metadata)
                    self.assertEqual(metadata['source_library_id'], self.library.id)
                else:
                    self.assertNotIn('metadata', imported)

    def test_http_import_batch_and_sync_response_shapes(self):
        self.remote_card()
        client = self.client()
        response = client.post(f'/api/decks/external/import/{self.library.id}')
        self.assertEqual(response.status_code, 200, response.text)
        local_id = response.json()['deck_id']
        self.assertEqual(response.json(), {'status': 'success', 'deck_id': local_id})
        response = client.post('/api/decks/external/import-batch', json={'deck_ids': [self.library.id]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {'status': 'success', 'imported_deck_ids': [local_id]})
        response = client.post(f'/api/decks/{local_id}/sync')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {'status': 'success'})


if __name__ == '__main__':
    unittest.main()
