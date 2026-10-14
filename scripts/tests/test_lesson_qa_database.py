"""Real course fixtures in the existing isolated SQLite/SRS harness only."""
import json
import unittest
import os
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import patch

os.environ.update(VERCEL='1', RUN_MIGRATIONS='false', FORCE_LOCAL_DB='false')

from test_forced_study import database, models, TABLES, ROOT, cards, study
from scripts.lesson_qa import read_database


class LessonQaDatabaseTests(unittest.TestCase):
    def setUp(self):
        database.create_tables(TABLES)
        models.TMAUser.create(user_id=1)

    def tearDown(self):
        database.drop_tables(TABLES)

    def test_read_only_guard_and_folder_or_deck_scope(self):
        parent = models.TMA_Folder.create(user_id=1, name='Course')
        child = models.TMA_Folder.create(user_id=1, name='Child', parent=parent)
        archive = models.TMA_Folder.create(user_id=1, name='Archive')
        deck = models.TMA_Deck.create(user_id=1, name='Active', folder=child)
        models.TMA_Card.create(deck=deck, front_text='[[der]]', back_text='x')
        models.TMA_Card.create(deck=deck, front_text='deleted', back_text='x', is_deleted=True)
        models.TMA_Deck.create(user_id=1, name='Archive', folder=archive)
        models.TMA_Deck.create(user_id=1, name='Deleted', folder=parent, is_deleted=True)
        calls = []
        def guard(sql):
            calls.append(sql)
            self.assertEqual(sql, 'SET TRANSACTION READ ONLY')
        # SQLite has no PostgreSQL SET TRANSACTION. Keep its real selectors and
        # assert the guard contract without opening any configured DB connection.
        wrapper = SimpleNamespace(obj=database, connection_context=nullcontext,
                                  atomic=database.atomic, execute_sql=guard)
        with patch.object(models, 'tma_db', wrapper):
            folder_result = read_database(folder_id=parent.id)
            deck_result = read_database(deck_id=deck.id)
        self.assertEqual(calls, ['SET TRANSACTION READ ONLY'] * 2)
        self.assertEqual([d['id'] for d in folder_result['decks']], [deck.id])
        self.assertEqual(folder_result['cards'], deck_result['cards'])
        self.assertEqual(len(folder_result['cards']), 1)
        self.assertEqual(folder_result['cards'][0]['deck_id'], deck.id)
        self.assertEqual(models.TMAReviewHistory.select().count(), 0)
        self.assertEqual(models.TMAProgress.select().count(), 0)

    def test_real_d14_forced_traversal_srs_history_and_completion(self):
        snapshot = json.loads((ROOT / 'reports/lesson-qa/relativsaetze.snapshot.json').read_text(encoding='utf-8'))
        deck = models.TMA_Deck.create(id=7139, user_id=1, name='D14 isolated')
        fixtures = sorted((c for c in snapshot['cards'] if c['deck_id'] == 7139), key=lambda c: (c['position'], c['id']))
        for c in fixtures:
            models.TMA_Card.create(id=c['id'], deck=deck, position=c['position'],
                front_text=c['front_text'], back_text=c['back_text'], context=c['context'], metadata=c['metadata'])
        seen = []
        while True:
            card, _ = cards.get_next_card(1, deck.id, exclude_ids=seen, review_context='forced')
            if card is None:
                break
            self.assertNotIn(card.id, seen)
            seen.append(card.id)
            study.update_card_progress(card.id, 1, 0 if len(seen) % 4 == 0 else 2, review_context='forced')
        self.assertEqual(seen, [c['id'] for c in fixtures])
        self.assertEqual(models.TMAProgress.select().count(), 48)
        self.assertEqual(models.TMAReviewHistory.select().count(), 48)
        self.assertEqual(models.TMAReviewHistory.select().where(models.TMAReviewHistory.rating == 0).count(), 12)
        self.assertTrue(all(p.next_review is not None for p in models.TMAProgress.select()))
        self.assertEqual([c.front_text for c in models.TMA_Card.select().order_by(models.TMA_Card.position, models.TMA_Card.id)],
                         [c['front_text'] for c in fixtures])
        # History is SRS ratings, not 46-base-point/2-bonus assessment scoring.


if __name__ == '__main__':
    unittest.main()
