import os
import sys
from peewee import SqliteDatabase

# Ensure project root is in python path
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
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
    models.TMA_Collaborator,
    models.TMAProgress,
    models.TMASetting
], safe=True)

from api.services import cards


def test_bulk_save_partial_failure():
    print("=== STARTING BULK SAVE PARTIAL FAILURE BACKEND TEST ===")
    user_id = 999888
    other_user_id = 777777
    models.TMAUser.create(user_id=user_id, first_name="Test User")
    models.TMAUser.create(user_id=other_user_id, first_name="Other User")

    deck = models.TMA_Deck.create(id=500, user_id=user_id, name="Test Bulk Deck")
    other_deck = models.TMA_Deck.create(id=600, user_id=other_user_id, name="Other User Deck")

    # Create a card owned by other user
    other_card = models.TMA_Card.create(id=999, deck_id=other_deck.id, front_text="Other front", back_text="Other back")

    # Batch of 3 cards: Valid, Invalid (unauthorized edit of other user's card), Valid
    batch_data = [
        {
            "deck_id": deck.id,
            "front": "Card 1 (Valid)",
            "back": "Answer 1",
            "card_type": "trainer"
        },
        {
            "id": other_card.id, # Triggers PermissionError in save_card
            "deck_id": other_deck.id,
            "front": "Card 2 (Forbidden Edit)",
            "back": "Answer 2",
            "card_type": "trainer"
        },
        {
            "deck_id": deck.id,
            "front": "Card 3 (Valid)",
            "back": "Answer 3",
            "card_type": "match"
        }
    ]

    print("\n[Step 1] Executing cards.bulk_save_cards with 3 cards (1 forbidden edit)...")
    res = cards.bulk_save_cards(batch_data, user_id)

    print("Result response:", res)

    # Assertions
    assert res["status"] == "success", "Response status must be success"
    assert res["created_count"] == 2, f"Expected 2 created cards, got {res['created_count']}"
    assert res["failed_count"] == 1, f"Expected 1 failed card, got {res['failed_count']}"
    assert len(res["cards"]) == 2, f"Expected 2 items in 'cards', got {len(res['cards'])}"
    assert len(res["failed"]) == 1, f"Expected 1 item in 'failed', got {len(res['failed'])}"
    assert res["failed"][0]["index"] == 1, f"Failed card index should be 1, got {res['failed'][0]['index']}"
    assert "Нет прав" in res["failed"][0]["message"] or "PermissionError" in res["failed"][0]["message"], f"Expected permission message, got {res['failed'][0]['message']}"

    # Verify database persistence of valid cards
    print("\n[Step 2] Verifying database state for created cards...")
    db_cards = list(models.TMA_Card.select().where((models.TMA_Card.deck_id == deck.id) & (models.TMA_Card.is_deleted == False)))
    assert len(db_cards) == 2, f"Expected 2 cards in DB, found {len(db_cards)}"

    fronts = [c.front_text for c in db_cards]
    assert "Card 1 (Valid)" in fronts, "Card 1 must exist in DB"
    assert "Card 3 (Valid)" in fronts, "Card 3 must exist in DB"

    print("  -> PASSED: Card 1 and Card 3 exist in database despite Card 2 failing.")
    print("\n=== ALL BULK SAVE PARTIAL FAILURE BACKEND TESTS PASSED PERFECTLY ===")


if __name__ == '__main__':
    test_bulk_save_partial_failure()
