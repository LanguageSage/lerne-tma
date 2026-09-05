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
    models.TMASetting,
    models.TMACustomPrompt
], safe=True)

# Mock AI Service responses
from unittest.mock import patch, AsyncMock
from api import ai_service


async def run_tests():
    print("=== STARTING BATCH AI GENERATION INTEGRATION TESTS ===")

    user_id = 777888

    # Seed User, Deck and AI Settings
    models.TMAUser.create(user_id=user_id, first_name="Test User")
    deck = models.TMA_Deck.create(id=50, user_id=user_id, name="German Batch Deck")
    models.TMASetting.create(key="AI_PROVIDER", value="google")
    models.TMASetting.create(key="GOOGLE_API_KEY", value="test_api_key")
    models.TMASetting.create(key="DEFAULT_MODEL", value="gemini-3.1-flash-lite")

    # Sample multi-line input (short words & long sentences mixed)
    sample_text = """Der Hund
Die Katze
Mein erster Eindruck ist, dass das Gebäude sehr modern wirkt.
Собака
Das Haus mit dem großen Garten."""

    # Mock AIService.chat_completion to return a valid JSON array
    mock_ai_json = """```json
[
  {"front": "Der Hund", "back": "собака (м.р.)", "context": "Der Hund bellt im Garten.", "level": "A1"},
  {"front": "Die Katze", "back": "кошка (ж.р.)", "context": "Die Katze schläft auf dem Sofa.", "level": "A1"},
  {"front": "Mein erster Eindruck ist, dass das Gebäude sehr modern wirkt.", "back": "Моё первое впечатление — что здание выглядит очень современным.", "context": "Mein erster Eindruck was positiv.", "level": "B2"},
  {"front": "der Hund", "back": "Собака", "context": "Ich mag diesen Hund.", "level": "A1"},
  {"front": "Das Haus mit dem großen Garten.", "back": "Дом с большим садом.", "context": "Wir wohnen in einem Haus mit dem großen Garten.", "level": "A2"}
]
```"""

    print("\n[Test 1] Testing batch AI fields generation (Pass 1 content)...")
    with patch("api.ai_clients.AIService.chat_completion", new_callable=AsyncMock) as mock_chat:
        mock_chat.return_value = (mock_ai_json, True)
        
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

    # Test 2: classify_phrases_batch
    print("\n[Test 2] Testing classify_phrases_batch...")
    with patch("api.ai_clients.AIService.chat_completion", new_callable=AsyncMock) as mock_chat:
        mock_chat.return_value = ('["A1", "A1", "B2", "A1", "A2"]', True)
        phrases = [c["front"] for c in res["cards"]]
        levels = await ai_service.classify_phrases_batch(phrases, "de")
        assert len(levels) == 5
        assert levels[0] == "A1"
        assert levels[2] == "B2"
        print("  -> PASSED: classify_phrases_batch returned accurate CEFR level array.")

    # Test 3: Test classify_cards_batch_endpoint (/cards/classify-batch)
    print("\n[Test 3] Testing /cards/classify-batch endpoint on deck cards...")
    import datetime
    for idx, cd in enumerate(res["cards"]):
        models.TMA_Card.create(
            deck_id=deck.id,
            front_text=cd["front"],
            back_text=cd["back"],
            context=cd["context"],
            tags="",
            source="ai_batch",
            position=idx + 1,
            created_at=datetime.datetime.now(),
            updated_at=datetime.datetime.now()
        )

    from api.routers.ai import classify_cards_batch_endpoint, ClassifyBatchRequest
    with patch("api.ai_service.classify_phrases_batch", new_callable=AsyncMock) as mock_classify:
        mock_classify.return_value = ["A1", "A1", "B2", "A1", "A2"]
        req = ClassifyBatchRequest(deck_id=deck.id, target_language="de")
        classify_res = await classify_cards_batch_endpoint(req, user_id=user_id)
        assert classify_res["status"] == "ok"
        assert classify_res["updated_count"] == 5
        
        db_cards = list(models.TMA_Card.select().where(models.TMA_Card.deck_id == deck.id).order_by(models.TMA_Card.position.asc()))
        assert db_cards[0].tags == "A1"
        assert db_cards[2].tags == "B2"
        print("  -> PASSED: /cards/classify-batch successfully classified and updated all deck card tags.")

    print("\n=== ALL TWO-PASS AND BATCH CLASSIFICATION TESTS PASSED PERFECTLY ===\n")


if __name__ == "__main__":
    asyncio.run(run_tests())
