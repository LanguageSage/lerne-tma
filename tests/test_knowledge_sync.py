import unittest
import os
import sys
import datetime
from peewee import SqliteDatabase

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

test_db = SqliteDatabase(':memory:')

os.environ.update(VERCEL='1', RUN_MIGRATIONS='false', FORCE_LOCAL_DB='false')

from api.models import (
    tma_db, TMAUser, TMA_Card, TMA_Deck,
    TMAKnowledgeItem, TMACardKnowledgeItem, TMAKnowledgeAttempt, TMAUserKnowledgeState,
    TMAReviewHistory, TMA_Collaborator, TMAProgress
)
from api.routers.knowledge import sync_knowledge_attempts, KnowledgeAttemptSyncRequest, KnowledgeAttemptSyncItem

class TestKnowledgeSyncAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        models = [TMAUser, TMA_Deck, TMA_Card, TMAKnowledgeItem, TMACardKnowledgeItem, TMAKnowledgeAttempt, TMAUserKnowledgeState, TMAReviewHistory, TMA_Collaborator, TMAProgress]
        test_db.bind(models, bind_refs=False, bind_backrefs=False)
        tma_db.initialize(test_db)
        test_db.connect()
        test_db.create_tables(models)

    def setUp(self):
        TMAProgress.delete().execute()
        TMAReviewHistory.delete().execute()
        TMA_Collaborator.delete().execute()
        TMAUserKnowledgeState.delete().execute()
        TMAKnowledgeAttempt.delete().execute()
        TMACardKnowledgeItem.delete().execute()
        TMAKnowledgeItem.delete().execute()
        TMA_Card.delete().execute()
        TMA_Deck.delete().execute()
        TMAUser.delete().execute()

        self.user = TMAUser.create(user_id=1, username="testuser")
        self.user2 = TMAUser.create(user_id=2, username="otheruser")
        self.deck = TMA_Deck.create(user_id=1, name="Test Deck")
        self.card = TMA_Card.create(deck=self.deck, front_text="Front", back_text="Back")
        self.ki1 = TMAKnowledgeItem.create(name="KI 1", language="de")
        TMACardKnowledgeItem.create(card_id=self.card.id, knowledge_item=self.ki1, role="primary")

    def item(self, **kwargs):
        return KnowledgeAttemptSyncItem(**{'card_id': self.card.id, **kwargs})

    def test_ordinary_origin_checks_leave_no_attempt_or_mastery(self):
        secondary = TMAKnowledgeItem.create(name='Secondary')
        TMACardKnowledgeItem.create(card_id=self.card.id, knowledge_item=secondary, role='secondary')
        unmapped = TMA_Card.create(deck=self.deck, front_text='Unmapped', back_text='Answer')
        deleted = TMA_Card.create(deck=self.deck, front_text='Deleted', back_text='Answer', is_deleted=True)
        TMACardKnowledgeItem.create(card_id=deleted.id, knowledge_item=self.ki1, role='primary')
        cases = [dict(card_id=None), dict(card_id=99999), dict(card_id=unmapped.id),
                 dict(card_id=deleted.id), dict(knowledge_item_id=secondary.id)]
        for kind in ('self_rating', 'hybrid'):
            for index, overrides in enumerate(cases):
                item = self.item(**dict({'client_event_id': f'{kind}:{index}', 'knowledge_item_id': self.ki1.id,
                                        'evaluation_data': {'schema_version': 1 if kind == 'self_rating' else 2,
                                                            'evaluation_type': kind, 'rating': 'easy'}}, **overrides))
                result = sync_knowledge_attempts(KnowledgeAttemptSyncRequest(attempts=[item]), 1).results[0]
                self.assertEqual((result.status, result.error_code), ('rejected', 'card_knowledge_not_accessible'))
            item = self.item(client_event_id=f'{kind}:foreign', knowledge_item_id=self.ki1.id,
                             evaluation_data={'schema_version': 1 if kind == 'self_rating' else 2,
                                              'evaluation_type': kind, 'rating': 'easy'})
            result = sync_knowledge_attempts(KnowledgeAttemptSyncRequest(attempts=[item]), 2).results[0]
            self.assertEqual(result.error_code, 'card_knowledge_not_accessible')
        self.assertEqual(TMAKnowledgeAttempt.select().count(), 0)
        self.assertEqual(TMAUserKnowledgeState.select().count(), 0)

    def test_deleted_deck_is_not_accessible_even_to_owner(self):
        self.deck.is_deleted = True
        self.deck.save()
        item = self.item(client_event_id='deleted-deck', knowledge_item_id=self.ki1.id)
        result = sync_knowledge_attempts(KnowledgeAttemptSyncRequest(attempts=[item]), 1).results[0]
        self.assertEqual(result.error_code, 'card_knowledge_not_accessible')
        self.assertEqual(TMAKnowledgeAttempt.select().count(), 0)

    def test_viewer_can_submit_own_evidence_but_new_events_stop_after_revocation(self):
        grant = TMA_Collaborator.create(user_id=2, target_type='deck', target_id=self.deck.id, role='viewer')
        item = self.item(client_event_id='viewer', knowledge_item_id=self.ki1.id,
                         evaluation_data={'schema_version': 2, 'evaluation_type': 'hybrid', 'rating': 'good',
                                          'exercise_evidence': {'auto_evaluated': True, 'completed': True,
                                                               'attempt_count': 1, 'first_try_correct': True}})
        request = KnowledgeAttemptSyncRequest(attempts=[item])
        self.assertEqual(sync_knowledge_attempts(request, 2).results[0].status, 'created')
        grant.delete_instance()
        self.assertEqual(sync_knowledge_attempts(request, 2).results[0].status, 'duplicate')
        fresh = item.model_copy(update={'client_event_id': 'after-revocation'})
        self.assertEqual(sync_knowledge_attempts(KnowledgeAttemptSyncRequest(attempts=[fresh]), 2).results[0].status, 'rejected')
        state = TMAUserKnowledgeState.get()
        self.assertEqual((state.user_id, state.evidence_event_count), (2, 1))
        self.assertEqual(TMAKnowledgeAttempt.select().count(), 1)

    def test_review_must_belong_to_same_user_and_card(self):
        other = TMA_Card.create(deck=self.deck, front_text='Other', back_text='Answer')
        reviews = [TMAReviewHistory.create(user_id=2, card_id=self.card.id, rating=2),
                   TMAReviewHistory.create(user_id=1, card_id=other.id, rating=2)]
        for review in reviews:
            item = self.item(client_event_id=f'review:{review.id}', knowledge_item_id=self.ki1.id, review_id=review.id)
            result = sync_knowledge_attempts(KnowledgeAttemptSyncRequest(attempts=[item]), 1).results[0]
            self.assertEqual(result.error_code, 'review_not_found_or_unauthorized')
        self.assertEqual(TMAKnowledgeAttempt.select().count(), 0)

    def test_assessment_deck_substitution_is_rejected(self):
        item = self.item(client_event_id=f'exam:{self.card.id}', knowledge_item_id=self.ki1.id,
                         evaluation_data={'schema_version': 3, 'evaluation_type': 'assessment',
                                          'assessment': {'deck_id': self.deck.id + 1}})
        result = sync_knowledge_attempts(KnowledgeAttemptSyncRequest(attempts=[item]), 1).results[0]
        self.assertEqual(result.error_code, 'assessment_not_accessible')
        self.assertEqual(TMAKnowledgeAttempt.select().count(), 0)
        self.assertEqual(TMAUserKnowledgeState.select().count(), 0)

    def test_assessment_correct_and_skipped_do_not_create_srs_reviews(self):
        for outcome in ('correct', 'skipped'):
            item = self.item(client_event_id=f'{outcome}:{self.card.id}', knowledge_item_id=self.ki1.id,
                             evaluation_data={'schema_version': 3, 'evaluation_type': 'assessment',
                                              'status': outcome, 'correct': outcome == 'correct',
                                              'assessment': {'session_id': outcome, 'deck_id': self.deck.id,
                                                             'ordinal': 1, 'required_count': 1, 'competency_ids': ['synthetic']}})
            request = KnowledgeAttemptSyncRequest(attempts=[item])
            self.assertEqual(sync_knowledge_attempts(request, 1).results[0].status, 'created')
            self.assertEqual(sync_knowledge_attempts(request, 1).results[0].status, 'duplicate')
        state = TMAUserKnowledgeState.get()
        self.assertEqual((state.positive_evidence, state.evidence_event_count), (1, 1))
        self.assertEqual(TMAKnowledgeAttempt.select().count(), 2)
        self.assertEqual(TMAProgress.select().count(), 0)
        self.assertEqual(TMAReviewHistory.select().count(), 0)

    def test_grade_to_attempt_to_mastery_and_retry_after_unmapping(self):
        import asyncio
        from api.routers.study import StudyGradeRequest, submit_grade
        grade = StudyGradeRequest(card_id=self.card.id, deck_id=self.deck.id, grade=2, return_next=False)
        self.assertEqual(asyncio.run(submit_grade(grade, user_id=1)), {'status': 'success'})
        review = TMAReviewHistory.get()
        self.assertEqual(review.rating, 2)
        self.assertIsNotNone(TMAProgress.get().last_reviewed)
        self.assertEqual(TMAKnowledgeAttempt.select().count(), 0)
        item = self.item(client_event_id='grade-1', knowledge_item_id=self.ki1.id, review_id=review.id,
                         evaluation_data={'schema_version': 1, 'evaluation_type': 'self_rating', 'rating': 'good'})
        request = KnowledgeAttemptSyncRequest(attempts=[item])
        self.assertEqual(sync_knowledge_attempts(request, 1).results[0].status, 'created')
        before = TMAUserKnowledgeState.get().__data__.copy()
        TMACardKnowledgeItem.delete().execute()
        self.assertEqual(sync_knowledge_attempts(request, 1).results[0].status, 'duplicate')
        changed = item.model_copy(update={'evaluation_data': {**item.evaluation_data, 'rating': 'easy'}})
        result = sync_knowledge_attempts(KnowledgeAttemptSyncRequest(attempts=[changed]), 1).results[0]
        self.assertEqual(result.status, 'event_conflict')
        self.assertEqual(TMAUserKnowledgeState.get().__data__, before)
        self.assertEqual(before['evidence_event_count'], 1)
        self.assertEqual(before['evidence_mass'], .5)
        self.assertEqual(TMAKnowledgeAttempt.select().count(), 1)
        self.assertEqual(TMAReviewHistory.select().count(), 1)

    def test_assessment_content_permissions_negative_evidence_and_idempotent_sync(self):
        from api.routers.knowledge import deck_knowledge_content
        from fastapi import HTTPException
        data = deck_knowledge_content(self.deck.id, user_id=1)
        self.assertEqual(data['card_ids'], [self.card.id])
        self.assertEqual(data['card_knowledge_items'][0]['knowledge_item_id'], self.ki1.id)
        with self.assertRaises(HTTPException):
            deck_knowledge_content(self.deck.id, user_id=2)
        item = self.item(client_event_id=f'assessment:{self.card.id}', knowledge_item_id=self.ki1.id,
            card_id=self.card.id, evaluation_data={'schema_version': 3, 'evaluation_type': 'assessment',
                'status': 'incorrect', 'correct': False, 'assessment': {'session_id': 'assessment',
                    'deck_id': self.deck.id, 'ordinal': 1, 'required_count': 46, 'competency_ids': ['case']}})
        request = KnowledgeAttemptSyncRequest(attempts=[item])
        self.assertEqual(sync_knowledge_attempts(request, user_id=2).results[0].status, 'rejected')
        self.assertEqual(sync_knowledge_attempts(request, user_id=1).results[0].status, 'created')
        self.assertEqual(sync_knowledge_attempts(request, user_id=1).results[0].status, 'duplicate')
        state = TMAUserKnowledgeState.get(TMAUserKnowledgeState.user_id == 1)
        self.assertEqual(state.positive_evidence, 0)
        self.assertEqual(state.negative_evidence, 1)
        self.assertEqual(state.self_rating_event_count, 0)

    def test_assessment_invalid_evidence_is_rejected_without_attempt_or_mastery(self):
        for invalid in ({'status': 'correct', 'correct': False}, {'status': 'skipped', 'correct': True},
                        {'status': 'incorrect', 'correct': False}):
            item = self.item(client_event_id=f'exam:{self.card.id}', knowledge_item_id=self.ki1.id,
                card_id=self.card.id, evaluation_data={'schema_version': 3, 'evaluation_type': 'assessment',
                    **invalid, 'assessment': {'deck_id': self.deck.id}})
            result = sync_knowledge_attempts(KnowledgeAttemptSyncRequest(attempts=[item]), user_id=1).results[0]
            self.assertEqual(result.error_code, 'invalid_assessment_evidence')
        self.assertEqual(TMAKnowledgeAttempt.select().count(), 0)
        self.assertEqual(TMAUserKnowledgeState.select().count(), 0)

    def test_create_attempt(self):
        # Test 1
        req = KnowledgeAttemptSyncRequest(attempts=[
            self.item(client_event_id="evt1", knowledge_item_id=self.ki1.id)
        ])
        resp = sync_knowledge_attempts(request=req, user_id=self.user.user_id)
        self.assertEqual(resp.results[0].status, "created")
        self.assertEqual(TMAKnowledgeAttempt.select().count(), 1)

    def test_free_text_summary_survives_raw_sync_and_duplicate_transport(self):
        import json
        evaluation = {'schema_version': 2, 'evaluation_type': 'hybrid', 'rating': 'good',
                      'card_type': 'free_text', 'exercise_evidence': {
                          'auto_evaluated': True, 'completed': True, 'attempt_count': 2,
                          'first_try_correct': False, 'mistake_count': 1,
                          'grading_summary': {'final_verdict': 'correct',
                                              'error_types_seen': ['grammar'],
                                              'error_codes_seen': ['grammar.article_case'],
                                              'minor_errors': [], 'final_evaluator': 'exact'}}}
        request = KnowledgeAttemptSyncRequest(attempts=[self.item(
            client_event_id='free-text-1', knowledge_item_id=self.ki1.id,
            card_id=self.card.id, evaluation_data=evaluation)])
        self.assertEqual(sync_knowledge_attempts(request, self.user.user_id).results[0].status, 'created')
        self.assertEqual(sync_knowledge_attempts(request, self.user.user_id).results[0].status, 'duplicate')
        self.assertEqual(TMAKnowledgeAttempt.select().count(), 1)
        self.assertEqual(json.loads(TMAKnowledgeAttempt.get().evaluation_data), evaluation)

    def test_duplicate_null_event_time(self):
        # Test 1: null -> created, null -> duplicate
        req = KnowledgeAttemptSyncRequest(attempts=[
            self.item(client_event_id="evt_null", knowledge_item_id=self.ki1.id) # event_time=None
        ])
        resp1 = sync_knowledge_attempts(request=req, user_id=self.user.user_id)
        self.assertEqual(resp1.results[0].status, "created")
        
        resp2 = sync_knowledge_attempts(request=req, user_id=self.user.user_id)
        self.assertEqual(resp2.results[0].status, "duplicate")
        self.assertEqual(TMAKnowledgeAttempt.select().where(TMAKnowledgeAttempt.client_event_id == "evt_null").count(), 1)

    def test_duplicate_explicit_event_time(self):
        # Test 2: T1 -> created, T1 -> duplicate
        now = datetime.datetime(2026, 9, 27, 18, 0, 0, tzinfo=datetime.timezone.utc)
        req = KnowledgeAttemptSyncRequest(attempts=[
            self.item(client_event_id="evt_T1", knowledge_item_id=self.ki1.id, event_time=now)
        ])
        resp1 = sync_knowledge_attempts(request=req, user_id=self.user.user_id)
        self.assertEqual(resp1.results[0].status, "created")
        
        resp2 = sync_knowledge_attempts(request=req, user_id=self.user.user_id)
        self.assertEqual(resp2.results[0].status, "duplicate")

    def test_conflict_different_event_time(self):
        # Test 3: T1 -> created, T2 -> event_conflict
        t1 = datetime.datetime(2026, 9, 27, 18, 0, 0, tzinfo=datetime.timezone.utc)
        t2 = datetime.datetime(2026, 9, 27, 19, 0, 0, tzinfo=datetime.timezone.utc)
        
        req1 = KnowledgeAttemptSyncRequest(attempts=[
            self.item(client_event_id="evt_T1_T2", knowledge_item_id=self.ki1.id, event_time=t1)
        ])
        sync_knowledge_attempts(request=req1, user_id=self.user.user_id)
        
        req2 = KnowledgeAttemptSyncRequest(attempts=[
            self.item(client_event_id="evt_T1_T2", knowledge_item_id=self.ki1.id, event_time=t2)
        ])
        resp2 = sync_knowledge_attempts(request=req2, user_id=self.user.user_id)
        self.assertEqual(resp2.results[0].status, "event_conflict")

    def test_conflict_null_then_explicit(self):
        # Test 4: null -> created, T2 -> event_conflict
        t2 = datetime.datetime(2026, 9, 27, 19, 0, 0, tzinfo=datetime.timezone.utc)
        
        req1 = KnowledgeAttemptSyncRequest(attempts=[
            self.item(client_event_id="evt_null_T2", knowledge_item_id=self.ki1.id)
        ])
        sync_knowledge_attempts(request=req1, user_id=self.user.user_id)
        
        req2 = KnowledgeAttemptSyncRequest(attempts=[
            self.item(client_event_id="evt_null_T2", knowledge_item_id=self.ki1.id, event_time=t2)
        ])
        resp2 = sync_knowledge_attempts(request=req2, user_id=self.user.user_id)
        self.assertEqual(resp2.results[0].status, "event_conflict")

    def test_user_isolation(self):
        TMA_Collaborator.create(user_id=2, target_type='deck', target_id=self.deck.id, role='viewer')
        # Test 4
        req = KnowledgeAttemptSyncRequest(attempts=[
            self.item(client_event_id="evt_shared", knowledge_item_id=self.ki1.id)
        ])
        resp1 = sync_knowledge_attempts(request=req, user_id=self.user.user_id)
        resp2 = sync_knowledge_attempts(request=req, user_id=self.user2.user_id)
        self.assertEqual(resp1.results[0].status, "created")
        self.assertEqual(resp2.results[0].status, "created")
        self.assertEqual(TMAKnowledgeAttempt.select().where(TMAKnowledgeAttempt.client_event_id == "evt_shared").count(), 2)

    def test_invalid_knowledge_item(self):
        # Test 6
        req = KnowledgeAttemptSyncRequest(attempts=[
            self.item(client_event_id="evt_invalid", knowledge_item_id=999)
        ])
        resp = sync_knowledge_attempts(request=req, user_id=self.user.user_id)
        self.assertEqual(resp.results[0].status, "rejected")
        self.assertEqual(resp.results[0].error_code, "knowledge_item_not_found")

    def test_invalid_review_id(self):
        # review_id does not exist or doesn't belong to the user
        req = KnowledgeAttemptSyncRequest(attempts=[
            self.item(client_event_id="evt_review", knowledge_item_id=self.ki1.id, review_id=999)
        ])
        resp = sync_knowledge_attempts(request=req, user_id=self.user.user_id)
        self.assertEqual(resp.results[0].status, "rejected")
        self.assertEqual(resp.results[0].error_code, "review_not_found_or_unauthorized")

    def test_partial_batch(self):
        # Test 7
        now = datetime.datetime(2026, 9, 27, 18, 0, 0, tzinfo=datetime.timezone.utc)
        req = KnowledgeAttemptSyncRequest(attempts=[
            self.item(client_event_id="evt_b1", knowledge_item_id=self.ki1.id, event_time=now),
            self.item(client_event_id="evt_b1", knowledge_item_id=self.ki1.id, event_time=now), # duplicate inline! Wait, the first one will create it, the second might fail due to integrity if processed in same batch... actually loop processes sequentially in my code.
            self.item(client_event_id="evt_b3", knowledge_item_id=999),
            self.item(client_event_id="evt_b4", knowledge_item_id=self.ki1.id)
        ])
        resp = sync_knowledge_attempts(request=req, user_id=self.user.user_id)
        self.assertEqual(resp.results[0].status, "created")
        self.assertEqual(resp.results[1].status, "duplicate")
        self.assertEqual(resp.results[2].status, "rejected")
        self.assertEqual(resp.results[3].status, "created")

    def test_oversized_batch(self):
        # Test 8
        items = [self.item(client_event_id=f"e{i}", knowledge_item_id=self.ki1.id) for i in range(101)]
        from pydantic import ValidationError
        with self.assertRaises(ValidationError):
            KnowledgeAttemptSyncRequest(attempts=items)

    def test_authentication(self):
        # Test 9
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.routers.knowledge import router
        
        # We create a dummy app just to test the dependency
        app = FastAPI()
        app.include_router(router)
        client = TestClient(app)
        
        # This should fail since we haven't provided any valid auth tokens or session headers
        response = client.post("/knowledge/attempts/sync", json={
            "attempts": [{"client_event_id": "auth1", "knowledge_item_id": self.ki1.id}]
        })
        self.assertIn(response.status_code, [401, 403])
        self.assertEqual(TMAKnowledgeAttempt.select().where(TMAKnowledgeAttempt.client_event_id == "auth1").count(), 0)

if __name__ == '__main__':
    unittest.main()
