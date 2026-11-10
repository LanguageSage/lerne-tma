"""Native maintenance invariants over isolated SQL; row locks also run on real PG."""
import copy
import json
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from test_offline_sync import database, models, TABLES
from native_fixture import content, sqlite_native
from api.services import card_text_update as service
from api.routers.card_text_update_models import TextUpdatePreviewRequest


class NativeContentUpdates(unittest.TestCase):
    def setUp(self):
        sqlite_native(self, database, writes=True)
        database.create_tables(TABLES)
        models.TMAUser.create(user_id=1, is_guest=False)
        models.TMAUser.create(user_id=2, is_guest=False)
        self.root = models.TMA_Folder.create(user_id=1, name='Root')
        self.child = models.TMA_Folder.create(user_id=1, parent=self.root, name='Child')
        self.decks = [models.TMA_Deck.create(user_id=1, folder=folder, name=str(i))
                      for i, folder in enumerate((self.root, self.child))]
        self.cards = [models.TMA_Card.create(deck=deck, content_v2=content('Before', 'Answer',
            metadata={'custom': {'keep': True}}, topics=['A,B']), card_type=None, position=7,
            audio_path='front.ogg', audio_back_path='back.ogg', image_path='image.webp', creator_id=1,
            history='["keep"]') for deck in self.decks]
        for card in self.cards:
            models.TMAProgress.create(card_id=card.id, user_id=1, interval=12, repetitions=4)
            models.TMAReviewHistory.create(card_id=card.id, user_id=1, rating=2)

    def tearDown(self):
        database.drop_tables(TABLES)

    def item(self, index=0, **fields):
        card = self.cards[index]
        value = copy.deepcopy(card.content_v2)
        value['card']['data']['prompt'] = 'After'
        return {'number': index + 1, 'deck_id': card.deck_id, 'card_id': card.id,
                'content_v2': value, **fields}

    def preview(self, items):
        return service.preview_folder_text_update(self.root.id, 1, items)

    def apply(self, items, preview=None, request_id=None, include_new=False):
        return service.apply_folder_text_update(self.root.id, 1, items,
            (preview or self.preview(items))['preview_token'], request_id or str(uuid4()), include_new)

    def snapshot(self):
        return {table._meta.table_name: list(table.select().dicts()) for table in TABLES}

    def test_updates_nested_decks_preserving_ids_media_all_learner_links_and_metadata(self):
        before = self.snapshot()
        result = self.apply([self.item(0), self.item(1)])
        self.assertEqual((result['updated'], result['created']), (2, 0))
        after = self.snapshot()
        for old, new in zip(before['tma_card'], after['tma_card']):
            self.assertEqual(new['content_v2']['card']['data']['prompt'], 'After')
            for key in old.keys() - {'content_v2', 'updated_at'}:
                self.assertEqual(new[key], old[key], key)
        for table in before.keys() - {'tma_card', 'tma_offline_batch'}:
            self.assertEqual(before[table], after[table], table)

    def test_replay_and_changed_request_id_are_transactional(self):
        items = [self.item(), self.item(1)]
        preview, identifier = self.preview(items), str(uuid4())
        result = self.apply(items, preview, identifier)
        self.assertEqual(self.apply(items, preview, identifier), result)
        changed = copy.deepcopy(items)
        changed[0]['content_v2']['card']['explanation'] = 'Different'
        with self.assertRaises(HTTPException) as error:
            self.apply(changed, preview, identifier)
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(models.TMAOfflineBatch.select().count(), 1)

    def test_unchanged_does_not_write_content_or_timestamps(self):
        item = self.item(content_v2=self.cards[0].content_v2)
        before = self.snapshot()['tma_card']
        self.assertEqual(self.apply([item])['unchanged'], 1)
        self.assertEqual(self.snapshot()['tma_card'], before)

    def test_unknown_duplicate_foreign_deleted_and_missing_scope_never_write(self):
        outside = models.TMA_Deck.create(user_id=2, name='Private')
        candidates = [self.item(card_id=9999), self.item(deck_id=outside.id), self.item(deck_id=None),
                      self.item(deck_id=self.decks[1].id)]
        for items in [[item] for item in candidates] + [[self.item(), self.item()]]:
            with self.subTest(items=items):
                before = self.snapshot()
                self.assertFalse(self.preview(items)['can_apply'])
                with self.assertRaises(HTTPException):
                    self.apply(items)
                self.assertEqual(self.snapshot(), before)
        models.TMA_Card.update(is_deleted=True).where(models.TMA_Card.id == self.cards[0].id).execute()
        self.assertFalse(self.preview([self.item()])['can_apply'])

    def test_new_cards_require_opt_in_and_preserve_existing_rows(self):
        item = self.item(card_id=None)
        self.assertEqual(self.apply([item])['skipped_new'], 1)
        self.assertEqual(models.TMA_Card.select().count(), 2)
        preview, identifier = self.preview([item]), str(uuid4())
        first = self.apply([item], preview, identifier, True)
        self.assertEqual(first['created'], 1)
        self.assertEqual(self.apply([item], preview, identifier, True), first)
        self.assertEqual(models.TMA_Card.select().count(), 3)

    def test_content_media_and_position_changes_invalidate_but_progress_does_not(self):
        items = [self.item()]
        preview = self.preview(items)
        models.TMAProgress.update(repetitions=11).execute()
        self.assertEqual(self.preview(items)['preview_token'], preview['preview_token'])
        for field, value in [('audio_path', 'changed.ogg'), ('position', 99)]:
            before = self.cards[0].__data__[field]
            models.TMA_Card.update(**{field: value}).where(models.TMA_Card.id == self.cards[0].id).execute()
            with self.assertRaises(HTTPException) as error:
                self.apply(items, preview)
            self.assertEqual(error.exception.status_code, 409)
            models.TMA_Card.update(**{field: before}).where(models.TMA_Card.id == self.cards[0].id).execute()

    def test_failure_in_second_deck_rolls_back_content_new_cards_and_receipt(self):
        before = self.snapshot()
        original = service.replace_v2_card
        calls = []
        def fail(card_id, value):
            calls.append(card_id)
            if len(calls) == 2:
                raise RuntimeError('synthetic write failure')
            return original(card_id, value)
        with patch.object(service, 'replace_v2_card', side_effect=fail):
            with self.assertRaisesRegex(RuntimeError, 'synthetic write failure'):
                self.apply([self.item(), self.item(1)])
        self.assertEqual(len(calls), 2)
        self.assertEqual(self.snapshot(), before)

    def test_old_payload_unknown_fields_and_invalid_native_content_are_rejected(self):
        for item in [dict(number=1, front='V1', back='V1'), self.item(progress={}),
                     self.item(content_v2={'schema_version': 1, 'front': 'V1'})]:
            with self.subTest(item=item), self.assertRaises(ValidationError):
                TextUpdatePreviewRequest(cards=[item])
        bad = self.item(content_v2={'schema_version': 2, 'card': {'type': 'quiz', 'data': {}}})
        self.assertFalse(self.preview([bad])['can_apply'])

    def test_folder_permission_revocation_rechecked_on_replay(self):
        items = [self.item()]
        preview = self.preview(items)
        models.TMA_Folder.update(user_id=2).where(models.TMA_Folder.id == self.root.id).execute()
        with self.assertRaises(HTTPException):
            self.apply(items, preview)

    def test_json_export_roundtrip_keeps_native_layout_metadata_and_identifiers(self):
        from api.services.author_service import serialize_folder, parse_document
        exported = serialize_folder(self.root, [(deck, [card]) for deck, card in zip(self.decks, self.cards)])
        parsed = parse_document(exported)
        self.assertEqual(parsed['errors'], [])
        self.assertEqual([row['card_id'] for row in parsed['cards']], [card.id for card in self.cards])
        for row, card in zip(parsed['cards'], self.cards):
            value = copy.deepcopy(card.content_v2)
            self.assertEqual(row['content_v2'], value)
