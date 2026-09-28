from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict, Literal
import datetime
import json
from peewee import IntegrityError

from api.dependencies.auth import get_user_id
from api import models
from api.services import knowledge_diagnostics
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


@router.get('/diagnostics/summary')
def get_knowledge_diagnostics_summary(user_id: int = Depends(get_user_id)):
    return knowledge_diagnostics.summary(user_id)


@router.get('/diagnostics/items')
def list_knowledge_diagnostics_items(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    sort_by: Literal['name', 'proficiency', 'confidence', 'evidence_mass',
                     'evidence_event_count', 'last_evidence_at'] = 'name',
    sort_dir: Literal['asc', 'desc'] = 'asc',
    language: Optional[str] = None,
    category: Optional[str] = None,
    cefr_level: Optional[str] = None,
    diagnostic_status: Optional[Literal['unobserved', 'insufficient', 'weak',
                                        'developing', 'strong']] = None,
    confidence_min: Optional[float] = Query(None, ge=0, le=1),
    confidence_max: Optional[float] = Query(None, ge=0, le=1),
    search: Optional[str] = Query(None, max_length=200),
    has_objective_evidence: Optional[bool] = None,
    user_id: int = Depends(get_user_id),
):
    if confidence_min is not None and confidence_max is not None and confidence_min > confidence_max:
        raise HTTPException(status_code=422, detail='confidence_min_exceeds_max')
    return knowledge_diagnostics.list_items(
        user_id, limit=limit, offset=offset, sort_by=sort_by, sort_dir=sort_dir,
        language=language, category=category, cefr_level=cefr_level,
        status=diagnostic_status, confidence_min=confidence_min,
        confidence_max=confidence_max, search=search,
        has_objective_evidence=has_objective_evidence)


@router.get('/diagnostics/items/{knowledge_item_id}')
def get_knowledge_diagnostics_item(knowledge_item_id: int, user_id: int = Depends(get_user_id)):
    result = knowledge_diagnostics.get_item(user_id, knowledge_item_id)
    if result is None:
        raise HTTPException(status_code=404, detail='knowledge_item_not_found')
    return result


@router.get('/diagnostics/items/{knowledge_item_id}/attempts')
def list_knowledge_diagnostics_attempts(
    knowledge_item_id: int,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user_id: int = Depends(get_user_id),
):
    if not knowledge_diagnostics.item_exists(user_id, knowledge_item_id):
        raise HTTPException(status_code=404, detail='knowledge_item_not_found')
    return knowledge_diagnostics.list_attempts(user_id, knowledge_item_id, limit=limit, offset=offset)
