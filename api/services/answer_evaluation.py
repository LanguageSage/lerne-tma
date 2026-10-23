"""Answer Evaluation Engine orchestration; no mastery writes or new persistence pipeline."""
import json
import re
import logging

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool
from pydantic import ValidationError

from api.services.answer_contract import GradingPolicy, unavailable
from api.services.answer_rules import evaluate_deterministic
from api.services.answer_ai import evaluate_with_ai

logger = logging.getLogger(__name__)


def load_answer_context(card_id: int, user_id: int, feedback_language: str) -> tuple[dict, GradingPolicy]:
    from api import models
    from api.services.offline_sync import require_access
    from api.services.input_parser import parse_exercise_content, detect_ai_input_type

    # Keep all Peewee reads and connection cleanup in the same worker thread.
    with models.tma_db.connection_context():
        card = models.TMA_Card.get_or_none(
            (models.TMA_Card.id == card_id) & (models.TMA_Card.is_deleted == False))
        if not card or card.deck.is_deleted:
            raise HTTPException(404, 'Card not found')
        require_access(user_id, 'deck', card.deck_id, write=False)
        card_type = detect_ai_input_type(card.front_text)
        if card_type not in ('free_text', 'editable_text'):
            raise HTTPException(422, 'Answer evaluation requires a text-answer card')
        try:
            metadata = json.loads(card.metadata or '{}')
            if not isinstance(metadata, dict):
                raise ValueError('metadata must be an object')
            default_policy = {'mode': 'controlled_text', 'typo_tolerance': False} if card_type == 'editable_text' else {}
            raw_policy = metadata.get('grading_policy', {})
            policy = GradingPolicy.model_validate(
                {**default_policy, **raw_policy} if isinstance(raw_policy, dict) else raw_policy)
            if card_type == 'editable_text' and policy.mode == 'open_text':
                raise ValueError('Editable Text requires a controlled grading policy')
        except (ValueError, TypeError, ValidationError) as exc:
            raise HTTPException(422, 'Invalid grading policy') from exc
        variants = metadata.get('accepted_answers', [])
        if not isinstance(variants, list) or len(variants) > 20 or any(
            not isinstance(v, str) or len(v) > 4000 for v in variants
        ):
            raise HTTPException(422, 'Invalid accepted answers')
        expected = (card.back_text or '') if card_type == 'editable_text' else card.back_text or card.context or ''
        mapping = models.TMACardKnowledgeItem.get_or_none(
            (models.TMACardKnowledgeItem.card_id == card.id) &
            (models.TMACardKnowledgeItem.role == 'primary'))
        ki = mapping.knowledge_item if mapping else None
        if ki and ki.category in ('orthography', 'spelling', 'punctuation'):
            # Surface errors are primary learning errors for these targets.
            policy = policy.model_copy(update={'typo_tolerance': False})
        content = parse_exercise_content(card.front_text)
        exercise = re.sub(r'@(?:free|edit)\b', '', content['exercise'], count=1, flags=re.I).strip()
        # The prompt may just say "Answer using a relative clause". The actual
        # dialogue/situation lives in ::source; omitting it changes what is graded.
        task = '\n\n'.join(part for part in (content['task'], content['context'], exercise, card.context) if part)
        return {
            'task': task,
            'target_language': ki.language if ki else card.deck.target_language or 'de',
            'expected_answers': [expected, *variants],
            'learning_target': ({'name': ki.name, 'description': ki.description,
                                 'rule_code': ki.rule_code} if ki else None),
            'cefr_level': ki.cefr_level if ki else card.deck.level,
            'feedback_language': feedback_language,
        }, policy


def configured_ai(diagnostics=None):
    from api.ai_service import get_ai_config
    from api.ai_clients import AIService
    from api import models
    with models.tma_db.connection_context():
        provider, key, model = get_ai_config()
        if diagnostics is not None:
            diagnostics.update(provider=provider, model=model)
        url_rec = (models.TMASetting.get_or_none(models.TMASetting.key == 'OLLAMA_URL')
                   if (provider or '').strip().lower() == 'ollama' else None)
        ollama_url = url_rec.value.strip() if url_rec and url_rec.value else None
    provider = (provider or '').strip().lower()
    if provider not in ('google', 'groq', 'openrouter', 'ollama'):
        raise ValueError('invalid_provider')
    if not isinstance(model, str) or not model.strip():
        raise ValueError('missing_model')
    model = model.strip()
    # Never silently send a different model (the generic Google client has a fallback).
    if provider == 'google' and 'gemini' not in model.lower():
        raise ValueError('invalid_model')
    client = AIService(provider=provider, api_key=key, ollama_url=ollama_url)
    if not client.api_keys and provider != 'ollama':
        raise ValueError('missing_api_key')
    # Evaluation owns the two attempts and their shared deadline; no nested retries.
    client.request_attempts = client.key_attempts = 1
    client.request_timeout = 25
    client.json_output = True
    return client, model


async def evaluate_answer(context: dict, policy: GradingPolicy, answer: str, ai_factory=None,
                          diagnostics=None):
    if diagnostics is not None:
        diagnostics.update(ai_called=False, provider=None, model=None, requests=[])
    if policy.mode != 'open_text' and not any(v.strip() for v in context['expected_answers']):
        logger.warning('Answer evaluator unavailable: missing_expected_answer')
        return unavailable('rules', 'missing_expected_answer')
    result = evaluate_deterministic(answer, context['expected_answers'], policy,
                                    context['target_language'])
    if result is not None:
        return result
    try:
        if ai_factory is not None:
            configured = await run_in_threadpool(ai_factory)
        else:
            configured = await run_in_threadpool(configured_ai, diagnostics)
    except ValueError as exc:
        reason = str(exc) if str(exc) in (
            'invalid_provider', 'missing_model', 'invalid_model', 'missing_api_key') else 'configuration_error'
        logger.warning('Answer evaluator unavailable: %s', reason)
        return unavailable(reason=reason)
    except Exception:
        logger.warning('Answer evaluator unavailable: provider_failure')
        return unavailable(reason='configuration_error')
    if not configured:
        logger.warning('Answer evaluator unavailable: invalid_evaluator')
        return unavailable(reason='missing_configuration')
    try:
        client, model = configured
    except (TypeError, ValueError):
        logger.warning('Answer evaluator unavailable: invalid_evaluator')
        return unavailable(reason='missing_configuration')
    return await evaluate_with_ai({**context, 'user_answer': answer}, policy, client, model,
                                  diagnostics=diagnostics)
