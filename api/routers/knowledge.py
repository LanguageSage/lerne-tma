from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict
import datetime
import json
from peewee import IntegrityError

from api.dependencies.auth import get_user_id
from api import models
from api.services.knowledge_mastery import (
    apply_created_attempt, knowledge_transaction, lock_knowledge_pair, normalize_event_time,
)

router = APIRouter(
    prefix="/knowledge",
    tags=["knowledge"],
)


class AttemptInsertIntegrityError(Exception):
    """Distinguish an invalid/duplicate attempt from a state-engine DB failure."""

class KnowledgeAttemptSyncItem(BaseModel):
    client_event_id: str
    knowledge_item_id: int
    card_id: Optional[int] = None
    event_time: Optional[datetime.datetime] = None
    evaluation_data: Optional[Dict[str, Any]] = None
    review_id: Optional[int] = None

class KnowledgeAttemptSyncRequest(BaseModel):
    attempts: List[KnowledgeAttemptSyncItem] = Field(..., max_length=100)

class KnowledgeAttemptSyncResult(BaseModel):
    client_event_id: str
    status: str  # created, duplicate, event_conflict, rejected
    error_code: Optional[str] = None

class KnowledgeAttemptSyncResponse(BaseModel):
    results: List[KnowledgeAttemptSyncResult]

def _normalize_datetime(dt) -> Optional[int]:
    if not dt:
        return None
    if isinstance(dt, str):
        try:
            dt = datetime.datetime.fromisoformat(dt.replace('Z', '+00:00'))
        except:
            return None
    if not dt.tzinfo:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return int(dt.timestamp())

def _compare_domain_payload(existing: models.TMAKnowledgeAttempt, item: KnowledgeAttemptSyncItem) -> bool:
    if existing.knowledge_item_id != item.knowledge_item_id:
        return False
    if existing.card_id != item.card_id:
        return False
    if existing.review_id != item.review_id:
        return False
        
    ext_time = _normalize_datetime(existing.event_time)
    itm_time = _normalize_datetime(item.event_time)
    
    # If incoming explicitly provides event_time, it must match.
    # If incoming does NOT provide event_time (None), we don't conflict with the server-generated time.
    if item.event_time is not None:
        if ext_time != itm_time:
            return False
    
    existing_eval = existing.evaluation_data
    if existing_eval:
        try:
            existing_eval = json.loads(existing_eval)
        except:
            existing_eval = None
    else:
        existing_eval = None
    
    item_eval = item.evaluation_data or None
    
    if existing_eval != item_eval:
        return False
        
    return True

@router.post("/attempts/sync", response_model=KnowledgeAttemptSyncResponse)
def sync_knowledge_attempts(request: KnowledgeAttemptSyncRequest, user_id: int = Depends(get_user_id)):
    results = []
    
    ki_ids = {item.knowledge_item_id for item in request.attempts}
    valid_kis = set()
    if ki_ids:
        valid_ki_query = models.TMAKnowledgeItem.select(models.TMAKnowledgeItem.id).where(models.TMAKnowledgeItem.id.in_(ki_ids))
        valid_kis = {ki.id for ki in valid_ki_query}
        
    review_ids = {item.review_id for item in request.attempts if item.review_id is not None}
    valid_reviews = set()
    if review_ids:
        valid_review_query = models.TMAReviewHistory.select(models.TMAReviewHistory.id).where(
            (models.TMAReviewHistory.id.in_(review_ids)) & 
            (models.TMAReviewHistory.user_id == user_id)
        )
        valid_reviews = {rev.id for rev in valid_review_query}

    for item in request.attempts:
        if not item.client_event_id:
            results.append(KnowledgeAttemptSyncResult(
                client_event_id=item.client_event_id or "", 
                status="rejected", 
                error_code="missing_client_event_id"
            ))
            continue
            
        if item.knowledge_item_id not in valid_kis:
            results.append(KnowledgeAttemptSyncResult(
                client_event_id=item.client_event_id, 
                status="rejected", 
                error_code="knowledge_item_not_found"
            ))
            continue
            
        if item.review_id is not None and item.review_id not in valid_reviews:
            results.append(KnowledgeAttemptSyncResult(
                client_event_id=item.client_event_id, 
                status="rejected", 
                error_code="review_not_found_or_unauthorized"
            ))
            continue
            
        evaluation_data_str = json.dumps(item.evaluation_data) if item.evaluation_data else None
        
        try:
            with knowledge_transaction():
                lock_knowledge_pair(user_id, item.knowledge_item_id)
                try:
                    attempt = models.TMAKnowledgeAttempt.create(
                        user_id=user_id,
                        card_id=item.card_id,
                        knowledge_item_id=item.knowledge_item_id,
                        client_event_id=item.client_event_id,
                        event_time=normalize_event_time(item.event_time or datetime.datetime.now(datetime.timezone.utc)),
                        evaluation_data=evaluation_data_str,
                        review_id=item.review_id
                    )
                except IntegrityError as error:
                    raise AttemptInsertIntegrityError() from error
                apply_created_attempt(attempt, item.evaluation_data)
            results.append(KnowledgeAttemptSyncResult(
                client_event_id=item.client_event_id,
                status="created"
            ))
        except AttemptInsertIntegrityError:
            existing = models.TMAKnowledgeAttempt.get_or_none(
                models.TMAKnowledgeAttempt.user_id == user_id,
                models.TMAKnowledgeAttempt.client_event_id == item.client_event_id
            )
            if existing:
                if _compare_domain_payload(existing, item):
                    results.append(KnowledgeAttemptSyncResult(
                        client_event_id=item.client_event_id, 
                        status="duplicate"
                    ))
                else:
                    results.append(KnowledgeAttemptSyncResult(
                        client_event_id=item.client_event_id, 
                        status="event_conflict",
                        error_code="payload_mismatch"
                    ))
            else:
                results.append(KnowledgeAttemptSyncResult(
                    client_event_id=item.client_event_id, 
                    status="rejected",
                    error_code="integrity_error"
                ))
    
    return KnowledgeAttemptSyncResponse(results=results)
