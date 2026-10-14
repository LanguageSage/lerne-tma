"""Bounded social conversation state and provisional learning evidence in Game attempts.

No mastery writes: model observations remain unconfirmed, as in game_mvp3.
"""
import copy
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from api.services.game_scene import NEIGHBOR, initial_scene, normalized_title

Goal = Literal['greet', 'introduce_self', 'share_about_self', 'ask_neighbor',
               'respond_to_neighbor', 'polite_goodbye']


class Evidence(BaseModel):
    model_config = ConfigDict(extra='forbid')
    evidence: str = Field(min_length=1, max_length=300)


class GoalObservation(Evidence):
    goal: Goal


class FactObservation(Evidence):
    key: Literal['name', 'origin', 'work', 'hobby', 'move']


class ReviewObservation(Evidence):
    kind: Literal['grammar', 'vocabulary']
    suggestion: str = Field(min_length=1, max_length=200)


class SocialIntent(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['chat', 'simplify', 'repeat', 'slow', 'end'] = 'chat'
    confidence: float = Field(ge=0, le=1, allow_inf_nan=False)
    evidence: str = Field(default='', max_length=1000)
    goals: list[GoalObservation] = Field(default_factory=list, max_length=6)
    facts: list[FactObservation] = Field(default_factory=list, max_length=5)
    review: list[ReviewObservation] = Field(default_factory=list, max_length=3)


class SocialReply(BaseModel):
    model_config = ConfigDict(extra='forbid')
    text: str = Field(min_length=1, max_length=700)
    question_topic: Literal['name', 'origin', 'work', 'hobby', 'move', 'settling', 'other'] | None = None


def initial_conversation():
    return {**initial_scene(), 'situation_id': NEIGHBOR['scene']['situation_id'],
            'exchange_count': 0, 'ended': False, 'end_reason': None,
            'learner_level': None, 'goals_observed': {}, 'known_facts': {},
            'asked_topics': ['move'], 'asked_questions': ['Sind Sie gerade eingezogen?'],
            'difficulties': [], 'review_candidates': [], 'learning_result': None}


def supported(span, message):
    return bool(span.strip()) and span in message


def advance_conversation(current, intent, message):
    state = copy.deepcopy(current)
    state['exchange_count'] += 1
    reliable = intent.confidence >= .75
    action = intent.action if reliable else 'clarify'
    # A model may propose only evidence from the current user utterance.
    if reliable:
        for observation in intent.goals:
            if supported(observation.evidence, message):
                state['goals_observed'].setdefault(observation.goal, {
                    'evidence': observation.evidence, 'exchange': state['exchange_count']})
        for fact in intent.facts:
            if supported(fact.evidence, message):
                state['known_facts'][fact.key] = fact.evidence
        for finding in intent.review:
            if supported(finding.evidence, message) and len(state['review_candidates']) < 12:
                item = {**finding.model_dump(), 'exchange': state['exchange_count'],
                        'source': 'model', 'confirmed': False}
                if not any(f['evidence'] == item['evidence'] and f['kind'] == item['kind']
                           for f in state['review_candidates']):
                    state['review_candidates'].append(item)
    if action == 'end' and not supported(intent.evidence, message):
        action = 'chat'
    if action == 'simplify':
        state['simple_language'] = True
    if action == 'slow':
        state['slow_speech'] = True
    if action in ('simplify', 'repeat', 'slow', 'clarify'):
        state['difficulties'].append({'kind': action, 'exchange': state['exchange_count'],
                                     'source': 'engine', 'meaning': 'support_requested' if action != 'clarify' else 'uncertain_meaning'})
    scene = NEIGHBOR['scene']
    reason = None
    if action == 'end':
        reason = 'user'
    elif state['exchange_count'] >= scene['max_exchanges']:
        reason = 'duration'
    elif (state['exchange_count'] >= scene['min_exchanges'] and
          action == 'chat' and set(scene['closing_goals']) <= state['goals_observed'].keys()):
        reason = 'goals'
    # Support requests before the hard limit get a simpler reply rather than an early exit.
    return state, {'kind': action, 'closing': reason is not None, 'end_reason': reason}


def sentences(text):
    return re.findall(r'[^.!?]+(?:[.!?]+|$)', text.strip())


def finish_reply(state, event, text, question_topic=None):
    """Suppress repeated questions and add a server-controlled, complete farewell."""
    parts = sentences(text)
    support = event['kind'] in ('simplify', 'repeat', 'clarify')
    previous = {normalized_title(q) for q in state['asked_questions']}
    repeated_topic = (question_topic in state['asked_topics'] or question_topic in state['known_facts']) and question_topic != 'other'
    kept = []
    for part in parts:
        if '?' in part and (event['closing'] or (not support and (
                normalized_title(part) in previous or repeated_topic))):
            continue
        kept.append(part.strip())
    text = ' '.join(kept).strip() or 'Danke für das Gespräch.'
    questions = [s.strip() for s in sentences(text) if '?' in s]
    if questions:
        state['asked_questions'] = (state['asked_questions'] + questions)[-24:]
        if question_topic and question_topic not in state['asked_topics']:
            state['asked_topics'].append(question_topic)
    if event['closing']:
        # Never rely on the model to actually end or avoid opening another question.
        text = f"{text} {NEIGHBOR['scene']['farewell']}"
        state.update(ended=True, end_reason=event['end_reason'], outcome='completed')
        state['learning_result'] = learning_result(state)
    return text


def learning_result(state):
    observed = state['goals_observed']
    return {'schema_version': 1, 'situation_id': state['situation_id'],
            'end_reason': state['end_reason'], 'exchange_count': state['exchange_count'],
            'achieved_goals': [{'goal': goal, **observed[goal], 'source': 'model', 'confirmed': False}
                               for goal in NEIGHBOR['scene']['goals'] if goal in observed],
            'not_achieved_goals': [goal for goal in NEIGHBOR['scene']['goals'] if goal not in observed],
            'difficulties': state['difficulties'], 'review_candidates': state['review_candidates'],
            'recommended_phrases': NEIGHBOR['scene']['repeat_phrases'],
            'assessment_status': 'provisional', 'not_achieved_meaning': 'not_observed',
            'modality': 'unknown', 'listening_comprehension': 'not_assessed',
            'level_assessment': None}


def end_conversation(current, reason='user'):
    state = copy.deepcopy(current)
    state.update(ended=True, end_reason=reason, outcome='completed')
    state['learning_result'] = learning_result(state)
    return state, {'kind': 'end', 'closing': True, 'end_reason': reason}, NEIGHBOR['scene']['farewell']


def conversation_hint(state):
    missing = set(NEIGHBOR['scene']['goals']) - state['goals_observed'].keys()
    if 'introduce_self' in missing:
        return 'Sie können sich vorstellen: „Ich heiße … Ich bin gerade eingezogen.“'
    if 'ask_neighbor' in missing:
        return 'Sie können eine Gegenfrage stellen: „Und Sie? Wohnen Sie schon lange hier?“'
    return 'Sie können von Ihrem Alltag erzählen oder sich verabschieden: „Es war schön, Sie kennenzulernen. Bis bald!“'
