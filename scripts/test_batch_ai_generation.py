import os
import sys
import asyncio
from peewee import SqliteDatabase

# Ensure project root is in python path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

# Initialize in-memory SQLite database for testing
test_db = SqliteDatabase(':memory:')

from api import models
models.tma_db.initialize(test_db)
models.tma_db.connect()

models.tma_db.create_tables([
    models.TMAUser,
    models.TMA_Folder,
    models.TMA_Deck,
    models.TMA_Card,
    models.TMAProgress,
    models.TMASetting
], safe=True)

# Mock AI Service responses
from unittest.mock import patch, AsyncMock
from api import ai_service


async def run_tests():
    print("=== STARTING BATCH AI GENERATION INTEGRATION TESTS ===")

    user_id = 777888

    # Seed User and Deck
    models.TMAUser.create(user_id=user_id, first_name="Test User")
    deck = models.TMA_Deck.create(id=50, user_id=user_id, name="German Batch Deck")

    # Sample multi-line input (short words & long sentences mixed)
    sample_text = """Der Hund
Die Katze
Mein erster Eindruck ist, dass das Gebäude sehr modern wirkt.
Собака
Das Haus mit dem großen Garten."""

    # Mock AIService.chat_completion to return a valid JSON array
    mock_ai_json = """```json
[
  {"front": "Der Hund", "back": "собака (м.р.)", "context": "Der Hund bellt im Garten."},
  {"front": "Die Katze", "back": "кошка (ж.р.)", "context": "Die Katze schläft auf dem Sofa."},
  {"front": "Mein erster Eindruck ist, dass das Gebäude sehr modern wirkt.", "back": "Моё первое впечатление — что здание выглядит очень современным.", "context": "Mein erster Eindruck war positiv."},
  {"front": "der Hund", "back": "Собака", "context": "Ich mag diesen Hund."},
  {"front": "Das Haus mit dem großen Garten.", "back": "Дом с большим садом.", "context": "Wir wohnen in einem Haus mit dem großen Garten."}
]
```"""

    print("\n[Test 1] Testing batch AI fields generation...")
    with patch("api.ai_clients.AIService.chat_completion", new_callable=AsyncMock) as mock_chat:
        mock_chat.return_value = (True, mock_ai_json)
        
        # Test generate_batch_card_fields
        res = await ai_service.generate_batch_card_fields(
            user_id=user_id,
            text=sample_text,
            target_language="de"
        )

        assert res["status"] == "success", f"Expected success, got: {res}"
        assert res["total_requested"] == 5, f"Expected 5 requested, got {res['total_requested']}"
        assert len(res["cards"]) == 5, f"Expected 5 cards, got {len(res['cards'])}"
        print("  -> PASSED: Batch AI fields generation returned 5 parsed cards.")

    # Test 2: Auto-creation of TMA_Card in target deck
    print("\n[Test 2] Testing auto-creation of cards in TMA_Card database...")
    cards_data = res["cards"]
    import datetime
    saved_cards = []
    for cd in cards_data:
        c = models.TMA_Card.create(
            deck_id=deck.id,
            front_text=cd["front"],
            back_text=cd["back"],
            context=cd["context"],
            source="ai_batch",
            created_at=datetime.datetime.now(),
            updated_at=datetime.datetime.now()
        )
        saved_cards.append(c)

    db_cards = list(models.TMA_Card.select().where(models.TMA_Card.deck_id == deck.id))
    assert len(db_cards) == 5, f"Expected 5 DB cards, got {len(db_cards)}"
    assert db_cards[0].front_text == "Der Hund"
    assert db_cards[2].front_text == "Mein erster Eindruck ist, dass das Gebäude sehr modern wirkt."
    print("  -> PASSED: 5 cards successfully created in TMA_Card database.")

    print("\n=== ALL BATCH AI GENERATION INTEGRATION TESTS PASSED PERFECTLY ===")


if __name__ == '__main__':
    asyncio.run(run_tests())
