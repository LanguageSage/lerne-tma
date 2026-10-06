"""Folder maintenance on isolated SQLite; never access the configured database."""
import datetime
import json
import subprocess
import unittest
from unittest.mock import patch
from uuid import uuid4
from pathlib import Path

from fastapi import HTTPException, FastAPI
from fastapi.testclient import TestClient
from peewee import SqliteDatabase
from test_offline_sync import database, models, TABLES
from api.services import card_text_update as service

ROOT = Path(__file__).resolve().parents[2]


class FolderTextUpdateTests(unittest.TestCase):
    def setUp(self):
        database.create_tables(TABLES)
        for identifier in (1, 2):
            models.TMAUser.create(user_id=identifier, is_guest=False)
        self.root = models.TMA_Folder.create(user_id=1, name='Deutsch B1', position=4)
        self.child = models.TMA_Folder.create(user_id=1, name='Child', parent=self.root)
        self.deep = models.TMA_Folder.create(user_id=1, name='Deep', parent=self.child)
        self.other = models.TMA_Folder.create(user_id=1, name='Other')
        self.decks = [models.TMA_Deck.create(user_id=1, name=f'Deck {index}', folder=folder, position=index)
                      for index, folder in enumerate((self.root, self.child, self.deep, self.root, self.other), 1)]
        self.cards = [models.TMA_Card.create(deck=deck, front_text=f'Haus {index}', back_text='дом',
                      context='One\n\nTwo', position=index, tags='B1,custom', metadata='{"cefr":{"level":"B1"},"other":42}',
                      image_path='image.png', audio_path='front.mp3', audio_back_path='back.mp3',
                      source='original', creator_id=1, history='[{"old":1}]', flag=3)
                      for index, deck in enumerate(self.decks, 1)]
        self.omitted = models.TMA_Card.create(deck=self.decks[0], front_text='Omitted', back_text='omitted', position=99)

    def tearDown(self):
        database.drop_tables(TABLES)

    def item(self, card=None, **changes):
        card = card or self.cards[0]
        result = dict(number=card.id, card_id=card.id, deck_id=card.deck_id,
                      **service._content(card), card_type='standard')
        result.update(changes)
        return result

    def preview(self, items, user=1):
        return service.preview_folder_text_update(self.root.id, user, items)

    def apply(self, items, preview=None, user=1, **options):
        return service.apply_folder_text_update(self.root.id, user, items,
            (preview or self.preview(items, user))['preview_token'], options.pop('request_id', str(uuid4())), **options)

    def assert_blocked(self, items):
        preview = self.preview(items)
        self.assertFalse(preview['can_apply'])
        before = [card.__data__.copy() for card in models.TMA_Card.select().order_by(models.TMA_Card.id)]
        with self.assertRaises(HTTPException) as error:
            self.apply(items, preview, include_new=True)
        self.assertEqual(error.exception.status_code, 422)
        self.assertEqual(before, [card.__data__ for card in models.TMA_Card.select().order_by(models.TMA_Card.id)])
        self.assertEqual(models.TMAOfflineBatch.select().count(), 0)
        return preview

    def test_real_folder_export_edit_parse_preview_apply_ignores_headings(self):
        script = """
import {serializeFolder} from './app/src/utils/cardTextSerializer.js';
import {parseCardTextUpdate} from './app/src/utils/cardTextUpdateParser.js';
let raw='';for await(const chunk of process.stdin)raw+=chunk;
const source=serializeFolder(JSON.parse(raw)).text.replace(/# Deck: [^\\n]+/g,'# Deck: Renamed in file')
  .replace('Haus 1','Edited one').replace('Haus 2','Edited two');
process.stdout.write(JSON.stringify(parseCardTextUpdate(source,{requireDeckId:true})));
"""
        sections = [{'deck': {'id': deck.id, 'name': deck.name},
                     'cards': [dict(id=card.id, **service._content(card))]}
                    for deck, card in zip(self.decks[:3], self.cards[:3])]
        parsed = json.loads(subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT,
            input=json.dumps(sections), text=True, encoding='utf-8', capture_output=True, check=True).stdout)
        self.assertEqual(parsed['errors'], [])
        preview = self.preview(parsed['cards'])
        self.assertEqual((preview['deck_count'], preview['updated'], preview['unchanged']), (3, 2, 1))
        self.apply(parsed['cards'], preview)
        self.assertEqual([deck.name for deck in models.TMA_Deck.select()], [deck.name for deck in self.decks])
        self.assertEqual(models.TMA_Folder.get_by_id(self.root.id).name, 'Deutsch B1')
        self.assertEqual(models.TMA_Card.select().count(), 6)

    def test_updates_multiple_nested_decks_without_increasing_count_or_moving_cards(self):
        items = [self.item(card, front='Edited '+str(card.id)) for card in self.cards[:3]]
        before = {card.id: (card.deck_id, card.position) for card in models.TMA_Card.select()}
        preview = self.preview(items)
        self.assertEqual(preview['updated'], 3)
        result = self.apply(items, preview)
        self.assertEqual(result['updated'], 3)
        self.assertEqual(len(result['decks']), 3)
        self.assertEqual(before, {card.id: (card.deck_id, card.position) for card in models.TMA_Card.select()})

    def test_unchanged_does_not_write_timestamps_or_technical_fields(self):
        items = [self.item(card) for card in self.cards[:3]]
        before = [card.__data__.copy() for card in models.TMA_Card.select()]
        preview = self.preview(items)
        self.assertEqual(preview['unchanged'], 3)
        self.assertEqual(self.apply(items, preview)['updated'], 0)
        self.assertEqual(before, [card.__data__ for card in models.TMA_Card.select()])

    def test_new_candidates_are_added_only_when_opted_in_to_the_declared_deck(self):
        items = [self.item(card, card_id=None, front='New '+str(card.id)) for card in self.cards[:2]]
        preview = self.preview(items)
        self.assertEqual(preview['new'], 2)
        self.assertEqual(self.apply(items, preview)['skipped_new'], 2)
        self.assertEqual(models.TMA_Card.select().count(), 6)
        self.assertEqual(self.apply(items, preview, include_new=True)['created'], 2)
        created = list(models.TMA_Card.select().where(models.TMA_Card.source == 'text_update').order_by(models.TMA_Card.id))
        self.assertEqual([card.deck_id for card in created], [deck.id for deck in self.decks[:2]])
        self.assertEqual([card.position for card in created], [100, 3])

    def test_missing_deck_id_blocks_new_and_existing_cards(self):
        for identifier in [None, self.cards[0].id]:
            preview = self.assert_blocked([self.item(card_id=identifier, deck_id=None)])
            self.assertIn('missing_deck_id', preview['cards'][0]['errors'])

    def test_unknown_card_id_is_missing_and_never_created(self):
        preview = self.assert_blocked([self.item(card_id=999999)])
        self.assertEqual(preview['missing'], 1)

    def test_unknown_and_deleted_deck_ids_are_critical(self):
        self.decks[1].is_deleted = True
        self.decks[1].save()
        for identifier in [999999, self.decks[1].id]:
            preview = self.assert_blocked([self.item(deck_id=identifier)])
            self.assertIn('missing_deck', preview['cards'][0]['errors'])

    def test_same_owner_deck_outside_folder_is_blocked_without_disclosing_content(self):
        preview = self.assert_blocked([self.item(self.cards[4])])
        self.assertIn('deck_outside_folder', preview['cards'][0]['errors'])
        self.assertIsNone(preview['cards'][0]['before'])
        self.assertIsNone(preview['decks'][0]['deck_name'])

    def test_foreign_private_deck_cannot_be_updated_or_disclosed(self):
        other = models.TMA_Deck.create(user_id=2, name='Private secret')
        card = models.TMA_Card.create(deck=other, front_text='Secret text', back_text='secret')
        preview = self.assert_blocked([self.item(card, front='User input', back='User back', context='')])
        self.assertNotIn('Secret', json.dumps(preview))
        self.assertNotIn('Private secret', json.dumps(preview))

    def test_folder_viewer_and_guest_cannot_preview_or_apply(self):
        models.TMA_Collaborator.create(target_type='folder', target_id=self.root.id, user_id=2, role='viewer')
        items = [self.item(front='Changed')]
        for operation in [lambda: self.preview(items, user=2), lambda: self.apply(items, user=2)]:
            with self.assertRaises(HTTPException) as error:
                operation()
            self.assertEqual(error.exception.status_code, 403)
        models.TMAUser.update(is_guest=True).where(models.TMAUser.user_id == 1).execute()
        with self.assertRaises(HTTPException):
            self.preview(items)

    def test_folder_editor_can_update_deep_descendants(self):
        models.TMA_Collaborator.create(target_type='folder', target_id=self.root.id, user_id=2, role='editor')
        result = self.apply([self.item(self.cards[2], front='Deep edited')], user=2)
        self.assertEqual(result['updated'], 1)
        self.assertEqual(models.TMA_Card.get_by_id(self.cards[2].id).creator_id, 1)

    def test_per_deck_viewer_blocks_whole_operation_even_when_folder_is_editable(self):
        models.TMA_Deck.update(user_id=2).where(models.TMA_Deck.id == self.decks[1].id).execute()
        models.TMA_Collaborator.create(target_type='deck', target_id=self.decks[1].id, user_id=1, role='viewer')
        preview = self.assert_blocked([self.item(front='Must rollback'), self.item(self.cards[1], front='No permission')])
        self.assertIn('readonly_deck', preview['decks'][1]['scope_errors'])

    def test_card_cannot_be_moved_between_allowed_decks_by_forged_deck_id(self):
        preview = self.assert_blocked([self.item(deck_id=self.decks[1].id, front='Move')])
        self.assertIn('foreign_card_id', preview['cards'][0]['errors'])
        self.assertEqual(models.TMA_Card.get_by_id(self.cards[0].id).deck_id, self.decks[0].id)

    def test_duplicate_card_ids_across_decks_are_reported_globally(self):
        preview = self.assert_blocked([self.item(), self.item(deck_id=self.decks[1].id, number=99)])
        self.assertTrue(all('duplicate_card_id' in row['errors'] for row in preview['cards']))

    def test_all_syntax_and_scope_errors_are_collected_before_any_write(self):
        preview = self.assert_blocked([self.item(front='Valid'), self.item(self.cards[1], front=''),
            self.item(self.cards[2], front='[[broken'), self.item(self.cards[4])])
        self.assertEqual(preview['errors'], 3)
        self.assertEqual(len(preview['decks']), 4)

    def test_omitted_card_and_omitted_deck_and_folder_structure_are_untouched(self):
        before = {row.id: row.__data__.copy() for row in models.TMA_Card.select()}
        decks = [row.__data__.copy() for row in models.TMA_Deck.select()]
        folders = [row.__data__.copy() for row in models.TMA_Folder.select()]
        self.apply([self.item(front='Changed')])
        for row in models.TMA_Card.select():
            if row.id != self.cards[0].id:
                self.assertEqual(row.__data__, before[row.id])
        self.assertEqual(decks, [row.__data__ for row in models.TMA_Deck.select()])
        self.assertEqual(folders, [row.__data__ for row in models.TMA_Folder.select()])

    def test_srs_history_media_provenance_author_ownership_and_positions_are_preserved(self):
        for card in self.cards[:3]:
            models.TMAProgress.create(user_id=1, card_id=card.id, interval=17, repetitions=8, queue='review', flag=4, want_to_learn=True)
            models.TMAProgress.create(user_id=2, card_id=card.id, interval=42, queue='review')
            models.TMAReviewHistory.create(user_id=1, card_id=card.id, rating=3, scheduled_interval=17)
        progress = [row.__data__.copy() for row in models.TMAProgress.select()]
        history = [row.__data__.copy() for row in models.TMAReviewHistory.select()]
        before = {row.id: row.__data__.copy() for row in models.TMA_Card.select()}
        self.apply([self.item(card, front='Changed '+str(card.id)) for card in self.cards[:3]])
        for row in models.TMA_Card.select():
            saved = row.__data__.copy()
            old = before[row.id]
            for field in ['front_text', 'card_type', 'updated_at']:
                saved.pop(field, None)
                old.pop(field, None)
            self.assertEqual(saved, old)
        self.assertEqual(progress, [row.__data__ for row in models.TMAProgress.select()])
        self.assertEqual(history, [row.__data__ for row in models.TMAReviewHistory.select()])

    def test_stale_content_in_any_affected_deck_blocks_all_updates(self):
        items = [self.item(front='Changed'), self.item(self.cards[1], front='Changed two')]
        preview = self.preview(items)
        models.TMA_Card.update(back_text='Concurrent editor').where(models.TMA_Card.id == self.cards[1].id).execute()
        with self.assertRaises(HTTPException) as error:
            self.apply(items, preview)
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(models.TMA_Card.get_by_id(self.cards[0].id).front_text, self.cards[0].front_text)

    def test_changed_composition_and_deleted_referenced_card_are_stale(self):
        items = [self.item(front='Changed')]
        preview = self.preview(items)
        models.TMA_Card.create(deck=self.decks[0], front_text='Added concurrently', back_text='x')
        with self.assertRaises(HTTPException) as error:
            self.apply(items, preview)
        self.assertEqual(error.exception.status_code, 409)
        preview = self.preview(items)
        models.TMA_Card.update(is_deleted=True).where(models.TMA_Card.id == self.cards[0].id).execute()
        with self.assertRaises(HTTPException) as error:
            self.apply(items, preview)
        self.assertEqual(error.exception.status_code, 409)

    def test_omitted_card_content_within_affected_deck_invalidates_preview(self):
        items = [self.item(front='Changed')]
        preview = self.preview(items)
        models.TMA_Card.update(front_text='Concurrent').where(models.TMA_Card.id == self.omitted.id).execute()
        self.assertNotEqual(self.preview(items)['preview_token'], preview['preview_token'])

    def test_unaffected_deck_and_unrelated_folder_changes_do_not_invalidate(self):
        items = [self.item(front='Changed')]
        preview = self.preview(items)
        models.TMA_Card.update(front_text='Unrelated').where(models.TMA_Card.id == self.cards[3].id).execute()
        models.TMA_Card.create(deck=self.decks[3], front_text='New unrelated', back_text='x')
        models.TMA_Folder.update(name='Other rename', updated_at=datetime.datetime.now()).where(models.TMA_Folder.id == self.other.id).execute()
        self.assertEqual(self.preview(items)['preview_token'], preview['preview_token'])
        self.assertEqual(self.apply(items, preview)['updated'], 1)

    def test_progress_changes_do_not_invalidate_content_preview(self):
        items = [self.item(front='Changed')]
        preview = self.preview(items)
        models.TMAProgress.create(user_id=1, card_id=self.cards[0].id, interval=100)
        self.assertEqual(self.preview(items)['preview_token'], preview['preview_token'])
        self.assertEqual(self.apply(items, preview)['updated'], 1)

    def test_deck_or_ancestor_moved_outside_scope_blocks_stale_apply(self):
        items = [self.item(self.cards[1], front='Changed')]
        preview = self.preview(items)
        models.TMA_Folder.update(parent=self.other).where(models.TMA_Folder.id == self.child.id).execute()
        with self.assertRaises(HTTPException) as error:
            self.apply(items, preview)
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(models.TMA_Card.get_by_id(self.cards[1].id).front_text, self.cards[1].front_text)

    def test_deck_and_folder_renames_do_not_change_fingerprint_or_get_overwritten(self):
        items = [self.item(front='Changed')]
        preview = self.preview(items)
        models.TMA_Deck.update(name='Current name').where(models.TMA_Deck.id == self.decks[0].id).execute()
        models.TMA_Folder.update(name='Current root').where(models.TMA_Folder.id == self.root.id).execute()
        self.assertEqual(self.preview(items)['preview_token'], preview['preview_token'])
        self.apply(items, preview)
        self.assertEqual(models.TMA_Deck.get_by_id(self.decks[0].id).name, 'Current name')

    def test_lost_response_retry_does_not_add_copies_reapply_or_reorder(self):
        items = [self.item(front='Changed'), self.item(self.cards[1], card_id=None, front='New')]
        preview = self.preview(items)
        request_id = str(uuid4())
        first = self.apply(items, preview, include_new=True, request_id=request_id)
        after = [row.__data__.copy() for row in models.TMA_Card.select()]
        self.assertEqual(self.apply(items, preview, include_new=True, request_id=request_id), first)
        self.assertEqual(after, [row.__data__ for row in models.TMA_Card.select()])
        with self.assertRaises(HTTPException) as error:
            self.apply(items, preview, include_new=False, request_id=request_id)
        self.assertEqual(error.exception.detail['code'], 'request_changed')

    def test_failure_after_updates_in_several_decks_rolls_back_entire_folder_and_receipt(self):
        items = [self.item(front='Changed'), self.item(card_id=None, number=100, front='New'), self.item(self.cards[1], front='Changed two')]
        preview = self.preview(items)
        before = [row.__data__.copy() for row in models.TMA_Card.select()]
        original = service._apply_rows
        calls = []
        def fail_after_second(*args, **kwargs):
            result = original(*args, **kwargs)
            calls.append(args[0].id)
            if len(calls) == 2:
                raise RuntimeError('after writes in second deck')
            return result
        with patch.object(service, '_apply_rows', side_effect=fail_after_second):
            with self.assertRaises(RuntimeError):
                self.apply(items, preview, include_new=True)
        self.assertEqual(len(calls), 2)
        self.assertEqual(before, [row.__data__ for row in models.TMA_Card.select()])
        self.assertEqual(models.TMAOfflineBatch.select().count(), 0)

    def test_retry_rechecks_permission_after_editor_becomes_viewer(self):
        collaborator = models.TMA_Collaborator.create(target_type='folder', target_id=self.root.id, user_id=2, role='editor')
        items = [self.item(front='Changed')]
        preview = self.preview(items, user=2)
        request_id = str(uuid4())
        self.apply(items, preview, user=2, request_id=request_id)
        collaborator.role = 'viewer'
        collaborator.save()
        with self.assertRaises(HTTPException) as error:
            self.apply(items, preview, user=2, request_id=request_id)
        self.assertEqual(error.exception.status_code, 403)

    def test_real_http_folder_routes_apply_multiple_decks_and_reject_viewer(self):
        from api.routers import folders as routes
        http_db = SqliteDatabase(f'file:folder_text_{uuid4().hex}?mode=memory&cache=shared', uri=True)
        http_db.bind(TABLES)
        try:
            http_db.create_tables(TABLES)
            for identifier in (1, 2):
                models.TMAUser.create(user_id=identifier, is_guest=False)
            root = models.TMA_Folder.create(user_id=1, name='HTTP')
            decks = [models.TMA_Deck.create(user_id=1, name=str(index), folder=root) for index in (1, 2)]
            cards = [models.TMA_Card.create(deck=deck, front_text='Old', back_text='x') for deck in decks]
            items = [self.item(card, front='Changed') for card in cards]
            app = FastAPI()
            app.include_router(routes.router, prefix='/api')
            with patch.object(routes, 'tma_db', http_db), patch.object(service, 'tma_db', http_db), TestClient(app) as client:
                path = f'/api/folders/{root.id}/text-update'
                preview = client.post(path+'/preview', json={'cards': items})
                self.assertEqual(preview.status_code, 200)
                self.assertEqual(preview.json()['updated'], 2)
                payload = {'cards': items, 'preview_token': preview.json()['preview_token'], 'request_id': str(uuid4())}
                result = client.post(path+'/apply', json=payload)
                self.assertEqual(result.status_code, 200)
                self.assertEqual(client.post(path+'/apply', json=payload).json(), result.json())
                self.assertEqual([card.front_text for card in models.TMA_Card.select()], ['Changed', 'Changed'])
                self.assertEqual(client.post(path+'/preview', json={'cards': [dict(items[0], history='[]')]}).status_code, 422)
                models.TMA_Collaborator.create(target_type='folder', target_id=root.id, user_id=2, role='viewer')
                app.dependency_overrides[routes.get_user_id] = lambda: 2
                self.assertEqual(client.post(path+'/apply', json=payload).status_code, 403)
        finally:
            http_db.close()
            database.bind(TABLES)


if __name__ == '__main__':
    unittest.main()
