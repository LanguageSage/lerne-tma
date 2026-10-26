"""Card communication storage and note API on an isolated SQLite database."""
import os
import unittest
from unittest.mock import DEFAULT, patch
from uuid import uuid4

from fastapi import HTTPException
from peewee import SqliteDatabase

from test_offline_sync import database, models, TABLES
from api.routers import card_notes as router
from api.routers import messages
from api.migrations import CARD_COMMUNICATION_MIGRATION_ID, MigrationError, run_card_notes_migration
from api import migrations


class CardNoteBootstrapTests(unittest.TestCase):
    def test_communication_migrates_only_in_local_bootstrap(self):
        for local, flag in ((False, 'false'), (False, 'true'), (True, 'false')):
            with self.subTest(local=local, run_migrations=flag), patch.dict(os.environ, RUN_MIGRATIONS=flag), \
                    patch.object(models, 'is_local', return_value=local), \
                    patch.object(models, '_tables_created', False), \
                    patch.object(models, '_is_empty_local_bootstrap', return_value=False), \
                    patch.object(models, 'tma_db') as db, \
                    patch.multiple(migrations, run_migrations=DEFAULT, run_auth_migrations=DEFAULT,
                                   run_knowledge_mastery_migration=DEFAULT, run_card_notes_migration=DEFAULT) as runners:
                models.create_all_tables()
                self.assertEqual(runners['run_card_notes_migration'].call_count, int(local))
                self.assertNotIn(models.TMACardNote, db.create_tables.call_args.args[0])
                self.assertNotIn(models.TMAUserMessage, db.create_tables.call_args.args[0])


class CardCommunicationTests(unittest.TestCase):
    def setUp(self):
        database.create_tables(TABLES)
        models.TMAUser.create(user_id=1)
        models.TMAUser.create(user_id=2)
        database.execute_sql('CREATE TABLE tma_migration_history (migration_id INT PRIMARY KEY)')
        database.execute_sql('INSERT INTO tma_migration_history VALUES (87)')
        run_card_notes_migration(database)
        self.deck = models.TMA_Deck.create(user_id=1, name='Notes')
        self.card = models.TMA_Card.create(deck=self.deck, front_text='Hallo', back_text='Hello')
        models.TMA_Collaborator.create(target_type='deck', target_id=self.deck.id, user_id=2, role='viewer')

    def tearDown(self):
        models.TMAUserMessage.delete().where(models.TMAUserMessage.thread.is_null(False)).execute()
        models.TMAUserMessage.delete().execute()
        database.drop_tables([models.TMAUserMessage, models.TMACardNote, *TABLES])
        database.execute_sql('DROP TABLE tma_migration_history')

    def save(self, user=1, note_id=None, card=None, **values):
        return router.save_note(card or self.card.id, note_id or uuid4(),
            router.NoteWrite(**{'kind': 'note', 'text': 'Remember', **values}), user)

    def test_private_notes_viewer_edit_retry_and_purge(self):
        note = self.save(user=2)
        self.assertEqual(router.list_notes(self.card.id, 1), [])
        self.assertEqual(router.list_notes(self.card.id, 2)[0]['kind'], 'note')
        self.save(user=2, note_id=note['id'], text='Updated')
        self.assertEqual(models.TMACardNote.select().count(), 1)
        with self.assertRaises(HTTPException) as caught:
            self.save(note_id=note['id'], text='Steal')
        self.assertEqual(caught.exception.status_code, 404)
        deleted = self.save(user=2, note_id=note['id'], is_deleted=True)
        self.assertTrue(deleted['is_deleted'])
        self.assertTrue(self.save(user=2, note_id=note['id'])['is_deleted'])
        with self.assertRaises(HTTPException):
            router.list_notes(self.card.id, 3)
        self.card.delete_instance()
        self.assertEqual(models.TMACardNote.select().count(), 0)

    def test_suggestions_cannot_enter_private_notes(self):
        with self.assertRaises(HTTPException) as caught:
            self.save(kind='suggestion', text='Typo')
        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(models.TMACardNote.select().count(), 0)

    def test_messages_thread_read_receipt_retry_and_deleted_card_history(self):
        message_id, reply_id = str(uuid4()), str(uuid4())
        original = dict(id=message_id, user_id=1, sender='user', kind='suggestion',
                        text='Typo', card_id=self.card.id, link=f'/cards/{self.card.id}')
        models.TMAUserMessage.insert(**original).on_conflict_ignore().execute()
        models.TMAUserMessage.insert(**original).on_conflict_ignore().execute()
        models.TMAUserMessage.create(id=reply_id, user_id=1, sender='admin', kind='reply',
                                     text='Fixed', thread=message_id)
        self.assertEqual(models.TMAUserMessage.select().count(), 2)
        self.assertEqual(models.TMAUserMessage.get_by_id(reply_id).thread_id, message_id)
        models.TMAUserMessage.update(read_at=models.datetime.datetime.now()).where(
            models.TMAUserMessage.id == reply_id).execute()
        self.card.delete_instance()
        self.assertEqual(models.TMAUserMessage.select().count(), 2)
        self.assertEqual(models.TMAUserMessage.get_by_id(message_id).card_id, self.card.id)
        self.assertIsNotNone(models.TMAUserMessage.get_by_id(reply_id).read_at)

    def test_message_api_private_thread_suggestion_retry_and_receipts(self):
        root_id, reply_id = uuid4(), uuid4()
        request = messages.MessageWrite(text='Fix typo', card_id=self.card.id)
        first = messages.send_message(root_id, request, 2)
        self.assertEqual((first['kind'], first['card_id'], first['link']),
                         ('suggestion', self.card.id, f'/cards/{self.card.id}'))
        self.assertEqual(messages.send_message(root_id, request, 2)['id'], str(root_id))
        self.assertEqual(messages.conversation_card(root_id, 2), {'id': self.card.id, 'deck_id': self.card.deck_id})
        self.assertEqual(models.TMAProgress.select().count(), 0)
        self.assertEqual(messages.conversations(2)[0]['incoming_count'], 0)
        self.assertEqual(models.TMAUserMessage.select().count(), 1)
        self.assertEqual(messages.conversations(1), [])
        for action in (lambda: messages.conversation(root_id, 1),
                       lambda: messages.conversation_card(root_id, 1),
                       lambda: messages.mark_read(root_id, messages.ReadWrite(read=True), 1),
                       lambda: messages.send_message(reply_id,
                           messages.MessageWrite(text='Steal', thread_id=root_id), 1)):
            with self.assertRaises(HTTPException) as caught:
                action()
            self.assertEqual(caught.exception.status_code, 404)
        with self.assertRaises(HTTPException):
            messages.send_message(root_id, messages.MessageWrite(text='Changed', card_id=self.card.id), 2)
        models.TMAUserMessage.create(id=str(reply_id), user_id=2, sender='admin',
                                     kind='reply', text='Done', thread=str(root_id))
        self.assertEqual(len(messages.conversation(root_id, 2)), 2)
        user_reply = messages.send_message(uuid4(),
            messages.MessageWrite(text='Thank you', thread_id=root_id), 2)
        self.assertEqual((user_reply['kind'], user_reply['thread_id']), ('reply', str(root_id)))
        self.assertEqual(len(messages.conversation(root_id, 2)), 3)
        self.assertEqual(messages.conversations(2)[0]['unread_count'], 1)
        self.assertEqual(messages.conversations(2)[0]['incoming_count'], 1)
        messages.mark_read(root_id, messages.ReadWrite(read=True), 2)
        self.assertEqual(messages.conversations(2)[0]['unread_count'], 0)
        messages.mark_read(root_id, messages.ReadWrite(read=False), 2)
        self.assertEqual(messages.conversations(2)[0]['unread_count'], 1)
        self.card.is_deleted = True
        self.card.save()
        with self.assertRaises(HTTPException) as caught:
            messages.conversation_card(root_id, 2)
        self.assertEqual(caught.exception.status_code, 404)

    def test_suggestion_requires_card_access(self):
        with self.assertRaises(HTTPException):
            messages.send_message(uuid4(), messages.MessageWrite(text='Other', card_id=99999), 2)
        self.assertEqual(models.TMAUserMessage.select().count(), 0)

    def test_migration_rerun_and_wrong_schema_fail_closed(self):
        run_card_notes_migration(database)
        self.assertEqual([row[0] for row in database.execute_sql(
            'SELECT migration_id FROM tma_migration_history ORDER BY migration_id')],
            [87, CARD_COMMUNICATION_MIGRATION_ID])
        database.execute_sql('ALTER TABLE tma_card_note ADD COLUMN status TEXT')
        with self.assertRaises(MigrationError):
            run_card_notes_migration(database)

    def test_old_87_note_table_is_not_silently_reused(self):
        other = SqliteDatabase(':memory:')
        with other.connection_context():
            other.execute_sql('CREATE TABLE tma_migration_history (migration_id INT PRIMARY KEY)')
            other.execute_sql('INSERT INTO tma_migration_history VALUES (87)')
            other.execute_sql('CREATE TABLE tma_card_note (id TEXT PRIMARY KEY, kind TEXT)')
            with self.assertRaises(MigrationError):
                run_card_notes_migration(other)
            self.assertFalse(other.table_exists('tma_user_message'))
            self.assertEqual(other.execute_sql(
                'SELECT COUNT(*) FROM tma_migration_history WHERE migration_id=90').fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()
