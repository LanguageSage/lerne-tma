"""One-way, opt-in V2 -> legacy preview for Theory, Standard and Trainer.

This module never writes cards. Derived FRONT/BACK must not be persisted alongside
an independently editable V2 source. Unsupported/lossy conversion raises an error.
"""
import re

from api.services.input_parser import detect_ai_input_type, parse_exercise_content
from api.services.structured_cards_v2 import Document, validate_document


class LegacyConversionError(ValueError):
    pass


def _legacy_answer_key(text):
    return re.sub(r'\s+', ' ', text.strip()).lower().rstrip('.!?').strip()


def _gap_answer(text, path):
    # Legacy splits these characters or strips Markdown. V2 itself allows them;
    # representing them faithfully requires a native structured renderer.
    if (text != text.strip() or re.search(r'[\[\]{}|;,/*_`<>\r\n]', text)
            or not _legacy_answer_key(text)):
        raise LegacyConversionError(f'{path}: answer cannot be represented safely in legacy syntax')
    return text


def _trainer_body(card, path):
    body, answers = [], []
    for index, part in enumerate(card.data.parts):
        p = f'{path}.data.parts[{index}]'
        if part.type == 'text':
            if re.search(r'[\[\]{}]|___GAP_\d+___', part.text):
                raise LegacyConversionError(f'{p}: literal brackets would create a legacy gap')
            body.append(part.text)
        elif part.type == 'input':
            values = [_gap_answer(answer, p + '.answers') for answer in part.answers]
            body.append('[[' + '|'.join(values) + ']]')
            answers.append(' / '.join(values))
        else:
            correct_keys = {_legacy_answer_key(option.text) for option in part.options if option.correct}
            if any(_legacy_answer_key(option.text) in correct_keys for option in part.options if not option.correct):
                raise LegacyConversionError(f'{p}: legacy answer normalization would accept a distractor')
            values = [('*' if option.correct else '') + _gap_answer(option.text, p + '.options')
                      for option in part.options]
            body.append('{' + '|'.join(values) + '}')
            answers.append(' / '.join(option.text for option in part.options if option.correct))
    return ''.join(body), ', '.join(answers)


def _convert_card(card, deck, index):
    path = f'cards[{index}]'
    if card.type == 'theory':
        body, back = card.data.text, card.data.summary
    elif card.type == 'standard':
        body, back = card.data.prompt, card.data.answer
        # Frontend quiz recognition also accepts A) *Answer and bullet prefixes.
        if re.search(r'(?m)^\s*(?:\[\*\]|(?:[a-zA-Z]|[0-9]{1,2})[).]\s*\*|[-○•]\s*\*)', body):
            raise LegacyConversionError(f'{path}.data.prompt: possible legacy quiz syntax')
    elif card.type == 'trainer':
        body, back = _trainer_body(card, path)
    else:
        raise LegacyConversionError(f'{path}.type: {card.type} conversion is not implemented')

    pieces, expected_info = [], []
    if card.type == 'theory':
        pieces.append('@theory')
    for block in card.info:
        text = '\n'.join(block.items) if block.type == 'options' else block.text
        pieces.append(f'::{block.type}\n{text}')
        expected_info.append(('context' if block.type == 'source' else block.type, text))
    pieces.append('::exercise\n' + body)
    front = '\n\n'.join(pieces)

    # Use the existing parser, including its information boundaries and theory
    # behavior, to reject marker collisions instead of silently changing content.
    parsed = parse_exercise_content(front)
    actual_info = [(block['type'], block['content']) for block in parsed['blocks']
                   if block['type'] != 'exercise']
    if parsed['exercise'] != body.strip() or actual_info != expected_info:
        raise LegacyConversionError(f'{path}: information or exercise text contains legacy structural markers')
    if detect_ai_input_type(front) != card.type:
        raise LegacyConversionError(f'{path}: legacy syntax would change the explicit card type')
    for source, block in zip(card.info, (b for b in parsed['blocks'] if b['type'] != 'exercise')):
        if source.type == 'options' and block['options'] != source.items:
            raise LegacyConversionError(f'{path}.info: legacy options would be split differently')

    intro = (deck.passport or {}).get('intro', {})
    level = card.level if card.level is not None else intro.get('level')
    topics = card.topics if card.topics is not None else ([intro['topic']] if intro.get('topic') else [])
    # Existing topics is one string. Reject an ambiguous join rather than losing
    # the boundaries of explicitly authored topic names.
    if any(',' in topic or '\n' in topic or '\r' in topic for topic in topics):
        raise LegacyConversionError(f'{path}.topics: legacy topic names cannot contain commas or newlines')
    result = {'front': front, 'back': back, 'context': card.explanation, 'card_type': card.type,
              'level': level, 'topics': ', '.join(topics),
              'metadata': card.model_dump(mode='json')['metadata']}
    if card.id is not None:
        result['source_id'] = card.id
    return result


def to_legacy_document(value: dict | Document) -> dict:
    """Return a complete projection or raise. No partial results or input mutation.

    Deck passport/extension metadata stay in the envelope; source_id is an author
    reference, never card_id. The result is a preview, not an API save request.
    """
    document = validate_document(value)
    cards = [_convert_card(card, document.deck, index) for index, card in enumerate(document.cards)]
    return {'deck': document.deck.model_dump(mode='json', exclude_none=True), 'cards': cards}
