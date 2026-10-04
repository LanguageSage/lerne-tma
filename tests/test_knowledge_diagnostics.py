import datetime
import json
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from peewee import SqliteDatabase

from api.models import (
    tma_db, TMAUser, TMA_Deck, TMA_Card, TMAKnowledgeItem,
    TMACardKnowledgeItem, TMAKnowledgeAttempt, TMAUserKnowledgeState, TMAReviewHistory,
)
from api.routers.knowledge import router
from api.services.knowledge_diagnostics import diagnostic_status
from api.services.knowledge_mastery import rebuild_knowledge_state


MODELS = [TMAUser, TMA_Deck, TMA_Card, TMAKnowledgeItem, TMACardKnowledgeItem,
          TMAKnowledgeAttempt, TMAUserKnowledgeState, TMAReviewHistory]


def self_rating(rating='good'):
    return {'schema_version': 1, 'evaluation_type': 'self_rating', 'rating': rating}


def hybrid(count=1, rating='good'):
    return {'schema_version': 2, 'evaluation_type': 'hybrid', 'rating': rating,
            'exercise_evidence': {'attempt_count': count, 'mistake_count': count - 1,
                                  'first_try_correct': count == 1,
                                  'auto_evaluated': True, 'completed': True}}


class TestClassification(unittest.TestCase):
    def check(self, events, confidence, proficiency, expected):
        self.assertEqual(diagnostic_status({'evidence_event_count': events,
                                            'confidence': confidence,
                                            'proficiency': proficiency}), expected)

    def test_statuses_and_boundaries(self):
        self.check(0, 0, .5, 'unobserved')
        self.check(1, .449999, .99, 'insufficient')
        self.check(1, .449999, .01, 'insufficient')
        self.check(1, .45, .399999, 'weak')
        self.check(1, .45, .40, 'developing')
        self.check(1, .45, .699999, 'developing')
        self.check(1, .45, .70, 'strong')


class TestDiagnosticsAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = SqliteDatabase(':memory:', check_same_thread=False, thread_safe=False)
        cls.database.bind(MODELS, bind_refs=False, bind_backrefs=False)
        tma_db.initialize(cls.database)
        cls.database.connect()
        cls.database.create_tables(MODELS)
        app = FastAPI()
        app.include_router(router)
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        cls.database.close()

    def setUp(self):
        for model in reversed(MODELS):
            model.delete().execute()
        TMAUser.create(user_id=1, username='a')
        TMAUser.create(user_id=2, username='b')
        self.a = TMAKnowledgeItem.create(name='Alpha', language='de', category='grammar', cefr_level='A1')
        self.b = TMAKnowledgeItem.create(name='Beta', language='en', category='vocabulary', cefr_level='B2')
        self.c = TMAKnowledgeItem.create(name='Gamma', language='de', category='grammar', cefr_level='C1')

    def get(self, path, user=1):
        return self.client.get(path, headers={'X-User-ID': str(user)})

    def add(self, ki, event_id, data, user=1, at=None):
        TMAKnowledgeAttempt.create(
            user_id=user, knowledge_item=ki, client_event_id=event_id,
            event_time=at or datetime.datetime(2026, 9, 28, 12),
            evaluation_data=json.dumps(data) if data is not None else None)

    def test_attempt_explanations_counts_and_read_only_comparison(self):
        events = [self_rating('good'), hybrid(),
                  {**self_rating(), 'schema_version': 9}, self_rating('mystery'),
                  {**hybrid(), 'exercise_evidence': {**hybrid()['exercise_evidence'], 'attempt_count': 0}},
                  {**hybrid(), 'exercise_evidence': {**hybrid()['exercise_evidence'], 'first_try_correct': False}},
                  {**hybrid(), 'exercise_evidence': {**hybrid()['exercise_evidence'], 'auto_evaluated': False}},
                  {**hybrid(), 'exercise_evidence': {**hybrid()['exercise_evidence'], 'completed': False}},
                  {**hybrid(), 'exercise_evidence': None},
                  {'schema_version': 1, 'evaluation_type': 'future', 'rating': 'good'}, None]
        for i, event in enumerate(events):
            self.add(self.a, f'a-{i}', event, at=datetime.datetime(2026, 9, 28, 12, i))
        rebuild_knowledge_state(1, self.a.id)
        path = f'/knowledge/diagnostics/items/{self.a.id}'
        detail = self.get(path).json()
        self.assertEqual((detail['raw_attempt_count'], detail['scorable_attempt_count'],
                          detail['ignored_attempt_count']), (11, 2, 9))
        self.assertEqual(detail['raw_attempt_count'], detail['scorable_attempt_count'] + detail['ignored_attempt_count'])
        self.assertTrue(detail['state_matches_rebuild'])
        self.assertEqual(detail['materialized_state']['attempts_count'], 2)
        self.assertEqual(detail['materialized_state']['proficiency'], detail['recomputed_state']['proficiency'])
        self.assertEqual(detail['materialized_state']['diagnostic_status'], detail['recomputed_state']['diagnostic_status'])
        self.assertNotIn('proficiency', detail)
        response = self.get(path + '/attempts?limit=5&offset=0')
        self.assertEqual(response.status_code, 200)
        self.assertEqual((response.json()['total'], len(response.json()['items'])), (11, 5))
        attempts = self.get(path + '/attempts?limit=100').json()['items']
        self.assertEqual([row['client_event_id'] for row in attempts], [f'a-{i}' for i in reversed(range(11))])
        by_id = {row['client_event_id']: row for row in attempts}
        reasons = [None, None, 'unsupported_schema_version', 'unknown_rating',
                   'invalid_attempt_count', 'invalid_first_try_correct',
                   'objective_not_auto_evaluated', 'objective_not_completed',
                   'missing_exercise_evidence', 'unsupported_evaluation_type', 'invalid_evaluation_data']
        self.assertEqual([by_id[f'a-{i}']['ignored_reason'] for i in range(11)], reasons)
        self.assertAlmostEqual(by_id['a-0']['weight'], .5)
        self.assertAlmostEqual(by_id['a-1']['score'], .95)
        self.assertEqual(by_id['a-1']['objective_evidence']['mistake_count'], 0)
        TMAUserKnowledgeState.update(proficiency=0.01, confidence=0.9).where(
            (TMAUserKnowledgeState.user_id == 1) &
            (TMAUserKnowledgeState.knowledge_item_id == self.a.id)).execute()
        mismatch = self.get(path).json()
        self.assertFalse(mismatch['state_matches_rebuild'])
        self.assertEqual(mismatch['materialized_state']['proficiency'], 0.01)
        self.assertNotEqual(mismatch['materialized_state']['proficiency'], mismatch['recomputed_state']['proficiency'])
        self.assertEqual(mismatch['materialized_state']['diagnostic_status'], 'weak')
        self.assertEqual(mismatch['recomputed_state']['diagnostic_status'], 'insufficient')
        listed = next(item for item in self.get('/knowledge/diagnostics/items').json()['items'] if item['id'] == self.a.id)
        self.assertEqual(listed['materialized_state']['proficiency'], 0.01)
        self.assertEqual(listed['recomputed_state']['proficiency'], mismatch['recomputed_state']['proficiency'])
        self.assertFalse(listed['state_matches_rebuild'])
        self.assertEqual(self.get('/knowledge/diagnostics/items?diagnostic_status=insufficient').json()['total'], 1)
        self.assertEqual(TMAUserKnowledgeState.get(
            TMAUserKnowledgeState.knowledge_item_id == self.a.id).proficiency, 0.01)
        summary = self.get('/knowledge/diagnostics/summary').json()
        self.assertEqual((summary['state_mismatch_count'], summary['insufficient_count'], summary['weak_count']), (1, 1, 0))

    def test_isolation_unobserved_and_auth(self):
        self.add(self.a, 'a', self_rating('easy'))
        self.add(self.a, 'b', hybrid(), user=2)
        self.add(self.b, 'b2', hybrid(), user=2)
        rebuild_knowledge_state(1, self.a.id)
        rebuild_knowledge_state(2, self.a.id)
        rebuild_knowledge_state(2, self.b.id)
        summary = self.get('/knowledge/diagnostics/summary').json()
        self.assertEqual(summary['classification_source'], 'recomputed_state')
        self.assertEqual((summary['observed_knowledge_items'], summary['unobserved_knowledge_items'],
                          summary['raw_attempt_count'], summary['objective_event_count']), (1, 2, 1, 0))
        detail = self.get(f'/knowledge/diagnostics/items/{self.b.id}').json()
        self.assertEqual((detail['recomputed_state']['diagnostic_status'], detail['recomputed_state']['confidence'], detail['recomputed_state']['proficiency'],
                          detail['has_evidence'], detail['materialized_state']),
                         ('unobserved', 0, .5, False, None))
        attempts = self.get(f'/knowledge/diagnostics/items/{self.a.id}/attempts').json()['items']
        self.assertEqual([row['client_event_id'] for row in attempts], ['a'])
        self.assertEqual(self.get(f'/knowledge/diagnostics/items/{self.a.id}/attempts', user=2).json()['total'], 1)
        self.assertEqual(self.client.get('/knowledge/diagnostics/summary').status_code, 401)
        self.assertEqual(self.get('/knowledge/diagnostics/items/99999').status_code, 404)

    def test_filters_sort_pagination_and_visibility(self):
        for i in range(6):
            self.add(self.a, f'a-{i}', hybrid())
        self.add(self.b, 'b', self_rating('again'))
        hidden = TMAKnowledgeItem.create(name='Private', is_global=False, author_id=2)
        self.add(hidden, 'hidden', hybrid(), user=2)
        base = '/knowledge/diagnostics/items'
        self.assertEqual(self.get(base + '?language=de').json()['total'], 2)
        self.assertEqual(self.get(base + '?category=grammar').json()['total'], 2)
        self.assertEqual(self.get(base + '?cefr_level=A1').json()['total'], 1)
        self.assertEqual(self.get(base + '?search=alp').json()['items'][0]['id'], self.a.id)
        self.assertEqual(self.get(base + '?diagnostic_status=insufficient').json()['total'], 1)
        self.assertEqual(self.get(base + '?diagnostic_status=unobserved').json()['total'], 1)
        self.assertEqual(self.get(base + '?diagnostic_status=developing').json()['total'], 0)
        self.assertEqual(self.get(base + '?confidence_min=0.45').json()['total'], 1)
        self.assertEqual(self.get(base + '?confidence_max=0.1').json()['total'], 2)
        self.assertEqual(self.get(base + '?has_objective_evidence=true').json()['total'], 1)
        sorted_items = self.get(base + '?sort_by=confidence&sort_dir=desc').json()['items']
        self.assertEqual(sorted_items[0]['id'], self.a.id)
        page = self.get(base + '?sort_by=name&limit=1&offset=1').json()
        self.assertEqual((page['total'], page['items'][0]['name']), (3, 'Beta'))
        self.assertEqual(self.get(base + '?sort_by=bad').status_code, 422)
        self.assertEqual(self.get(base + '?limit=101').status_code, 422)
        self.assertEqual(self.get(base + '?confidence_min=.8&confidence_max=.2').status_code, 422)
        self.assertEqual(self.get(base + '?user_id=2').json()['total'], 3)
        self.assertEqual(self.get(f'{base}/{hidden.id}').status_code, 404)
        self.assertEqual(self.get(f'{base}/{hidden.id}/attempts').status_code, 404)
        self.assertEqual(self.get(base, user=2).json()['total'], 4)

    def test_list_query_count_does_not_grow_per_item(self):
        for i in range(100):
            TMAKnowledgeItem.create(name=f'Extra {i:03d}')
        self.add(self.a, 'a', hybrid())
        with patch.object(self.database, 'execute_sql', wraps=self.database.execute_sql) as execute:
            response = self.get('/knowledge/diagnostics/items?limit=100')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['total'], 103)
        self.assertEqual(execute.call_count, 3)

    def test_ignored_only_and_nonfinite_raw_payload(self):
        self.add(self.a, 'ignored', {'schema_version': 1, 'evaluation_type': 'self_rating',
                                     'rating': 'unknown', 'extra': float('nan')})
        detail = self.get(f'/knowledge/diagnostics/items/{self.a.id}').json()
        self.assertEqual((detail['recomputed_state']['diagnostic_status'], detail['raw_attempt_count'],
                          detail['scorable_attempt_count'], detail['materialized_state']),
                         ('unobserved', 1, 0, None))
        attempt = self.get(f'/knowledge/diagnostics/items/{self.a.id}/attempts').json()['items'][0]
        self.assertEqual(attempt['ignored_reason'], 'unknown_rating')
        self.assertIsNone(attempt['evaluation_data']['extra'])
        self.assertIsNone(TMAUserKnowledgeState.get_or_none(
            TMAUserKnowledgeState.knowledge_item_id == self.a.id))
        self.add(self.b, 'valid-without-state', self_rating('good'))
        missing = self.get(f'/knowledge/diagnostics/items/{self.b.id}').json()
        self.assertEqual(missing['scorable_attempt_count'], 1)
        self.assertFalse(missing['state_matches_rebuild'])
        self.assertIsNone(missing['materialized_state'])
        self.assertEqual(missing['recomputed_state']['evidence_event_count'], 1)
        self.assertIsNone(TMAUserKnowledgeState.get_or_none(
            TMAUserKnowledgeState.knowledge_item_id == self.b.id))

    def test_stale_materialized_state_without_scorable_raw_evidence(self):
        self.add(self.a, 'scorable', hybrid())
        rebuild_knowledge_state(1, self.a.id)
        TMAKnowledgeAttempt.delete().where(TMAKnowledgeAttempt.knowledge_item_id == self.a.id).execute()
        detail = self.get(f'/knowledge/diagnostics/items/{self.a.id}').json()
        self.assertIsNotNone(detail['materialized_state'])
        self.assertEqual(detail['recomputed_state']['evidence_event_count'], 0)
        self.assertFalse(detail['state_matches_rebuild'])
        listed = next(item for item in self.get('/knowledge/diagnostics/items').json()['items'] if item['id'] == self.a.id)
        self.assertFalse(listed['state_matches_rebuild'])
        summary = self.get('/knowledge/diagnostics/summary').json()
        self.assertEqual((summary['state_mismatch_count'], summary['observed_knowledge_items']), (1, 0))


if __name__ == '__main__':
    unittest.main()
