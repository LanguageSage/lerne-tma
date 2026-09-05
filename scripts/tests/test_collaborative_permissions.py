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

# Create test tables
models.tma_db.create_tables([
    models.TMAUser,
    models.TMA_Folder,
    models.TMA_Deck,
    models.TMA_Card,
    models.TMAProgress,
    models.TMAReviewHistory,
    models.TMA_Collaborator
], safe=True)

from api.services import collaborative_service


def run_tests():
    print("=== STARTING COLLABORATIVE & GRANULAR PERMISSIONS INTEGRATION TESTS ===")

    teacher_id = 1001
    student_a_id = 2002
    student_b_id = 3003

    # Seed users
    models.TMAUser.create(user_id=teacher_id, first_name="Teacher Alex", username="teacher_alex")
    models.TMAUser.create(user_id=student_a_id, first_name="Student Maria", username="student_maria")
    models.TMAUser.create(user_id=student_b_id, first_name="Student John", username="student_john")

    # 1. Create Folder Hierarchy
    print("\n[Step 1] Creating folder and deck hierarchy...")
    root_folder = models.TMA_Folder.create(id=1, user_id=teacher_id, name="Course B1")
    sub_folder = models.TMA_Folder.create(id=2, user_id=teacher_id, name="Grammar Subfolder", parent=root_folder)
    
    deck_theory = models.TMA_Deck.create(id=10, user_id=teacher_id, name="Theory Deck", folder=root_folder)
    deck_practice = models.TMA_Deck.create(id=20, user_id=teacher_id, name="Group Practice Deck", folder=sub_folder)

    # Verify owner permissions
    assert collaborative_service.get_effective_user_role(teacher_id, 'folder', 1) == 'owner'
    assert collaborative_service.get_effective_user_role(teacher_id, 'deck', 10) == 'owner'
    assert collaborative_service.get_effective_user_role(teacher_id, 'deck', 20) == 'owner'
    print("  -> PASSED: Owner role verified for teacher.")

    # 2. Add Student A as 'viewer' to Root Folder (Course B1)
    print("\n[Step 2] Testing cascading 'viewer' role inheritance...")
    collaborative_service.add_collaborator('folder', 1, student_a_id, role='viewer', added_by=teacher_id)

    role_root = collaborative_service.get_effective_user_role(student_a_id, 'folder', 1)
    role_sub = collaborative_service.get_effective_user_role(student_a_id, 'folder', 2)
    role_deck_theory = collaborative_service.get_effective_user_role(student_a_id, 'deck', 10)
    role_deck_practice = collaborative_service.get_effective_user_role(student_a_id, 'deck', 20)

    assert role_root == 'viewer', f"Expected viewer for root folder, got {role_root}"
    assert role_sub == 'viewer', f"Expected cascaded viewer for subfolder, got {role_sub}"
    assert role_deck_theory == 'viewer', f"Expected cascaded viewer for Theory deck, got {role_deck_theory}"
    assert role_deck_practice == 'viewer', f"Expected cascaded viewer for Practice deck, got {role_deck_practice}"
    print("  -> PASSED: 'viewer' role cascaded down folder hierarchy to subfolders and decks.")

    # 3. Apply Granular Override: Set Student A as 'editor' specifically on Group Practice Deck (deck_id=20)
    print("\n[Step 3] Testing Granular Override (Deck Editor over Folder Viewer)...")
    collaborative_service.add_collaborator('deck', 20, student_a_id, role='editor', added_by=teacher_id)

    role_deck_theory_after = collaborative_service.get_effective_user_role(student_a_id, 'deck', 10)
    role_deck_practice_after = collaborative_service.get_effective_user_role(student_a_id, 'deck', 20)

    assert role_deck_theory_after == 'viewer', f"Theory deck should remain viewer, got {role_deck_theory_after}"
    assert role_deck_practice_after == 'editor', f"Practice deck should override to editor, got {role_deck_practice_after}"
    print("  -> PASSED: Granular override worked! Deck 20 is 'editor' while Deck 10 remains 'viewer'.")

    # 4. Accessible IDs lookup and active decks/folders query
    print("\n[Step 4] Testing User Accessible Decks & Folders Lookup...")
    student_a_decks = collaborative_service.get_user_accessible_deck_ids(student_a_id)
    assert 10 in student_a_decks and 20 in student_a_decks, f"Student A should have access to decks 10 and 20. Got: {student_a_decks}"
    
    from api.services.decks import get_active_decks
    from api.services.folders import get_active_folders
    
    active_decks_student_a = get_active_decks(student_a_id)
    active_folders_student_a = get_active_folders(student_a_id)
    
    deck_ids_student_a = [d["id"] for d in active_decks_student_a]
    folder_ids_student_a = [f["id"] for f in active_folders_student_a]

    assert 10 in deck_ids_student_a and 20 in deck_ids_student_a, f"Student A active decks query must include shared decks. Got: {deck_ids_student_a}"
    assert 1 in folder_ids_student_a and 2 in folder_ids_student_a, f"Student A active folders query must include shared folders. Got: {folder_ids_student_a}"
    print("  -> PASSED: get_active_decks and get_active_folders successfully return shared decks and folders!")


    # 5. Group Progress & Leaderboard
    print("\n[Step 5] Testing Group Progress Aggregation & Leaderboard...")
    # Add Student B to root folder as viewer
    collaborative_service.add_collaborator('folder', 1, student_b_id, role='viewer', added_by=teacher_id)

    # Seed 3 cards
    models.TMA_Card.delete().where(models.TMA_Card.id << [9101, 9102, 9103]).execute()
    models.TMAProgress.delete().where(models.TMAProgress.card_id << [9101, 9102, 9103]).execute()
    c1 = models.TMA_Card.create(id=9101, deck=deck_theory, front_text="Front 1", back_text="Back 1")
    c2 = models.TMA_Card.create(id=9102, deck=deck_practice, front_text="Front 2", back_text="Back 2")
    c3 = models.TMA_Card.create(id=9103, deck=deck_practice, front_text="Front 3", back_text="Back 3")

    # Student A mastered 2 cards
    models.TMAProgress.create(card_id=9101, user_id=student_a_id, queue='review', interval=25)
    models.TMAProgress.create(card_id=9102, user_id=student_a_id, queue='review', interval=30)
    models.TMAReviewHistory.create(card_id=9101, user_id=student_a_id, rating=3)

    # Student B mastered 1 card
    models.TMAProgress.create(card_id=9101, user_id=student_b_id, queue='review', interval=25)

    progress_data = collaborative_service.get_group_progress(folder_id=1, requester_id=teacher_id)
    assert progress_data["total_cards"] == 3
    members = progress_data["members"]
    assert len(members) == 3 # Teacher + Student A + Student B

    student_a_stats = next(m for m in members if m["user_id"] == student_a_id)
    student_b_stats = next(m for m in members if m["user_id"] == student_b_id)

    assert student_a_stats["mastered_cards"] == 2
    assert student_a_stats["progress_percent"] == 67
    assert student_a_stats["reviews_today"] == 1

    assert student_b_stats["mastered_cards"] == 1
    assert student_b_stats["progress_percent"] == 33

    # Check leaderboard sorting (Student A at top of non-owners)
    assert members[0]["user_id"] == student_a_id or members[1]["user_id"] == student_a_id
    print("  -> PASSED: Group progress aggregated correctly, percent calculated, and leaderboard sorted.")

    # 6. Card Editing Role Enforcement
    print("\n[Step 6] Testing Card Editing Role Enforcement...")
    from api.services.cards import save_card
    from fastapi import HTTPException

    # Student B has role 'viewer' on deck 10 -> Should fail with 403
    viewer_failed = False
    try:
        save_card({"id": 101, "deck_id": 10, "front": "Hacked Front"}, user_id=student_b_id)
    except HTTPException as exc:
        if exc.status_code == 403:
            viewer_failed = True

    assert viewer_failed, "Student B (viewer) should be rejected from editing card on deck 10 with HTTP 403."

    # Student A has role 'editor' on deck 20 -> Should succeed!
    updated_card = save_card({"id": 102, "deck_id": 20, "front": "Editor Updated Front"}, user_id=student_a_id)
    assert updated_card.front_text == "Editor Updated Front"
    print("  -> PASSED: Viewer rejected from editing cards (HTTP 403), Editor successfully saved changes for group!")

    # 7. Creating new decks inside a shared folder
    print("\n[Step 7] Testing New Deck Creation in Shared Folder...")
    from api.services.decks import create_deck

    # Student B (viewer) trying to create deck in Folder 1 -> Should fail HTTP 403
    create_viewer_failed = False
    try:
        create_deck(name="Illegal Deck", user_id=student_b_id, folder_id=1)
    except HTTPException as exc:
        if exc.status_code == 403:
            create_viewer_failed = True

    assert create_viewer_failed, "Student B (viewer) must be blocked from creating decks in Folder 1"

    # Update Student A's role on Folder 1 to 'editor'
    collaborative_service.add_collaborator('folder', 1, student_a_id, role='editor', added_by=teacher_id)

    # Student A (editor on folder 1) -> Creates deck in Folder 1
    new_collab_deck = create_deck(name="Editor Shared Deck", user_id=student_a_id, folder_id=1)
    assert new_collab_deck.id is not None


    # Verify Teacher and Student B automatically get access and roles for new_collab_deck
    teacher_accessible_decks = collaborative_service.get_user_accessible_deck_ids(teacher_id)
    student_b_accessible_decks = collaborative_service.get_user_accessible_deck_ids(student_b_id)

    assert new_collab_deck.id in teacher_accessible_decks, "Teacher must see new deck created in shared folder"
    assert new_collab_deck.id in student_b_accessible_decks, "Student B must see new deck created in shared folder"

    role_teacher_new_deck = collaborative_service.get_effective_user_role(teacher_id, 'deck', new_collab_deck.id)
    role_student_b_new_deck = collaborative_service.get_effective_user_role(student_b_id, 'deck', new_collab_deck.id)

    assert role_teacher_new_deck == 'owner', f"Teacher should be owner, got {role_teacher_new_deck}"
    assert role_student_b_new_deck == 'viewer', f"Student B should be viewer, got {role_student_b_new_deck}"

    print("  -> PASSED: New deck created by Editor in shared folder is automatically accessible to everyone with inherited roles!")

    print("\n=== ALL COLLABORATIVE & GRANULAR PERMISSION TESTS PASSED PERFECTLY ===")




if __name__ == '__main__':
    run_tests()
