"""Characterize card transfers through the public services, using synthetic SQLite data."""
import datetime as dt
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from peewee import SqliteDatabase

from api import models, services
from api.services import cards, offline_sync, sync_service


OLD = dt.datetime(2020, 1, 1)
SINCE = '2020-01-02T00:00:00Z'
TABLES = [models.TMAUser, models.TMA_Folder, models.TMA_Deck, models.TMA_Card,
          models.TMA_Collaborator, models.TMAProgress, models.TMAReviewHistory,
          models.TMASetting]


class CardTransferTests(unittest.TestCase):
    def setUp(self):
        self.db = SqliteDatabase(':memory:')
        previous = models.tma_db.obj
        models.tma_db.initialize(self.db)
        self.addCleanup(models.tma_db.initialize, previous)
        self.addCleanup(self.db.close)
        self.db.create_tables(TABLES)
        for uid in (1, 2, 3):
            models.TMAUser.create(user_id=uid, default_decks_initialized=True)

    def pair(self):
        roots, decks = [], []
        for name in ('Source', 'Target'):
            root = models.TMA_Folder.create(user_id=1, name=name, updated_at=OLD)
            child = models.TMA_Folder.create(user_id=1, name=name, parent=root, updated_at=OLD)
            roots.extend([root, child])
            decks.append(models.TMA_Deck.create(user_id=1, name=name, folder=child, updated_at=OLD))
        return *decks, roots

    def card(self, deck, front='Haus', **values):
        return models.TMA_Card.create(deck=deck, front_text=front, back_text='Raw **back**',
                                     context='Raw context', creator_id=3, updated_at=OLD, **values)

    def snapshot(self, *tables):
        return [list(table.select().order_by(table._meta.primary_key).dicts()) for table in tables]

    def test_empty_selection_response_shapes(self):
        self.assertEqual(cards.batch_move_cards([], 999, 1), {'status': 'success', 'count': 0})
        self.assertEqual(cards.batch_copy_cards([], 999, 1), {
            'status': 'success', 'count': 0, 'created': 0, 'updated': 0, 'skipped': 0})

    def test_existing_imports_expose_the_transfer_functions(self):
        from api.services import card_transfer
        for name in ('batch_copy_cards', 'batch_move_cards', 'normalize_card_key'):
            self.assertIs(getattr(cards, name), getattr(card_transfer, name))
            self.assertIs(getattr(services, name), getattr(card_transfer, name))

    def test_selection_order_and_existing_empty_deck_positions(self):
        for operation in ('copy', 'move'):
            for occupied in (False, True):
                with self.subTest(operation=operation, occupied=occupied):
                    source, target, _ = self.pair()
                    first = self.card(source, 'First', position=20)
                    second = self.card(source, 'Second', position=10)
                    deleted = self.card(source, 'Deleted', is_deleted=True, position=100)
                    self.card(target, 'Old deleted', is_deleted=True, position=1000)
                    if occupied:
                        self.card(target, 'Existing', position=7)
                    result = getattr(cards, f'batch_{operation}_cards')(
                        [second.id, deleted.id, first.id], target.id, 1)
                    self.assertEqual(result, {'status': 'success', 'count': 2,
                        'created' if operation == 'copy' else 'moved': 2, 'updated': 0, 'skipped': 0})
                    active = list(models.TMA_Card.select().where(
                        (models.TMA_Card.deck == target) & ~models.TMA_Card.is_deleted
                        & (models.TMA_Card.front_text != 'Existing')).order_by(models.TMA_Card.id))
                    self.assertEqual({c.front_text: c.position for c in active},
                                     {'Second': 8, 'First': 9} if occupied else {'Second': 10, 'First': 20})
                    self.assertEqual({c.creator_id for c in active}, {3})

    def test_duplicates_created_earlier_in_selection_use_the_same_modes(self):
        for operation in ('copy', 'move'):
            for mode in ('skip', 'overwrite', 'keep'):
                with self.subTest(operation=operation, mode=mode):
                    source, target, _ = self.pair()
                    first = self.card(source, 'Guten Tag')
                    second = self.card(source, 'guten-tag')
                    result = getattr(cards, f'batch_{operation}_cards')(
                        [first.id, second.id], target.id, 1, mode)
                    self.assertEqual(result['created' if operation == 'copy' else 'moved'],
                                     2 if mode == 'keep' else 1)
                    self.assertEqual((result['updated'], result['skipped']),
                                     (int(mode == 'overwrite'), int(mode == 'skip')))
                    active = list(models.TMA_Card.select().where(
                        (models.TMA_Card.deck == target) & ~models.TMA_Card.is_deleted))
                    self.assertCountEqual([c.front_text for c in active],
                        ['Guten Tag', 'guten-tag'] if mode == 'keep' else
                        ['guten-tag' if mode == 'overwrite' else 'Guten Tag'])
                    self.assertEqual(models.TMA_Card.get_by_id(second.id).is_deleted,
                                     operation == 'move' and mode == 'overwrite')

    def test_progress_history_and_overwrite_target_identity_are_unchanged(self):
        for operation in ('copy', 'move'):
            for overwrite in (False, True):
                with self.subTest(operation=operation, overwrite=overwrite):
                    source, target, _ = self.pair()
                    original = self.card(source, 'Haus!', tags='synthetic', metadata='{"test": true}')
                    existing = self.card(target, 'haus' if overwrite else 'Other')
                    existing.creator_id = 2
                    existing.save()
                    for card in (original, existing):
                        for uid in (1, 2):
                            models.TMAProgress.create(card_id=card.id, user_id=uid, queue='review',
                                interval=17, ease_factor=2.3, repetitions=4, lapses=2, flag=3,
                                want_to_learn=True, next_review=OLD, updated_at=OLD)
                            models.TMAReviewHistory.create(card_id=card.id, user_id=uid, rating=3,
                                                           scheduled_interval=17, review_time=OLD)
                    before = self.snapshot(models.TMAProgress, models.TMAReviewHistory)
                    target_before = dict(models.TMA_Card.get_by_id(existing.id).__data__)
                    source_before = dict(models.TMA_Card.get_by_id(original.id).__data__)
                    getattr(cards, f'batch_{operation}_cards')([original.id], target.id, 1, 'overwrite')
                    self.assertEqual(self.snapshot(models.TMAProgress, models.TMAReviewHistory), before)
                    saved_target = models.TMA_Card.get_by_id(existing.id)
                    if overwrite:
                        self.assertEqual(saved_target.id, existing.id)
                        self.assertEqual(saved_target.creator_id, target_before['creator_id'])
                        self.assertEqual(saved_target.front_text, 'Haus!')
                        self.assertEqual(saved_target.metadata, original.metadata)
                    else:
                        self.assertEqual(saved_target.__data__, target_before)
                    saved_source = models.TMA_Card.get_by_id(original.id)
                    if operation == 'copy':
                        self.assertEqual(saved_source.__data__, source_before)
                    else:
                        self.assertEqual(saved_source.is_deleted, overwrite)
                        self.assertEqual(saved_source.deck_id, source.id if overwrite else target.id)

    def test_whole_selection_and_target_are_authorized_before_writes(self):
        source, target, _ = self.pair()
        allowed = self.card(source)
        private = models.TMA_Deck.create(user_id=2, name='Private')
        forbidden = self.card(private, 'Private')
        for operation in ('copy', 'move'):
            for ids, destination, status in (
                ([allowed.id, forbidden.id], target.id, 403),
                ([allowed.id, 99999], target.id, 404),
                ([allowed.id], private.id, 403),
                ([allowed.id], 99999, 404),
            ):
                with self.subTest(operation=operation, ids=ids, destination=destination):
                    before = self.snapshot(*TABLES)
                    with self.assertRaises(HTTPException) as error:
                        getattr(cards, f'batch_{operation}_cards')(ids, destination, 1)
                    self.assertEqual(error.exception.status_code, status)
                    self.assertEqual(self.snapshot(*TABLES), before)

    def test_late_failure_rolls_back_cards_decks_and_parent_timestamps(self):
        for operation in ('copy', 'move'):
            with self.subTest(operation=operation):
                source, target, _ = self.pair()
                originals = [self.card(source, front) for front in ('First', 'Second')]
                before = self.snapshot(*TABLES)
                from api.services.collaborative_service import touch_deck_and_parent_folders

                def touch_then_fail(*args, **kwargs):
                    touch_deck_and_parent_folders(*args, **kwargs)
                    raise RuntimeError('Synthetic failure after writes')

                with patch('api.services.collaborative_service.touch_deck_and_parent_folders',
                           side_effect=touch_then_fail), self.assertRaisesRegex(RuntimeError, 'Synthetic'):
                    getattr(cards, f'batch_{operation}_cards')([c.id for c in originals], target.id, 1)
                self.assertEqual(self.snapshot(*TABLES), before)

    def test_transfers_and_overwrite_tombstones_reach_all_pull_paths(self):
        for operation in ('copy', 'move'):
            for overwrite in (False, True):
                with self.subTest(operation=operation, overwrite=overwrite):
                    source, target, folders = self.pair()
                    original = self.card(source)
                    existing = self.card(target, 'Haus' if overwrite else 'Other')
                    # Direct deck grants let the collaborator observe both ends.
                    for deck in (source, target):
                        models.TMA_Collaborator.create(target_type='deck', target_id=deck.id,
                                                       user_id=2, role='viewer', added_by=1)
                    getattr(cards, f'batch_{operation}_cards')([original.id], target.id, 1, 'overwrite')
                    active = models.TMA_Card.get((models.TMA_Card.deck == target)
                        & (models.TMA_Card.front_text == 'Haus') & ~models.TMA_Card.is_deleted)
                    expected = {active.id}
                    if operation == 'move' and overwrite:
                        expected.add(original.id)
                    for pull in (sync_service.execute_sync_pull(SINCE, 1),
                                 sync_service.execute_collab_pull(SINCE, 2)):
                        changed = {c['id']: c for c in pull['cards'] if c['id'] in (original.id, active.id)}
                        self.assertEqual(set(changed), expected)
                        self.assertEqual(changed[active.id]['deck_id'], target.id)
                        if operation == 'move' and overwrite:
                            self.assertTrue(changed[original.id]['is_deleted'])
                    snapshot = {c['id']: c for c in offline_sync.pull_offline(2)['cards']}
                    self.assertEqual(snapshot[active.id]['deck_id'], target.id)
                    self.assertEqual(snapshot[original.id]['is_deleted'], operation == 'move' and overwrite)
                    touched = folders if operation == 'move' else folders[2:]
                    for folder in folders:
                        self.assertEqual(models.TMA_Folder.get_by_id(folder.id).updated_at > OLD,
                                         folder in touched)
                    self.assertEqual(models.TMA_Deck.get_by_id(source.id).updated_at > OLD, operation == 'move')
                    self.assertGreater(models.TMA_Deck.get_by_id(target.id).updated_at, OLD)
                    if overwrite:
                        self.assertEqual(active.id, existing.id)

    def test_same_deck_move_keeps_card_unchanged(self):
        source, _, _ = self.pair()
        original = self.card(source, position=12)
        before = dict(models.TMA_Card.get_by_id(original.id).__data__)
        self.assertEqual(cards.batch_move_cards([original.id], source.id, 1), {
            'status': 'success', 'count': 0, 'moved': 0, 'updated': 0, 'skipped': 0})
        self.assertEqual(models.TMA_Card.get_by_id(original.id).__data__, before)


if __name__ == '__main__':
    unittest.main()
