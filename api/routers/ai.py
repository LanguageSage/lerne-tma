from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, ConfigDict, Field, ValidationError
import logging
import asyncio
from api import ai_service, models, permissions, services
from api.dependencies.auth import get_user_id
from api.db_workers import db_phases, run_db
from api.provider_url import resolve_public_provider_url
from api.services.cefr_metadata import build_ai_cefr_payload
from api.services.answer_contract import AnswerEvaluation, GradingPolicy
from api.services.structured_card_api import ContentV2

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
@db_phases
async def evaluate_free_text(request: AnswerEvaluationRequest, user_id: int = Depends(get_user_id)):
    from starlette.concurrency import run_in_threadpool
    from api.services.answer_evaluation import load_answer_context, evaluate_answer

    # UI flags and localhost are never authority to disclose reference answers.
    if request.diagnostics and not permissions.is_admin(user_id):
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
    phrase: str | None = None
    target_language: str = "de"
    native_language: str = None
    action_type: str = "full_card"
    user_request: Optional[str] = None


class DraftRequest(PhraseRequest):
    # A new Standard draft may have a blank answer until generation fills it.
    content_v2: dict


def _validated_draft(value, status=422):
    try:
        return ContentV2.model_validate(value).model_dump(mode='json')
    except ValidationError as exc:
        raise HTTPException(status, exc.errors(include_input=False, include_context=False, include_url=False)) from exc


def _standard_result(result, original=None):
    card = original or {'type': 'standard', 'data': {}}
    data = {**card['data'], 'prompt': result.get('front') or card['data'].get('prompt', ''),
            'answer': result.get('back') or card['data'].get('answer', '')}
    level = result.get('level') or card.get('level')
    updated = {**card, 'data': data, 'level': level,
               'explanation': result.get('context') or card.get('explanation', '')}
    if result.get('cefr'):
        updated['metadata'] = {**(card.get('metadata') or {}), 'cefr': result['cefr']}
    return _validated_draft({'schema_version': 2, 'card': updated}, 502)


async def _generate_draft(request, user_id):
    import json

    envelope = request.content_v2
    card = envelope.get('card')
    if not isinstance(card, dict):
        raise HTTPException(422, 'Card draft is required')
    standard = card.get('type') == 'standard' and request.action_type == 'full_card'
    if standard:
        data = card.get('data')
        if not isinstance(data, dict) or not isinstance(data.get('prompt'), str) or not data['prompt'].strip():
            raise HTTPException(422, 'Standard prompt is required')
        validated = _validated_draft({**envelope, 'card': {**card, 'data': {
            **data, 'answer': data.get('answer') or 'Pending translation',
        }}})
        phrase = data['prompt']
        directive = request.user_request
        action = 'full_card'
    else:
        validated = _validated_draft(envelope)
        phrase = json.dumps(validated['card'], ensure_ascii=False)
        directive = request.user_request or (
            'Explain which authored options are correct, and why each remaining option is incorrect.'
            if request.action_type == 'quiz_analysis' else 'Explain the grammar and give examples.'
        )
        action = 'edit_structured' if request.action_type == 'custom_directive' and request.user_request else 'custom_directive'
    result = await ai_service.generate_card_fields(
        user_id, phrase, request.target_language, request.native_language,
        action, directive, plain=True,
    )
    if result.get('error'):
        return result
    if standard:
        return {'content_v2': _standard_result(result, card)}
    original = validated['card']
    if action == 'edit_structured':
        patch = result.get('patch')
        if not isinstance(patch, dict) or patch.keys() - {'data', 'info', 'explanation', 'level', 'topics'}:
            raise HTTPException(502, 'AI returned an invalid Structured Cards V2 edit')
        fields = patch.get('data', {})
        if not isinstance(fields, dict):
            raise HTTPException(502, 'AI returned invalid card data')
        return {'content_v2': _validated_draft({**validated, 'card': {
            **original, **patch, 'data': {**original['data'], **fields},
        }}, 502)}
    explanation = '\n\n'.join(filter(None, (result.get('context'), original.get('explanation'))))
    return {'content_v2': _validated_draft({**validated, 'card': {**original, 'explanation': explanation}}, 502)}

@router.get("/admin/models/{provider}")
@db_phases
async def list_models(provider: str, url: str = None, user_id: int = Depends(get_user_id)):
    """Lists available models for a given provider."""
    if not permissions.is_admin(user_id):
        raise HTTPException(403, "Admin only")
    url, resolver = await _provider_url(url, required=provider == "ollama")
    return await ai_service.get_provider_models(provider, url, ollama_resolver=resolver)


async def _provider_url(url, *, required):
    if url is None and not required:
        return None, None
    try:
        return await resolve_public_provider_url(url)
    except (ValueError, OSError, TimeoutError):
        raise HTTPException(400, "AI provider URL must resolve to public HTTP(S) addresses") from None

class TestAIRequest(BaseModel):
    provider: str
    model: str
    api_key: str = None
    ollama_url: str = None

@router.post("/admin/test-ai")
@db_phases
async def test_ai_connection(request: TestAIRequest, user_id: int = Depends(get_user_id)):
    """Tests if the AI provider is reachable and working."""
    if not permissions.is_admin(user_id):
        raise HTTPException(403, "Admin only")
    from api import ai_clients
    uses_ollama = request.provider == "ollama" or (
        request.provider not in {"google", "groq", "openrouter"} and request.model.lower().startswith("ollama/"))
    url, resolver = await _provider_url(request.ollama_url, required=uses_ollama)
    client = ai_clients.AIService(
        provider=request.provider,
        api_key=request.api_key,
        ollama_url=url,
        ollama_resolver=resolver,
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
    cards: list[ContentV2] = Field(min_length=1, max_length=30)


def _ai_batch_detect_level():
    setting = models.TMASetting.get_or_none(models.TMASetting.key == 'AI_DETECT_LEVEL')
    return not setting or setting.value.lower() != 'false'


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
                cards = []
                for item in request.cards:
                    draft = DraftRequest(content_v2=item.model_dump(mode='json'), target_language=target_lang,
                                         native_language=request.native_language, action_type='explain_rule')
                    result = await _generate_draft(draft, user_id)
                    if result.get('error'):
                        raise HTTPException(502, result['error'])
                    cards.append(result)
                res = {'cards': cards, 'generated_count': len(cards)}
            else:
                res = await ai_service.generate_batch_card_fields(
                    user_id, request.text, target_lang, request.native_language)
            if 'error' in res:
                raise HTTPException(status_code=res.get('status_code', 400), detail=res['error'])
            if not res.get('cards'):
                raise HTTPException(502, 'ИИ не вернул карточки. Ничего не сохранено.')
            if mode == 'generate':
                if await run_db(_ai_batch_detect_level):
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
                res['cards'] = [{'content_v2': _standard_result(card)} for card in res['cards']]
    except TimeoutError:
        raise HTTPException(504, 'Истекло время генерации ИИ. Ничего не сохранено.')
    if request.deck_id:
        return await run_in_threadpool(save_ai_batch_result, res, request_data, user_id, import_id)
    return res


@router.post("/ai/enrich-batch")
@router.post("/cards/ai-enrich-batch")
@db_phases
async def enrich_batch_cards(request: EnrichBatchRequest, user_id: int = Depends(get_user_id)):
    return await _run_ai_batch(request, user_id, 'enrich')


@router.post("/ai/generate")
@router.post("/cards/ai-generate")
@db_phases
async def generate_card(request: DraftRequest | PhraseRequest, user_id: int = Depends(get_user_id)):
    if isinstance(request, DraftRequest):
        return await _generate_draft(request, user_id)
    if not request.phrase:
        raise HTTPException(422, 'Phrase is required')
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
@db_phases
async def generate_batch_cards(request: BatchRequest, user_id: int = Depends(get_user_id)):
    return await _run_ai_batch(request, user_id, 'generate')


class ClassifyBatchRequest(BaseModel):
    deck_id: Optional[int] = Field(default=None, gt=0)
    card_ids: Optional[list[int]] = Field(default=None, max_length=10000)
    target_language: Optional[str] = Field(default="de", max_length=20)
    operation_id: Optional[UUID] = None
    batch_index: int = Field(default=0, ge=0)


@router.post("/cards/classify-batch")
@db_phases
async def classify_cards_batch_endpoint(request: ClassifyBatchRequest, user_id: int = Depends(get_user_id)):
    from api.services.reclassification import classify_batch
    return await classify_batch(request, user_id)
