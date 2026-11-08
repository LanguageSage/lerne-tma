"""Read either authoring format into validated V2 documents, without storage access."""
import re

from pydantic import ValidationError

from .input_parser import _option_parts, find_quiz_option_start, parse_exercise_content
from .structured_cards_v2 import (
    Document, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_CARDS, _check_size, _load_json,
    load_document, validate_document,
)


class ImportFormatError(ValueError):
    """Codex input contains unsupported or ambiguous structure."""


_DECK = re.compile(r'(?im)^[ \t]*# (?:Deck|Колода):[ \t]*(.*)$')
_FOLDER = re.compile(r'(?i)# (?:Folder|Папка):[ \t]*(.+)')
_SEPARATOR = re.compile(r'(?m)^[ \t]*(?:<<<LERNE_CARD>>>|---+)[ \t]*$')
_SECTION = re.compile(r'(?im)^[ \t]*(FRONT|BACK|CONTEXT)[ \t]*:[ \t]*')
_PASSPORT = re.compile(r'(?ms)^\s*<<<LERNE_PASSPORT>>>[ \t]*\n(.*?)^\s*<<<END_LERNE_PASSPORT>>>[ \t]*(?:\n|$)')
_DIRECTIVE = re.compile(r'(?im)^[ \t]*@(match|puzzle|wordbank|free|edit|theory|quiz|options)[ \t]*$')
_TYPES = {'match': 'match', 'puzzle': 'puzzle', 'wordbank': 'word_bank',
          'free': 'free_text', 'edit': 'editable_text'}
_TRAINER = re.compile(r'\[\[([^\[\]\n]*)\]\]|\{([^{}\n]*)\}|\[([^\[\]\n]+)\](?!\()')
_BANK_GAP = re.compile(r'<<([a-zA-Z0-9_-]+)>>')
_QUIZ_MARKER = re.compile(r'^\[[*xX ]\]|^(?:(?:[A-Za-z]|[0-9]{1,2})[).]|[-○•])\s*\*(?!\*)')


def _metadata(lines, allowed):
    result = {}
    for line in lines.split('\n'):
        if not line.strip():
            continue
        match = re.fullmatch(r'\s*::([a-z_]+)[ \t]+(.+?)\s*', line, re.I)
        if not match or match[1].lower() not in allowed:
            raise ImportFormatError(f'Unexpected or invalid Codex header line: {line.strip()}')
        key, value = match[1].lower(), match[2].strip()
        if key in result or not value:
            raise ImportFormatError(f'Duplicate or empty ::{key}')
        if key in ('deck_id', 'card_id'):
            if not re.fullmatch(r'[0-9]{1,19}', value) or not int(value):
                raise ImportFormatError(f'::{key} must be a positive numeric ID')
            value = int(value)
        result[key] = value
    return result


def _context(text):
    settings, explanation = {}, []
    lines = iter(text.split('\n'))
    for line in lines:
        match = re.fullmatch(r'[ \t]*::(level|topic)(?:[ \t]+(.*?))?[ \t]*', line, re.I)
        if match:
            key = match[1].lower()
            value = (match[2] or next(lines, '')).strip()
            if key in settings or not value or value.startswith('::'):
                raise ImportFormatError(f'CONTEXT: duplicate or missing ::{key} value')
            settings[key] = value
        else:
            explanation.append(line)
    return settings, '\n'.join(explanation).strip()


def _split_parts(text, pattern, make_gap, invalid):
    parts, cursor = [], 0
    for match in pattern.finditer(text):
        if match.start() > cursor:
            parts.append({'type': 'text', 'text': text[cursor:match.start()]})
        parts.append(make_gap(match))
        cursor = match.end()
    if cursor < len(text):
        parts.append({'type': 'text', 'text': text[cursor:]})
    if any(part['type'] == 'text' and invalid.search(part['text']) for part in parts):
        raise ImportFormatError('FRONT: unmatched or mixed gap markers')
    return parts


def _trainer_part(match):
    if match[1] is not None:
        answers = [answer.strip() for answer in match[1].split('|')]
        if any(not answer or answer.startswith('*') for answer in answers):
            raise ImportFormatError('FRONT: invalid Trainer input answer')
        return {'type': 'input', 'answers': answers}
    values = [value.strip() for value in re.split(r'[|;,/]', match[2] if match[2] is not None else match[3])]
    starred = any(value.startswith('*') for value in values)
    options = [{'text': value.removeprefix('*').strip(),
                'correct': value.startswith('*') if starred else i == 0}
               for i, value in enumerate(values)]
    if any(not option['text'] or option['text'].startswith('*') for option in options):
        raise ImportFormatError('FRONT: invalid Trainer choice')
    return {'type': 'choice', 'options': options}


def _word_bank(body, back):
    sections = re.split(r'(?im)^[ \t]*@options[ \t]*$', body)
    if len(sections) != 2:
        raise ImportFormatError('FRONT: Word Bank needs one @options section')
    text, raw_options = (section.strip() for section in sections)
    options = [value.strip() for value in re.split(r'\||\n+', raw_options)]
    if not all(options):
        raise ImportFormatError('FRONT: empty Word Bank option')
    answers = {}
    for line in filter(str.strip, back.split('\n')):
        match = re.fullmatch(r'\s*([a-zA-Z0-9_-]+)\s*=\s*(\S.*?)\s*', line)
        if not match or match[1] in answers:
            raise ImportFormatError('BACK: malformed or duplicate Word Bank answer')
        answers[match[1]] = match[2]

    def normalize(value):
        return ' '.join(value.split()).lower()

    bank = {}
    for i in reversed(range(len(options))):
        key = normalize(options[i])
        bank.setdefault(key, []).append(i)
    ambiguous = {key for key, indices in bank.items() if len({options[i] for i in indices}) > 1}

    def gap(match):
        answer = answers.pop(match[1], None)
        if answer is None:
            raise ImportFormatError(f'BACK: missing or repeated answer for gap {match[1]}')
        key = normalize(answer)
        candidates = bank.get(key)
        if key in ambiguous or candidates is None or (candidates and options[candidates[-1]] != answer):
            raise ImportFormatError(f'BACK: absent or ambiguous bank option for gap {match[1]}')
        if not candidates:
            raise ImportFormatError(f'BACK: not enough copies of the bank option for gap {match[1]}')
        return {'type': 'gap', 'option': candidates.pop()}

    parts = _split_parts(text, _BANK_GAP, gap, re.compile(r'<<|>>|\[\[|\]\]'))
    if answers:
        raise ImportFormatError('BACK: Word Bank contains answers for unknown gaps')
    return {'options': options, 'parts': parts}


def _exercise(front, back, settings):
    parsed = parse_exercise_content(front)
    info, bodies, layout = [], [], []
    for block in parsed['blocks']:
        kind, content = block['type'], block['content']
        if kind == 'exercise':
            if block['marker'] and not content:
                raise ImportFormatError('FRONT: empty ::exercise block')
            if content:
                bodies.append(content)
                layout.append({'id': 'exercise', 'type': 'exercise'})
            continue
        if kind in ('level', 'topic'):
            if kind in settings or not content:
                raise ImportFormatError(f'FRONT: duplicate or empty ::{kind}')
            settings[kind] = content
        elif kind == 'options':
            items = [item.strip() for item in re.split(r'\||\n+', content)]
            if not all(items):
                raise ImportFormatError('FRONT: empty ::options item')
            info.append({'type': kind, 'items': items})
        else:
            info.append({'type': 'source' if kind == 'context' else kind, 'text': content})
        if kind not in ('level', 'topic'):
            layout.append({'id': f'info-{len(info)}', 'type': 'info', 'index': len(info) - 1})

    exercise_markers = re.findall(r'(?im)^[ 	]*::exercise[ 	]*$', front)
    if len(bodies) != 1 or len(exercise_markers) > 1:
        raise ImportFormatError('FRONT: expected exactly one exercise body')
    body = bodies[0]
    directives = list(_DIRECTIVE.finditer(body))
    if parsed['is_theory']:
        marker = re.match(r'(?i)^@theory[ \t]*(?:\n|$)', front)
        if directives or not marker or parse_exercise_content(front[marker.end():])['is_theory']:
            raise ImportFormatError('FRONT: misplaced or conflicting Theory directive')
        kind, data = 'theory', {'text': body, 'summary': back}
    elif directives:
        marker = directives[0]
        name = marker[1].lower()
        if marker.start() != 0 or name not in _TYPES or (
            [directive[1].lower() for directive in directives[1:]] != (['options'] if name == 'wordbank' else [])
        ):
            raise ImportFormatError('FRONT: unknown, misplaced or conflicting exercise directives')
        kind = _TYPES[name]
        content = body[marker.end():].strip()
        if kind == 'word_bank':
            data = _word_bank(content, back)
        elif kind == 'puzzle':
            data = {'tokens': content.split(), 'translation': back}
        elif kind == 'match':
            pairs = []
            for line in filter(str.strip, content.split('\n')):
                left, separator, right = line.partition('=>')
                if not separator or not left.strip() or not right.strip():
                    raise ImportFormatError('FRONT: each Match line needs a nonempty pair separated by =>')
                pairs.append({'left': left.strip(), 'right': right.strip()})
            data = {'pairs': pairs, 'back_note': back}
        elif kind == 'free_text':
            data = {'prompt': content, 'sample_answer': back}
        else:
            data = {'source_text': content, 'correct_text': back}
    else:
        kind, data = _plain_exercise(body, back, parsed)
    return kind, data, info, layout if info else None


def _plain_exercise(body, back, parsed):
    lines = body.split('\n')
    allow_empty = any(block['type'] == 'exercise' and block['marker'] for block in parsed['blocks'])
    first = find_quiz_option_start(lines, allow_empty_question=allow_empty)
    marked = [i for i, line in enumerate(lines) if _QUIZ_MARKER.search(line.strip())
              or (_option_parts(line)[0] and not re.fullmatch(r'\*[^*]+\*', line.strip()))]
    has_trainer = bool(re.search(r'\[\[|\]\]|[{}]', body))
    if marked:
        if first < 0 or min(marked) < first or has_trainer:
            raise ImportFormatError('FRONT: ambiguous Quiz answer block or mixed Quiz/Trainer markers')
        options = [_option_parts(line) for line in lines[first:] if line.strip()]
        if sum(correct for correct, _ in options) != 1 or any(not label for _, label in options):
            raise ImportFormatError('FRONT: Codex Quiz needs nonempty options and exactly one correct answer')
        return 'quiz', {'prompt': '\n'.join(lines[:first]).strip(), 'back_note': back,
                        'options': [{'text': label, 'correct': correct} for correct, label in options]}
    if has_trainer:
        parts = _split_parts(body, _TRAINER, _trainer_part, re.compile(r'\[\[|\]\]|[{}]'))
        return 'trainer', {'parts': parts, 'back_note': back}
    if re.search(r'<<|>>|(?m:^[ \t]*@(?:free_text|word_bank)[ \t]*$)', body, re.I):
        raise ImportFormatError('FRONT: unsupported exercise marker')
    return 'standard', {'prompt': body, 'answer': back}


def _codex_card(block, deck_id):
    fields = list(_SECTION.finditer(block))
    order = [match[1].upper() for match in fields]
    if order not in (['FRONT'], ['FRONT', 'BACK'], ['FRONT', 'CONTEXT'], ['FRONT', 'BACK', 'CONTEXT']):
        raise ImportFormatError('Expected FRONT, then optional BACK and CONTEXT sections')
    metadata = _metadata(block[:fields[0].start()], {'card_id', 'deck_id', 'image'})
    if deck_id is not None and metadata.get('deck_id', deck_id) != deck_id:
        raise ImportFormatError('Card ::deck_id conflicts with its deck header')
    sections = {key: block[match.end():fields[i + 1].start() if i + 1 < len(fields) else len(block)].strip()
                for i, (key, match) in enumerate(zip(order, fields))}
    settings, explanation = _context(sections.get('CONTEXT', ''))
    kind, data, info, layout = _exercise(sections['FRONT'], sections.get('BACK', ''), settings)
    return {
        'id': str(metadata['card_id']) if 'card_id' in metadata else None,
        'image': metadata.get('image'), 'type': kind, 'data': data, 'info': info, 'layout': layout,
        'explanation': explanation, 'level': settings['level'].upper() if 'level' in settings else None,
        'topics': [settings['topic']] if 'topic' in settings else None,
    }, metadata.get('deck_id', deck_id)


def _codex_deck(text, name, folder):
    blocks = [block.strip() for block in _SEPARATOR.split(text) if block.strip()]
    if not blocks:
        raise ImportFormatError('Deck has no cards')
    preamble = ''
    # A deck may have a header/preamble separated from the first card, or a
    # passport followed immediately by FRONT in a hand-authored document.
    first = _SECTION.search(blocks[0])
    prefix = blocks[0][:first.start()] if first else blocks.pop(0)
    passport_match = _PASSPORT.search(prefix)
    if passport_match:
        passport = _load_json(passport_match[1], MAX_DOCUMENT_BYTES)
        if not isinstance(passport, dict):
            raise ImportFormatError('Deck passport must be a JSON object')
        preamble = prefix[:passport_match.start()]
        if first:
            blocks[0] = blocks[0][passport_match.end():]
        else:
            preamble += prefix[passport_match.end():]
    else:
        passport = None
        if not first:
            preamble = prefix
    deck_id = _metadata(preamble, {'deck_id'}).get('deck_id')
    if len(blocks) > MAX_DOCUMENT_CARDS:
        raise ImportFormatError('Deck exceeds the V2 card limit')

    cards, ids = [], set()
    for i, block in enumerate(blocks):
        try:
            card, source_deck_id = _codex_card(block, deck_id)
        except ImportFormatError as exc:
            raise ImportFormatError(f'cards[{i}]: {exc}') from exc
        cards.append(card)
        if source_deck_id is not None:
            ids.add(source_deck_id)
    if len(ids) > 1:
        raise ImportFormatError('Conflicting ::deck_id values within one deck')
    deck_metadata = {}
    if ids:
        deck_metadata['source_deck_id'] = ids.pop()
    if folder is not None:
        deck_metadata['source_folder_name'] = folder
    return validate_document({'schema_version': 2, 'deck': {
        'name': name, 'passport': passport, 'metadata': deck_metadata}, 'cards': cards})


def _with_passport_defaults(document):
    intro = (document.deck.passport or {}).get('intro', {})
    value = document.model_dump(mode='json')
    for card in value['cards']:
        if card['level'] is None:
            card['level'] = intro.get('level')
        if card['topics'] is None:
            card['topics'] = [intro['topic']] if intro.get('topic') else []
    return validate_document(value)


def import_documents(text: str, *, default_deck_name: str | None = None,
                     json_input: bool = False) -> list[Document]:
    """Return ordered canonical V2 documents, or raise without partial results.

    JSON V2 describes one deck. A Codex folder can describe multiple decks.
    Exported IDs are source references only, never persistence instructions.
    """
    _check_size(text, MAX_DOCUMENT_BYTES)
    text = text.removeprefix('\ufeff').lstrip()
    if json_input or text.startswith(('{', '[')):
        try:
            return [_with_passport_defaults(load_document(text))]
        except RecursionError as exc:
            raise ImportFormatError('JSON V2 nesting exceeds the parser limit') from exc
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    first_line, _, rest = text.partition('\n')
    folder_match = _FOLDER.fullmatch(first_line.strip())
    folder = folder_match[1].strip() if folder_match else None
    if folder_match:
        text = rest
    headers = list(_DECK.finditer(text))
    if not headers:
        if not default_deck_name:
            raise ImportFormatError('Codex without a deck header requires a default deck name')
        decks = [(default_deck_name, text)]
    else:
        if _SEPARATOR.sub('', text[:headers[0].start()]).strip():
            raise ImportFormatError('Unexpected content before first deck header')
        ends = [header.start() for header in headers[1:]] + [len(text)]
        decks = [(header[1].strip(), text[header.end():end]) for header, end in zip(headers, ends)]
    documents = []
    for i, (name, body) in enumerate(decks):
        try:
            document = _codex_deck(body, name, folder)
            documents.append(_with_passport_defaults(document))
        except ValidationError as exc:
            details = '; '.join(
                f"{'.'.join(map(str, error['loc'])) or 'document'}: {error['msg']}"
                for error in exc.errors(include_input=False, include_url=False)
            )
            raise ImportFormatError(f'decks[{i}] ({name}): {details}') from exc
        except RecursionError as exc:
            raise ImportFormatError(f'decks[{i}] ({name}): passport nesting exceeds the parser limit') from exc
        except ValueError as exc:
            raise ImportFormatError(f'decks[{i}] ({name}): {exc}') from exc
    return documents
