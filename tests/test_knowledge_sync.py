import unittest
import os
import sys
import datetime
from peewee import SqliteDatabase

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

test_db = SqliteDatabase(':memory:')

from api.models import (
    tma_db, TMAUser, TMA_Card, TMA_Deck,
    TMAKnowledgeItem, TMACardKnowledgeItem, TMAKnowledgeAttempt, TMAUserKnowledgeState,
    TMAReviewHistory
)
from api.routers.knowledge import sync_knowledge_attempts, KnowledgeAttemptSyncRequest, KnowledgeAttemptSyncItem

class TestKnowledgeSyncAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        models = [TMAUser, TMA_Deck, TMA_Card, TMAKnowledgeItem, TMACardKnowledgeItem, TMAKnowledgeAttempt, TMAUserKnowledgeState, TMAReviewHistory]
        test_db.bind(models, bind_refs=False, bind_backrefs=False)
        tma_db.initialize(test_db)
        test_db.connect()
        test_db.create_tables(models)

    def setUp(self):
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

    def test_create_attempt(self):
        # Test 1
        req = KnowledgeAttemptSyncRequest(attempts=[
            KnowledgeAttemptSyncItem(client_event_id="evt1", knowledge_item_id=self.ki1.id)
        ])
        resp = sync_knowledge_attempts(request=req, user_id=self.user.user_id)
        self.assertEqual(resp.results[0].status, "created")
        self.assertEqual(TMAKnowledgeAttempt.select().count(), 1)

    def test_duplicate_null_event_time(self):
        # Test 1: null -> created, null -> duplicate
        req = KnowledgeAttemptSyncRequest(attempts=[
            KnowledgeAttemptSyncItem(client_event_id="evt_null", knowledge_item_id=self.ki1.id) # event_time=None
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
            KnowledgeAttemptSyncItem(client_event_id="evt_T1", knowledge_item_id=self.ki1.id, event_time=now)
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
            KnowledgeAttemptSyncItem(client_event_id="evt_T1_T2", knowledge_item_id=self.ki1.id, event_time=t1)
        ])
        sync_knowledge_attempts(request=req1, user_id=self.user.user_id)
        
        req2 = KnowledgeAttemptSyncRequest(attempts=[
            KnowledgeAttemptSyncItem(client_event_id="evt_T1_T2", knowledge_item_id=self.ki1.id, event_time=t2)
        ])
        resp2 = sync_knowledge_attempts(request=req2, user_id=self.user.user_id)
        self.assertEqual(resp2.results[0].status, "event_conflict")

    def test_conflict_null_then_explicit(self):
        # Test 4: null -> created, T2 -> event_conflict
        t2 = datetime.datetime(2026, 9, 27, 19, 0, 0, tzinfo=datetime.timezone.utc)
        
        req1 = KnowledgeAttemptSyncRequest(attempts=[
            KnowledgeAttemptSyncItem(client_event_id="evt_null_T2", knowledge_item_id=self.ki1.id)
        ])
        sync_knowledge_attempts(request=req1, user_id=self.user.user_id)
        
        req2 = KnowledgeAttemptSyncRequest(attempts=[
            KnowledgeAttemptSyncItem(client_event_id="evt_null_T2", knowledge_item_id=self.ki1.id, event_time=t2)
        ])
        resp2 = sync_knowledge_attempts(request=req2, user_id=self.user.user_id)
        self.assertEqual(resp2.results[0].status, "event_conflict")

    def test_user_isolation(self):
        # Test 4
        req = KnowledgeAttemptSyncRequest(attempts=[
            KnowledgeAttemptSyncItem(client_event_id="evt_shared", knowledge_item_id=self.ki1.id)
        ])
        resp1 = sync_knowledge_attempts(request=req, user_id=self.user.user_id)
        resp2 = sync_knowledge_attempts(request=req, user_id=self.user2.user_id)
        self.assertEqual(resp1.results[0].status, "created")
        self.assertEqual(resp2.results[0].status, "created")
        self.assertEqual(TMAKnowledgeAttempt.select().where(TMAKnowledgeAttempt.client_event_id == "evt_shared").count(), 2)

    def test_invalid_knowledge_item(self):
        # Test 6
        req = KnowledgeAttemptSyncRequest(attempts=[
            KnowledgeAttemptSyncItem(client_event_id="evt_invalid", knowledge_item_id=999)
        ])
        resp = sync_knowledge_attempts(request=req, user_id=self.user.user_id)
        self.assertEqual(resp.results[0].status, "rejected")
        self.assertEqual(resp.results[0].error_code, "knowledge_item_not_found")

    def test_invalid_review_id(self):
        # review_id does not exist or doesn't belong to the user
        req = KnowledgeAttemptSyncRequest(attempts=[
            KnowledgeAttemptSyncItem(client_event_id="evt_review", knowledge_item_id=self.ki1.id, review_id=999)
        ])
        resp = sync_knowledge_attempts(request=req, user_id=self.user.user_id)
        self.assertEqual(resp.results[0].status, "rejected")
        self.assertEqual(resp.results[0].error_code, "review_not_found_or_unauthorized")

    def test_partial_batch(self):
        # Test 7
        now = datetime.datetime(2026, 9, 27, 18, 0, 0, tzinfo=datetime.timezone.utc)
        req = KnowledgeAttemptSyncRequest(attempts=[
            KnowledgeAttemptSyncItem(client_event_id="evt_b1", knowledge_item_id=self.ki1.id, event_time=now),
            KnowledgeAttemptSyncItem(client_event_id="evt_b1", knowledge_item_id=self.ki1.id, event_time=now), # duplicate inline! Wait, the first one will create it, the second might fail due to integrity if processed in same batch... actually loop processes sequentially in my code.
            KnowledgeAttemptSyncItem(client_event_id="evt_b3", knowledge_item_id=999),
            KnowledgeAttemptSyncItem(client_event_id="evt_b4", knowledge_item_id=self.ki1.id)
        ])
        resp = sync_knowledge_attempts(request=req, user_id=self.user.user_id)
        self.assertEqual(resp.results[0].status, "created")
        self.assertEqual(resp.results[1].status, "duplicate")
        self.assertEqual(resp.results[2].status, "rejected")
        self.assertEqual(resp.results[3].status, "created")

    def test_oversized_batch(self):
        # Test 8
        items = [KnowledgeAttemptSyncItem(client_event_id=f"e{i}", knowledge_item_id=self.ki1.id) for i in range(101)]
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
