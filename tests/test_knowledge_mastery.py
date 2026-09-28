import datetime
import math
import unittest
from unittest.mock import patch

from peewee import IntegrityError, SqliteDatabase

from api.models import (
    tma_db, TMAUser, TMA_Deck, TMA_Card, TMAKnowledgeItem,
    TMACardKnowledgeItem, TMAKnowledgeAttempt, TMAUserKnowledgeState, TMAReviewHistory,
)
from api.routers.knowledge import (
    KnowledgeAttemptSyncItem, KnowledgeAttemptSyncRequest, sync_knowledge_attempts,
)
from api.services.knowledge_mastery import (
    CALCULATION_VERSION, rebuild_knowledge_state, score_knowledge_attempt,
)
from api.migrations import run_knowledge_mastery_migration


test_db = SqliteDatabase(':memory:')
MODELS = [TMAUser, TMA_Deck, TMA_Card, TMAKnowledgeItem, TMACardKnowledgeItem,
          TMAKnowledgeAttempt, TMAUserKnowledgeState, TMAReviewHistory]


def self_rating(rating):
    return {'schema_version': 1, 'evaluation_type': 'self_rating', 'rating': rating}


def hybrid(count, rating):
    return {'schema_version': 2, 'evaluation_type': 'hybrid', 'rating': rating,
            'exercise_evidence': {'auto_evaluated': True, 'completed': True,
                                  'first_try_correct': count == 1, 'attempt_count': count}}


class TestMasteryScorer(unittest.TestCase):
    def test_self_rating_table(self):
        for rating, expected in [('again', .10), ('hard', .40), ('good', .75), ('easy', .95)]:
            with self.subTest(rating=rating):
                evidence = score_knowledge_attempt(self_rating(rating))
                self.assertAlmostEqual(evidence.score, expected)
                self.assertEqual(evidence.weight, .5)
                self.assertAlmostEqual(evidence.positive_delta + evidence.negative_delta, .5)

    def test_hybrid_table(self):
        for count, rating, expected in [(1, 'good', .95), (2, 'good', .79),
                                        (3, 'hard', .60), (4, 'hard', .52), (5, 'good', .51),
                                        (9, 'good', .51)]:
            with self.subTest(count=count, rating=rating):
                evidence = score_knowledge_attempt(hybrid(count, rating))
                self.assertAlmostEqual(evidence.score, expected)
                self.assertEqual(evidence.weight, 1)
                self.assertTrue(evidence.has_objective)
                self.assertTrue(evidence.has_self_rating)

    def test_unscorable_versions_ratings_and_inconsistent_evidence(self):
        invalid = [self_rating('ext_0'), self_rating('unknown_4'),
                   self_rating(['good']),
                   {**self_rating('good'), 'schema_version': 999},
                   {**hybrid(4, 'good'), 'evaluation_type': 'future'},
                   {**hybrid(4, 'good'), 'exercise_evidence': {
                       **hybrid(4, 'good')['exercise_evidence'], 'first_try_correct': True}},
                   {**hybrid(1, 'good'), 'exercise_evidence': {
                       **hybrid(1, 'good')['exercise_evidence'], 'completed': False}},
                   hybrid(0, 'good')]
        for event in invalid:
            with self.subTest(event=event):
                self.assertIsNone(score_knowledge_attempt(event))


class TestMasteryMigration(unittest.TestCase):
    def test_legacy_rows_survive_additive_migration(self):
        database = SqliteDatabase(':memory:')
        database.connect()
        try:
            database.execute_sql('''CREATE TABLE tma_user_knowledge_state (
                id INTEGER PRIMARY KEY, user_id BIGINT NOT NULL, knowledge_item_id INTEGER NOT NULL,
                attempts_count INTEGER NOT NULL DEFAULT 0, last_attempt_at TIMESTAMP,
                calculation_version INTEGER NOT NULL DEFAULT 1, state_data TEXT,
                created_at TIMESTAMP, updated_at TIMESTAMP)''')
            database.execute_sql('''INSERT INTO tma_user_knowledge_state
                (id, user_id, knowledge_item_id, attempts_count, calculation_version)
                VALUES (7, 11, 13, 4, 1)''')
            self.assertTrue(run_knowledge_mastery_migration(database)['applied'])
            self.assertFalse(run_knowledge_mastery_migration(database)['applied'])
            row = database.execute_sql('''SELECT id, user_id, knowledge_item_id,
                attempts_count, calculation_version, evidence_mass
                FROM tma_user_knowledge_state''').fetchone()
            self.assertEqual(row, (7, 11, 13, 4, '', 0))
            self.assertIn('last_evidence_at', {c.name for c in database.get_columns('tma_user_knowledge_state')})
        finally:
            database.close()


class TestMasterySync(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        test_db.bind(MODELS, bind_refs=False, bind_backrefs=False)
        tma_db.initialize(test_db)
        test_db.connect()
        test_db.create_tables(MODELS)

    @classmethod
    def tearDownClass(cls):
        test_db.close()

    def setUp(self):
        for model in [TMAUserKnowledgeState, TMAKnowledgeAttempt, TMACardKnowledgeItem,
                      TMAReviewHistory, TMAKnowledgeItem, TMA_Card, TMA_Deck, TMAUser]:
            model.delete().execute()
        TMAUser.create(user_id=1, username='a')
        TMAUser.create(user_id=2, username='b')
        self.ki1 = TMAKnowledgeItem.create(name='one')
        self.ki2 = TMAKnowledgeItem.create(name='two')

    def send(self, event_id, data, *, user_id=1, ki=None, event_time=None):
        item = KnowledgeAttemptSyncItem(client_event_id=event_id,
                                        knowledge_item_id=ki or self.ki1.id,
                                        event_time=event_time, evaluation_data=data)
        return sync_knowledge_attempts(KnowledgeAttemptSyncRequest(attempts=[item]),
                                       user_id=user_id).results[0].status

    def state(self, user_id=1, ki=None):
        return TMAUserKnowledgeState.get_or_none(
            TMAUserKnowledgeState.user_id == user_id,
            TMAUserKnowledgeState.knowledge_item_id == (ki or self.ki1.id))

    def snapshot(self, state):
        return tuple(getattr(state, name) for name in (
            'positive_evidence', 'negative_evidence', 'evidence_mass', 'proficiency',
            'confidence', 'evidence_event_count', 'objective_event_count',
            'self_rating_event_count', 'last_evidence_at', 'calculation_version'))

    def test_first_hybrid_duplicate_and_rebuild(self):
        at = datetime.datetime(2026, 9, 28, 12, tzinfo=datetime.timezone.utc)
        self.assertEqual(self.send('a', hybrid(1, 'good'), event_time=at), 'created')
        state = self.state()
        self.assertAlmostEqual(state.positive_evidence, .95)
        self.assertAlmostEqual(state.negative_evidence, .05)
        self.assertAlmostEqual(state.evidence_mass, 1)
        self.assertAlmostEqual(state.proficiency, 1.95 / 3)
        self.assertAlmostEqual(state.confidence, 1 - math.exp(-.2))
        self.assertEqual((state.evidence_event_count, state.objective_event_count,
                          state.self_rating_event_count), (1, 1, 1))
        before = self.snapshot(state)
        self.assertEqual(self.send('a', hybrid(1, 'good'), event_time=at), 'duplicate')
        self.assertEqual(self.snapshot(self.state()), before)
        TMAUserKnowledgeState.delete().execute()
        self.assertEqual(self.snapshot(rebuild_knowledge_state(1, self.ki1.id)), before)

    def test_easy_self_rating_and_strong_sequences(self):
        self.send('easy', self_rating('easy'))
        state = self.state()
        self.assertAlmostEqual(state.positive_evidence, .475)
        self.assertAlmostEqual(state.negative_evidence, .025)
        self.assertAlmostEqual(state.proficiency, .59)
        self.assertAlmostEqual(state.confidence, 1 - math.exp(-.1))
        self.assertEqual((state.evidence_event_count, state.objective_event_count,
                          state.self_rating_event_count), (1, 0, 1))
        for i in range(20):
            self.send(f'strong-{i}', hybrid(1, 'good'), ki=self.ki2.id)
            if i == 4:
                five = self.state(ki=self.ki2.id)
                self.assertAlmostEqual(five.positive_evidence, 4.75)
                self.assertAlmostEqual(five.negative_evidence, .25)
                self.assertAlmostEqual(five.proficiency, 5.75 / 7)
                self.assertAlmostEqual(five.confidence, 1 - math.exp(-1))
        strong = self.state(ki=self.ki2.id)
        self.assertAlmostEqual(strong.positive_evidence, 19)
        self.assertAlmostEqual(strong.negative_evidence, 1)
        self.assertAlmostEqual(strong.proficiency, 20 / 22)
        self.assertAlmostEqual(strong.confidence, 1 - math.exp(-4))
        self.assertEqual(strong.evidence_event_count, 20)

    def test_mixed_out_of_order_isolation_and_rebuild(self):
        newer = datetime.datetime(2026, 9, 28, 12, tzinfo=datetime.timezone.utc)
        older = newer - datetime.timedelta(days=10)
        events = [hybrid(1, 'good'), hybrid(1, 'good'), hybrid(3, 'hard'),
                  self_rating('again'), hybrid(1, 'good')]
        for i, event in enumerate(events):
            self.assertEqual(self.send(str(i), event,
                                       event_time=newer if i == 0 else older), 'created')
        state = self.state()
        self.assertAlmostEqual(state.positive_evidence, .95 + .95 + .60 + .05 + .95)
        self.assertAlmostEqual(state.negative_evidence, .05 + .05 + .40 + .45 + .05)
        self.assertAlmostEqual(state.evidence_mass, 4.5)
        self.assertAlmostEqual(state.proficiency, (1 + 3.5) / (2 + 4.5))
        self.assertAlmostEqual(state.confidence, 1 - math.exp(-4.5 / 5))
        self.assertEqual(state.last_evidence_at, newer.replace(tzinfo=None))
        before = self.snapshot(state)
        self.assertEqual(self.snapshot(rebuild_knowledge_state(1, self.ki1.id)), before)
        self.send('other-user', self_rating('hard'), user_id=2)
        self.send('other-ki', self_rating('easy'), ki=self.ki2.id)
        self.assertEqual(self.snapshot(self.state()), before)
        self.assertEqual(self.state(user_id=2).evidence_event_count, 1)
        self.assertEqual(self.state(ki=self.ki2.id).evidence_event_count, 1)

    def test_future_and_extended_events_preserved_without_state(self):
        for i, data in enumerate([self_rating('ext_0'),
                                  {**self_rating('good'), 'schema_version': 999},
                                  {'schema_version': 1, 'evaluation_type': 'future'}]):
            self.assertEqual(self.send(f'future-{i}', data), 'created')
        self.assertEqual(TMAKnowledgeAttempt.select().count(), 3)
        self.assertIsNone(self.state())
        self.assertIsNone(rebuild_knowledge_state(1, self.ki1.id))

    def test_version_mismatch_rebuilds_history_once(self):
        self.send('a', self_rating('good'))
        self.send('b', hybrid(4, 'hard'))
        expected = self.snapshot(self.state())
        TMAUserKnowledgeState.update(calculation_version='old', evidence_mass=999).execute()
        self.send('c', self_rating('again'))
        after = self.snapshot(self.state())
        self.assertEqual(after[-1], CALCULATION_VERSION)
        self.assertNotEqual(after, expected)
        self.assertEqual(self.snapshot(rebuild_knowledge_state(1, self.ki1.id)), after)
        self.assertAlmostEqual(after[2], 2)

    def test_engine_failure_rolls_back_attempt_and_is_retryable(self):
        for error in (RuntimeError('engine'), IntegrityError('state')):
            with patch('api.routers.knowledge.apply_created_attempt', side_effect=error):
                with self.assertRaises(type(error)):
                    self.send('retry', self_rating('good'))
        self.assertEqual(TMAKnowledgeAttempt.select().count(), 0)
        self.assertEqual(self.send('retry', self_rating('good')), 'created')
        self.assertEqual(self.state().evidence_event_count, 1)


if __name__ == '__main__':
    unittest.main()
