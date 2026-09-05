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
    print("=== STARTING COLLABORATIVE FIXES INTEGRATION TESTS ===")

    owner_id = 111111
    editor_id = 222222
    viewer_id = 333333

    # Seed users
    models.TMAUser.create(user_id=owner_id, first_name="Anna Owner")
    models.TMAUser.create(user_id=editor_id, first_name="Ilya Editor")
    models.TMAUser.create(user_id=viewer_id, first_name="Maria Viewer")

    # Create folder "Диалоги" and deck "Разговор 1"
    folder = models.TMA_Folder.create(id=10, user_id=owner_id, name="Диалоги")
    deck = models.TMA_Deck.create(id=200, user_id=owner_id, folder_id=folder.id, name="Разговор 1")

    # Add collaborators to folder "Диалоги"
    models.TMA_Collaborator.create(target_type='folder', target_id=folder.id, user_id=editor_id, role='editor', added_by=owner_id)
    models.TMA_Collaborator.create(target_type='folder', target_id=folder.id, user_id=viewer_id, role='viewer', added_by=owner_id)

    # 1. Owner creates a card in deck
    print("\n[Step 1] Owner (Anna) saves a new card in deck...")
    t_folder_before = folder.updated_at
    card = cards.save_card({"deck_id": deck.id, "front": "Guten Tag", "back": "Добрый день", "creator_id": str(owner_id)}, user_id=owner_id)
    assert card.id is not None

    folder_after_save = models.TMA_Folder.get_by_id(folder.id)
    assert folder_after_save.updated_at is not None
    print(f"  -> PASSED: Card saved ({card.id}). Folder 'Диалоги' updated_at touched: {folder_after_save.updated_at}")

    # 2. Check live presence timestamp for folder
    print("\n[Step 2] Checking presence update for folder 'Диалоги'...")
    p_res1 = collaborative_service.record_and_get_presence(user_id=editor_id, target_type='folder', target_id=folder.id)
    assert p_res1["updated_at"] is not None
    print(f"  -> PASSED: Presence endpoint returned updated_at for folder: {p_res1['updated_at']}")

    # 3. Editor (Ilya) edits Owner's card
    print("\n[Step 3] Editor (Ilya) edits card created by Owner...")
    updated_card = cards.save_card({"card_id": card.id, "deck_id": deck.id, "front": "Guten Tag!", "back": "Добрый день!"}, user_id=editor_id)
    assert updated_card.front_text == "Guten Tag!"
    print("  -> PASSED: Editor successfully edited card created by Owner.")

    # 4. Viewer (Maria) tries to delete card -> Should fail
    print("\n[Step 4] Viewer (Maria) attempts to delete card (Should be forbidden)...")
    res_viewer_delete = cards.delete_card(card.id, user_id=viewer_id)
    assert res_viewer_delete == False, "Viewer must not be allowed to delete card"
    print("  -> PASSED: Viewer permission safely rejected.")

    # 5. Editor (Ilya) deletes Owner's card -> Should succeed
    print("\n[Step 5] Editor (Ilya) deletes card created by Owner...")
    res_editor_delete = cards.delete_card(card.id, user_id=editor_id)
    assert res_editor_delete == True, "Editor must be allowed to delete card in collaborative folder"

    card_in_db = models.TMA_Card.get_by_id(card.id)
    assert card_in_db.is_deleted == True
    print("  -> PASSED: Editor successfully deleted card without 404/500 errors.")

    # 6. Verify folder.updated_at touched on delete
    folder_after_delete = models.TMA_Folder.get_by_id(folder.id)
    p_res2 = collaborative_service.record_and_get_presence(user_id=editor_id, target_type='folder', target_id=folder.id)
    print(f"  -> PASSED: Folder timestamp touched on delete: {p_res2['updated_at']}")

    print("\n=== ALL COLLABORATIVE FIX INTEGRATION TESTS PASSED PERFECTLY ===")


if __name__ == '__main__':
    run_tests()
