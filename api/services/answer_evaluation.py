"""Answer Evaluation Engine orchestration; no mastery writes or new persistence pipeline."""
import json
import re

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool
from pydantic import ValidationError

from api.services.answer_contract import GradingPolicy, unavailable
from api.services.answer_rules import evaluate_deterministic
from api.services.answer_ai import evaluate_with_ai


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
        if detect_ai_input_type(card.front_text) != 'free_text':
            raise HTTPException(422, 'Answer evaluation requires a free-text card')
        try:
            metadata = json.loads(card.metadata or '{}')
            if not isinstance(metadata, dict):
                raise ValueError('metadata must be an object')
            policy = GradingPolicy.model_validate(metadata.get('grading_policy', {}))
        except (ValueError, TypeError, ValidationError) as exc:
            raise HTTPException(422, 'Invalid grading policy') from exc
        variants = metadata.get('accepted_answers', [])
        if not isinstance(variants, list) or len(variants) > 20 or any(
            not isinstance(v, str) or len(v) > 4000 for v in variants
        ):
            raise HTTPException(422, 'Invalid accepted answers')
        expected = card.back_text or card.context or ''
        mapping = models.TMACardKnowledgeItem.get_or_none(
            (models.TMACardKnowledgeItem.card_id == card.id) &
            (models.TMACardKnowledgeItem.role == 'primary'))
        ki = mapping.knowledge_item if mapping else None
        if ki and ki.category in ('orthography', 'spelling', 'punctuation'):
            # Surface errors are primary learning errors for these targets.
            policy = policy.model_copy(update={'typo_tolerance': False})
        exercise = parse_exercise_content(card.front_text)['exercise']
        return {
            'task': re.sub(r'@free\b', '', exercise, count=1, flags=re.I).strip(),
            'target_language': ki.language if ki else card.deck.target_language or 'de',
            'expected_answers': [expected, *variants],
            'learning_target': ({'name': ki.name, 'description': ki.description,
                                 'rule_code': ki.rule_code} if ki else None),
            'cefr_level': ki.cefr_level if ki else card.deck.level,
            'feedback_language': feedback_language,
        }, policy


def configured_ai():
    from api.ai_service import get_ai_config
    from api.ai_clients import AIService
    from api import models
    with models.tma_db.connection_context():
        provider, key, model = get_ai_config()
    if not model or (not key and provider != 'ollama'):
        return None
    return AIService(provider=provider, api_key=key), model.strip()


async def evaluate_answer(context: dict, policy: GradingPolicy, answer: str, ai_factory=None):
    if policy.mode != 'open_text' and not any(v.strip() for v in context['expected_answers']):
        return unavailable('rules')
    result = evaluate_deterministic(answer, context['expected_answers'], policy,
                                    context['target_language'])
    if result is not None:
        return result
    if ai_factory is None:
        ai_factory = configured_ai
    try:
        configured = await run_in_threadpool(ai_factory)
    except Exception:
        return unavailable()
    if not configured:
        return unavailable()
    client, model = configured
    return await evaluate_with_ai({**context, 'user_answer': answer}, policy, client, model)
