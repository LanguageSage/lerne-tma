"""Authenticated card routes backed by Structured Cards V2."""
import re
from typing import Annotated
from fastapi import APIRouter, Depends, Header, HTTPException

from api import services
from api.db_workers import db_worker
from api.dependencies.auth import get_user_id
from api.services import structured_card_api as native
from api.card_core.lerne_card_core.structured_cards_import import import_documents
from pydantic import BaseModel, Field

router = APIRouter(prefix="/cards", tags=["cards"])


class ImportPreview(BaseModel):
    text: str = Field(min_length=1, max_length=native.MAX_DOCUMENT_BYTES)


@router.post("/validate")
def validate_card(data: native.ContentV2, _user_id: int = Depends(get_user_id)):
    return data


@router.post("/import-preview")
def preview_import(data: ImportPreview, _user_id: int = Depends(get_user_id)):
    try:
        documents = import_documents(data.text, default_deck_name='Import')
        return {'documents': [document.model_dump(mode='json') for document in documents]}
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/save")
@db_worker
def save_card(data: native.SaveCard, user_id: int = Depends(get_user_id)):
    return native.save_card(data, user_id)


@router.post("/bulk-save")
@db_worker
def bulk_save_cards(data: native.BulkSave, user_id: int = Depends(get_user_id)):
    return native.bulk_save(data, user_id)


@router.post("/batch-move")
@db_worker
def batch_move_cards(data: native.Transfer, user_id: int = Depends(get_user_id)):
    return native.transfer_cards(data, user_id, move=True)


@router.post("/batch-copy")
@db_worker
def batch_copy_cards(data: native.Transfer, user_id: int = Depends(get_user_id)):
    return native.transfer_cards(data, user_id, move=False)


@router.post("/batch-delete")
@db_worker
def batch_delete_cards(data: native.DeleteSelection, user_id: int = Depends(get_user_id)):
    return native.change_selection(data, user_id, delete=True)


@router.post("/reorder")
@db_worker
def reorder_cards(data: native.Selection, user_id: int = Depends(get_user_id)):
    return native.change_selection(data, user_id, delete=False)


@router.get("/duplicates")
@db_worker(retry_reads=True)
def get_duplicates(user_id: int = Depends(get_user_id)):
    return services.get_duplicate_cards(user_id)


@router.get("/search")
@db_worker(retry_reads=True)
def search_cards(q: str = "", folder_id: int | None = None, target_language: str = "de",
                 limit: int = 60, user_id: int = Depends(get_user_id)):
    return services.search_all_in_scope(user_id, q, folder_id, target_language, min(max(limit, 1), 200))


@router.get("/{card_id}")
@db_worker(retry_reads=True)
def get_card(card_id: int, user_id: int = Depends(get_user_id)):
    return native.get_card(card_id, user_id)


@router.put("/{card_id}")
@router.patch("/{card_id}")
@db_worker
def update_card(card_id: int, data: native.UpdateCard, user_id: int = Depends(get_user_id)):
    return native.update_card(card_id, data, user_id)


@router.delete("/{card_id}")
@db_worker
def delete_card(card_id: int, if_match: Annotated[str, Header()],
                user_id: int = Depends(get_user_id)):
    match = re.fullmatch(r'"([0-9a-f]{64})"', if_match)
    if not match:
        raise HTTPException(422, 'If-Match must be a quoted revision')
    return native.delete_card(card_id, match[1], user_id)


@router.post("/{card_id}/flag")
@db_worker
def set_flag(card_id: int, data: dict, user_id: int = Depends(get_user_id)):
    try:
        card = services.set_card_flag(card_id, user_id, data.get("flag", 0))
    except PermissionError as exc:
        raise HTTPException(403, 'Access denied') from exc
    except ValueError as exc:
        raise HTTPException(404, 'Card not found') from exc
    if card:
        return card
    raise HTTPException(404, 'Card not found')
