"""Content maintenance on disposable SQLite; real JS exporter/parser round-trip."""
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from fastapi import FastAPI
from fastapi.testclient import TestClient
from peewee import SqliteDatabase
from pydantic import ValidationError
from test_offline_sync import database, models, TABLES
from api.services import card_text_update as service
from api.routers.decks import TextUpdateApplyRequest, TextUpdatePreviewRequest

ROOT = Path(__file__).resolve().parents[2]


class CardTextUpdateTests(unittest.TestCase):
    def setUp(self):
        database.create_tables(TABLES)
        models.TMAUser.create(user_id=1, is_guest=False)
        models.TMAUser.create(user_id=2, is_guest=False)
        self.deck = models.TMA_Deck.create(user_id=1, name='Übungen')
        self.a = models.TMA_Card.create(deck=self.deck, front_text='Haus', back_text='дом', position=1)
        self.b = models.TMA_Card.create(deck=self.deck, front_text='Ich [[lerne]] Deutsch.', back_text='Я учу немецкий.',
            context='One\n\nTwo', position=2, tags='B1,custom', topics='Verben', metadata='{"cefr":{"level":"B1"},"other":42}',
            audio_path='front.mp3', audio_back_path='back.mp3', image_path='image.png', history='[{"content":"old"}]', flag=3)
        self.c = models.TMA_Card.create(deck=self.deck, front_text='Baum', back_text='дерево', position=3)

    def tearDown(self):
        database.drop_tables(TABLES)

    def item(self, card=None, **changes):
        card = card or self.b
        value = dict(number=1, card_id=card.id, deck_id=self.deck.id, **service._content(card),
                     card_type='trainer' if '[[' in card.front_text else 'standard')
        value.update(changes)
        return value

    def preview(self, items):
        return service.preview_text_update(self.deck.id, 1, items)

    def apply(self, items, preview=None, **kwargs):
        return service.apply_text_update(self.deck.id, 1, items,
            (preview or self.preview(items))['preview_token'], kwargs.pop('request_id', str(uuid4())), **kwargs)

    def test_real_export_edit_preview_apply_keeps_count_and_omitted_card(self):
        script = """
import {serializeDeck} from './app/src/utils/cardTextSerializer.js';
import {parseCardTextUpdate} from './app/src/utils/cardTextUpdateParser.js';
let input='';for await(const chunk of process.stdin) input+=chunk;
const data=JSON.parse(input);
const exported=serializeDeck(data.deck,data.cards).text;
process.stdout.write(JSON.stringify(parseCardTextUpdate(exported.replace('[[lerne]]','[[lernte]]'))));
"""
        exported_cards = [dict(id=card.id, **service._content(card)) for card in (self.a, self.b)]
        parsed = json.loads(subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT,
            input=json.dumps({'deck': {'id': self.deck.id, 'name': self.deck.name}, 'cards': exported_cards}),
            text=True, encoding='utf-8', capture_output=True, check=True).stdout)
        self.assertEqual(parsed['errors'], [])
        preview = self.preview(parsed['cards'])
        self.assertEqual((preview['updated'], preview['unchanged'], preview['new']), (1, 1, 0))
        self.assertEqual(preview['cards'][1]['changed_fields'], ['front'])
        self.assertEqual(self.apply(parsed['cards'], preview)['updated'], 1)
        self.assertEqual(models.TMA_Card.select().count(), 3)
        self.assertEqual(models.TMA_Card.get_by_id(self.b.id).front_text, 'Ich [[lernte]] Deutsch.')
        self.assertEqual(models.TMA_Card.get_by_id(self.c.id).front_text, 'Baum')

    def test_unchanged_content_does_not_write_or_compare_technical_fields(self):
        before = models.TMA_Card.get_by_id(self.b.id).__data__.copy()
        items = [self.item()]
        preview = self.preview(items)
        self.assertEqual(preview['unchanged'], 1)
        self.assertEqual(self.apply(items, preview)['updated'], 0)
        self.assertEqual(models.TMA_Card.get_by_id(self.b.id).__data__, before)

    def test_idless_is_new_but_requires_explicit_opt_in_and_retry_is_idempotent(self):
        items = [self.item(card_id=None, front='New')]
        preview = self.preview(items)
        self.assertEqual(preview['new'], 1)
        self.assertEqual(self.apply(items, preview)['skipped_new'], 1)
        self.assertEqual(models.TMA_Card.select().count(), 3)
        request_id = str(uuid4())
        first = self.apply(items, preview, include_new=True, request_id=request_id)
        self.assertEqual(first['created'], 1)
        self.assertEqual(self.apply(items, preview, include_new=True, request_id=request_id), first)
        self.assertEqual(models.TMA_Card.select().count(), 4)
        with self.assertRaises(HTTPException) as error:
            self.apply(items, preview, include_new=False, request_id=request_id)
        self.assertEqual(error.exception.status_code, 409)

    def test_unknown_and_deleted_ids_warn_and_never_create(self):
        self.c.is_deleted = True
        self.c.save()
        for identifier in [99999, self.c.id]:
            items = [self.item(card_id=identifier)]
            preview = self.preview(items)
            self.assertEqual(preview['missing'], 1)
            self.assertFalse(preview['can_apply'])
            with self.assertRaises(HTTPException):
                self.apply(items, preview, include_new=True)
        self.assertEqual(models.TMA_Card.select().count(), 3)
        self.assertEqual(models.TMAOfflineBatch.select().count(), 0)

    def test_other_deck_and_other_owner_ids_cannot_be_updated_or_disclosed(self):
        for owner in [1, 2]:
            other = models.TMA_Deck.create(user_id=owner, name='Private')
            card = models.TMA_Card.create(deck=other, front_text='Secret', back_text='Secret answer')
            items = [self.item(front='Should not commit'), self.item(card_id=card.id, number=2)]
            preview = self.preview(items)
            self.assertFalse(preview['can_apply'])
            self.assertIn('foreign_card_id', preview['cards'][1]['errors'])
            self.assertIsNone(preview['cards'][1]['before'])
            self.assertNotIn('Secret', json.dumps(preview))
            with self.assertRaises(HTTPException):
                self.apply(items, preview)
            self.assertEqual(models.TMA_Card.get_by_id(self.b.id).front_text, self.b.front_text)
            self.assertEqual(models.TMA_Card.get_by_id(card.id).front_text, 'Secret')

    def test_wrong_declared_deck_and_duplicate_ids_block_entire_request(self):
        for items in [[self.item(deck_id=self.deck.id+1)], [self.item(), self.item(number=2)]]:
            preview = self.preview(items)
            self.assertFalse(preview['can_apply'])
            with self.assertRaises(HTTPException):
                self.apply(items, preview)

    def test_readonly_private_guest_missing_and_deleted_decks_are_blocked(self):
        models.TMA_Collaborator.create(target_type='deck', target_id=self.deck.id, user_id=2, role='viewer')
        for operation in [lambda: service.preview_text_update(self.deck.id, 2, [self.item()]),
                          lambda: service.apply_text_update(self.deck.id, 2, [self.item()], '0'*64, str(uuid4()))]:
            with self.assertRaises(HTTPException) as error:
                operation()
            self.assertEqual(error.exception.status_code, 403)
        models.TMAUser.update(is_guest=True).where(models.TMAUser.user_id == 1).execute()
        with self.assertRaises(HTTPException):
            self.preview([self.item()])
        models.TMAUser.update(is_guest=False).execute()
        self.deck.is_deleted = True
        self.deck.save()
        for identifier in [self.deck.id, 99999]:
            with self.assertRaises(HTTPException) as error:
                service.preview_text_update(identifier, 1, [self.item()])
            self.assertEqual(error.exception.status_code, 404)

    def test_editor_permission_is_supported(self):
        models.TMA_Collaborator.create(target_type='deck', target_id=self.deck.id, user_id=2, role='editor')
        items = [self.item(front='Changed')]
        preview = service.preview_text_update(self.deck.id, 2, items)
        service.apply_text_update(self.deck.id, 2, items, preview['preview_token'], str(uuid4()))
        self.assertEqual(models.TMA_Card.get_by_id(self.b.id).front_text, 'Changed')

    def test_progress_history_media_metadata_and_noncontent_fields_are_preserved(self):
        models.TMAProgress.create(user_id=1, card_id=self.b.id, interval=17, repetitions=4, lapses=2, queue='review')
        models.TMAProgress.create(user_id=2, card_id=self.b.id, interval=42, repetitions=8, queue='review')
        models.TMAReviewHistory.create(user_id=1, card_id=self.b.id, rating=3, scheduled_interval=17)
        progress = [row.__data__.copy() for row in models.TMAProgress.select()]
        history = [row.__data__.copy() for row in models.TMAReviewHistory.select()]
        before = models.TMA_Card.get_by_id(self.b.id).__data__.copy()
        self.apply([self.item(front='Ich [[lernte]] Deutsch.', back='New translation')])
        after = models.TMA_Card.get_by_id(self.b.id).__data__.copy()
        for key in ['front_text', 'back_text', 'card_type', 'updated_at']:
            before.pop(key, None)
            after.pop(key, None)
        self.assertEqual(before, after)
        self.assertEqual(progress, [row.__data__ for row in models.TMAProgress.select()])
        self.assertEqual(history, [row.__data__ for row in models.TMAReviewHistory.select()])

    def test_level_edits_preserve_custom_tags_and_non_cefr_metadata(self):
        for tags in ['B1,custom', '["B1","custom"]']:
            models.TMA_Card.update(tags=tags).where(models.TMA_Card.id == self.b.id).execute()
            self.apply([self.item(level='B2')])
            card = models.TMA_Card.get_by_id(self.b.id)
            self.assertEqual(json.loads(card.metadata)['other'], 42)
            self.assertIn('custom', card.tags)
            if tags.startswith('['):
                self.assertEqual(json.loads(card.tags), ['custom', 'B2'])
            models.TMA_Card.update(metadata=self.b.metadata).where(models.TMA_Card.id == self.b.id).execute()

    def test_multiple_syntax_errors_block_all_content_writes(self):
        items = [self.item(front='Valid change'), self.item(self.a, number=2, front=''), self.item(self.c, number=3, front='[[unclosed')]
        preview = self.preview(items)
        self.assertEqual(preview['errors'], 2)
        with self.assertRaises(HTTPException):
            self.apply(items, preview)
        self.assertEqual(models.TMA_Card.get_by_id(self.b.id).front_text, self.b.front_text)

    def test_stale_content_preview_rejected_but_srs_change_is_allowed(self):
        items = [self.item(front='Changed')]
        preview = self.preview(items)
        models.TMAProgress.create(user_id=1, card_id=self.b.id, interval=99)
        self.assertEqual(self.preview(items)['preview_token'], preview['preview_token'])
        models.TMA_Card.update(back_text='Another editor').where(models.TMA_Card.id == self.a.id).execute()
        with self.assertRaises(HTTPException) as error:
            self.apply(items, preview)
        self.assertEqual(error.exception.detail['code'], 'preview_changed')
        self.assertEqual(models.TMAOfflineBatch.select().count(), 0)

    def test_failure_after_first_write_rolls_back_content_new_cards_and_receipt(self):
        items = [self.item(front='Changed'), self.item(card_id=None, number=2, front='New')]
        preview = self.preview(items)
        with patch.object(service, 'touch_deck_and_parent_folders', side_effect=RuntimeError('injected')):
            with self.assertRaises(RuntimeError):
                self.apply(items, preview, include_new=True)
        self.assertEqual(models.TMA_Card.select().count(), 3)
        self.assertEqual(models.TMA_Card.get_by_id(self.b.id).front_text, self.b.front_text)
        self.assertEqual(models.TMAOfflineBatch.select().count(), 0)

    def test_api_rejects_srs_media_extra_fields_and_noninteger_identifiers(self):
        for extra in [{'interval': 0}, {'history': '[]'}, {'audio_path': ''}, {'card_id': True}, {'card_id': '1'}]:
            with self.assertRaises(ValidationError):
                TextUpdatePreviewRequest(cards=[self.item(**extra)])
        request = TextUpdateApplyRequest(cards=[self.item()], preview_token='0'*64, request_id=uuid4())
        self.assertFalse(request.include_new)

    def test_real_http_routes_validate_permissions_preview_apply_and_retry(self):
        # Shared, ephemeral SQLite lets the sync FastAPI worker own/close its connection.
        from api.routers import decks as routes
        http_db = SqliteDatabase(f'file:text_update_{uuid4().hex}?mode=memory&cache=shared', uri=True)
        http_db.bind(TABLES)
        try:
            http_db.create_tables(TABLES)
            models.TMAUser.create(user_id=1, is_guest=False)
            models.TMAUser.create(user_id=2, is_guest=False)
            deck = models.TMA_Deck.create(user_id=1, name='HTTP')
            card = models.TMA_Card.create(deck=deck, front_text='Haus', back_text='дом')
            item = self.item(card, deck_id=deck.id, front='Haustür')
            app = FastAPI()
            app.include_router(routes.router, prefix='/api')
            with patch.object(routes, 'tma_db', http_db), patch.object(service, 'tma_db', http_db), TestClient(app) as client:
                path = f'/api/decks/{deck.id}/text-update'
                preview = client.post(path+'/preview', json={'cards': [item]})
                self.assertEqual(preview.status_code, 200)
                self.assertEqual(preview.json()['updated'], 1)
                payload = {'cards': [item], 'preview_token': preview.json()['preview_token'], 'request_id': str(uuid4())}
                response = client.post(path+'/apply', json=payload)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(client.post(path+'/apply', json=payload).json(), response.json())
                self.assertEqual(models.TMA_Card.get_by_id(card.id).front_text, 'Haustür')
                self.assertEqual(models.TMA_Card.select().count(), 1)
                self.assertEqual(client.post(path+'/preview', json={'cards': [dict(item, interval=0)]}).status_code, 422)
                app.dependency_overrides[routes.get_user_id] = lambda: 2
                self.assertEqual(client.post(path+'/preview', json={'cards': [item]}).status_code, 403)
                self.assertEqual(client.post(path+'/apply', json=payload).status_code, 403)
        finally:
            http_db.close()
            database.bind(TABLES)


if __name__ == '__main__':
    unittest.main()
