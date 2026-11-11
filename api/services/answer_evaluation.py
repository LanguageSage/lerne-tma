"""Answer Evaluation Engine orchestration; no mastery writes or new persistence pipeline."""
import logging

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from api.services.answer_contract import GradingPolicy, unavailable
from api.services.answer_rules import evaluate_deterministic
from api.services.answer_ai import evaluate_with_ai

logger = logging.getLogger(__name__)


def load_answer_context(card_id: int, user_id: int, feedback_language: str) -> tuple[dict, GradingPolicy]:
    from api import models
    from api.services.offline_sync import require_access
    from api.services.structured_card_api import require_native

    # Keep all Peewee reads and connection cleanup in the same worker thread.
    with models.tma_db.connection_context():
        card = models.TMA_Card.get_or_none(
            (models.TMA_Card.id == card_id) & (models.TMA_Card.is_deleted == False))
        if not card or card.deck.is_deleted:
            raise HTTPException(404, 'Card not found')
        require_access(user_id, 'deck', card.deck_id, write=False)
        content = require_native(card)
        if content.type not in ('free_text', 'editable_text'):
            raise HTTPException(422, 'Answer evaluation requires a text-answer card')
        data = content.data
        policy = data.grading_policy
        if content.type == 'editable_text':
            exercise, expected = data.source_text, data.correct_text
        else:
            exercise, expected = data.prompt, data.sample_answer
        mapping = models.TMACardKnowledgeItem.get_or_none(
            (models.TMACardKnowledgeItem.card_id == card.id) &
            (models.TMACardKnowledgeItem.role == 'primary'))
        ki = mapping.knowledge_item if mapping else None
        if ki and ki.category in ('orthography', 'spelling', 'punctuation'):
            # Surface errors are primary learning errors for these targets.
            policy = policy.model_copy(update={'typo_tolerance': False})
        preamble = [block.text for block in content.info if block.type in ('task', 'source')]
        task = '\n\n'.join(part for part in (*preamble, exercise, content.explanation) if part)
        return {
            'task': task,
            'target_language': ki.language if ki else card.deck.target_language or 'de',
            'expected_answers': [expected, *data.accepted_answers],
            'learning_target': ({'name': ki.name, 'description': ki.description,
                                 'rule_code': ki.rule_code} if ki else None),
            'cefr_level': ki.cefr_level if ki else (content.level or card.deck.level),
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
