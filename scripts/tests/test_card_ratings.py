"""Private card ratings and migration 92 on an isolated SQLite database."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import HTTPException
from peewee import IntegrityError, SqliteDatabase
from pydantic import ValidationError

from test_offline_sync import database, models, TABLES
from api.routers import card_ratings as router
from api.migrations import CARD_RATING_MIGRATION_ID, MigrationError, run_card_rating_migration


class CardRatingTests(unittest.TestCase):
    def setUp(self):
        database.create_tables(TABLES)
        models.TMAUser.create(user_id=1)
        models.TMAUser.create(user_id=2)
        database.execute_sql('CREATE TABLE tma_migration_history (migration_id INT PRIMARY KEY)')
        run_card_rating_migration(database)
        self.deck = models.TMA_Deck.create(user_id=1, name='Ratings')
        self.card = models.TMA_Card.create(deck=self.deck, front_text='Hallo', back_text='Hello')
        models.TMA_Collaborator.create(target_type='deck', target_id=self.deck.id, user_id=2, role='viewer')

    def tearDown(self):
        database.drop_tables([models.TMACardRating, *TABLES])
        database.execute_sql('DROP TABLE tma_migration_history')

    def rate(self, user=1, card=None, **values):
        return router.save_rating.__wrapped__(card or self.card.id, router.RatingWrite(**values), user)

    def test_upsert_keeps_one_private_row_per_user_and_clears(self):
        self.assertEqual(self.rate(user=2, rating=1)['rating'], 1)
        saved = self.rate(user=2, rating=-1, reason='unclear')
        self.assertEqual((saved['rating'], saved['reason']), (-1, 'unclear'))
        # A new vote replaces the previous reason instead of keeping stale feedback.
        self.assertEqual(self.rate(user=2, rating=-1)['reason'], None)
        self.rate(user=1, rating=1)
        self.assertEqual(models.TMACardRating.select().count(), 2)
        self.assertEqual([row['rating'] for row in router.list_deck_ratings.__wrapped__(self.deck.id, 2)], [-1])
        self.assertEqual([row['rating'] for row in router.list_deck_ratings.__wrapped__(self.deck.id, 1)], [1])
        self.assertEqual(self.rate(user=2, rating=None)['rating'], None)
        self.assertEqual(self.rate(user=2, rating=None)['rating'], None)  # Retried clear is harmless.
        self.assertEqual(router.list_deck_ratings.__wrapped__(self.deck.id, 2), [])
        self.assertEqual(models.TMACardRating.select().count(), 1)

    def test_contract_rejects_invalid_values(self):
        for values in ({'rating': 0}, {'rating': 2}, {'rating': 1, 'reason': 'error'},
                       {'rating': None, 'reason': 'error'}, {'rating': -1, 'reason': 'spam'},
                       {'rating': 1, 'text': 'extra'}):
            with self.subTest(values=values), self.assertRaises(ValidationError):
                router.RatingWrite(**values)
        with self.assertRaises(IntegrityError):
            models.TMACardRating.insert(card=self.card.id, user_id=1, rating=0).execute()

    def test_requires_read_access_and_live_card(self):
        with self.assertRaises(HTTPException):
            self.rate(user=3, rating=1)
        with self.assertRaises(HTTPException) as caught:
            router.list_deck_ratings.__wrapped__(self.deck.id, 3)
        self.assertEqual(caught.exception.status_code, 403)
        self.card.is_deleted = True
        self.card.save()
        with self.assertRaises(HTTPException) as caught:
            self.rate(rating=1)
        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(router.list_deck_ratings.__wrapped__(self.deck.id, 1), [])

    def test_permanent_card_delete_cascades(self):
        self.rate(rating=-1, reason='error')
        self.card.delete_instance()
        self.assertEqual(models.TMACardRating.select().count(), 0)

    def test_missing_table_is_isolated_503(self):
        database.drop_tables([models.TMACardRating])
        for action in (lambda: self.rate(rating=1), lambda: router.list_deck_ratings.__wrapped__(self.deck.id, 1)):
            with self.assertRaises(HTTPException) as caught:
                action()
            self.assertEqual(caught.exception.status_code, 503)
        database.create_tables([models.TMACardRating])

    def test_migration_rerun_and_wrong_schema_fail_closed(self):
        run_card_rating_migration(database)
        self.assertEqual([row[0] for row in database.execute_sql(
            'SELECT migration_id FROM tma_migration_history')], [CARD_RATING_MIGRATION_ID])
        database.execute_sql('ALTER TABLE tma_card_rating ADD COLUMN status TEXT')
        with self.assertRaises(MigrationError):
            run_card_rating_migration(database)

    def test_existing_untracked_table_is_not_silently_reused(self):
        other = SqliteDatabase(':memory:')
        with other.connection_context():
            other.execute_sql('CREATE TABLE tma_card_rating (id INTEGER PRIMARY KEY, rating TEXT)')
            with self.assertRaises(MigrationError):
                run_card_rating_migration(other)
            # The failed transaction rolls back, so no migration record can survive.
            self.assertFalse(other.table_exists('tma_migration_history'))


if __name__ == '__main__':
    unittest.main()
