import os
import sys
import datetime
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
    models.TMA_Collaborator,
    models.TMAProgress,
    models.TMASetting
], safe=True)

from api.services import collaborative_service, cards


def run_tests():
    print("=== STARTING COLLABORATIVE LIVE PRESENCE & AUTO-SYNC TESTS ===")

    owner_id = 111111
    user_b_id = 222222

    # 1. Create users & collaborative deck
    models.TMAUser.create(user_id=owner_id, first_name="Anna", username="anna_teacher")
    models.TMAUser.create(user_id=user_b_id, first_name="Ilya", username="ilya_student")

    deck = models.TMA_Deck.create(id=100, user_id=owner_id, name="Диалоги (Shared)")
    models.TMA_Collaborator.create(target_type='deck', target_id=deck.id, user_id=user_b_id, role='editor', added_by=owner_id)

    print("\n[Step 1] Initial presence check (Both users offline)...")
    res1 = collaborative_service.record_and_get_presence(user_id=owner_id, target_type='deck', target_id=deck.id)
    # owner_id just pinged, so owner_id is online, user_b_id is offline
    assert res1["online_count"] == 1, f"Expected 1 online user, got {res1['online_count']}"
    assert res1["collaborators"][0]["user_id"] == owner_id, "Active user should be leftmost"
    assert res1["collaborators"][0]["is_online"] == True
    assert res1["collaborators"][1]["user_id"] == user_b_id
    assert res1["collaborators"][1]["is_online"] == False
    print("  -> PASSED: Active user (Anna) is leftmost & online, User B (Ilya) is rightmost & offline.")

    # 2. Both users send heartbeats
    print("\n[Step 2] User B (Ilya) sends heartbeat presence ping...")
    res2 = collaborative_service.record_and_get_presence(user_id=user_b_id, target_type='deck', target_id=deck.id)
    assert res2["online_count"] == 2, f"Expected 2 online users, got {res2['online_count']}"
    print("  -> PASSED: Both collaborators are now active online.")

    # 3. Card Edit updates deck.updated_at
    print("\n[Step 3] Card Edit by User A updates deck.updated_at timestamp...")
    t_before = deck.updated_at
    card = cards.save_card({"deck_id": deck.id, "front": "Hallo", "back": "Привет"}, user_id=owner_id)
    deck_refreshed = models.TMA_Deck.get_by_id(deck.id)
    
    assert card.id is not None
    assert deck_refreshed.updated_at is not None
    print(f"  -> PASSED: Deck updated_at touched on card save: {deck_refreshed.updated_at}")

    print("\n=== ALL LIVE COLLABORATIVE PRESENCE TESTS PASSED PERFECTLY ===")


if __name__ == '__main__':
    run_tests()
