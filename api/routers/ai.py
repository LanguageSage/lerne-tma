from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, ConfigDict, Field
import logging
import asyncio
from api import ai_service, models, services
from api.dependencies.auth import get_user_id
from api.services.cefr_metadata import build_ai_cefr_payload
from api.services.answer_contract import AnswerEvaluation, GradingPolicy

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["ai"],
)


class AnswerEvaluationRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    card_id: int = Field(gt=0)
    answer: str = Field(min_length=1, max_length=4000)
    feedback_language: str = Field(default='ru', pattern=r'^(ru|uk|en)$')
    diagnostics: bool = False


class AnswerEvaluationResponse(BaseModel):
    result: AnswerEvaluation
    grading_policy: GradingPolicy
    diagnostics: dict | None = None


@router.post('/ai/evaluate-answer', response_model=AnswerEvaluationResponse)
async def evaluate_free_text(request: AnswerEvaluationRequest, user_id: int = Depends(get_user_id)):
    from starlette.concurrency import run_in_threadpool
    from api.services.answer_evaluation import load_answer_context, evaluate_answer
    from api.permissions import is_admin

    # UI flags and localhost are never authority to disclose reference answers.
    if request.diagnostics and not is_admin(user_id):
        raise HTTPException(403, 'Admin only')
    context, policy = await run_in_threadpool(
        load_answer_context, request.card_id, user_id, request.feedback_language)
    diagnostics = {} if request.diagnostics else None
    result = await evaluate_answer(context, policy, request.answer, diagnostics=diagnostics)
    if diagnostics is not None:
        diagnostics['result'] = result.model_dump()
        diagnostics['grading_policy'] = policy.model_dump()
    return {'result': result.model_dump(), 'grading_policy': policy.model_dump(), 'diagnostics': diagnostics}

class PhraseRequest(BaseModel):
    phrase: str
    target_language: str = "de"
    native_language: str = None
    action_type: str = "full_card"
    user_request: Optional[str] = None

@router.get("/admin/models/{provider}")
async def list_models(provider: str, url: str = None):
    """Lists available models for a given provider."""
    return await ai_service.get_provider_models(provider, url)

class TestAIRequest(BaseModel):
    provider: str
    model: str
    api_key: str = None
    ollama_url: str = None

@router.post("/admin/test-ai")
async def test_ai_connection(request: TestAIRequest):
    """Tests if the AI provider is reachable and working."""
    import ai_clients
    client = ai_clients.AIService(
        provider=request.provider,
        api_key=request.api_key,
        ollama_url=request.ollama_url
    )
    response, success = await client.chat_completion(
        system_prompt="Return 'OK'.",
        user_message="Test connection.",
        model=request.model
    )
    if success:
        return {"status": "success", "message": "Connection successful!"}
    else:
        return {"status": "error", "message": response}

from typing import Literal
from uuid import UUID
from starlette.concurrency import run_in_threadpool
from api.services.cards import prepare_ai_batch, save_ai_batch_result


class BatchOptions(BaseModel):
    target_language: str = "de"
    native_language: Optional[str] = None
    deck_id: Optional[int] = Field(default=None, gt=0)
    import_id: Optional[UUID] = None
    placement: Literal['start', 'end'] = 'end'


class BatchRequest(BatchOptions):
    text: str = Field(min_length=1, max_length=60000)


class EnrichBatchRequest(BatchOptions):
    cards: list[dict] = Field(min_length=1, max_length=30)


async def _run_ai_batch(request, user_id, mode):
    request_data = {**request.model_dump(mode='json', exclude={'import_id'}), 'mode': mode}
    import_id = str(request.import_id) if request.import_id else None
    prepared = await run_in_threadpool(prepare_ai_batch, request_data, user_id, import_id)
    if prepared['response'] is not None:
        return prepared['response']
    target_lang = prepared['target_language']
    try:
        # A batch can make several provider calls. Bound the complete operation,
        # including optional classification, before any cards are written.
        async with asyncio.timeout(110):
            if mode == 'enrich':
                res = await ai_service.enrich_batch_quiz_fields(
                    user_id, request.cards, target_lang, request.native_language)
            else:
                res = await ai_service.generate_batch_card_fields(
                    user_id, request.text, target_lang, request.native_language)
            if 'error' in res:
                raise HTTPException(status_code=res.get('status_code', 400), detail=res['error'])
            if not res.get('cards'):
                raise HTTPException(502, 'ИИ не вернул карточки. Ничего не сохранено.')
            if mode == 'generate':
                setting = models.TMASetting.get_or_none(models.TMASetting.key == 'AI_DETECT_LEVEL')
                if not setting or setting.value.lower() != 'false':
                    try:
                        levels = await asyncio.wait_for(ai_service.classify_phrases_batch(
                            [c['front'] for c in res['cards']], target_lang), timeout=10)
                    except Exception:
                        logger.warning('Batch CEFR classification unavailable; using generated levels')
                        levels = []
                    for idx, card in enumerate(res['cards']):
                        level = levels[idx] if idx < len(levels) else card.get('level', 'A1')
                        card.update(level=level, tags=level, cefr=build_ai_cefr_payload(level))
                else:
                    for card in res['cards']:
                        card.update(level=None, tags=None, cefr=None)
    except TimeoutError:
        raise HTTPException(504, 'Истекло время генерации ИИ. Ничего не сохранено.')
    if request.deck_id:
        return await run_in_threadpool(save_ai_batch_result, res, request_data, user_id, import_id)
    return res


@router.post("/ai/enrich-batch")
@router.post("/cards/ai-enrich-batch")
async def enrich_batch_cards(request: EnrichBatchRequest, user_id: int = Depends(get_user_id)):
    return await _run_ai_batch(request, user_id, 'enrich')


@router.post("/ai/generate")
@router.post("/cards/ai-generate")
async def generate_card(request: PhraseRequest, user_id: int = Depends(get_user_id)):
    return await ai_service.generate_card_fields(
        user_id=user_id,
        phrase=request.phrase,
        target_language=request.target_language,
        native_language=request.native_language,
        action_type=request.action_type,
        user_request=request.user_request,
    )


@router.post("/ai/generate-batch")
@router.post("/cards/ai-generate-batch")
async def generate_batch_cards(request: BatchRequest, user_id: int = Depends(get_user_id)):
    return await _run_ai_batch(request, user_id, 'generate')


class ClassifyBatchRequest(BaseModel):
    deck_id: Optional[int] = Field(default=None, gt=0)
    card_ids: Optional[list[int]] = Field(default=None, max_length=10000)
    target_language: Optional[str] = Field(default="de", max_length=20)
    operation_id: Optional[UUID] = None
    batch_index: int = Field(default=0, ge=0)


@router.post("/cards/classify-batch")
async def classify_cards_batch_endpoint(request: ClassifyBatchRequest, user_id: int = Depends(get_user_id)):
    from api.services.reclassification import classify_batch
    return await classify_batch(request, user_id)
