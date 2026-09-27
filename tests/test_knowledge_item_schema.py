import unittest
import os
import sys
import datetime
from peewee import SqliteDatabase, IntegrityError

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

test_db = SqliteDatabase(':memory:')

from api.models import (
    tma_db, TMAUser, TMA_Card, TMA_Deck,
    TMAKnowledgeItem, TMACardKnowledgeItem, TMAKnowledgeAttempt, TMAUserKnowledgeState
)

class TestKnowledgeItemSchema(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        models = [TMAUser, TMA_Deck, TMA_Card, TMAKnowledgeItem, TMACardKnowledgeItem, TMAKnowledgeAttempt, TMAUserKnowledgeState]
        test_db.bind(models, bind_refs=False, bind_backrefs=False)
        tma_db.initialize(test_db)
        test_db.connect()
        test_db.create_tables(models)
        # Apply the partial index manually for SQLite test
        try:
            test_db.execute_sql("CREATE UNIQUE INDEX IF NOT EXISTS idx_tma_card_ki_primary ON tma_card_knowledge_item(card_id) WHERE role = 'primary'")
        except Exception:
            pass

    def setUp(self):
        TMAUserKnowledgeState.delete().execute()
        TMAKnowledgeAttempt.delete().execute()
        TMACardKnowledgeItem.delete().execute()
        TMAKnowledgeItem.delete().execute()
        TMA_Card.delete().execute()
        TMA_Deck.delete().execute()
        TMAUser.delete().execute()

        self.user = TMAUser.create(user_id=1, username="testuser")
        self.deck = TMA_Deck.create(user_id=1, name="Test Deck")
        self.card = TMA_Card.create(deck=self.deck, front_text="Front", back_text="Back")
        self.ki1 = TMAKnowledgeItem.create(name="KI 1", language="de")
        self.ki2 = TMAKnowledgeItem.create(name="KI 2", language="de")

    def test_unique_pair_card_ki(self):
        """Запрети повтор одной пары карточки и KI."""
        TMACardKnowledgeItem.create(card_id=self.card.id, knowledge_item=self.ki1, role='secondary')
        with self.assertRaises(IntegrityError):
            TMACardKnowledgeItem.create(card_id=self.card.id, knowledge_item=self.ki1, role='secondary')

    def test_one_primary_ki_per_card(self):
        """Не более одного primary KI на карточку."""
        TMACardKnowledgeItem.create(card_id=self.card.id, knowledge_item=self.ki1, role='primary')
        with self.assertRaises(IntegrityError):
            TMACardKnowledgeItem.create(card_id=self.card.id, knowledge_item=self.ki2, role='primary')

    def test_multiple_secondary_ki_allowed(self):
        """Допустимы несколько secondary KI."""
        TMACardKnowledgeItem.create(card_id=self.card.id, knowledge_item=self.ki1, role='primary')
        TMACardKnowledgeItem.create(card_id=self.card.id, knowledge_item=self.ki2, role='secondary')
        ki3 = TMAKnowledgeItem.create(name="KI 3")
        TMACardKnowledgeItem.create(card_id=self.card.id, knowledge_item=ki3, role='secondary')
        self.assertEqual(TMACardKnowledgeItem.select().count(), 3)

    def test_attempt_idempotency(self):
        """Одинаковый ключ события не может создать дубль."""
        TMAKnowledgeAttempt.create(
            user_id=self.user.user_id, knowledge_item=self.ki1, client_event_id="evt_123"
        )
        with self.assertRaises(IntegrityError):
            TMAKnowledgeAttempt.create(
                user_id=self.user.user_id, knowledge_item=self.ki1, client_event_id="evt_123"
            )

    def test_user_knowledge_state_unique(self):
        """Один UserKnowledgeState на пользователя и KI."""
        TMAUserKnowledgeState.create(user_id=self.user.user_id, knowledge_item=self.ki1)
        with self.assertRaises(IntegrityError):
            TMAUserKnowledgeState.create(user_id=self.user.user_id, knowledge_item=self.ki1)

if __name__ == '__main__':
    unittest.main()
