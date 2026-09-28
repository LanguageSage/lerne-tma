import pytest
from fastapi.testclient import TestClient
from api.models import TMA_Folder, TMA_Deck, TMA_Card, TMAProgress, TMAUser, tma_db
from api.main import app
import os
import datetime

client = TestClient(app)

# Helper for test IDs
ADMIN_ID = int(os.environ.get("ADMIN_USER_ID", "642478257"))
OWNER_ID = 101010
VIEWER_ID = 202020

@pytest.fixture(scope="module", autouse=True)
def setup_teardown():
    # Setup
    with tma_db.atomic():
        TMAUser.get_or_create(user_id=ADMIN_ID, defaults={'username': 'admin'})
        TMAUser.get_or_create(user_id=OWNER_ID, defaults={'username': 'owner'})
        TMAUser.get_or_create(user_id=VIEWER_ID, defaults={'username': 'viewer'})
        
        folder = TMA_Folder.create(
            user_id=OWNER_ID,
            name="Test Official Folder",
            access_scope="private"
        )
        
        deck = TMA_Deck.create(
            user_id=OWNER_ID,
            folder_id=folder.id,
            name="Test Official Deck"
        )
        
        card = TMA_Card.create(
            deck_id=deck.id,
            front_text="Front",
            back_text="Back",
            position=1
        )
        
    yield {'folder_id': folder.id, 'deck_id': deck.id, 'card_id': card.id}
    
    # Teardown
    with tma_db.atomic():
        TMA_Card.delete().where(TMA_Card.id == card.id).execute()
        TMA_Deck.delete().where(TMA_Deck.id == deck.id).execute()
        TMA_Folder.delete().where(TMA_Folder.id == folder.id).execute()
        TMAProgress.delete().where(TMAProgress.card_id == card.id).execute()


def auth_headers(user_id):
    return {"X-User-ID": str(user_id)}


def test_01_non_admin_cannot_publish(setup_teardown):
    folder_id = setup_teardown['folder_id']
    resp = client.post(
        f"/api/collaborative/admin/folders/{folder_id}/access-scope",
        json={"access_scope": "global_readonly"},
        headers=auth_headers(OWNER_ID)
    )
    assert resp.status_code == 403


def test_02_admin_can_publish(setup_teardown):
    folder_id = setup_teardown['folder_id']
    resp = client.post(
        f"/api/collaborative/admin/folders/{folder_id}/access-scope",
        json={"access_scope": "global_readonly"},
        headers=auth_headers(ADMIN_ID)
    )
    assert resp.status_code == 200
    assert resp.json()['access_scope'] == 'global_readonly'
    f = TMA_Folder.get_by_id(folder_id)
    assert f.access_scope == 'global_readonly'


def test_03_invalid_scope_rejected(setup_teardown):
    folder_id = setup_teardown['folder_id']
    resp = client.post(
        f"/api/collaborative/admin/folders/{folder_id}/access-scope",
        json={"access_scope": "invalid_scope"},
        headers=auth_headers(ADMIN_ID)
    )
    assert resp.status_code == 422


def test_04_owner_role_is_owner(setup_teardown):
    deck_id = setup_teardown['deck_id']
    resp = client.get(f"/api/collaborative/check-access?type=deck&id={deck_id}", headers=auth_headers(OWNER_ID))
    assert resp.status_code == 200
    assert resp.json()['role'] == 'owner'


def test_05_viewer_role_is_viewer_on_global(setup_teardown):
    deck_id = setup_teardown['deck_id']
    resp = client.get(f"/api/collaborative/check-access?type=deck&id={deck_id}", headers=auth_headers(VIEWER_ID))
    assert resp.status_code == 200
    assert resp.json()['role'] == 'viewer'


def test_06_folder_in_active_folders_for_viewer(setup_teardown):
    folder_id = setup_teardown['folder_id']
    resp = client.get("/api/folders", headers=auth_headers(VIEWER_ID))
    assert resp.status_code == 200
    folders = resp.json()
    f = next((x for x in folders if x['id'] == folder_id), None)
    assert f is not None
    assert f['is_global_readonly'] is True
    assert f['role'] == 'viewer'


def test_07_viewer_cannot_rename_global_folder(setup_teardown):
    folder_id = setup_teardown['folder_id']
    resp = client.post(
        f"/api/folders/{folder_id}/rename",
        json={"name": "Hacked"},
        headers=auth_headers(VIEWER_ID)
    )
    assert resp.status_code == 403


def test_08_owner_can_rename_global_folder(setup_teardown):
    folder_id = setup_teardown['folder_id']
    resp = client.post(
        f"/api/folders/{folder_id}/rename",
        json={"name": "Renamed Official"},
        headers=auth_headers(OWNER_ID)
    )
    assert resp.status_code == 200
    f = TMA_Folder.get_by_id(folder_id)
    assert f.name == "Renamed Official"


def test_09_viewer_cannot_delete_global_folder(setup_teardown):
    folder_id = setup_teardown['folder_id']
    resp = client.delete(
        f"/api/folders/{folder_id}",
        headers=auth_headers(VIEWER_ID)
    )
    assert resp.status_code == 403


def test_10_viewer_cannot_move_global_folder(setup_teardown):
    folder_id = setup_teardown['folder_id']
    resp = client.post(
        f"/api/folders/{folder_id}/move",
        json={"parent_id": None},
        headers=auth_headers(VIEWER_ID)
    )
    assert resp.status_code == 403


def test_11_viewer_cannot_change_color(setup_teardown):
    folder_id = setup_teardown['folder_id']
    resp = client.post(
        f"/api/folders/{folder_id}/color",
        json={"color": "#ff0000"},
        headers=auth_headers(VIEWER_ID)
    )
    assert resp.status_code == 403


def test_12_viewer_cannot_create_subfolder(setup_teardown):
    folder_id = setup_teardown['folder_id']
    resp = client.post(
        "/api/folders",
        json={"name": "Sub", "parent_id": folder_id},
        headers=auth_headers(VIEWER_ID)
    )
    assert resp.status_code == 403


def test_13_viewer_cannot_rename_global_deck(setup_teardown):
    deck_id = setup_teardown['deck_id']
    resp = client.post(
        f"/api/decks/{deck_id}/rename",
        json={"name": "Hacked Deck"},
        headers=auth_headers(VIEWER_ID)
    )
    assert resp.status_code in [403, 404]  # decks.py rename might return 404 because user_id filter


def test_14_viewer_cannot_delete_global_deck(setup_teardown):
    deck_id = setup_teardown['deck_id']
    resp = client.delete(
        f"/api/decks/{deck_id}",
        headers=auth_headers(VIEWER_ID)
    )
    assert resp.status_code in [403, 404]


def test_15_viewer_cannot_edit_card(setup_teardown):
    card_id = setup_teardown['card_id']
    deck_id = setup_teardown['deck_id']
    resp = client.post(
        f"/api/cards/{card_id}/save",
        json={"deck_id": deck_id, "front_text": "Hacked"},
        headers=auth_headers(VIEWER_ID)
    )
    assert resp.status_code == 403


def test_16_viewer_cannot_delete_card(setup_teardown):
    card_id = setup_teardown['card_id']
    resp = client.delete(
        f"/api/cards/{card_id}",
        headers=auth_headers(VIEWER_ID)
    )
    # delete_card returns bool, router returns 404 if false
    assert resp.status_code in [403, 404]


def test_17_viewer_can_set_card_flag(setup_teardown):
    card_id = setup_teardown['card_id']
    resp = client.post(
        f"/api/cards/{card_id}/flag",
        json={"flag": 3},
        headers=auth_headers(VIEWER_ID)
    )
    assert resp.status_code == 200
    assert resp.json()['flag'] == 3
    
    prog = TMAProgress.get_or_none(card_id=card_id, user_id=VIEWER_ID)
    assert prog is not None
    assert prog.flag == 3
    
    # Ensure owner's flag is unaffected (or canonical card)
    card = TMA_Card.get_by_id(card_id)
    assert getattr(card, 'flag', 0) != 3


def test_18_build_card_dict_returns_user_flag(setup_teardown):
    deck_id = setup_teardown['deck_id']
    resp = client.get(f"/api/decks/{deck_id}/cards", headers=auth_headers(VIEWER_ID))
    assert resp.status_code == 200
    cards = resp.json()['cards']
    assert len(cards) == 1
    assert cards[0]['flag'] == 3


def test_19_reset_deck_preserves_flag(setup_teardown):
    deck_id = setup_teardown['deck_id']
    card_id = setup_teardown['card_id']
    
    # Set some review data
    TMAProgress.update(interval=10, queue='review').where(TMAProgress.card_id == card_id, TMAProgress.user_id == VIEWER_ID).execute()
    
    resp = client.post(f"/api/decks/{deck_id}/reset", headers=auth_headers(VIEWER_ID))
    assert resp.status_code == 200
    
    prog = TMAProgress.get_or_none(card_id=card_id, user_id=VIEWER_ID)
    assert prog.interval == 0
    assert prog.queue == 'new'
    assert prog.flag == 3  # Flag preserved!


def test_20_admin_can_unpublish(setup_teardown):
    folder_id = setup_teardown['folder_id']
    resp = client.post(
        f"/api/collaborative/admin/folders/{folder_id}/access-scope",
        json={"access_scope": "private"},
        headers=auth_headers(ADMIN_ID)
    )
    assert resp.status_code == 200
    f = TMA_Folder.get_by_id(folder_id)
    assert f.access_scope == 'private'

    # Viewer should no longer have access
    resp2 = client.get(f"/api/collaborative/check-access?type=folder&id={folder_id}", headers=auth_headers(VIEWER_ID))
    assert resp2.status_code == 200
    assert resp2.json()['role'] is None
