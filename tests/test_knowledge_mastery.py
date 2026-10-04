import datetime
import math
import unittest
from contextlib import nullcontext
from types import SimpleNamespace
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
    CALCULATION_VERSION, rebuild_all_knowledge_states, rebuild_knowledge_state,
    score_knowledge_attempt,
)
from api.migrations import KNOWLEDGE_MASTERY_LOCK_ID, run_knowledge_mastery_migration


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
    def test_puzzle_boundary_history_does_not_change_mastery_v1(self):
        for count in (1, 2, 3, 5):
            with self.subTest(count=count):
                plain = hybrid(count, 'good')
                detailed = hybrid(count, 'good')
                detailed['card_type'] = 'puzzle'
                detailed['exercise_evidence']['mistake_count'] = count - 1
                detailed['exercise_evidence']['grading_summary'] = {
                    'final_verdict': 'correct', 'final_evaluator': 'rules',
                    'error_types_seen': ['word_order'] if count > 1 else [],
                    'error_codes_seen': ['exercise.word_order'] if count > 1 else [],
                    'incorrect_parts': ['puzzle:boundary:0-2', 'puzzle:boundary:2-1'] if count > 1 else [],
                }
                self.assertIsNotNone(score_knowledge_attempt(detailed))
                self.assertEqual(score_knowledge_attempt(plain), score_knowledge_attempt(detailed))

    def test_match_and_quiz_feedback_does_not_change_mastery_scores(self):
        for card_type, code, part in [('match', 'exercise.wrong_match', 'match:left-2'),
                                      ('quiz', 'exercise.wrong_choice', 'option-2')]:
            for count in (1, 2):
                with self.subTest(card_type=card_type, count=count):
                    plain = hybrid(count, 'good')
                    detailed = hybrid(count, 'good')
                    detailed['card_type'] = card_type
                    detailed['exercise_evidence']['mistake_count'] = count - 1
                    detailed['exercise_evidence']['grading_summary'] = {
                        'final_verdict': 'correct', 'final_evaluator': 'rules',
                        'error_codes_seen': [code] if count > 1 else [],
                        'incorrect_parts': [part] if count > 1 else [],
                        'interaction_count': count + 2,
                    }
                    self.assertIsNotNone(score_knowledge_attempt(detailed))
                    self.assertEqual(score_knowledge_attempt(plain), score_knowledge_attempt(detailed))

    def test_part_feedback_summary_is_additive_for_mastery_v1(self):
        plain = hybrid(2, 'good')
        with_parts = hybrid(2, 'good')
        with_parts['exercise_evidence']['grading_summary'] = {
            'final_verdict': 'correct', 'error_types_seen': ['word_choice', 'other'],
            'error_codes_seen': ['exercise.wrong_choice', 'exercise.affix_mismatch'],
            'incorrect_parts': ['gap-2', '3'], 'final_evaluator': 'rules',
        }
        self.assertEqual(score_knowledge_attempt(plain), score_knowledge_attempt(with_parts))

    def test_free_text_grading_summary_is_additive_and_minor_is_not_penalized(self):
        exact = hybrid(1, 'good')
        minor = hybrid(1, 'good')
        minor['exercise_evidence']['grading_summary'] = {
            'final_verdict': 'accepted_minor', 'error_types_seen': ['typo'], 'minor_errors': ['typo']}
        self.assertEqual(score_knowledge_attempt(exact), score_knowledge_attempt(minor))
        retry = hybrid(2, 'good')
        retry['exercise_evidence']['grading_summary'] = {
            'final_verdict': 'correct', 'error_types_seen': ['grammar']}
        self.assertAlmostEqual(score_knowledge_attempt(retry).score, .79)
        # Descriptive client summary never overrides critical objective fields.
        minor['exercise_evidence']['completed'] = False
        self.assertIsNone(score_knowledge_attempt(minor))

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

    def test_extended_ratings_in_self_and_hybrid(self):
        scores = [.10, .25, .40, .575, .75, .85, .95, 1.00]
        for grade, expected in enumerate(scores):
            with self.subTest(grade=grade):
                rating = f'ext_{grade}'
                self_evidence = score_knowledge_attempt(self_rating(rating))
                self.assertAlmostEqual(self_evidence.score, expected)
                self.assertEqual(self_evidence.weight, .5)
                hybrid_evidence = score_knowledge_attempt(hybrid(2, rating))
                self.assertAlmostEqual(hybrid_evidence.score, .80 * .8 + expected * .2)
                self.assertEqual(hybrid_evidence.weight, 1)

    def test_unscorable_versions_ratings_and_inconsistent_evidence(self):
        invalid = [self_rating('ext_8'), self_rating('unknown_4'),
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
    def test_postgres_lock_precedes_marker_and_schema_checks(self):
        events = []

        class FakePostgres:
            param = '%s'

            def atomic(self, **options):
                events.append('transaction')
                return nullcontext()

            def execute_sql(self, sql, params=None):
                events.append(sql)
                return SimpleNamespace(fetchone=lambda: (1,))

            def get_columns(self, table):
                events.append('inspect schema')
                names = ('positive_evidence', 'negative_evidence', 'evidence_mass',
                         'proficiency', 'confidence', 'evidence_event_count',
                         'objective_event_count', 'self_rating_event_count',
                         'last_evidence_at')
                return [SimpleNamespace(name=name) for name in names]

        with patch('peewee.PostgresqlDatabase', FakePostgres):
            result = run_knowledge_mastery_migration(FakePostgres())
        self.assertFalse(result['applied'])
        lock = f'SELECT pg_advisory_xact_lock({KNOWLEDGE_MASTERY_LOCK_ID})'
        self.assertLess(events.index('transaction'), events.index(lock))
        self.assertLess(events.index(lock), next(i for i, sql in enumerate(events)
                                                 if 'SELECT 1 FROM tma_migration_history' in sql))
        self.assertLess(events.index(lock), events.index('inspect schema'))

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
            self.assertTrue({
                'positive_evidence', 'negative_evidence', 'evidence_mass',
                'proficiency', 'confidence', 'evidence_event_count',
                'objective_event_count', 'self_rating_event_count', 'last_evidence_at',
            } <= {c.name for c in database.get_columns('tma_user_knowledge_state')})
        finally:
            database.close()

    def test_incomplete_schema_does_not_mark_migration_applied(self):
        database = SqliteDatabase(':memory:')
        database.connect()
        try:
            database.execute_sql('''CREATE TABLE tma_user_knowledge_state (
                id INTEGER PRIMARY KEY, calculation_version TEXT)''')
            stale_columns = database.get_columns('tma_user_knowledge_state')
            with patch.object(database, 'get_columns', return_value=stale_columns):
                with self.assertRaisesRegex(RuntimeError, 'required columns missing'):
                    run_knowledge_mastery_migration(database)
            if database.table_exists('tma_migration_history'):
                self.assertIsNone(database.execute_sql(
                    'SELECT 1 FROM tma_migration_history WHERE migration_id = 82').fetchone())
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

    def test_future_events_preserved_without_state(self):
        for i, data in enumerate([{**self_rating('good'), 'schema_version': 999},
                                  {'schema_version': 1, 'evaluation_type': 'future'}]):
            self.assertEqual(self.send(f'future-{i}', data), 'created')
        self.assertEqual(TMAKnowledgeAttempt.select().count(), 2)
        self.assertIsNone(self.state())
        self.assertIsNone(rebuild_knowledge_state(1, self.ki1.id))

    def test_rebuild_all_restores_missing_states_without_changing_attempts(self):
        self.send('a', self_rating('ext_0'))
        self.send('b', hybrid(2, 'ext_7'))
        self.send('other-user', self_rating('good'), user_id=2)
        self.send('other-ki', self_rating('hard'), ki=self.ki2.id)
        before = {(1, self.ki1.id): self.snapshot(self.state()),
                  (2, self.ki1.id): self.snapshot(self.state(user_id=2)),
                  (1, self.ki2.id): self.snapshot(self.state(ki=self.ki2.id))}
        raw = list(TMAKnowledgeAttempt.select(
            TMAKnowledgeAttempt.id, TMAKnowledgeAttempt.evaluation_data).tuples())
        TMAUserKnowledgeState.delete().execute()
        self.assertEqual(rebuild_all_knowledge_states(), 3)
        self.assertEqual(self.snapshot(self.state()), before[(1, self.ki1.id)])
        self.assertEqual(self.snapshot(self.state(user_id=2)), before[(2, self.ki1.id)])
        self.assertEqual(self.snapshot(self.state(ki=self.ki2.id)), before[(1, self.ki2.id)])
        self.assertEqual(list(TMAKnowledgeAttempt.select(
            TMAKnowledgeAttempt.id, TMAKnowledgeAttempt.evaluation_data).tuples()), raw)

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


    def test_failed_hybrid_attempt_preserved_without_positive_evidence(self):
        failed_event = {
            'schema_version': 2,
            'card_type': 'free_text',
            'evaluation_type': 'hybrid',
            'correct': False,
            'rating': 'again',
            'exercise_evidence': {
                'auto_evaluated': True,
                'completed': False,
                'first_try_correct': False,
                'attempt_count': 3,
                'mistake_count': 3,
                'grading_summary': {
                    'final_verdict': 'incorrect',
                    'error_types_seen': ['grammar'],
                    'error_codes_seen': ['grammar.article_case'],
                    'minor_errors': [],
                    'final_evaluator': 'ai',
                },
            },
        }
        self.assertEqual(self.send('failed-attempt-1', failed_event), 'created')
        # 1. Raw attempt is preserved in TMAKnowledgeAttempt
        attempt = TMAKnowledgeAttempt.get(TMAKnowledgeAttempt.client_event_id == 'failed-attempt-1')
        self.assertEqual(attempt.user_id, 1)
        import json
        eval_data = json.loads(attempt.evaluation_data)
        self.assertEqual(eval_data['evaluation_type'], 'hybrid')
        self.assertEqual(eval_data['exercise_evidence']['completed'], False)
        self.assertEqual(eval_data['exercise_evidence']['attempt_count'], 3)
        self.assertEqual(eval_data['exercise_evidence']['mistake_count'], 3)
        self.assertEqual(eval_data['exercise_evidence']['grading_summary']['error_types_seen'], ['grammar'])
        self.assertEqual(eval_data['exercise_evidence']['grading_summary']['error_codes_seen'], ['grammar.article_case'])

        # 2. Mastery v1 state is NOT created (no positive or negative evidence added)
        self.assertIsNone(self.state())
        self.assertIsNone(rebuild_knowledge_state(1, self.ki1.id))


if __name__ == '__main__':
    unittest.main()
