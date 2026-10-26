"""Isolated annotation contracts; no configured database or external services."""
import unittest
from uuid import uuid4
from fastapi import HTTPException
from test_offline_sync import database, models, TABLES
from api.routers import card_notes as router
from api.migrations import run_card_notes_migration
from peewee import SqliteDatabase


class CardNoteTests(unittest.TestCase):
    def setUp(self):
        database.create_tables(TABLES)
        run_card_notes_migration(database)
        self.deck = models.TMA_Deck.create(user_id=1, name='Notes')
        self.card = models.TMA_Card.create(deck=self.deck, front_text='Hallo', back_text='Hello')
        models.TMA_Collaborator.create(target_type='deck', target_id=self.deck.id, user_id=2, role='viewer')

    def tearDown(self):
        database.drop_tables([models.TMACardNote, *TABLES])
        database.execute_sql('DROP TABLE tma_migration_history')

    def save(self, user=1, note_id=None, card=None, **values):
        return router.save_note(card or self.card.id, note_id or uuid4(),
            router.NoteWrite(**{'kind': 'note', 'text': 'Remember', **values}), user)

    def test_ownership_viewer_notes_and_retries(self):
        note = self.save(user=2)
        self.assertEqual(len(router.list_notes(self.card.id, 2)), 1)
        self.assertEqual(router.list_notes(self.card.id, 1), [])
        self.save(user=2, note_id=note['id'], text='Updated')
        self.assertEqual(models.TMACardNote.select().count(), 1)
        self.assertEqual(router.list_notes(self.card.id, 2)[0]['text'], 'Updated')
        with self.assertRaises(HTTPException) as caught:
            self.save(note_id=note['id'], text='Steal')
        self.assertEqual(caught.exception.status_code, 404)
        with self.assertRaises(HTTPException):
            router.list_notes(self.card.id, 3)

    def test_card_edits_leave_annotations_and_progress_untouched(self):
        note = self.save()
        models.TMA_Card.update(front_text='Changed').where(models.TMA_Card.id == self.card.id).execute()
        self.assertEqual(router.list_notes(self.card.id, 1)[0]['id'], note['id'])
        self.assertEqual(models.TMAProgress.select().count(), 0)
        self.assertEqual(models.TMAReviewHistory.select().count(), 0)

    def test_only_personal_notes_allow_edit_delete_and_card_purge_cascades(self):
        suggestion = self.save(kind='suggestion')
        for values in ({'text': 'Changed'}, {'is_deleted': True}):
            with self.subTest(values=values), self.assertRaises(HTTPException):
                self.save(note_id=suggestion['id'], kind='suggestion', **values)
        self.save()
        self.card.delete_instance()
        self.assertEqual(models.TMACardNote.select().count(), 0)

    def test_seen_revision_cannot_consume_a_newer_reply_or_go_backwards(self):
        note = self.save(kind='suggestion', seen_revision=1)
        models.TMACardNote.update(reply='Checked', status='reviewed', revision=2).execute()
        stale = self.save(note_id=note['id'], kind='suggestion', seen_revision=1)
        self.assertEqual((stale['revision'], stale['seen_revision']), (2, 1))
        read = self.save(note_id=note['id'], kind='suggestion', seen_revision=2)
        self.assertEqual(read['seen_revision'], 2)
        old = self.save(note_id=note['id'], kind='suggestion', seen_revision=0)
        self.assertEqual(old['seen_revision'], 2)
        self.assertEqual(old['reply'], 'Checked')
        self.assertEqual(old['status'], 'reviewed')

    def test_delete_tombstone_prevents_stale_device_resurrection(self):
        note = self.save()
        deleted = self.save(note_id=note['id'], is_deleted=True)
        self.assertTrue(deleted['is_deleted'])
        replay = self.save(note_id=note['id'])
        self.assertTrue(replay['is_deleted'])

    def test_read_acknowledgement_never_rewrites_text_from_another_device(self):
        note = self.save()
        self.save(note_id=note['id'], text='Newer device edit')
        result = router.save_note(self.card.id, note['id'], router.NoteWrite(kind='note', seen_revision=1), 1)
        self.assertEqual(result['text'], 'Newer device edit')

    def test_card_scope_kind_blank_and_deleted_card(self):
        note = self.save()
        other = models.TMA_Card.create(deck=self.deck, front_text='Other', back_text='Other')
        for values in ({'card': other.id}, {'kind': 'suggestion'}, {'text': '  '}):
            with self.subTest(values=values), self.assertRaises(HTTPException):
                self.save(note_id=note['id'], **values)
        models.TMA_Card.update(is_deleted=True).execute()
        with self.assertRaises(HTTPException):
            router.list_notes(self.card.id, 1)

    def test_migration_rerun_preserves_data_and_history(self):
        self.save()
        run_card_notes_migration(database)
        self.assertEqual(models.TMACardNote.select().count(), 1)
        self.assertEqual(database.execute_sql('SELECT migration_id FROM tma_migration_history').fetchall(), [(87,)])

    def test_explicit_migration_targets_only_the_selected_database(self):
        self.save()
        other = SqliteDatabase(':memory:')
        with other.connection_context():
            other.execute_sql('CREATE TABLE tma_card (id INTEGER PRIMARY KEY)')
            run_card_notes_migration(other)
            self.assertTrue(other.table_exists('tma_card_note'))
            self.assertEqual(other.execute_sql('SELECT COUNT(*) FROM tma_card_note').fetchone()[0], 0)
        self.assertEqual(models.TMACardNote.select().count(), 1)


if __name__ == '__main__':
    unittest.main()
