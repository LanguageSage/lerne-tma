"""Pure V1 -> JSON V2 structured card converter (Stage 7.1).

Converts legacy V1 card dictionaries, `{deck, cards}` documents, and `{decks, cards}`
snapshots into canonical `content_v2` payloads (`schema_version = 2`) without
database access and without mutating source structures.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
import json
import math
import re
from typing import Any

from api.card_core.lerne_card_core.deck_passport import (
    CEFR_LEVELS,
    passport_from_metadata,
    validate_passport,
)
from api.card_core.lerne_card_core.input_parser import (
    detect_ai_input_type,
    detect_card_type,
    parse_exercise_content,
)
from api.card_core.lerne_card_core.structured_cards_import import (
    ImportFormatError,
    _context,
    _exercise,
)
from api.card_core.lerne_card_core.structured_cards_legacy import (
    _legacy_answer_key,
)
from api.card_core.lerne_card_core.structured_cards_v2 import (
    CONTENT_KEYS,
    Card,
    CardBase,
    Deck,
    Document,
    GradingPolicy,
    validate_card,
    validate_document,
)

SCHEMA_VERSION = 2
VALID_CEFR_LEVELS = set(CEFR_LEVELS)
_KNOWN_BLOCK_MARKERS = frozenset({'task', 'options', 'source', 'example', 'level', 'topic', 'exercise'})
_INLINE_MARKER_RE = re.compile(
    r'^[ \t]*::(task|options|source|example|level|topic|exercise)[ \t]+\S',
    re.IGNORECASE | re.MULTILINE,
)
_ANY_BLOCK_MARKER_RE = re.compile(r'^[ \t]*::([a-zA-Z0-9_-]+)[ \t]*$', re.MULTILINE)
_DIRECTIVE_START_RE = re.compile(r'^[ \t]*@([a-zA-Z0-9_-]+)\b')
_UNDERSCORE_BLANK_RE = re.compile(r'_{3,}')
_CYRILLIC_CHAR_RE = re.compile(r'[\u0400-\u04FF]')


def _card_has_audio(card: dict[str, Any], metadata: dict[str, Any]) -> bool:
    if card.get('audio_path') or card.get('audio_back_path'):
        return True
    if metadata.get('audio_filename'):
        return True
    resources = metadata.get('resources')
    if isinstance(resources, list):
        for res in resources:
            if isinstance(res, dict) and res.get('type') == 'audio':
                return True
    return False


def _classify_empty_back(
    prompt: str,
    card: dict[str, Any],
    metadata: dict[str, Any],
    deck: dict[str, Any] | None,
) -> str:
    """Classify a standard/translation card with empty back into:
    - 'audio_standard': single-sided audio shadowing/listening card
    - 'theory': grammar explanation or reading passage without answer
    - 'block': defective isolated word/fragment with missing answer
    """
    stripped_prompt = prompt.strip()
    if not stripped_prompt:
        return 'block'
    words = stripped_prompt.split()
    num_words = len(words)
    has_audio = _card_has_audio(card, metadata)

    cyr_count = len(_CYRILLIC_CHAR_RE.findall(stripped_prompt))
    lat_count = len(re.findall(r'[a-zA-Z]', stripped_prompt))
    is_cyrillic = cyr_count > lat_count

    deck_name = (deck.get('name') or '').lower() if isinstance(deck, dict) else ''
    deck_meta = str(deck.get('metadata') or '').lower() if isinstance(deck, dict) else ''
    is_theory_deck = 'теория' in deck_name or 'theory' in deck_meta

    if has_audio and (not is_cyrillic or num_words >= 3):
        return 'audio_standard'

    if is_theory_deck:
        return 'theory'

    if is_cyrillic and num_words >= 4:
        return 'theory'

    if not is_cyrillic and (num_words >= 4 or '\n' in stripped_prompt):
        return 'theory'

    return 'block'


def encode_v2_content(card: Card | dict[str, Any]) -> dict[str, Any]:
    validated = card if isinstance(card, CardBase) else validate_card(card)
    dumped = validated.model_dump(mode='json')
    if _contains_null_byte(dumped):
        raise ValueError('content_v2 cannot contain U+0000 null bytes')
    return {
        'schema_version': SCHEMA_VERSION,
        'card': dumped,
    }


def decode_v2_content(payload: Any) -> Card:
    if isinstance(payload, str):
        payload = _strict_json_object(payload)
    if not isinstance(payload, dict):
        raise ValueError('content_v2 must be a JSON object')
    if _contains_null_byte(payload) or _contains_non_finite_float(payload):
        raise ValueError('content_v2 contains forbidden null byte or non-finite float')
    if set(payload.keys()) != {'schema_version', 'card'}:
        raise ValueError('content_v2 must have exactly schema_version and card keys')
    if payload.get('schema_version') is True or payload.get('schema_version') != SCHEMA_VERSION:
        raise ValueError(f'content_v2 schema_version must be {SCHEMA_VERSION}')
    return validate_card(payload['card'])


@dataclass(frozen=True)
class ConversionDiagnostic:
    code: str
    message: str
    severity: str = 'ERROR'
    path: str = 'card'
    card_id: Any = None
    deck_id: Any = None
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            'code': self.code,
            'severity': self.severity,
            'message': self.message,
            'path': self.path,
        }
        if self.card_id is not None:
            payload['card_id'] = self.card_id
        if self.deck_id is not None:
            payload['deck_id'] = self.deck_id
        if self.details:
            payload['details'] = copy.deepcopy(self.details)
        return payload


class V1ConversionError(ValueError):
    """Raised when a V1 card or document cannot be safely converted to V2."""

    def __init__(self, diagnostics: list[ConversionDiagnostic]):
        self.diagnostics = list(diagnostics)
        summary = '; '.join(f'[{d.code}] {d.message}' for d in self.diagnostics)
        super().__init__(summary or 'V1 to V2 conversion failed')


def _contains_null_byte(value: Any) -> bool:
    if isinstance(value, str):
        return '\x00' in value
    if isinstance(value, dict):
        return any(_contains_null_byte(k) or _contains_null_byte(v) for k, v in value.items())
    if isinstance(value, (list, tuple)):
        return any(_contains_null_byte(item) for item in value)
    return False


def _contains_non_finite_float(value: Any) -> bool:
    if isinstance(value, float):
        return not math.isfinite(value)
    if isinstance(value, dict):
        return any(_contains_non_finite_float(v) for v in value.values())
    if isinstance(value, (list, tuple)):
        return any(_contains_non_finite_float(item) for item in value)
    return False


def _strict_json_object(raw: str) -> dict[str, Any]:
    def _reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, val in pairs:
            if key in result:
                raise ValueError(f'duplicate JSON key: {key!r}')
            result[key] = val
        return result

    def _reject_constants(token: str) -> Any:
        raise ValueError(f'non-finite JSON constant: {token}')

    parsed = json.loads(raw, object_pairs_hook=_reject_duplicates, parse_constant=_reject_constants)
    if not isinstance(parsed, dict):
        raise ValueError('metadata JSON must be an object')
    return parsed


def _parse_metadata_dict(raw_metadata: Any) -> tuple[dict[str, Any] | None, str | None]:
    if raw_metadata is None or raw_metadata == '':
        return {}, None
    if isinstance(raw_metadata, str):
        stripped = raw_metadata.strip()
        if not stripped:
            return {}, None
        try:
            return _strict_json_object(stripped), None
        except Exception as exc:
            return None, f'metadata is not valid JSON object: {exc}'
    if isinstance(raw_metadata, dict):
        if _contains_non_finite_float(raw_metadata):
            return None, 'metadata contains non-finite float (NaN or Infinity)'
        return copy.deepcopy(raw_metadata), None
    return None, f'metadata must be a dict or JSON object string, got {type(raw_metadata).__name__}'


def _parse_tags_tokens(raw_tags: Any) -> tuple[list[str] | None, str | None]:
    if raw_tags is None or raw_tags == '':
        return [], None
    if isinstance(raw_tags, list):
        tokens: list[str] = []
        for item in raw_tags:
            if not isinstance(item, str) or not item.strip():
                return None, 'tags list must contain only non-empty strings'
            tokens.append(item.strip())
        return tokens, None
    if isinstance(raw_tags, str):
        stripped = raw_tags.strip()
        if not stripped:
            return [], None
        if stripped.startswith('['):
            try:
                parsed = json.loads(stripped)
            except Exception as exc:
                # Check for legacy pattern: JSON array followed by comma-separated tags, e.g. '["tag1", "tag2"],A1'
                rbracket = stripped.rfind(']')
                if rbracket != -1:
                    json_part = stripped[:rbracket + 1]
                    rest_part = stripped[rbracket + 1:].lstrip(',').strip()
                    try:
                        parsed_json = json.loads(json_part)
                        if isinstance(parsed_json, list):
                            rest_tokens = [p.strip() for p in rest_part.split(',') if p.strip()]
                            base_tokens, base_err = _parse_tags_tokens(parsed_json)
                            if base_err is None and base_tokens is not None:
                                return [*base_tokens, *rest_tokens], None
                    except Exception:
                        pass
                return None, f'malformed JSON list in tags: {exc}'
            if not isinstance(parsed, list):
                return None, 'JSON tags value must be a list'
            return _parse_tags_tokens(parsed)
        return [part.strip() for part in stripped.split(',') if part.strip()], None
    return None, f'tags must be a string or list of strings, got {type(raw_tags).__name__}'


def _normalize_cefr_dict(raw_cefr: Any) -> tuple[dict[str, Any] | None, str | None]:
    if not isinstance(raw_cefr, dict):
        return None, 'cefr metadata must be an object'
    raw_level = raw_cefr.get('level')
    if not isinstance(raw_level, str) or raw_level.strip().upper() not in VALID_CEFR_LEVELS:
        return None, f'cefr.level must be one of {sorted(VALID_CEFR_LEVELS)}, got {raw_level!r}'
    normalized = copy.deepcopy(raw_cefr)
    normalized['level'] = raw_level.strip().upper()
    if 'confidence' in normalized and normalized['confidence'] is not None:
        conf = normalized['confidence']
        if isinstance(conf, bool) or not isinstance(conf, (int, float)) or not math.isfinite(float(conf)):
            return None, 'cefr.confidence must be a finite number between 0 and 1'
        if not (0.0 <= float(conf) <= 1.0):
            return None, 'cefr.confidence must be between 0 and 1'
        normalized['confidence'] = round(float(conf), 4)
    return normalized, None


def _extract_deck_defaults(deck: dict[str, Any] | None) -> tuple[str | None, list[str]]:
    if not isinstance(deck, dict):
        return None, []
    level: str | None = None
    topics: list[str] = []

    raw_level = deck.get('level')
    if isinstance(raw_level, str) and raw_level.strip().upper() in VALID_CEFR_LEVELS:
        level = raw_level.strip().upper()

    raw_topic = deck.get('topic')
    if isinstance(raw_topic, str) and raw_topic.strip():
        topics = [raw_topic.strip()]
    elif isinstance(deck.get('topics'), list):
        topics = [t.strip() for t in deck['topics'] if isinstance(t, str) and t.strip()]

    for container_key in ('passport', 'metadata'):
        container = deck.get(container_key)
        if isinstance(container, str) and container.strip():
            try:
                container = json.loads(container)
            except Exception:
                container = None
        if isinstance(container, dict):
            intro = container.get('intro')
            if isinstance(intro, dict):
                if level is None:
                    intro_level = intro.get('level')
                    if isinstance(intro_level, str) and intro_level.strip().upper() in VALID_CEFR_LEVELS:
                        level = intro_level.strip().upper()
                if not topics:
                    intro_topic = intro.get('topic')
                    if isinstance(intro_topic, str) and intro_topic.strip():
                        topics = [intro_topic.strip()]
                    elif isinstance(intro.get('topics'), list):
                        topics = [t.strip() for t in intro['topics'] if isinstance(t, str) and t.strip()]
    return level, topics


def _synthesized_legacy_back(kind: str, data: dict[str, Any]) -> str | None:
    if kind == 'trainer':
        answers: list[str] = []
        for part in data.get('parts', []):
            if part.get('type') == 'input':
                answers.append(' / '.join(part.get('answers', [])))
            elif part.get('type') == 'choice':
                answers.append(
                    ' / '.join(opt['text'] for opt in part.get('options', []) if opt.get('correct'))
                )
        return ', '.join(answers)
    if kind == 'quiz':
        correct = [opt['text'] for opt in data.get('options', []) if opt.get('correct')]
        return correct[0] if correct else None
    if kind == 'match':
        return '\n'.join(f"{pair['left']} => {pair['right']}" for pair in data.get('pairs', []))
    return None


def _classify_import_error(message: str) -> tuple[str, str]:
    lower = message.lower()
    if 'ambiguous quiz answer block or mixed quiz/trainer markers' in lower:
        return 'ambiguous_quiz_or_mixed_markers', 'card.front'
    if 'expected at least one exercise block' in lower:
        return 'missing_exercise_body', 'card.front'
    if 'expected exactly one exercise body' in lower or 'empty ::exercise block' in lower:
        return 'multiple_exercise_blocks', 'card.front'
    if 'information after exercise' in lower or 'information blocks must precede' in lower:
        return 'info_after_exercise', 'card.front'
    if 'empty ::options item' in lower or '::options requires' in lower or 'block must not be empty' in lower:
        return 'empty_info_block', 'card.front'
    if 'duplicate or empty ::level' in lower or 'duplicate ::level' in lower or '::level' in lower:
        return 'invalid_level', 'card.level'
    if 'duplicate or empty ::topic' in lower or 'duplicate ::topic' in lower or '::topic' in lower:
        return 'invalid_topics', 'card.topics'
    if 'directive' in lower:
        return 'invalid_directive', 'card.front'
    if 'standard card requires non-empty back' in lower:
        return 'empty_back', 'card.back'
    if 'quiz' in lower:
        return 'invalid_quiz_structure', 'card.data'
    if 'trainer' in lower:
        return 'invalid_trainer_structure', 'card.data'
    if 'match' in lower:
        return 'invalid_match_structure', 'card.data'
    if 'word bank' in lower or 'wordbank' in lower or '@options' in lower or 'bank option' in lower or 'answer for gap' in lower:
        return 'invalid_word_bank_structure', 'card.data'
    if 'puzzle' in lower:
        return 'invalid_puzzle_structure', 'card.data'
    if 'free text' in lower:
        return 'invalid_free_text_structure', 'card.data'
    if 'editable text' in lower:
        return 'invalid_editable_text_structure', 'card.data'
    if 'theory' in lower:
        return 'invalid_theory_structure', 'card.data'
    return 'import_format_error', 'card'


def _has_nonempty_legacy_fields(card: dict[str, Any]) -> bool:
    for key in ('front', 'front_text', 'back', 'back_text', 'context', 'card_type', 'tags', 'topics'):
        val = card.get(key)
        if isinstance(val, str) and val.strip():
            return True
        if isinstance(val, list) and len(val) > 0:
            return True
    meta = card.get('metadata')
    if isinstance(meta, dict) and len(meta) > 0:
        return True
    if isinstance(meta, str) and meta.strip() and meta.strip() != '{}':
        return True
    return False


def inspect_v1_card(
    card: dict[str, Any],
    *,
    deck: dict[str, Any] | None = None,
    index: int | None = None,
    strip_synthesized_back_note: bool = True,
    require_explicit_free_text_policy: bool = False,
    default_free_text_policy: str = 'controlled_text',
    classify_empty_back: bool = True,
) -> dict[str, Any]:
    """Inspect and convert a single V1 card dictionary without mutating input."""
    if not isinstance(card, dict):
        diag = ConversionDiagnostic(
            code='invalid_card_object',
            message=f'card must be a dict, got {type(card).__name__}',
            path='card',
        )
        return {
            'ok': False,
            'card_id': None,
            'deck_id': None,
            'index': index,
            'content_v2': None,
            'card': None,
            'diagnostics': [diag.to_dict()],
            'warnings': [],
        }

    raw_card_id = card.get('id', card.get('card_id', card.get('source_id')))
    raw_deck_id = card.get('deck_id', deck.get('id') if isinstance(deck, dict) else None)
    errors: list[ConversionDiagnostic] = []
    warnings: list[ConversionDiagnostic] = []

    def add_error(code: str, message: str, path: str = 'card', **details: Any) -> None:
        errors.append(
            ConversionDiagnostic(
                code=code,
                message=message,
                severity='ERROR',
                path=path,
                card_id=raw_card_id,
                deck_id=raw_deck_id,
                details=details,
            )
        )

    def add_warning(code: str, message: str, path: str = 'card', **details: Any) -> None:
        warnings.append(
            ConversionDiagnostic(
                code=code,
                message=message,
                severity='WARNING',
                path=path,
                card_id=raw_card_id,
                deck_id=raw_deck_id,
                details=details,
            )
        )

    if _contains_null_byte(card):
        add_error('null_byte_in_content', 'card contains forbidden U+0000 null byte')
        return _build_result(raw_card_id, raw_deck_id, index, None, None, errors, warnings)

    if card.get('content_v2') is not None:
        if _has_nonempty_legacy_fields(card):
            add_error(
                'mixed_v1_v2_storage',
                'card contains both content_v2 and populated legacy V1 fields',
                path='card.content_v2',
            )
            return _build_result(raw_card_id, raw_deck_id, index, None, None, errors, warnings)
        try:
            existing_card = decode_v2_content(copy.deepcopy(card['content_v2']))
            return _build_result(
                raw_card_id,
                raw_deck_id,
                index,
                encode_v2_content(existing_card),
                existing_card,
                errors,
                warnings,
            )
        except Exception as exc:
            add_error(
                'invalid_existing_content_v2',
                f'existing content_v2 failed validation: {exc}',
                path='card.content_v2',
            )
            return _build_result(raw_card_id, raw_deck_id, index, None, None, errors, warnings)

    # 1. Extract front, back, context strings without mutating source.
    raw_front = card['front'] if 'front' in card and card['front'] is not None else card.get('front_text', '')
    raw_back = card['back'] if 'back' in card and card['back'] is not None else card.get('back_text', '')
    raw_context = card.get('context', '')
    if raw_context is None:
        raw_context = ''

    if not isinstance(raw_front, str):
        add_error('invalid_front_type', 'front/front_text must be a string', path='card.front')
    if not isinstance(raw_back, str):
        add_error('invalid_back_type', 'back/back_text must be a string', path='card.back')
    if not isinstance(raw_context, str):
        add_error('invalid_context_type', 'context must be a string', path='card.context')
    if errors:
        return _build_result(raw_card_id, raw_deck_id, index, None, None, errors, warnings)

    if not raw_front.strip():
        add_error('empty_front', 'card front text must not be empty', path='card.front')
        return _build_result(raw_card_id, raw_deck_id, index, None, None, errors, warnings)

    # 2. Parse metadata dict.
    metadata, meta_err = _parse_metadata_dict(card.get('metadata'))
    if meta_err is not None or metadata is None:
        add_error('invalid_metadata_json', meta_err or 'invalid metadata', path='card.metadata')
        return _build_result(raw_card_id, raw_deck_id, index, None, None, errors, warnings)

    # 3. Parse context directives and explanation.
    for match in _ANY_BLOCK_MARKER_RE.finditer(raw_context):
        marker_name = match.group(1).lower()
        if marker_name not in ('level', 'topic'):
            add_error(
                'invalid_context_directive',
                f'unsupported block marker ::{marker_name} in context',
                path='card.context',
                marker=marker_name,
            )
    try:
        context_meta, context_explanation = _context(raw_context)
    except ImportFormatError as exc:
        code, path = _classify_import_error(str(exc))
        add_error(code, str(exc), path=path)
        context_meta, context_explanation = {}, ''

    # 4. Pre-inspect front block structure for inline markers, unknown markers, and multi-block ambiguities.
    inline_match = _INLINE_MARKER_RE.search(raw_front)
    if inline_match:
        marker_name = inline_match.group(1).lower()
        add_error(
            'inline_front_directive',
            f'inline ::{marker_name} marker in front must be placed on its own marker line',
            path='card.front',
            marker=marker_name,
        )

    for match in _ANY_BLOCK_MARKER_RE.finditer(raw_front):
        marker_name = match.group(1).lower()
        if marker_name not in _KNOWN_BLOCK_MARKERS:
            add_error(
                'unknown_block_marker',
                f'unknown block marker ::{marker_name} in front',
                path='card.front',
                marker=marker_name,
            )

    parsed_front = parse_exercise_content(raw_front)
    parsed_blocks = parsed_front.get('blocks', [])
    exercise_block_indices = [i for i, b in enumerate(parsed_blocks) if b.get('type') == 'exercise']
    info_block_indices = [
        i
        for i, b in enumerate(parsed_blocks)
        if b.get('type') in ('task', 'options', 'source', 'context', 'example', 'level', 'topic')
    ]

    if exercise_block_indices and info_block_indices and max(info_block_indices) > min(exercise_block_indices):
        add_error(
            'info_after_exercise',
            'information blocks (::task, ::source, ::example, ::options) must precede the exercise block',
            path='card.front',
        )

    if len(exercise_block_indices) > 1:
        first_ex = parsed_blocks[exercise_block_indices[0]]
        second_ex = parsed_blocks[exercise_block_indices[1]]
        second_dir = _DIRECTIVE_START_RE.match(second_ex.get('content', ''))
        if len(exercise_block_indices) == 2 and second_dir and not _DIRECTIVE_START_RE.match(first_ex.get('content', '')):
            add_error(
                'unmarked_preamble_before_directive',
                f"unmarked text before @{second_dir.group(1)} inside exercise block; mark instructions with ::task",
                path='card.front',
                preamble=first_ex.get('content', ''),
                directive=f"@{second_dir.group(1)}",
            )
        else:
            add_error(
                'multiple_exercise_blocks',
                f'expected exactly one exercise block, found {len(exercise_block_indices)}',
                path='card.front',
                count=len(exercise_block_indices),
            )

    if errors:
        return _build_result(raw_card_id, raw_deck_id, index, None, None, errors, warnings)

    # 5. Parse core exercise via lerne_card_core.structured_cards_import._exercise.
    front_meta: dict[str, Any] = {}
    try:
        kind, data, info_blocks = _exercise(raw_front.strip(), raw_back.strip(), front_meta)
    except ImportFormatError as exc:
        code, path = _classify_import_error(str(exc))
        add_error(code, str(exc), path=path)
        return _build_result(raw_card_id, raw_deck_id, index, None, None, errors, warnings)

    # 6. Post-parse structural & semantic ambiguity checks.
    # 6a. Classify empty back on standard cards before card_type and detector checks.
    reclassified_to_theory = False
    if kind == 'standard' and not data.get('answer', '').strip():
        if classify_empty_back:
            classification = _classify_empty_back(data.get('prompt', ''), card, metadata, deck)
            if classification == 'audio_standard':
                data['answer'] = data.get('prompt', '')
                add_warning(
                    'single_sided_audio_card',
                    'standard card has empty back but contains audio; back (answer) mirrored from front prompt for listening/shadowing practice',
                    path='card.back',
                    prompt=data.get('prompt', ''),
                )
            elif classification == 'theory':
                kind = 'theory'
                data = {'text': data.get('prompt', ''), 'summary': ''}
                reclassified_to_theory = True
                add_warning(
                    'empty_back_converted_to_theory',
                    'standard card with empty back reclassified as theory text/reading passage',
                    path='card.type',
                )
            else:
                add_error(
                    'empty_back',
                    'standard card requires non-empty back (answer)',
                    path='card.back',
                )
        else:
            add_error(
                'empty_back',
                'standard card requires non-empty back (answer)',
                path='card.back',
            )

    # 6b. Stored card_type vs parsed kind.
    det_card = detect_card_type(raw_front)
    det_ai = detect_ai_input_type(raw_front)

    explicit_card_type = card.get('card_type', card.get('type'))
    if isinstance(explicit_card_type, str) and explicit_card_type.strip():
        norm_type = explicit_card_type.strip()
        if reclassified_to_theory and norm_type in ('standard', 'translation'):
            add_warning(
                'legacy_card_type_reclassified_to_theory',
                f"legacy card_type {norm_type!r} reclassified to 'theory' due to empty back and theory content",
                path='card.type',
                stored_card_type=norm_type,
                parsed_type=kind,
            )
        elif norm_type == 'translation' and kind == 'standard':
            add_warning(
                'legacy_translation_card_type_normalized',
                "legacy card_type 'translation' normalized to V2 type 'standard'",
                path='card.type',
                stored_card_type=norm_type,
                parsed_type=kind,
            )
        elif norm_type != kind and norm_type in ('standard', 'translation') and det_card == kind:
            add_warning(
                'legacy_default_card_type_normalized',
                f"legacy default card_type {norm_type!r} normalized to parsed content type {kind!r}",
                path='card.type',
                stored_card_type=norm_type,
                parsed_type=kind,
            )
        elif norm_type != kind:
            add_error(
                'card_type_mismatch',
                f'stored card_type {norm_type!r} conflicts with parsed V2 card type {kind!r}',
                path='card.type',
                stored_card_type=norm_type,
                parsed_type=kind,
            )

    # 6c. Unconverted fill-in-the-blank underscores in standard cards.
    if kind == 'standard' and _UNDERSCORE_BLANK_RE.search(data.get('prompt', '')):
        add_error(
            'unconverted_blank_placeholder',
            'standard card prompt contains underscore blank placeholder (___) without [[input]] or {choice} gap',
            path='card.data.prompt',
        )

    # 6d. Editable text requires an actual edit (source_text != correct_text).
    if kind == 'editable_text':
        src_text = data.get('source_text', '').strip()
        corr_text = data.get('correct_text', '').strip()
        if not src_text or not corr_text or src_text == corr_text:
            add_error(
                'invalid_editable_text_structure',
                'editable_text requires non-empty source_text and correct_text that differ',
                path='card.data',
            )

    # 6e. Puzzle delimiter tokens & translation solution leak check.
    if kind == 'puzzle':
        tokens = data.get('tokens', [])
        if any(tok in ('/', '|') for tok in tokens):
            add_error(
                'ambiguous_puzzle_delimiters',
                'puzzle tokens contain standalone "/" or "|" delimiter tokens; provide space-separated word tokens',
                path='card.data.tokens',
            )
        translation = data.get('translation', '')
        joined_tokens = ' '.join(tokens)
        if len(tokens) >= 3 and joined_tokens and joined_tokens in translation:
            add_warning(
                'puzzle_solution_in_translation',
                'puzzle translation (back) contains the target token sequence',
                path='card.data.translation',
            )

    # 6f. Detector consistency check (detect_card_type & detect_ai_input_type).
    if reclassified_to_theory:
        add_warning(
            'empty_back_theory_detector_bypass',
            f"legacy detectors detected {det_card!r} for empty-back card reclassified as 'theory'",
            path='card.type',
            parsed_type=kind,
            detect_card_type=det_card,
            detect_ai_input_type=det_ai,
        )
    elif det_card != kind:
        add_error(
            'detector_type_divergence',
            f'legacy detector detect_card_type returned {det_card!r}, which disagrees with parsed type {kind!r}',
            path='card.type',
            parsed_type=kind,
            detect_card_type=det_card,
            detect_ai_input_type=det_ai,
        )
    elif kind == 'quiz' and det_ai != 'quiz':
        add_warning(
            'legacy_ai_detector_quiz_prefix',
            f'quiz uses prefixed option markers where detect_ai_input_type={det_ai!r} while detect_card_type="quiz"',
            path='card.type',
            detect_card_type=det_card,
            detect_ai_input_type=det_ai,
        )
    elif det_ai != kind:
        add_warning(
            'legacy_ai_detector_divergence',
            f'legacy authoring detector detect_ai_input_type returned {det_ai!r} while detect_card_type and parsed type are {kind!r}',
            path='card.type',
            parsed_type=kind,
            detect_card_type=det_card,
            detect_ai_input_type=det_ai,
        )

    # 6g. Strip redundant legacy synthesized back_note if requested.
    if strip_synthesized_back_note and kind in ('trainer', 'quiz', 'match'):
        synthesized = _synthesized_legacy_back(kind, data)
        if synthesized is not None and data.get('back_note') == synthesized:
            data['back_note'] = ''

    # 7. Reconcile grading_policy & accepted_answers for free_text and editable_text.
    has_top_policy = 'grading_policy' in card and card['grading_policy'] is not None
    has_meta_policy = 'grading_policy' in metadata and metadata['grading_policy'] is not None
    has_top_accepted = 'accepted_answers' in card and card['accepted_answers'] is not None
    has_meta_accepted = 'accepted_answers' in metadata and metadata['accepted_answers'] is not None

    if has_top_policy and has_meta_policy and card['grading_policy'] != metadata['grading_policy']:
        add_error(
            'conflicting_answer_policy_metadata',
            'card.grading_policy conflicts with card.metadata.grading_policy',
            path='card.data.grading_policy',
        )
    if has_top_accepted and has_meta_accepted and card['accepted_answers'] != metadata['accepted_answers']:
        add_error(
            'conflicting_answer_policy_metadata',
            'card.accepted_answers conflicts with card.metadata.accepted_answers',
            path='card.data.accepted_answers',
        )

    raw_policy = card['grading_policy'] if has_top_policy else metadata.pop('grading_policy', None)
    if has_top_policy and 'grading_policy' in metadata:
        metadata.pop('grading_policy', None)

    raw_accepted = card['accepted_answers'] if has_top_accepted else metadata.pop('accepted_answers', None)
    if has_top_accepted and 'accepted_answers' in metadata:
        metadata.pop('accepted_answers', None)

    if kind in ('free_text', 'editable_text'):
        if raw_accepted is not None:
            if not isinstance(raw_accepted, list) or not all(
                isinstance(item, str) and item.strip() for item in raw_accepted
            ):
                add_error(
                    'invalid_accepted_answers',
                    'accepted_answers must be a list of non-empty strings',
                    path='card.data.accepted_answers',
                )
            else:
                cleaned_accepted = [item.strip() for item in raw_accepted]
                if len(set(cleaned_accepted)) != len(cleaned_accepted):
                    add_error(
                        'invalid_accepted_answers',
                        'accepted_answers must not contain duplicate values',
                        path='card.data.accepted_answers',
                    )
                else:
                    data['accepted_answers'] = cleaned_accepted

        if raw_policy is not None:
            try:
                validated_policy = GradingPolicy.model_validate(raw_policy)
                if kind == 'editable_text' and validated_policy.mode == 'open_text':
                    add_error(
                        'invalid_grading_policy',
                        'editable_text does not allow open_text grading_policy',
                        path='card.data.grading_policy',
                    )
                else:
                    data['grading_policy'] = validated_policy.model_dump(mode='json')
            except Exception as exc:
                add_error(
                    'invalid_grading_policy',
                    f'invalid grading_policy: {exc}',
                    path='card.data.grading_policy',
                )
        elif kind == 'free_text':
            if require_explicit_free_text_policy:
                add_error(
                    'ambiguous_free_text_policy',
                    'V1 free_text card has no explicit grading_policy in metadata '
                    '(legacy runtime defaulted to controlled_text while V2 defaults to open_text)',
                    path='card.data.grading_policy',
                )
            else:
                try:
                    fallback_policy = GradingPolicy(mode=default_free_text_policy)
                    data['grading_policy'] = fallback_policy.model_dump(mode='json')
                    add_warning(
                        'implicit_free_text_policy',
                        f'applied fallback grading_policy mode={default_free_text_policy!r} to free_text card',
                        path='card.data.grading_policy',
                    )
                except Exception as exc:
                    add_error(
                        'invalid_grading_policy',
                        f'invalid default_free_text_policy: {exc}',
                        path='card.data.grading_policy',
                    )
    else:
        if raw_policy is not None or raw_accepted is not None:
            add_error(
                'unexpected_answer_policy_metadata',
                f'grading_policy/accepted_answers are only allowed on free_text or editable_text, not {kind!r}',
                path='card.metadata',
            )

    # 8. Resolve level, CEFR metadata, and custom tags.
    deck_level, deck_topics = _extract_deck_defaults(deck)

    front_level: str | None = None
    if 'level' in front_meta and front_meta['level'] is not None:
        fl = str(front_meta['level']).strip().upper()
        if fl not in VALID_CEFR_LEVELS:
            add_error('invalid_level', f'front ::level {front_meta["level"]!r} is not a valid CEFR level', path='card.level')
        else:
            front_level = fl

    context_level: str | None = None
    if 'level' in context_meta and context_meta['level'] is not None:
        cl = str(context_meta['level']).strip().upper()
        if cl not in VALID_CEFR_LEVELS:
            add_error('invalid_level', f'context ::level {context_meta["level"]!r} is not a valid CEFR level', path='card.level')
        else:
            context_level = cl

    field_level_raw = card.get('level')
    field_level: str | None = None
    if field_level_raw is not None and field_level_raw != '':
        if not isinstance(field_level_raw, str) or field_level_raw.strip().upper() not in VALID_CEFR_LEVELS:
            add_error(
                'invalid_level',
                f'card.level must be one of {sorted(VALID_CEFR_LEVELS)}, got {field_level_raw!r}',
                path='card.level',
            )
        else:
            field_level = field_level_raw.strip().upper()

    has_top_cefr = 'cefr' in card and card['cefr'] is not None
    has_meta_cefr = 'cefr' in metadata and metadata['cefr'] is not None
    if has_top_cefr and has_meta_cefr and card['cefr'] != metadata['cefr']:
        add_error(
            'conflicting_level_sources',
            'card.cefr conflicts with card.metadata.cefr',
            path='card.metadata.cefr',
        )
    raw_cefr = card['cefr'] if has_top_cefr else metadata.get('cefr')
    cefr_level: str | None = None
    if raw_cefr is not None:
        norm_cefr, cefr_err = _normalize_cefr_dict(raw_cefr)
        if cefr_err is not None or norm_cefr is None:
            add_error('invalid_cefr_metadata', cefr_err or 'invalid cefr metadata', path='card.metadata.cefr')
        else:
            cefr_level = norm_cefr['level']
            metadata['cefr'] = norm_cefr

    tags_tokens, tags_err = _parse_tags_tokens(card.get('tags'))
    if tags_err is not None or tags_tokens is None:
        add_error('invalid_tags', tags_err or 'invalid tags', path='card.tags')
        tags_tokens = []

    meta_tags_tokens: list[str] = []
    if 'tags' in metadata and metadata['tags'] is not None:
        parsed_meta_tags, meta_tags_err = _parse_tags_tokens(metadata['tags'])
        if meta_tags_err is not None or parsed_meta_tags is None:
            add_error('invalid_tags', meta_tags_err or 'invalid metadata.tags', path='card.metadata.tags')
        else:
            meta_tags_tokens = parsed_meta_tags

    cefr_from_tags: list[str] = []
    custom_tags: list[str] = []
    for tok in [*tags_tokens, *meta_tags_tokens]:
        upper = tok.upper()
        if upper in VALID_CEFR_LEVELS:
            if upper not in cefr_from_tags:
                cefr_from_tags.append(upper)
        else:
            if tok not in custom_tags:
                custom_tags.append(tok)

    if len(cefr_from_tags) > 1:
        add_error(
            'conflicting_level_sources',
            f'tags contain multiple distinct CEFR levels: {cefr_from_tags}',
            path='card.tags',
            levels=cefr_from_tags,
        )
    tags_level = cefr_from_tags[0] if len(cefr_from_tags) == 1 else None

    level_sources: dict[str, str] = {}
    if front_level:
        level_sources['front_directive'] = front_level
    if context_level:
        level_sources['context_directive'] = context_level
    if field_level:
        level_sources['card_level'] = field_level
    if cefr_level:
        level_sources['metadata_cefr'] = cefr_level
    if tags_level:
        level_sources['tags'] = tags_level

    distinct_card_levels = set(level_sources.values())
    if len(distinct_card_levels) > 1:
        add_error(
            'conflicting_level_sources',
            f'conflicting CEFR levels across card sources: {level_sources}',
            path='card.level',
            sources=level_sources,
        )

    resolved_level: str | None = next(iter(distinct_card_levels), None) or deck_level

    if custom_tags:
        metadata['tags'] = custom_tags
    elif 'tags' in metadata:
        metadata.pop('tags', None)

    # 9. Resolve topics.
    front_topic = front_meta.get('topic')
    context_topic = context_meta.get('topic')
    if front_topic and context_topic and front_topic != context_topic:
        add_error(
            'conflicting_topic_sources',
            f'front ::topic {front_topic!r} conflicts with context ::topic {context_topic!r}',
            path='card.topics',
        )
    directive_topic = front_topic or context_topic

    has_structured_topics = 'structured_topics' in metadata and metadata['structured_topics'] is not None
    raw_structured_topics = metadata.pop('structured_topics', None)
    structured_topics: list[str] | None = None
    if has_structured_topics:
        if not isinstance(raw_structured_topics, list) or not raw_structured_topics or not all(
            isinstance(t, str) and t.strip() for t in raw_structured_topics
        ):
            add_error(
                'invalid_topics',
                'metadata.structured_topics must be a non-empty list of non-blank strings',
                path='card.metadata.structured_topics',
            )
        else:
            structured_topics = [t.strip() for t in raw_structured_topics]

    raw_field_topics = card.get('topics')
    field_topics_list: list[str] | None = None
    field_topics_str: str | None = None
    if raw_field_topics is not None and raw_field_topics != '' and raw_field_topics != []:
        if isinstance(raw_field_topics, list):
            if not all(isinstance(t, str) and t.strip() for t in raw_field_topics):
                add_error('invalid_topics', 'card.topics list must contain non-blank strings', path='card.topics')
            else:
                field_topics_list = [t.strip() for t in raw_field_topics]
        elif isinstance(raw_field_topics, str):
            stripped_topics = raw_field_topics.strip()
            if stripped_topics:
                field_topics_str = stripped_topics
        else:
            add_error(
                'invalid_topics',
                f'card.topics must be a string or list of strings, got {type(raw_field_topics).__name__}',
                path='card.topics',
            )

    if structured_topics is not None:
        if field_topics_list is not None and field_topics_list != structured_topics:
            add_error(
                'conflicting_topic_sources',
                f'card.topics {field_topics_list!r} conflicts with metadata.structured_topics {structured_topics!r}',
                path='card.topics',
            )
        if field_topics_str is not None and ', '.join(structured_topics) != field_topics_str:
            add_error(
                'conflicting_topic_sources',
                f'card.topics {field_topics_str!r} conflicts with metadata.structured_topics {structured_topics!r}',
                path='card.topics',
            )
        if directive_topic is not None and structured_topics != [directive_topic]:
            add_error(
                'conflicting_topic_sources',
                f'::topic {directive_topic!r} conflicts with metadata.structured_topics {structured_topics!r}',
                path='card.topics',
            )

    if directive_topic is not None and field_topics_list is not None and field_topics_list != [directive_topic]:
        add_error(
            'conflicting_topic_sources',
            f'::topic {directive_topic!r} conflicts with card.topics {field_topics_list!r}',
            path='card.topics',
        )
    if directive_topic is not None and field_topics_str is not None and field_topics_str != directive_topic:
        add_error(
            'conflicting_topic_sources',
            f'::topic {directive_topic!r} conflicts with card.topics {field_topics_str!r}',
            path='card.topics',
        )

    resolved_topics: list[str] | None = None
    if structured_topics is not None:
        resolved_topics = structured_topics
    elif field_topics_list is not None:
        resolved_topics = field_topics_list
    elif directive_topic is not None:
        resolved_topics = [directive_topic]
    elif field_topics_str is not None:
        if ',' in field_topics_str:
            if deck_topics == [field_topics_str]:
                resolved_topics = [field_topics_str]
            else:
                add_error(
                    'ambiguous_comma_topics',
                    f'card.topics string {field_topics_str!r} contains a comma without metadata.structured_topics '
                    'or matching ::topic/deck topic; cannot safely distinguish one topic with a comma from multiple topics',
                    path='card.topics',
                    raw_topics=field_topics_str,
                )
        else:
            resolved_topics = [field_topics_str]
    elif deck_topics:
        resolved_topics = list(deck_topics)

    # 10. Check remaining metadata keys against CONTENT_KEYS shadow list.
    shadow_keys = sorted(set(metadata) & CONTENT_KEYS)
    if shadow_keys:
        add_error(
            'forbidden_metadata_key',
            f'card.metadata cannot shadow structured content keys: {shadow_keys}',
            path='card.metadata',
            keys=shadow_keys,
        )

    # 11. Resolve optional author id (source_id) and relative image reference (image_ref / image).
    author_id: str | None = None
    if card.get('source_id') is not None:
        if not isinstance(card['source_id'], str) or not card['source_id'].strip():
            add_error('invalid_author_id', 'source_id must be a non-empty string', path='card.id')
        else:
            author_id = card['source_id'].strip()

    image_ref: str | None = None
    raw_image_ref = card.get('image_ref', card.get('image'))
    if raw_image_ref is not None:
        if not isinstance(raw_image_ref, str) or not raw_image_ref.strip():
            add_error('invalid_image_ref', 'image/image_ref must be a non-empty string', path='card.image')
        else:
            image_ref = raw_image_ref.strip()

    if errors:
        return _build_result(raw_card_id, raw_deck_id, index, None, None, errors, warnings)

    # 12. Build and validate canonical V2 Card model and verify legacy projection invariant.
    card_payload: dict[str, Any] = {
        'id': author_id,
        'type': kind,
        'level': resolved_level,
        'topics': resolved_topics,
        'info': info_blocks,
        'explanation': context_explanation,
        'image': image_ref,
        'data': data,
        'metadata': metadata,
    }
    try:
        v2_card = validate_card(card_payload)
    except Exception as exc:
        schema_code = (
            f'invalid_{kind}_structure'
            if kind in ('trainer', 'quiz', 'match', 'word_bank', 'puzzle', 'free_text', 'editable_text', 'theory')
            else 'v2_schema_validation_failed'
        )
        add_error(schema_code, f'V2 card schema validation failed: {exc}', path='card.data')
        return _build_result(raw_card_id, raw_deck_id, index, None, None, errors, warnings)

    if kind == 'trainer':
        for part_idx, part in enumerate(v2_card.data.parts):
            if part.type == 'choice':
                correct_keys = {_legacy_answer_key(opt.text) for opt in part.options if opt.correct}
                if any(_legacy_answer_key(opt.text) in correct_keys for opt in part.options if not opt.correct):
                    add_error(
                        'invalid_trainer_structure',
                        f'trainer choice part[{part_idx}] distractor normalizes to the same answer key as a correct option',
                        path=f'card.data.parts[{part_idx}]',
                    )
                    return _build_result(raw_card_id, raw_deck_id, index, None, None, errors, warnings)

    content_v2 = encode_v2_content(v2_card)
    return _build_result(raw_card_id, raw_deck_id, index, content_v2, v2_card, errors, warnings)


def _build_result(
    card_id: Any,
    deck_id: Any,
    index: int | None,
    content_v2: dict[str, Any] | None,
    card_model: Card | None,
    errors: list[ConversionDiagnostic],
    warnings: list[ConversionDiagnostic],
) -> dict[str, Any]:
    return {
        'ok': len(errors) == 0 and content_v2 is not None,
        'card_id': card_id,
        'deck_id': deck_id,
        'index': index,
        'content_v2': content_v2,
        'card': card_model,
        'diagnostics': [e.to_dict() for e in errors],
        'warnings': [w.to_dict() for w in warnings],
    }


def convert_v1_card(
    card: dict[str, Any],
    *,
    deck: dict[str, Any] | None = None,
    index: int | None = None,
    strip_synthesized_back_note: bool = True,
    require_explicit_free_text_policy: bool = False,
    default_free_text_policy: str = 'controlled_text',
    classify_empty_back: bool = True,
) -> dict[str, Any]:
    """Convert a single V1 card dictionary to a canonical `content_v2` payload.

    Raises `V1ConversionError` with structured diagnostics on any ambiguity or error.
    """
    result = inspect_v1_card(
        card,
        deck=deck,
        index=index,
        strip_synthesized_back_note=strip_synthesized_back_note,
        require_explicit_free_text_policy=require_explicit_free_text_policy,
        default_free_text_policy=default_free_text_policy,
        classify_empty_back=classify_empty_back,
    )
    if not result['ok'] or result['content_v2'] is None:
        diags = [
            ConversionDiagnostic(
                code=d['code'],
                message=d['message'],
                severity=d.get('severity', 'ERROR'),
                path=d.get('path', 'card'),
                card_id=d.get('card_id'),
                deck_id=d.get('deck_id'),
                details=d.get('details', {}),
            )
            for d in result['diagnostics']
        ]
        raise V1ConversionError(diags)
    return result['content_v2']


def _extract_deck_v2_payload(
    deck: dict[str, Any],
    *,
    deck_id: Any = None,
) -> tuple[dict[str, Any] | None, list[ConversionDiagnostic]]:
    errors: list[ConversionDiagnostic] = []
    if not isinstance(deck, dict):
        errors.append(
            ConversionDiagnostic(
                code='invalid_deck_object',
                message=f'deck must be a dict, got {type(deck).__name__}',
                path='deck',
                deck_id=deck_id,
            )
        )
        return None, errors

    if _contains_null_byte(deck):
        errors.append(
            ConversionDiagnostic(
                code='null_byte_in_content',
                message='deck contains forbidden U+0000 null byte',
                path='deck',
                deck_id=deck_id,
            )
        )
        return None, errors

    passport_candidate: Any = deck.get('passport')
    raw_metadata = deck.get('metadata')
    parsed_meta: dict[str, Any] = {}
    if raw_metadata is not None and raw_metadata != '':
        meta_dict, meta_err = _parse_metadata_dict(raw_metadata)
        if meta_err is not None or meta_dict is None:
            errors.append(
                ConversionDiagnostic(
                    code='invalid_deck_metadata',
                    message=meta_err or 'invalid deck metadata',
                    path='deck.metadata',
                    deck_id=deck_id,
                )
            )
            return None, errors
        parsed_meta = meta_dict

    if passport_candidate is None:
        if 'intro' in deck or 'pedagogy' in deck:
            passport_candidate = {
                'schema_version': deck.get('schema_version', 1),
                **({} if 'intro' not in deck else {'intro': copy.deepcopy(deck['intro'])}),
                **({} if 'pedagogy' not in deck else {'pedagogy': copy.deepcopy(deck['pedagogy'])}),
            }
        elif 'passport' in parsed_meta and isinstance(parsed_meta['passport'], dict):
            passport_candidate = copy.deepcopy(parsed_meta['passport'])
        elif 'intro' in parsed_meta or 'pedagogy' in parsed_meta:
            passport_candidate = passport_from_metadata(parsed_meta)

    if passport_candidate is not None:
        if not isinstance(passport_candidate, dict):
            errors.append(
                ConversionDiagnostic(
                    code='invalid_deck_passport',
                    message='deck passport must be a JSON object',
                    path='deck.passport',
                    deck_id=deck_id,
                )
            )
            return None, errors
        passport_errors = validate_passport(passport_candidate)
        if passport_errors:
            errors.append(
                ConversionDiagnostic(
                    code='invalid_deck_passport',
                    message='; '.join(passport_errors),
                    path='deck.passport',
                    deck_id=deck_id,
                    details={'errors': passport_errors},
                )
            )
            return None, errors

    deck_meta = {
        k: copy.deepcopy(v)
        for k, v in parsed_meta.items()
        if k not in ('schema_version', 'intro', 'pedagogy', 'passport')
    }
    shadow_keys = sorted(set(deck_meta) & CONTENT_KEYS)
    if shadow_keys:
        errors.append(
            ConversionDiagnostic(
                code='forbidden_metadata_key',
                message=f'deck.metadata cannot shadow structured content keys: {shadow_keys}',
                path='deck.metadata',
                deck_id=deck_id,
                details={'keys': shadow_keys},
            )
        )
        return None, errors

    deck_name = deck.get('name') or deck.get('title')
    if not deck_name and isinstance(passport_candidate, dict):
        intro = passport_candidate.get('intro')
        if isinstance(intro, dict):
            deck_name = intro.get('title')

    if not isinstance(deck_name, str) or not deck_name.strip():
        errors.append(
            ConversionDiagnostic(
                code='missing_deck_name',
                message='deck requires a non-empty name',
                path='deck.name',
                deck_id=deck_id,
            )
        )
        return None, errors

    try:
        validated_deck = Deck.model_validate({
            'name': deck_name.strip(),
            'passport': copy.deepcopy(passport_candidate) if passport_candidate is not None else None,
            'metadata': deck_meta,
        })
    except Exception as exc:
        errors.append(
            ConversionDiagnostic(
                code='invalid_deck_passport',
                message=str(exc),
                path='deck',
                deck_id=deck_id,
            )
        )
        return None, errors

    return validated_deck.model_dump(mode='json'), []


def convert_v1_document(
    legacy_document: dict[str, Any],
    *,
    strip_synthesized_back_note: bool = True,
    require_explicit_free_text_policy: bool = False,
    default_free_text_policy: str = 'controlled_text',
    classify_empty_back: bool = True,
) -> Document:
    """Convert a legacy `{deck, cards}` document into a validated V2 `Document`.

    Does not mutate `legacy_document`. Raises `V1ConversionError` on any deck or card
    diagnostic error.
    """
    if not isinstance(legacy_document, dict):
        raise V1ConversionError([
            ConversionDiagnostic(
                code='invalid_document_object',
                message='legacy document must be a dict with deck and cards',
                path='document',
            )
        ])

    raw_deck = legacy_document.get('deck')
    raw_cards = legacy_document.get('cards')
    deck_id = raw_deck.get('id') if isinstance(raw_deck, dict) else None
    all_errors: list[ConversionDiagnostic] = []

    deck_v2, deck_errors = _extract_deck_v2_payload(raw_deck, deck_id=deck_id)
    all_errors.extend(deck_errors)

    if not isinstance(raw_cards, list) or len(raw_cards) == 0:
        all_errors.append(
            ConversionDiagnostic(
                code='empty_document_cards',
                message='document requires a non-empty cards list',
                path='cards',
                deck_id=deck_id,
            )
        )
        raise V1ConversionError(all_errors)

    converted_cards: list[dict[str, Any]] = []
    for idx, raw_card in enumerate(raw_cards):
        res = inspect_v1_card(
            raw_card,
            deck=raw_deck if isinstance(raw_deck, dict) else None,
            index=idx,
            strip_synthesized_back_note=strip_synthesized_back_note,
            require_explicit_free_text_policy=require_explicit_free_text_policy,
            default_free_text_policy=default_free_text_policy,
            classify_empty_back=classify_empty_back,
        )
        if not res['ok'] or res['content_v2'] is None:
            for d in res['diagnostics']:
                all_errors.append(
                    ConversionDiagnostic(
                        code=d['code'],
                        message=d['message'],
                        severity=d.get('severity', 'ERROR'),
                        path=f"cards[{idx}].{d.get('path', 'card')}",
                        card_id=d.get('card_id'),
                        deck_id=d.get('deck_id', deck_id),
                        details=d.get('details', {}),
                    )
                )
        else:
            converted_cards.append(res['content_v2']['card'])

    if all_errors or deck_v2 is None:
        raise V1ConversionError(all_errors)

    try:
        return validate_document({
            'schema_version': 2,
            'deck': deck_v2,
            'cards': converted_cards,
        })
    except Exception as exc:
        raise V1ConversionError([
            ConversionDiagnostic(
                code='v2_document_validation_failed',
                message=str(exc),
                path='document',
                deck_id=deck_id,
            )
        ]) from exc


_MEDIA_KEYS: tuple[str, ...] = (
    'image_path',
    'audio_path',
    'audio_back_path',
    'video_front_path',
    'video_back_path',
)

_CONSUMED_METADATA_KEYS: frozenset[str] = frozenset({
    'grading_policy',
    'accepted_answers',
    'structured_topics',
})


def _append_grouped_reason(
    groups: dict[str, dict[str, Any]],
    diag: dict[str, Any],
) -> None:
    code = diag['code']
    entry = groups.get(code)
    if entry is None:
        entry = {
            'count': 0,
            'severity': diag.get('severity', 'ERROR'),
            'card_ids': [],
            'deck_ids': [],
            'sample_message': diag.get('message', ''),
        }
        groups[code] = entry
    entry['count'] += 1
    card_id = diag.get('card_id')
    deck_id = diag.get('deck_id')
    if card_id is not None and card_id not in entry['card_ids']:
        entry['card_ids'].append(card_id)
    if deck_id is not None and deck_id not in entry['deck_ids']:
        entry['deck_ids'].append(deck_id)


def convert_v1_snapshot(
    snapshot: dict[str, Any] | list[Any],
    *,
    strip_synthesized_back_note: bool = True,
    require_explicit_free_text_policy: bool = False,
    default_free_text_policy: str = 'controlled_text',
    include_converted_payloads: bool = True,
    allow_shared_positions: bool = False,
    classify_empty_back: bool = True,
) -> dict[str, Any]:
    """Batch-inspect and dry-run convert a V1 snapshot without mutating source data.

    Accepts:
    - `{decks: [...], cards: [...]}` snapshot dict
    - `{deck: {...}, cards: [...]}` legacy document dict
    - `[...]` list of V1 card dicts
    """
    if isinstance(snapshot, list):
        raw_decks: list[Any] = []
        raw_cards: list[Any] = snapshot
        has_decks_list = False
    elif isinstance(snapshot, dict):
        if isinstance(snapshot.get('decks'), list) and isinstance(snapshot.get('cards'), list):
            raw_decks = snapshot['decks']
            raw_cards = snapshot['cards']
            has_decks_list = True
        elif isinstance(snapshot.get('deck'), dict) and isinstance(snapshot.get('cards'), list):
            raw_decks = [snapshot['deck']]
            raw_cards = snapshot['cards']
            has_decks_list = True
        elif isinstance(snapshot.get('cards'), list) and 'decks' not in snapshot and 'deck' not in snapshot:
            raw_decks = []
            raw_cards = snapshot['cards']
            has_decks_list = False
        else:
            diag = ConversionDiagnostic(
                code='invalid_snapshot_object',
                message='snapshot must be a dict with (decks, cards) or (deck, cards), or a list of cards',
                path='snapshot',
            ).to_dict()
            reasons: dict[str, dict[str, Any]] = {}
            _append_grouped_reason(reasons, diag)
            return {
                'ok': False,
                'mode': 'dry_run',
                'checked': {'decks': 0, 'cards': 0},
                'total_decks': 0,
                'total_cards': 0,
                'converted_count': 0,
                'blocked_count': 0,
                'failed_count': 0,
                'warning_count': 0,
                'cards_with_warnings_count': 0,
                'converted_ids': [],
                'blocked_ids': [],
                'warning_ids': [],
                'blocked_deck_ids': [],
                'counts_by_code': {'invalid_snapshot_object': 1},
                'warning_counts_by_code': {},
                'reasons': reasons,
                'blocked_by_code': reasons,
                'warnings_by_code': {},
                'invariants': {
                    'source_unmodified': True,
                    'id_uniqueness_ok': False,
                    'order_preserved': True,
                    'metadata_preserved': True,
                    'media_links_preserved': True,
                    'v2_valid': False,
                },
                'decks': [],
                'cards': [],
                'diagnostics': [diag],
                'warnings': [],
            }
    else:
        diag = ConversionDiagnostic(
            code='invalid_snapshot_object',
            message='snapshot must be a dict with (decks, cards) or (deck, cards), or a list of cards',
            path='snapshot',
        ).to_dict()
        reasons = {}
        _append_grouped_reason(reasons, diag)
        return {
            'ok': False,
            'mode': 'dry_run',
            'checked': {'decks': 0, 'cards': 0},
            'total_decks': 0,
            'total_cards': 0,
            'converted_count': 0,
            'blocked_count': 0,
            'failed_count': 0,
            'warning_count': 0,
            'cards_with_warnings_count': 0,
            'converted_ids': [],
            'blocked_ids': [],
            'warning_ids': [],
            'blocked_deck_ids': [],
            'counts_by_code': {'invalid_snapshot_object': 1},
            'warning_counts_by_code': {},
            'reasons': reasons,
            'blocked_by_code': reasons,
            'warnings_by_code': {},
            'invariants': {
                'source_unmodified': True,
                'id_uniqueness_ok': False,
                'order_preserved': True,
                'metadata_preserved': True,
                'media_links_preserved': True,
                'v2_valid': False,
            },
            'decks': [],
            'cards': [],
            'diagnostics': [diag],
            'warnings': [],
        }

    decks_by_id: dict[Any, dict[str, Any]] = {}
    seen_deck_ids: dict[Any, int] = {}
    deck_reports: list[dict[str, Any]] = []
    all_diagnostics: list[dict[str, Any]] = []
    all_warnings: list[dict[str, Any]] = []
    counts_by_code: dict[str, int] = {}
    warning_counts_by_code: dict[str, int] = {}
    reasons_by_code: dict[str, dict[str, Any]] = {}
    warnings_by_code: dict[str, dict[str, Any]] = {}
    blocked_deck_ids: list[Any] = []
    id_uniqueness_ok = True

    def record_error_dict(d: dict[str, Any]) -> None:
        all_diagnostics.append(d)
        counts_by_code[d['code']] = counts_by_code.get(d['code'], 0) + 1
        _append_grouped_reason(reasons_by_code, d)

    def record_warning_dict(w: dict[str, Any]) -> None:
        all_warnings.append(w)
        warning_counts_by_code[w['code']] = warning_counts_by_code.get(w['code'], 0) + 1
        _append_grouped_reason(warnings_by_code, w)

    for deck_idx, deck in enumerate(raw_decks):
        deck_id = deck.get('id') if isinstance(deck, dict) else None
        deck_v2, deck_errors = _extract_deck_v2_payload(deck, deck_id=deck_id)
        if isinstance(deck, dict):
            if deck_id is not None:
                if deck_id in seen_deck_ids:
                    id_uniqueness_ok = False
                    deck_errors.append(
                        ConversionDiagnostic(
                            code='duplicate_deck_id',
                            message=f'duplicate deck id {deck_id!r} (first seen at decks[{seen_deck_ids[deck_id]}])',
                            path='deck.id',
                            deck_id=deck_id,
                            details={'first_index': seen_deck_ids[deck_id], 'duplicate_index': deck_idx},
                        )
                    )
                else:
                    seen_deck_ids[deck_id] = deck_idx
                    decks_by_id[deck_id] = deck
            elif len(raw_decks) > 1:
                id_uniqueness_ok = False
                deck_errors.append(
                    ConversionDiagnostic(
                        code='missing_deck_id',
                        message=f'deck at decks[{deck_idx}] is missing an id in multi-deck snapshot',
                        path='deck.id',
                        deck_id=None,
                    )
                )

        deck_diag_dicts = [d.to_dict() for d in deck_errors]
        for d in deck_diag_dicts:
            record_error_dict(d)
        deck_ok = len(deck_diag_dicts) == 0 and deck_v2 is not None
        if not deck_ok and deck_id is not None and deck_id not in blocked_deck_ids:
            blocked_deck_ids.append(deck_id)
        deck_reports.append({
            'deck_id': deck_id,
            'index': deck_idx,
            'ok': deck_ok,
            'deck_v2': deck_v2 if deck_ok else None,
            'diagnostics': deck_diag_dicts,
        })

    # Determine whether this snapshot uses explicit card IDs.
    any_card_has_primary_id = any(
        isinstance(c, dict) and (c.get('id') is not None or c.get('card_id') is not None)
        for c in raw_cards
    )
    seen_card_ids: dict[Any, int] = {}
    seen_author_ids_by_deck: dict[Any, dict[str, int]] = {}
    seen_positions_by_deck: dict[Any, dict[Any, int]] = {}

    card_reports: list[dict[str, Any]] = []
    converted_count = 0
    failed_count = 0
    cards_with_warnings_count = 0
    converted_ids: list[Any] = []
    blocked_ids: list[Any] = []
    warning_ids: list[Any] = []

    order_preserved = True
    metadata_preserved = True
    media_links_preserved = True
    v2_valid = True

    single_default_deck = raw_decks[0] if (len(raw_decks) == 1 and isinstance(raw_decks[0], dict)) else None

    for idx, card in enumerate(raw_cards):
        deck_id = card.get('deck_id') if isinstance(card, dict) else None
        if deck_id is not None and deck_id in decks_by_id:
            deck_obj = decks_by_id[deck_id]
        elif deck_id is None and single_default_deck is not None:
            deck_obj = single_default_deck
            deck_id = single_default_deck.get('id')
        else:
            deck_obj = None

        res = inspect_v1_card(
            card,
            deck=deck_obj,
            index=idx,
            strip_synthesized_back_note=strip_synthesized_back_note,
            require_explicit_free_text_policy=require_explicit_free_text_policy,
            default_free_text_policy=default_free_text_policy,
            classify_empty_back=classify_empty_back,
        )

        card_diags = list(res['diagnostics'])
        card_warns = list(res['warnings'])
        card_id = res['card_id']
        resolved_deck_id = res['deck_id'] if res['deck_id'] is not None else deck_id
        card_position = card.get('position') if isinstance(card, dict) else None

        if isinstance(card, dict):
            primary_id = card.get('id', card.get('card_id'))
            if any_card_has_primary_id:
                if primary_id is None or (isinstance(primary_id, str) and not primary_id.strip()):
                    id_uniqueness_ok = False
                    card_diags.append(
                        ConversionDiagnostic(
                            code='missing_card_id',
                            message=f'card at cards[{idx}] is missing id/card_id',
                            path='card.id',
                            card_id=card_id,
                            deck_id=resolved_deck_id,
                            details={'index': idx},
                        ).to_dict()
                    )
                elif primary_id in seen_card_ids:
                    id_uniqueness_ok = False
                    card_diags.append(
                        ConversionDiagnostic(
                            code='duplicate_card_id',
                            message=f'duplicate card id {primary_id!r} (first seen at cards[{seen_card_ids[primary_id]}])',
                            path='card.id',
                            card_id=primary_id,
                            deck_id=resolved_deck_id,
                            details={'first_index': seen_card_ids[primary_id], 'duplicate_index': idx},
                        ).to_dict()
                    )
                else:
                    seen_card_ids[primary_id] = idx

            if has_decks_list and len(decks_by_id) > 0 and card.get('deck_id') is not None:
                if card['deck_id'] not in decks_by_id:
                    id_uniqueness_ok = False
                    card_diags.append(
                        ConversionDiagnostic(
                            code='orphan_card_deck_id',
                            message=f"card references deck_id {card['deck_id']!r} not present in snapshot decks",
                            path='card.deck_id',
                            card_id=card_id,
                            deck_id=card['deck_id'],
                        ).to_dict()
                    )

            raw_source_id = card.get('source_id')
            if isinstance(raw_source_id, str) and raw_source_id.strip():
                norm_source_id = raw_source_id.strip()
                deck_author_map = seen_author_ids_by_deck.setdefault(resolved_deck_id, {})
                if norm_source_id in deck_author_map:
                    id_uniqueness_ok = False
                    card_diags.append(
                        ConversionDiagnostic(
                            code='duplicate_author_card_id',
                            message=(
                                f'duplicate author source_id {norm_source_id!r} within deck {resolved_deck_id!r} '
                                f'(first seen at cards[{deck_author_map[norm_source_id]}])'
                            ),
                            path='card.id',
                            card_id=card_id,
                            deck_id=resolved_deck_id,
                            details={'source_id': norm_source_id, 'first_index': deck_author_map[norm_source_id]},
                        ).to_dict()
                    )
                else:
                    deck_author_map[norm_source_id] = idx

            if card_position is not None:
                deck_pos_map = seen_positions_by_deck.setdefault(resolved_deck_id, {})
                if card_position in deck_pos_map:
                    if allow_shared_positions:
                        card_warns.append(
                            ConversionDiagnostic(
                                code='shared_card_position',
                                message=(
                                    f'card shares position {card_position!r} within deck {resolved_deck_id!r} '
                                    f'(first seen at cards[{deck_pos_map[card_position]}])'
                                ),
                                severity='WARNING',
                                path='card.position',
                                card_id=card_id,
                                deck_id=resolved_deck_id,
                                details={'position': card_position, 'first_index': deck_pos_map[card_position]},
                            ).to_dict()
                        )
                    else:
                        order_preserved = False
                        card_diags.append(
                            ConversionDiagnostic(
                                code='duplicate_card_position',
                                message=(
                                    f'duplicate card position {card_position!r} within deck {resolved_deck_id!r} '
                                    f'(first seen at cards[{deck_pos_map[card_position]}])'
                                ),
                                path='card.position',
                                card_id=card_id,
                                deck_id=resolved_deck_id,
                                details={'position': card_position, 'first_index': deck_pos_map[card_position]},
                            ).to_dict()
                        )
                else:
                    deck_pos_map[card_position] = idx

        media_links: dict[str, Any] = {}
        if isinstance(card, dict):
            for media_key in _MEDIA_KEYS:
                if media_key in card:
                    media_links[media_key] = card[media_key]

        content_v2 = res['content_v2'] if len(card_diags) == 0 else None
        card_ok = len(card_diags) == 0 and content_v2 is not None

        # Verify V2 schema, media link preservation, and custom metadata preservation on converted cards.
        if card_ok and content_v2 is not None and isinstance(card, dict):
            try:
                decoded = decode_v2_content(content_v2)
                if decoded.type != content_v2['card']['type']:
                    v2_valid = False
            except Exception as exc:
                v2_valid = False
                card_ok = False
                content_v2 = None
                card_diags.append(
                    ConversionDiagnostic(
                        code='v2_roundtrip_validation_failed',
                        message=f'decoded content_v2 failed validation: {exc}',
                        path='card.content_v2',
                        card_id=card_id,
                        deck_id=resolved_deck_id,
                    ).to_dict()
                )

            for media_key in _MEDIA_KEYS:
                if media_key in card and media_links.get(media_key) != card[media_key]:
                    media_links_preserved = False

            raw_img_ref = card.get('image_ref', card.get('image'))
            if isinstance(raw_img_ref, str) and raw_img_ref.strip() and content_v2 is not None:
                if content_v2['card'].get('image') != raw_img_ref.strip():
                    media_links_preserved = False

            raw_meta, raw_meta_err = _parse_metadata_dict(card.get('metadata'))
            if raw_meta_err is None and isinstance(raw_meta, dict) and content_v2 is not None:
                v2_meta = content_v2['card'].get('metadata', {})
                for mk, mv in raw_meta.items():
                    if mk in _CONSUMED_METADATA_KEYS or mk in ('tags', 'cefr'):
                        continue
                    if v2_meta.get(mk) != mv:
                        metadata_preserved = False

        if card_ok:
            converted_count += 1
            converted_ids.append(card_id if card_id is not None else f'index:{idx}')
        else:
            failed_count += 1
            blocked_ids.append(card_id if card_id is not None else f'index:{idx}')

        if card_warns:
            cards_with_warnings_count += 1
            warning_ids.append(card_id if card_id is not None else f'index:{idx}')

        for d in card_diags:
            record_error_dict(d)
        for w in card_warns:
            record_warning_dict(w)

        card_entry: dict[str, Any] = {
            'ok': card_ok,
            'card_id': card_id,
            'deck_id': resolved_deck_id,
            'index': idx,
            'position': card_position,
            'media': media_links,
            'diagnostics': card_diags,
            'warnings': card_warns,
        }
        if include_converted_payloads:
            card_entry['content_v2'] = content_v2
        elif content_v2 is not None:
            card_entry['v2_type'] = content_v2['card']['type']
        card_reports.append(card_entry)

    # Verify order preservation across the batch.
    if len(card_reports) != len(raw_cards) or [r['index'] for r in card_reports] != list(range(len(raw_cards))):
        order_preserved = False

    invariants = {
        'source_unmodified': True,
        'id_uniqueness_ok': id_uniqueness_ok,
        'order_preserved': order_preserved,
        'metadata_preserved': metadata_preserved,
        'media_links_preserved': media_links_preserved,
        'v2_valid': v2_valid,
    }

    return {
        'ok': len(all_diagnostics) == 0 and all(invariants.values()),
        'mode': 'dry_run',
        'checked': {'decks': len(raw_decks), 'cards': len(raw_cards)},
        'total_decks': len(raw_decks),
        'total_cards': len(raw_cards),
        'converted_count': converted_count,
        'blocked_count': failed_count,
        'failed_count': failed_count,
        'warning_count': len(all_warnings),
        'cards_with_warnings_count': cards_with_warnings_count,
        'converted_ids': converted_ids,
        'blocked_ids': blocked_ids,
        'warning_ids': warning_ids,
        'blocked_deck_ids': blocked_deck_ids,
        'counts_by_code': counts_by_code,
        'warning_counts_by_code': warning_counts_by_code,
        'reasons': reasons_by_code,
        'blocked_by_code': reasons_by_code,
        'warnings_by_code': warnings_by_code,
        'invariants': invariants,
        'decks': deck_reports,
        'cards': card_reports,
        'diagnostics': all_diagnostics,
        'warnings': all_warnings,
    }


def run_v1_migration_dry_run(
    snapshot: dict[str, Any] | list[Any],
    *,
    strip_synthesized_back_note: bool = True,
    require_explicit_free_text_policy: bool = False,
    default_free_text_policy: str = 'controlled_text',
    include_converted_payloads: bool = False,
    verify_source_unmodified: bool = True,
    allow_shared_positions: bool = False,
    classify_empty_back: bool = True,
) -> dict[str, Any]:
    """Run a non-destructive V1 -> V2 migration dry-run on a snapshot and verify invariants."""
    before_copy = copy.deepcopy(snapshot) if verify_source_unmodified else None
    report = convert_v1_snapshot(
        snapshot,
        strip_synthesized_back_note=strip_synthesized_back_note,
        require_explicit_free_text_policy=require_explicit_free_text_policy,
        default_free_text_policy=default_free_text_policy,
        include_converted_payloads=include_converted_payloads,
        allow_shared_positions=allow_shared_positions,
        classify_empty_back=classify_empty_back,
    )
    if verify_source_unmodified:
        source_unmodified = (snapshot == before_copy)
        report['invariants']['source_unmodified'] = source_unmodified
        if not source_unmodified:
            report['ok'] = False
    return report


def format_dry_run_summary(report: dict[str, Any]) -> str:
    """Format a concise human-readable summary of a V1 -> V2 migration dry-run report."""
    lines: list[str] = []
    status = 'READY (0 blocked)' if report.get('ok') else 'BLOCKED (manual fixes required)'
    lines.append(f"=== V1 -> V2 Migration Dry-Run Summary [{status}] ===")
    lines.append(
        f"Decks checked: {report.get('total_decks', 0)} "
        f"(blocked decks: {len(report.get('blocked_deck_ids', []))})"
    )
    lines.append(
        f"Cards total:   {report.get('total_cards', 0)} | "
        f"Converted: {report.get('converted_count', 0)} | "
        f"With warnings: {report.get('cards_with_warnings_count', 0)} "
        f"({report.get('warning_count', 0)} warning(s)) | "
        f"Blocked: {report.get('blocked_count', 0)}"
    )

    invariants = report.get('invariants', {})
    if invariants:
        inv_parts = [f"{k}={'OK' if v else 'FAIL'}" for k, v in invariants.items()]
        lines.append(f"Invariants:    {', '.join(inv_parts)}")

    warnings_by_code = report.get('warnings_by_code', {})
    if warnings_by_code:
        lines.append('Warnings (auto-converted safely):')
        for code, info in sorted(warnings_by_code.items(), key=lambda kv: (-kv[1]['count'], kv[0])):
            card_ids = info.get('card_ids', [])
            preview = ', '.join(str(cid) for cid in card_ids[:10])
            if len(card_ids) > 10:
                preview += f", ... (+{len(card_ids) - 10} more)"
            lines.append(f"  - {code}: {info['count']} (card IDs: [{preview}])")

    reasons = report.get('reasons', {})
    if reasons:
        lines.append('Blocked Reasons (require fix before migration):')
        for code, info in sorted(reasons.items(), key=lambda kv: (-kv[1]['count'], kv[0])):
            card_ids = info.get('card_ids', [])
            deck_ids = info.get('deck_ids', [])
            targets: list[str] = []
            if card_ids:
                c_preview = ', '.join(str(cid) for cid in card_ids[:15])
                if len(card_ids) > 15:
                    c_preview += f", ... (+{len(card_ids) - 15} more)"
                targets.append(f"card IDs: [{c_preview}]")
            if deck_ids and not card_ids:
                d_preview = ', '.join(str(did) for did in deck_ids[:15])
                if len(deck_ids) > 15:
                    d_preview += f", ... (+{len(deck_ids) - 15} more)"
                targets.append(f"deck IDs: [{d_preview}]")
            target_str = f" ({'; '.join(targets)})" if targets else ''
            lines.append(f"  - {code}: {info['count']}{target_str}")
            if info.get('sample_message'):
                lines.append(f"      example: {info['sample_message']}")
    return '\n'.join(lines)


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint for offline V1 -> V2 conversion and dry-run diagnostics."""
    import argparse
    from pathlib import Path
    import sys

    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description='Offline V1 -> JSON V2 structured card converter and dry-run diagnostics.')
    parser.add_argument('file', type=Path, help='Path to V1 card, {deck, cards} document, or {decks, cards} snapshot JSON')
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Run non-destructive mass migration diagnostics without failing exit code on blocked cards',
    )
    parser.add_argument(
        '--summary',
        action='store_true',
        help='Print concise human-readable dry-run summary (to stderr when combined with JSON stdout, or stdout when used with --report-out)',
    )
    parser.add_argument(
        '--report-out',
        type=Path,
        default=None,
        help='Optional path to write the JSON dry-run report',
    )
    parser.add_argument(
        '--include-payloads',
        action='store_true',
        help='Include converted content_v2 payloads in --dry-run JSON output',
    )
    parser.add_argument(
        '--fail-on-blocked',
        action='store_true',
        help='Return non-zero exit code in --dry-run mode if any cards or decks are blocked',
    )
    parser.add_argument(
        '--strict-free-policy',
        action='store_true',
        help='Block V1 free_text cards that do not specify an explicit grading_policy in metadata',
    )
    parser.add_argument(
        '--allow-implicit-free-policy',
        action='store_true',
        help='(Default behavior) Convert V1 free_text cards without grading_policy to controlled_text with a warning',
    )
    parser.add_argument(
        '--allow-shared-positions',
        action='store_true',
        help='Allow multiple cards in a deck to share the same position value (e.g. 0) with a warning instead of error',
    )
    parser.add_argument(
        '--strict-empty-back',
        action='store_true',
        help='Block all standard cards with empty back (disable automatic classification into audio shadowing or theory)',
    )
    args = parser.parse_args(argv)
    require_explicit = bool(args.strict_free_policy and not args.allow_implicit_free_policy)
    classify_empty = not args.strict_empty_back
    try:
        raw = json.loads(args.file.read_text(encoding='utf-8-sig'))
        if args.dry_run:
            report = run_v1_migration_dry_run(
                raw,
                require_explicit_free_text_policy=require_explicit,
                include_converted_payloads=args.include_payloads,
                allow_shared_positions=args.allow_shared_positions,
                classify_empty_back=classify_empty,
            )
            report_json = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False)
            if args.report_out is not None:
                args.report_out.write_text(report_json + '\n', encoding='utf-8')
                if args.summary:
                    print(format_dry_run_summary(report))
                else:
                    print(report_json)
            elif args.summary:
                print(format_dry_run_summary(report))
            else:
                print(report_json)
            if args.fail_on_blocked and not report['ok']:
                return 1
            return 0

        if isinstance(raw, dict) and 'decks' in raw and 'cards' in raw:
            result = convert_v1_snapshot(
                raw,
                require_explicit_free_text_policy=require_explicit,
                classify_empty_back=classify_empty,
            )
            out_stream = sys.stdout if result['ok'] else sys.stderr
            print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), file=out_stream)
            if args.summary:
                print(format_dry_run_summary(result), file=sys.stderr)
            return 0 if result['ok'] else 1
        if isinstance(raw, dict) and 'deck' in raw and 'cards' in raw:
            doc = convert_v1_document(
                raw,
                require_explicit_free_text_policy=require_explicit,
                classify_empty_back=classify_empty,
            )
            print(json.dumps(doc.model_dump(mode='json'), ensure_ascii=False, indent=2, allow_nan=False))
            return 0
        payload = convert_v1_card(
            raw,
            require_explicit_free_text_policy=require_explicit,
            classify_empty_back=classify_empty,
        )
        print(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except V1ConversionError as exc:
        print(
            json.dumps({'valid': False, 'errors': [d.to_dict() for d in exc.diagnostics]}, ensure_ascii=False, indent=2),
            file=sys.stderr,
        )
        return 1
    except (OSError, ValueError) as exc:
        print(json.dumps({'valid': False, 'errors': [{'message': str(exc)}]}, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1


__all__ = [
    'ConversionDiagnostic',
    'V1ConversionError',
    'convert_v1_card',
    'convert_v1_document',
    'convert_v1_snapshot',
    'decode_v2_content',
    'encode_v2_content',
    'format_dry_run_summary',
    'inspect_v1_card',
    'main',
    'run_v1_migration_dry_run',
]


if __name__ == '__main__':
    raise SystemExit(main())
