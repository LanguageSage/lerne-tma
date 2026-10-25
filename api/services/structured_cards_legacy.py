"""One-way, opt-in V2 -> legacy preview for all card types.

This module never writes cards. Derived FRONT/BACK must not be persisted alongside
an independently editable V2 source. Unsupported/lossy conversion raises an error.
"""
import re

from api.services.input_parser import detect_ai_input_type, detect_card_type, parse_exercise_content
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


def _match_value(text, path, *, left=False):
    # Canonical Match splits once at the first =>, then trims/strips Markdown.
    # Arrows, dashes and equals signs are literal text; further => is safe on the
    # right only. Interior whitespace and duplicates stay intact.
    if text != text.strip() or text.startswith('\ufeff') or text.endswith('\ufeff'):
        raise LegacyConversionError(f'{path}: legacy Match would trim leading/trailing whitespace')
    if re.search(r'[\r\n]', text):
        raise LegacyConversionError(f'{path}: legacy Match cannot preserve line breaks in labels')
    if left and '=>' in text:
        raise LegacyConversionError(f'{path}: legacy Match left label cannot contain the pair separator =>')
    if re.search(r'[*_`]|</?(?:center|large)>', text):
        raise LegacyConversionError(f'{path}: Markdown/control markup is not supported in legacy Match labels')
    return text


def _plain_legacy_text(text, path):
    # Conservative subset unchanged by the current frontend stripMarkdown/trim.
    if text != text.strip() or text.startswith('\ufeff') or text.endswith('\ufeff'):
        raise LegacyConversionError(f'{path}: legacy would trim leading/trailing whitespace')
    if re.search(r'[*_`]|</?(?:center|large)>', text):
        raise LegacyConversionError(f'{path}: Markdown/control markup cannot be projected safely')
    return text


def _puzzle_body(card, path):
    tokens = []
    for index, token in enumerate(card.data.tokens):
        p = f'{path}.data.tokens[{index}]'
        _plain_legacy_text(token, p)
        if re.search(r'[\s\ufeff]', token):
            raise LegacyConversionError(f'{p}: legacy Puzzle splits tokens on whitespace')
        if re.fullmatch(r'@(?:match|puzzle|wordbank|free|edit|theory)|::(?:exercise|task|source|example|options|level|topic)', token, re.I):
            raise LegacyConversionError(f'{p}: legacy structural marker cannot be a Puzzle token')
        tokens.append(token)
    return '@puzzle\n' + ' '.join(tokens)


def _quiz_text(text, path, *, option=False):
    _plain_legacy_text(text, path)
    if re.search(r'[\r\u2028\u2029]|\n[\s\ufeff]*\n', text) or (option and '\n' in text):
        raise LegacyConversionError(f'{path}: legacy Quiz cannot preserve these line/paragraph boundaries')
    if re.search(r'[\s\ufeff]+[?!.,;:]', text):
        raise LegacyConversionError(f'{path}: legacy Quiz would remove whitespace before punctuation')
    if re.search(r'\{[^}]+\}|\[\[[^\]]+\]\]', text):
        raise LegacyConversionError(f'{path}: legacy Quiz would mask Trainer syntax')
    if re.search(r'(?im)^[\s\ufeff]*(?:@(?:match|puzzle|wordbank|free|edit|theory)|::(?:exercise|task|source|example|options|level|topic))[\s\ufeff]*$', text):
        raise LegacyConversionError(f'{path}: legacy structural marker cannot be Quiz content')
    if option and re.match(r'[-○•]|(?:[a-zA-Z]|[0-9]{1,2})[).]', text):
        raise LegacyConversionError(f'{path}: legacy Quiz would strip the option prefix')
    return text


def _quiz_body(card, path):
    correct = [option for option in card.data.options if option.correct]
    if len(correct) != 1:
        raise LegacyConversionError(f'{path}.data.options: legacy Quiz projection requires exactly one correct answer; multiple correct answers remain valid V2')
    prompt = _quiz_text(card.data.prompt, path + '.data.prompt')
    lines = [('[*] ' if option.correct else '[ ] ')
             + _quiz_text(option.text, f'{path}.data.options[{i}].text', option=True)
             for i, option in enumerate(card.data.options)]
    return prompt + '\n\n' + '\n'.join(lines), correct[0].text


_STRUCTURAL_LINE = r'(?im)^[\s\ufeff]*(?:@(?:match|puzzle|wordbank|free|edit|theory|options)|::(?:exercise|task|source|example|options|level|topic))[\s\ufeff]*$'


def _word_bank_body(card, path):
    options = card.data.options
    used = {part.option for part in card.data.parts if part.type == 'gap'}
    normalize = lambda value: re.sub(r'[\s\ufeff]+', ' ', value).lower()
    answer_labels = {}
    for i in sorted(used):
        answer_labels.setdefault(normalize(options[i]), options[i])
    for i, value in enumerate(options):
        p = f'{path}.data.options[{i}]'
        if (value != value.strip() or value.startswith('\ufeff') or value.endswith('\ufeff')
                or re.search(r'[|\r\n\u2028\u2029]', value) or re.search(_STRUCTURAL_LINE, value)):
            raise LegacyConversionError(f'{p}: legacy Word Bank would trim, split or reinterpret this option')
        # Same-text copies are interchangeable but independently consumable.
        # Different labels must not become accepted distractors/answers.
        key = normalize(value)
        if key in answer_labels and value != answer_labels[key]:
            raise LegacyConversionError(f'{p}: legacy Word Bank normalization would conflate distinct answers/options')

    fragments, literals, spans, answers = [], [], [], []
    offset = 0
    for i, part in enumerate(card.data.parts):
        p = f'{path}.data.parts[{i}]'
        if part.type == 'text':
            fragment = part.text
            p += '.text'
        else:
            # Number by bank position: even identical copies retain their own ID.
            gap_id = str(part.option + 1)
            fragment = f'<<{gap_id}>>'
            answers.append(f'{gap_id}={options[part.option]}')
        fragments.append(fragment)
        literals.append(fragment if part.type == 'text' else ' ' * len(fragment))
        spans.append((offset, offset + len(fragment), p))
        offset += len(fragment)
    text = ''.join(fragments)
    # Validate the assembled text too: boundaries/markers can cross text parts.
    checks = [r'[\r\u2028\u2029]', r'^[\s\ufeff]+|[\s\ufeff]+$',
              r'\n[ \t]*\n+', _STRUCTURAL_LINE,
              r'___WORD_BANK_GAP_', r'\[\[|\]\]']
    # Literal angle delimiters split across parts must also be rejected.
    without_gaps = ''.join(literals)
    for pattern in checks + [r'<<|>>']:
        match = re.search(pattern, without_gaps if pattern == r'<<|>>' else text)
        if match:
            field = next(p for start, end, p in spans if start <= match.start() < end)
            raise LegacyConversionError(f'{field}: legacy Word Bank cannot preserve this text/boundary')
    return '@wordbank\n' + text + '\n@options\n' + ' | '.join(options), '\n'.join(answers)


def _free_text_body(card, path):
    prompt = _plain_legacy_text(card.data.prompt, path + '.data.prompt')
    if re.search(r'[\r\u2028\u2029]', prompt) or re.search(_STRUCTURAL_LINE, prompt):
        raise LegacyConversionError(f'{path}.data.prompt: legacy Free Text cannot preserve these boundaries/markers')
    sample = card.data.sample_answer
    if sample != sample.strip() or sample.startswith('\ufeff') or sample.endswith('\ufeff'):
        raise LegacyConversionError(f'{path}.data.sample_answer: legacy Free Text would trim the sample answer')
    return '@free\n' + prompt, sample


def _editable_text_body(card, path):
    source = _plain_legacy_text(card.data.source_text, path + '.data.source_text')
    if source != source.strip() or re.search(r'[\r\u2028\u2029]', source) or re.search(_STRUCTURAL_LINE, source):
        raise LegacyConversionError(f'{path}.data.source_text: legacy Editable Text cannot preserve these boundaries/markers')
    correct = card.data.correct_text
    if correct != correct.strip() or correct.startswith('\ufeff') or correct.endswith('\ufeff'):
        raise LegacyConversionError(f'{path}.data.correct_text: legacy Editable Text would trim the correction')
    return '@edit\n' + source, correct


def to_legacy_card(card, deck, index):
    """Project one already validated V2 card and deck, preserving its source index.

    Callers must use the V2 contract first. Conversion failure is independent of
    V2 validity; this function never mutates the source or writes storage.
    """
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
    elif card.type == 'match':
        lines = [f"{_match_value(pair.left, f'{path}.data.pairs[{i}].left', left=True)} => "
                 f"{_match_value(pair.right, f'{path}.data.pairs[{i}].right')}"
                 for i, pair in enumerate(card.data.pairs)]
        body, back = '@match\n' + '\n'.join(lines), '\n'.join(lines)
    elif card.type == 'puzzle':
        body, back = _puzzle_body(card, path), card.data.translation
    elif card.type == 'quiz':
        body, back = _quiz_body(card, path)
    elif card.type == 'word_bank':
        body, back = _word_bank_body(card, path)
    elif card.type == 'free_text':
        body, back = _free_text_body(card, path)
    elif card.type == 'editable_text':
        body, back = _editable_text_body(card, path)
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
    if detect_card_type(front) != card.type or detect_ai_input_type(front) != card.type:
        raise LegacyConversionError(f'{path}: legacy syntax would change the explicit card type')
    for source, block in zip(card.info, (b for b in parsed['blocks'] if b['type'] != 'exercise')):
        if source.type == 'options' and block['options'] != source.items:
            raise LegacyConversionError(f'{path}.info: legacy options would be split differently')

    intro = (deck.passport or {}).get('intro', {})
    level = card.level if card.level is not None else intro.get('level')
    topics = card.topics if card.topics is not None else ([intro['topic']] if intro.get('topic') else [])
    # Legacy stores a display string, so preserve the source array when commas
    # make a single name indistinguishable from multiple names.
    if any('\n' in topic or '\r' in topic for topic in topics):
        raise LegacyConversionError(f'{path}.topics: legacy topic names cannot contain newlines')
    metadata = card.model_dump(mode='json')['metadata']
    if len(topics) > 1 or any(',' in topic for topic in topics):
        metadata['structured_topics'] = list(topics)
    result = {'front': front, 'back': back, 'context': card.explanation, 'card_type': card.type,
              'level': level, 'topics': ', '.join(topics),
              'metadata': metadata}
    if card.type in ('free_text', 'editable_text'):
        # These are the existing server evaluator's authoritative legacy fields.
        # Explicit defaults matter: legacy defaults to controlled_text, V2 to open_text.
        result['metadata'].update(accepted_answers=list(card.data.accepted_answers),
                                  grading_policy=card.data.grading_policy.model_dump(mode='json'))
    if card.id is not None:
        result['source_id'] = card.id
    return result


def to_legacy_document(value: dict | Document) -> dict:
    """Return a complete projection or raise. No partial results or input mutation.

    Deck passport/extension metadata stay in the envelope; source_id is an author
    reference, never card_id. The result is a preview, not an API save request.
    """
    document = validate_document(value)
    cards = [to_legacy_card(card, document.deck, index) for index, card in enumerate(document.cards)]
    return {'deck': document.deck.model_dump(mode='json', exclude_none=True), 'cards': cards}
