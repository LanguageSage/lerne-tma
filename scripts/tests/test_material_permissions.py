"""Material permissions over disposable SQLite; run with scripts/test_backend.py."""
import os
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient
from peewee import SqliteDatabase

from api import models
from api.dependencies.auth import get_user_id
from api.routers import ai, cards, collaborative, decks, folders, media, share, sync, trash
from api.services import cards as card_service
from api.services import collaborative_service as permissions


class MaterialPermissionTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, ADMIN_USER_ID='505')
        self.env.start()
        self.addCleanup(self.env.stop)
        scratch = Path(__file__).resolve().parents[2] / 'scratch'
        scratch.mkdir(exist_ok=True)
        self.path = scratch / f'permissions-{uuid4().hex}.sqlite3'
        self.db = SqliteDatabase(str(self.path), thread_safe=False, check_same_thread=False)
        self.previous = (models.tma_db.obj, models.lerne_db.obj)
        models.tma_db.initialize(self.db)
        models.lerne_db.initialize(self.db)
        self.addCleanup(self.cleanup)
        self.db.create_tables([models.TMAUser, models.TMA_Folder, models.TMA_Deck,
            models.TMA_Card, models.TMA_Collaborator, models.TMAProgress,
            models.TMAReviewHistory, models.TMAOfflineBatch, models.TMASetting,
            models.TMAMedia, models.Deck, models.Card, models.LibraryCategory])
        for uid in (101, 202, 303, 404, 505):
            models.TMAUser.create(user_id=uid, username=f'user{uid}', is_guest=False,
                                  default_decks_initialized=True)
        self.root = models.TMA_Folder.create(user_id=101, name='Private root')
        self.child = models.TMA_Folder.create(user_id=101, parent=self.root, name='Child')
        self.deck = models.TMA_Deck.create(user_id=101, folder=self.child, name='Deck')
        # Authorship deliberately differs from current access rights.
        self.card = models.TMA_Card.create(deck=self.deck, creator_id=404,
                                          front_text='Haus', back_text='дом', tags='old')
        for uid, role in ((202, 'editor'), (303, 'viewer')):
            models.TMA_Collaborator.create(target_type='folder', target_id=self.root.id,
                                           user_id=uid, role=role, added_by=101)
        self.targets = {uid: models.TMA_Deck.create(user_id=uid, name=f'Target {uid}')
                        for uid in (101, 202, 303, 404)}
        app = FastAPI()
        # Authentication is outside task 1.4; exercise real routers and permissions.
        def fixture_user(x_test_user: int = Header()):
            return x_test_user
        app.dependency_overrides[get_user_id] = fixture_user
        for module in (ai, cards, decks, folders, media, share, sync, collaborative, trash):
            app.include_router(module.router, prefix='/api')
        self.client = TestClient(app)

    def cleanup(self):
        if hasattr(self, 'client'):
            self.client.close()
        self.db.close()
        models.tma_db.initialize(self.previous[0])
        models.lerne_db.initialize(self.previous[1])
        self.path.unlink(missing_ok=True)

    def call(self, method, path, uid=101, **kwargs):
        return self.client.request(method, '/api' + path,
                                   headers={'X-Test-User': str(uid)}, **kwargs)

    def publish(self):
        self.root.access_scope = 'global_readonly'
        self.root.save()

    def test_private_and_inherited_read_matrix(self):
        for uid, role in ((101, 'owner'), (202, 'editor'), (303, 'viewer'), (404, None)):
            with self.subTest(uid=uid):
                self.assertEqual(permissions.get_effective_user_role(uid, 'deck', self.deck.id), role)
                response = self.call('GET', f'/decks/{self.deck.id}/cards', uid)
                self.assertEqual(response.status_code, 200 if role else 403, response.text)
                snapshot = self.call('GET', '/sync/v2/pull', uid).json()
                self.assertEqual(self.card.id in {c['id'] for c in snapshot['cards']}, bool(role))

    def test_classify_role_matrix(self):
        for uid in (101, 202, 303, 404):
            with self.subTest(uid=uid), patch('api.services.classifier.classify_sentence_fast',
                    return_value={'confidence': 1.0, 'level': 'A1'}):
                response = self.call('POST', '/cards/classify-batch', uid,
                                     json={'deck_id': self.deck.id})
                self.assertEqual(response.status_code, 200 if uid in (101, 202) else 403, response.text)
        self.assertEqual(models.TMA_Card.get_by_id(self.card.id).creator_id, 404)

    def test_classify_requires_verified_session_before_classification(self):
        self.client.app.dependency_overrides.clear()
        with patch('api.services.classifier.classify_sentence_fast') as classify:
            for headers in ({}, {'X-User-ID': '101'}, {'Authorization': 'Basic invalid'}):
                with self.subTest(headers=headers):
                    response = self.client.post('/api/cards/classify-batch', headers=headers,
                                                json={'deck_id': self.deck.id})
                    self.assertEqual(response.status_code, 401, response.text)
                    self.assertEqual(response.headers['www-authenticate'], 'Bearer')
        classify.assert_not_called()
        self.assertEqual(models.TMA_Card.get_by_id(self.card.id).tags, 'old')

    def test_classify_mixed_ids_rejected_before_any_write(self):
        foreign = models.TMA_Card.create(deck=self.targets[404], front_text='Private', back_text='')
        with patch('api.services.classifier.classify_sentence_fast') as classify:
            response = self.call('POST', '/cards/classify-batch', 202,
                                 json={'card_ids': [self.card.id, foreign.id]})
        self.assertEqual(response.status_code, 403, response.text)
        classify.assert_not_called()
        self.assertEqual(models.TMA_Card.get_by_id(self.card.id).tags, 'old')

    def test_classify_missing_id_rejects_whole_batch(self):
        response = self.call('POST', '/cards/classify-batch',
                             json={'card_ids': [self.card.id, 999999]})
        self.assertEqual(response.status_code, 404, response.text)

    def test_global_classify_uses_existing_maintenance_policy(self):
        self.publish()
        for uid in (101, 202, 303, 404, 505):
            with self.subTest(uid=uid), patch('api.services.classifier.classify_sentence_fast',
                    return_value={'confidence': 1.0, 'level': 'A1'}):
                response = self.call('POST', '/cards/classify-batch', uid,
                                     json={'card_ids': [self.card.id]})
                self.assertEqual(response.status_code, 200 if uid in (101, 505) else 403, response.text)

    def test_classification_rechecks_revoked_access(self):
        async def revoke(*_args, **_kwargs):
            models.TMA_Collaborator.delete().where(models.TMA_Collaborator.user_id == 202).execute()
            return ['B2']
        with patch.object(ai.ai_service, 'classify_phrases_batch', side_effect=revoke):
            response = self.call('POST', '/cards/classify-batch', 202,
                                 json={'card_ids': [self.card.id], 'target_language': 'en'})
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(models.TMA_Card.get_by_id(self.card.id).tags, 'old')

    def test_classification_accepts_editor(self):
        with patch.object(ai.ai_service, 'classify_phrases_batch', new=AsyncMock(return_value=['B2'])):
            response = self.call('POST', '/cards/classify-batch', 202,
                                 json={'card_ids': [self.card.id], 'target_language': 'en'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['complete'])
        self.assertIn('B2', models.TMA_Card.get_by_id(self.card.id).tags)

    def test_viewer_can_copy_readable_card_but_cannot_write_source(self):
        response = self.call('POST', '/cards/batch-copy', 303, json={
            'card_ids': [self.card.id], 'target_deck_id': self.targets[303].id})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['created'], 1)
        copied = models.TMA_Card.get(models.TMA_Card.deck == self.targets[303])
        self.assertEqual(copied.creator_id, 404)
        self.assertFalse(models.TMA_Card.get_by_id(self.card.id).is_deleted)

    def test_creator_without_access_cannot_copy_or_mutate_via_services(self):
        for operation in ('copy', 'move', 'delete', 'single_delete'):
            with self.subTest(operation=operation):
                try:
                    if operation == 'single_delete':
                        card_service.delete_card(self.card.id, 404)
                    elif operation == 'delete':
                        card_service.batch_delete_cards([self.card.id], 404)
                    else:
                        getattr(card_service, f'batch_{operation}_cards')(
                            [self.card.id], self.targets[404].id, 404)
                except HTTPException as error:
                    self.assertEqual(error.status_code, 403)
                self.assertEqual(models.TMA_Card.get_by_id(self.card.id).deck_id, self.deck.id)
                self.assertFalse(models.TMA_Card.get_by_id(self.card.id).is_deleted)
                self.assertEqual(models.TMA_Card.select().count(), 1)

    def test_copy_deck_accepts_inherited_reader_and_preserves_author(self):
        for uid in (202, 303):
            response = self.call('POST', f'/decks/{self.deck.id}/copy', uid, json={})
            self.assertEqual(response.status_code, 200, response.text)
            copied = models.TMA_Card.get(models.TMA_Card.deck_id == response.json()['id'])
            self.assertEqual(copied.creator_id, 404)
        denied = self.call('POST', f'/decks/{self.deck.id}/copy', 404, json={})
        self.assertIn(denied.status_code, (403, 404), denied.text)

    def test_create_and_move_destination_guards(self):
        for uid in (101, 202, 303, 404):
            for path, payload in (('/decks', {'name': 'New', 'folder_id': self.child.id}),
                                  ('/folders', {'name': 'New', 'parent_id': self.child.id}),
                                  (f'/decks/{self.targets[uid].id}/move', {'folder_id': self.child.id})):
                with self.subTest(uid=uid, path=path):
                    response = self.call('POST', path, uid, json=payload)
                    self.assertEqual(response.status_code, 200 if uid in (101, 202) else 403, response.text)

    def test_share_card_requires_read_access_and_inherited_access_works(self):
        response = self.call('POST', f'/share/generate/card/{self.card.id}', 404, json={})
        self.assertEqual(response.status_code, 403, response.text)
        self.assertIsNone(models.TMA_Card.get_by_id(self.card.id).share_id)
        for kind, item in (('card', self.card), ('deck', self.deck), ('folder', self.child)):
            response = self.call('POST', f'/share/generate/{kind}/{item.id}', 303, json={})
            self.assertEqual(response.status_code, 200, response.text)

    def test_canonical_mutation_matrix(self):
        for uid in (101, 202, 303, 404):
            for path, payload in ((f'/decks/{self.deck.id}/rename', {'name': 'Renamed'}),
                                  (f'/folders/{self.child.id}/rename', {'name': 'Renamed'}),
                                  ('/cards/save', {'card_id': self.card.id, 'front': 'Neu', 'auto_generate_audio': False}),
                                  ('/cards/bulk-save', {'cards': [{'deck_id': self.deck.id, 'front': 'Bulk'}]}),
                                  ('/cards/reorder', {'card_ids': [self.card.id]})):
                with self.subTest(uid=uid, path=path):
                    response = self.call('POST', path, uid, json=payload)
                    self.assertEqual(response.status_code, 200 if uid in (101, 202) else 403, response.text)

    def test_sync_v2_matrix_and_forbidden_destination_rollback(self):
        for uid in (101, 202, 303, 404):
            response = self.call('POST', '/sync/v2/push', uid, json={
                'request_id': str(uuid4()), 'cards': [{'id': self.card.id,
                'deck_id': self.deck.id, 'front_text': 'Sync', 'back_text': 'Back'}]})
            self.assertEqual(response.status_code, 200 if uid in (101, 202) else 403, response.text)
        response = self.call('POST', '/sync/v2/push', 202, json={
            'request_id': str(uuid4()), 'cards': [
                {'id': self.card.id, 'deck_id': self.deck.id, 'front_text': 'Rollback', 'back_text': ''},
                {'id': -1, 'deck_id': self.targets[404].id, 'front_text': 'Forbidden', 'back_text': ''}]})
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(models.TMA_Card.get_by_id(self.card.id).front_text, 'Sync')

    def test_legacy_sync_editor_can_update_inherited_folder_and_deck(self):
        response = self.call('POST', '/sync/push', 202, json={
            'folders': [{'id': self.child.id, 'name': 'Edited child', 'parent_id': self.root.id,
                         'updated_at': '2030-01-01T00:00:00'}],
            'decks': [{'id': self.deck.id, 'name': 'Edited deck', 'folder_id': self.child.id,
                       'updated_at': '2030-01-01T00:00:00'}]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(models.TMA_Folder.get_by_id(self.child.id).name, 'Edited child')
        self.assertEqual(models.TMA_Deck.get_by_id(self.deck.id).name, 'Edited deck')

    def test_private_collaborator_metadata_is_not_exposed_to_outsider(self):
        response = self.call('GET', f'/collaborative/check-access?type=deck&id={self.deck.id}', 404)
        self.assertEqual(response.status_code, 403, response.text)

    def test_global_read_copy_and_write_matrix(self):
        self.publish()
        for uid in (101, 202, 303, 404):
            with self.subTest(uid=uid):
                self.assertEqual(self.call('GET', f'/decks/{self.deck.id}/cards', uid).status_code, 200)
                response = self.call('POST', '/cards/batch-copy', uid, json={
                    'card_ids': [self.card.id], 'target_deck_id': self.targets[uid].id})
                self.assertEqual(response.status_code, 200, response.text)
                for path, payload in ((f'/decks/{self.deck.id}/rename', {'name': 'Published'}),
                                      ('/cards/batch-delete', {'card_ids': [self.card.id]})):
                    response = self.call('POST', path, uid, json=payload)
                    self.assertEqual(response.status_code, 200 if uid == 101 else 403, response.text)
                # Keep the source available for the next role in this matrix.
                models.TMA_Card.update(is_deleted=False).where(models.TMA_Card.id == self.card.id).execute()

    def test_batch_move_checks_both_decks_and_preserves_author(self):
        for uid in (303, 404):
            response = self.call('POST', '/cards/batch-move', uid, json={
                'card_ids': [self.card.id], 'target_deck_id': self.targets[uid].id})
            self.assertEqual(response.status_code, 403, response.text)
        response = self.call('POST', '/cards/batch-move', 202, json={
            'card_ids': [self.card.id], 'target_deck_id': self.targets[404].id})
        self.assertEqual(response.status_code, 403, response.text)
        response = self.call('POST', '/cards/batch-move', 202, json={
            'card_ids': [self.card.id], 'target_deck_id': self.targets[202].id})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(models.TMA_Card.get_by_id(self.card.id).creator_id, 404)

    def test_legacy_sync_rejects_viewer_outsider_and_global_editor(self):
        for published in (False, True):
            if published:
                self.publish()
            for uid in ((202, 303, 404) if published else (303, 404)):
                response = self.call('POST', '/sync/push', uid, json={'cards': [{
                    'id': self.card.id, 'deck_id': self.deck.id, 'front_text': 'Forbidden',
                    'back_text': '', 'updated_at': '2030-01-01T00:00:00'}]})
                self.assertEqual(response.status_code, 403, response.text)
                self.assertEqual(models.TMA_Card.get_by_id(self.card.id).front_text, 'Haus')

    def test_global_descendant_owner_cannot_restore_or_clear_originals(self):
        self.publish()
        self.deck.user_id = 202
        self.deck.save()
        models.TMA_Card.update(is_deleted=True).where(models.TMA_Card.id == self.card.id).execute()
        for path in (f'/trash/card/{self.card.id}/restore', f'/trash/deck/{self.deck.id}/restore'):
            response = self.call('POST', path, 202)
            self.assertEqual(response.status_code, 403, response.text)
            self.assertTrue(models.TMA_Card.get_by_id(self.card.id).is_deleted)
        response = self.call('DELETE', '/trash/clear', 202)
        self.assertEqual(response.status_code, 403, response.text)
        self.assertIsNotNone(models.TMA_Card.get_or_none(models.TMA_Card.id == self.card.id))

    def test_sync_cannot_restore_deleted_global_descendant_by_row_ownership(self):
        self.publish()
        self.deck.user_id = 202
        self.deck.is_deleted = True
        self.deck.save()
        response = self.call('POST', '/sync/v2/push', 202, json={
            'request_id': str(uuid4()), 'decks': [{'id': self.deck.id, 'name': 'Hijack',
                'folder_id': None, 'is_deleted': False}]})
        self.assertEqual(response.status_code, 403, response.text)
        self.assertTrue(models.TMA_Deck.get_by_id(self.deck.id).is_deleted)

    def test_library_import_cannot_overwrite_published_descendant_owned_by_reader(self):
        self.publish()
        self.deck.user_id = 202
        self.deck.save()
        library = models.Deck.create(name='Deck')
        models.Card.create(deck=library, front_text='Library', back_text='Content')
        for mode in ('merge', 'replace'):
            response = self.call('POST', f'/decks/external/import/{library.id}?mode={mode}', 202)
            self.assertEqual(response.status_code, 403, response.text)
            self.assertEqual(models.TMA_Card.get_by_id(self.card.id).front_text, 'Haus')

    def test_shared_import_cannot_replace_published_descendant_owned_by_reader(self):
        self.publish()
        self.deck.user_id = 202
        self.deck.save()
        source = models.TMA_Deck.create(user_id=404, name='Deck', share_id='d_synthetic')
        models.TMA_Card.create(deck=source, front_text='Shared', back_text='Content', creator_id=303)
        for resolution in ('merge', 'replace'):
            response = self.call('POST', '/share/import', 202,
                                 json={'share_id': source.share_id, 'resolution': resolution})
            self.assertEqual(response.status_code, 403, response.text)
            self.assertFalse(models.TMA_Card.get_by_id(self.card.id).is_deleted)

    def test_copied_card_keeps_displayed_author(self):
        response = self.call('POST', '/cards/batch-copy', 303, json={
            'card_ids': [self.card.id], 'target_deck_id': self.targets[303].id})
        self.assertEqual(response.status_code, 200, response.text)
        response = self.call('GET', f'/decks/{self.targets[303].id}/cards', 303)
        self.assertEqual(response.json()[0]['creator_name'], 'user404')

    def test_copy_rejects_missing_audio_without_creating_card(self):
        missing = 'https://example.supabase.co/storage/v1/object/public/audio/missing.mp3'
        models.TMA_Card.update(audio_path=missing).where(models.TMA_Card.id == self.card.id).execute()
        target_id = self.targets[303].id
        with patch('api.services.media.validate_new_audio_path', side_effect=HTTPException(422, 'missing Storage object')):
            response = self.call('POST', '/cards/batch-copy', 303, json={
                'card_ids': [self.card.id], 'target_deck_id': target_id})
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(models.TMA_Card.select().where(models.TMA_Card.deck_id == target_id).count(), 0)

    def test_audio_requires_permission_instead_of_authorship(self):
        for uid in (101, 202, 303, 404):
            with patch('api.utils.audio.generate_audio', new=AsyncMock(return_value='https://example.supabase.co/storage/v1/object/public/audio/fixture.mp3')) as generate:
                response = self.call('POST', '/media/generate-card-audio', uid,
                                     json={'card_id': self.card.id})
                self.assertEqual(response.status_code, 200 if uid in (101, 202) else 403, response.text)
                self.assertEqual(generate.await_count, 1 if uid in (101, 202) else 0)

    def test_audio_viewer_grant_is_preserved(self):
        models.TMA_Collaborator.update(can_edit_audio=True).where(
            models.TMA_Collaborator.user_id == 303).execute()
        with patch('api.utils.audio.generate_audio', new=AsyncMock(return_value='https://example.supabase.co/storage/v1/object/public/audio/fixture.mp3')):
            response = self.call('POST', '/media/generate-card-audio', 303,
                                 json={'card_id': self.card.id})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(models.TMA_Card.get_by_id(self.card.id).creator_id, 404)

    def test_failed_audio_upload_keeps_previous_card_link(self):
        previous = 'https://example.supabase.co/storage/v1/object/public/audio/old.mp3'
        models.TMA_Card.update(audio_path=previous).where(models.TMA_Card.id == self.card.id).execute()
        with patch('api.utils.audio.generate_audio', side_effect=RuntimeError('Storage upload failed')):
            response = self.call('POST', '/media/generate-card-audio', 101,
                                 json={'card_id': self.card.id})
        self.assertEqual(response.status_code, 500, response.text)
        self.assertEqual(models.TMA_Card.get_by_id(self.card.id).audio_path, previous)

    def test_explicit_audio_does_not_overwrite_newer_link(self):
        previous = 'https://example.supabase.co/storage/v1/object/public/audio/old.mp3'
        newer = 'https://example.supabase.co/storage/v1/object/public/audio/manual.mp3'
        models.TMA_Card.update(audio_path=previous).where(models.TMA_Card.id == self.card.id).execute()

        async def finish_after_new_link(*_args, **_kwargs):
            models.TMA_Card.update(audio_path=newer).where(models.TMA_Card.id == self.card.id).execute()
            return 'https://example.supabase.co/storage/v1/object/public/audio/generated.mp3'

        with patch('api.utils.audio.generate_audio', side_effect=finish_after_new_link):
            response = self.call('POST', '/media/generate-card-audio', 101,
                                 json={'card_id': self.card.id})
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(models.TMA_Card.get_by_id(self.card.id).audio_path, newer)

    def test_text_edit_keeps_old_audio_when_background_upload_fails(self):
        previous = 'https://example.supabase.co/storage/v1/object/public/audio/old.mp3'
        models.TMA_Card.update(audio_path=previous).where(models.TMA_Card.id == self.card.id).execute()
        with patch('api.utils.audio.generate_audio', side_effect=RuntimeError('Storage upload failed')) as generate:
            response = self.call('POST', '/cards/save', 101, json={
                'card_id': self.card.id, 'deck_id': self.deck.id,
                'front': 'Changed spoken text', 'audio_path': previous,
            })
        self.assertEqual(response.status_code, 200, response.text)
        generate.assert_called_once()
        self.assertEqual(models.TMA_Card.get_by_id(self.card.id).audio_path, previous)

    def test_late_background_audio_does_not_overwrite_newer_edit(self):
        previous = 'https://example.supabase.co/storage/v1/object/public/audio/old.mp3'
        newer = 'https://example.supabase.co/storage/v1/object/public/audio/manual.mp3'
        models.TMA_Card.update(audio_path=previous).where(models.TMA_Card.id == self.card.id).execute()

        async def finish_after_new_edit(*_args, **_kwargs):
            models.TMA_Card.update(audio_path=newer, front_text='Newer edit').where(
                models.TMA_Card.id == self.card.id).execute()
            return 'https://example.supabase.co/storage/v1/object/public/audio/generated.mp3'

        with patch('api.utils.audio.generate_audio', side_effect=finish_after_new_edit):
            response = self.call('POST', '/cards/save', 101, json={
                'card_id': self.card.id, 'deck_id': self.deck.id,
                'front': 'First edit', 'audio_path': previous,
            })
        self.assertEqual(response.status_code, 200, response.text)
        saved = models.TMA_Card.get_by_id(self.card.id)
        self.assertEqual((saved.front_text, saved.audio_path), ('Newer edit', newer))

    def test_audio_rechecks_access_after_generation(self):
        async def revoke(*_args, **_kwargs):
            models.TMA_Collaborator.delete().where(models.TMA_Collaborator.user_id == 202).execute()
            return 'https://example.supabase.co/storage/v1/object/public/audio/fixture.mp3'
        with patch('api.utils.audio.generate_audio', side_effect=revoke):
            response = self.call('POST', '/media/generate-card-audio', 202,
                                 json={'card_id': self.card.id})
        self.assertEqual(response.status_code, 403, response.text)
        self.assertIsNone(models.TMA_Card.get_by_id(self.card.id).audio_path)

    def test_direct_viewer_override_of_inherited_editor_is_preserved(self):
        models.TMA_Collaborator.create(target_type='deck', target_id=self.deck.id,
                                       user_id=202, role='viewer', added_by=101)
        self.assertEqual(permissions.get_effective_user_role(202, 'deck', self.deck.id), 'viewer')
        response = self.call('POST', '/cards/classify-batch', 202, json={'deck_id': self.deck.id})
        self.assertEqual(response.status_code, 403, response.text)
        response = self.call('POST', '/cards/batch-copy', 202, json={
            'card_ids': [self.card.id], 'target_deck_id': self.targets[202].id})
        self.assertEqual(response.status_code, 200, response.text)

    def test_private_owner_can_restore_deleted_deck(self):
        models.TMA_Deck.update(is_deleted=True).where(models.TMA_Deck.id == self.deck.id).execute()
        models.TMA_Card.update(is_deleted=True).where(models.TMA_Card.id == self.card.id).execute()
        response = self.call('POST', f'/trash/deck/{self.deck.id}/restore')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(models.TMA_Deck.get_by_id(self.deck.id).is_deleted)
        self.assertFalse(models.TMA_Card.get_by_id(self.card.id).is_deleted)

    def test_published_descendant_row_owner_cannot_change_audio(self):
        self.publish()
        self.deck.user_id = 202
        self.deck.save()
        with patch('api.utils.audio.generate_audio', new=AsyncMock()) as generate:
            response = self.call('POST', '/media/generate-card-audio', 202,
                                 json={'card_id': self.card.id})
        self.assertEqual(response.status_code, 403, response.text)
        generate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
