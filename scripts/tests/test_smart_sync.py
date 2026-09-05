import os
import sys
import datetime
from peewee import SqliteDatabase
from pydantic import BaseModel
from typing import List, Optional

# Ensure project root is in python path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

# Initialize in-memory SQLite database for testing
test_db = SqliteDatabase(':memory:')

from api import models
models.tma_db.initialize(test_db)
models.tma_db.connect()

# Create test tables
models.tma_db.create_tables([
    models.TMAUser,
    models.TMA_Folder,
    models.TMA_Deck,
    models.TMA_Card,
    models.TMAProgress
], safe=True)

from api.services.sync_service import execute_sync_push, execute_sync_pull

# Mock Pydantic models matching sync.py
class SyncFolderItem(BaseModel):
    id: int
    name: str
    is_deleted: bool = False
    is_pinned: bool = False
    position: int = 0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class SyncDeckItem(BaseModel):
    id: int
    name: str
    level: Optional[str] = None
    topic: Optional[str] = None
    is_deleted: bool = False
    is_pinned: bool = False
    position: int = 0
    folder_id: Optional[int] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class SyncCardItem(BaseModel):
    id: int
    deck_id: int
    front_text: str
    back_text: str
    context: Optional[str] = None
    image_path: Optional[str] = None
    audio_path: Optional[str] = None
    audio_back_path: Optional[str] = None
    video_front_path: Optional[str] = None
    video_back_path: Optional[str] = None
    want_to_learn: bool = False
    is_deleted: bool = False
    flag: Optional[int] = 0
    position: Optional[int] = 0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class SyncProgressItem(BaseModel):
    card_id: int
    queue: str
    interval: int
    ease_factor: float
    repetitions: int
    lapses: int
    step_index: Optional[int] = None
    next_review: Optional[str] = None
    last_reviewed: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class PushRequest(BaseModel):
    folders: List[SyncFolderItem] = []
    decks: List[SyncDeckItem] = []
    cards: List[SyncCardItem] = []
    progress: List[SyncProgressItem] = []


def run_tests():
    user_id = 999111
    print("=== STARTING SMART SYNC INTEGRATION TESTS ===")

    # Test 1: Negative ID mapping (creating offline folder, deck, card, progress)
    print("\n[Test 1] Testing temp negative ID mappings...")
    req1 = PushRequest(
        folders=[SyncFolderItem(id=-1, name="Offline Folder", created_at="2026-08-10T10:00:00Z", updated_at="2026-08-10T10:00:00Z")],
        decks=[SyncDeckItem(id=-10, name="Offline Deck", folder_id=-1, created_at="2026-08-10T10:00:00Z", updated_at="2026-08-10T10:00:00Z")],
        cards=[SyncCardItem(id=-100, deck_id=-10, front_text="Hund", back_text="Dog", image_path="http://img.png", audio_path="http://aud.mp3", created_at="2026-08-10T10:00:00Z", updated_at="2026-08-10T10:00:00Z")],
        progress=[SyncProgressItem(card_id=-100, queue="review", interval=5, ease_factor=2.5, repetitions=3, lapses=0, updated_at="2026-08-10T10:00:00Z")]
    )
    res1 = execute_sync_push(req1, user_id=user_id)
    assert res1["status"] == "success", "Push failed"
    mappings = res1["mappings"]
    
    real_folder_id = mappings["folders"]["-1"]
    real_deck_id = mappings["decks"]["-10"]
    real_card_id = mappings["cards"]["-100"]

    assert real_folder_id > 0, "Folder ID not mapped properly"
    assert real_deck_id > 0, "Deck ID not mapped properly"
    assert real_card_id > 0, "Card ID not mapped properly"
    print(f"  -> Mapped folder: -1 -> {real_folder_id}, deck: -10 -> {real_deck_id}, card: -100 -> {real_card_id}")

    # Verify created DB entities
    saved_card = models.TMA_Card.get_by_id(real_card_id)
    assert saved_card.front_text == "Hund"
    assert saved_card.image_path == "http://img.png"
    assert saved_card.audio_path == "http://aud.mp3"

    saved_prog = models.TMAProgress.get((models.TMAProgress.card_id == real_card_id) & (models.TMAProgress.user_id == user_id))
    assert saved_prog.queue == "review"
    assert saved_prog.interval == 5
    print("  -> PASSED: Temp negative IDs resolved and recorded in DB.")

    # Test 2: Smart Media Preservation during push edit
    print("\n[Test 2] Testing Smart Media Preservation...")
    # Client sends text edit for real_card_id with updated_at newer than server, but with NULL/empty media paths
    req2 = PushRequest(
        cards=[
            SyncCardItem(
                id=real_card_id,
                deck_id=real_deck_id,
                front_text="Der Hund (собака)",
                back_text="Dog",
                image_path=None, # Client didn't touch/send image
                audio_path="",   # Client didn't touch/send audio
                updated_at="2026-08-11T12:00:00Z" # Newer timestamp
            )
        ]
    )
    res2 = execute_sync_push(req2, user_id=user_id)
    assert res2["status"] == "success"

    card_after_push = models.TMA_Card.get_by_id(real_card_id)
    assert card_after_push.front_text == "Der Hund (собака)", f"Front text failed to update: {card_after_push.front_text}"
    assert card_after_push.image_path == "http://img.png", f"Media image lost! Got: {card_after_push.image_path}"
    assert card_after_push.audio_path == "http://aud.mp3", f"Media audio lost! Got: {card_after_push.audio_path}"
    print("  -> PASSED: Card text updated while existing server media was PRESERVED.")

    # Test 3: Incremental Pull
    print("\n[Test 3] Testing Incremental Pull...")
    pull_res = execute_sync_pull(since="2026-08-11T00:00:00Z", user_id=user_id)
    assert pull_res["status"] == "success"
    cards_pulled = pull_res["cards"]
    assert len(cards_pulled) == 1
    pulled_c = cards_pulled[0]
    assert pulled_c["id"] == real_card_id
    assert pulled_c["front_text"] == "Der Hund (собака)"
    assert pulled_c["image_path"] == "http://img.png"
    assert "flag" in pulled_c
    assert "position" in pulled_c
    print("  -> PASSED: Incremental pull returned updated card with media and metadata.")

    print("\n=== ALL SMART SYNC INTEGRATION TESTS PASSED PERFECTLY ===")

if __name__ == '__main__':
    run_tests()
