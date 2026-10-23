"""Single gateway for normalizing and applying card content fields.

Consolidates content field handling (`front_text`, `back_text`, `context`,
`card_type`, `topics`, `tags`, `level`, `metadata`) and TTS audio invalidation
without hidden front/back swap heuristics or destructive context regexes.
"""
import json
import re
from typing import Any

from api.services.cefr_metadata import (
    build_local_cefr_payload,
    build_manual_cefr_payload,
    get_cefr_metadata,
    merge_cefr_metadata,
    parse_card_metadata,
    serialize_card_metadata,
)
from api.services.input_parser import detect_card_type
from api.utils.audio import _prepare_tts_text

LEVELS = ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')
VALID_CARD_TYPES = {
    'theory', 'standard', 'trainer', 'quiz', 'match', 'puzzle', 'word_bank', 'free_text', 'editable_text'
}


def normalize_level(value: Any) -> str | None:
    if not value:
        return None
    lvl = str(value).upper().strip()
    return lvl if lvl in LEVELS else None


def extract_level_from_tags(tags: str | None) -> str | None:
    if not tags:
        return None
    upper = str(tags).upper()
    return next((lvl for lvl in LEVELS if lvl in upper), None)


def update_level_tags(existing_tags: str | None, level: str | None) -> str:
    """Replace any existing CEFR level tag while preserving custom tags and format (JSON list or CSV)."""
    norm_level = normalize_level(level)
    if not norm_level:
        return existing_tags or ''
    try:
        parsed = json.loads(existing_tags or '')
    except (TypeError, ValueError):
        parsed = None
    if isinstance(parsed, list):
        filtered = [tag for tag in parsed if str(tag).upper() not in LEVELS]
        return json.dumps(filtered + [norm_level], ensure_ascii=False)
    items = [tag.strip() for tag in (existing_tags or '').split(',') if tag.strip() and tag.strip().upper() not in LEVELS]
    return ','.join(items + [norm_level])


def extract_context_markers(context: str | None) -> tuple[str, str | None, str | None]:
    """Extract only explicit ::level and ::topic directives from context without mangling normal prose."""
    if not context:
        return '', None, None
    level = None
    topic = None
    m_level = re.search(r'(?:^|\n)[ \t]*::level(?:[ \t]+|\r?\n[ \t]*)([a-cA-C][1-2])\b', context, re.IGNORECASE)
    if m_level:
        lvl = m_level.group(1).upper()
        if lvl in LEVELS:
            level = lvl
    m_topic = re.search(r'(?:^|\n)[ \t]*::topic(?:[ \t]+|\r?\n[ \t]*)([^\r\n]+)', context, re.IGNORECASE)
    if m_topic:
        top = m_topic.group(1).strip()
        if top and not top.startswith('::'):
            topic = top
    if not level and not topic:
        return context, None, None
    cleaned = re.sub(r'(?im)^[ \t]*::level(?:[ \t]+[a-cA-C][1-2]|\r?\n[ \t]*[a-cA-C][1-2])\b[ \t]*\r?\n?', '', context)
    cleaned = re.sub(r'(?im)^[ \t]*::topic(?:[ \t]+[^\r\n]+|\r?\n[ \t]*[^\r\n]+)[ \t]*\r?\n?', '', cleaned)
    return cleaned.strip(), level, topic


def apply_card_content(card: Any, data: dict) -> None:
    """Apply content, media, level/tags/metadata, and card_type to a TMA_Card instance."""
    old_front = card.front_text
    old_back = card.back_text

    if 'front' in data or 'front_text' in data:
        new_front = data.get('front') if 'front' in data else data.get('front_text')
        old_spoken = _prepare_tts_text(old_front) if old_front else ''
        new_spoken = _prepare_tts_text(new_front) if new_front else ''
        spoken_changed = bool(old_spoken and new_spoken and old_spoken != new_spoken)

        if spoken_changed:
            incoming_audio = data.get('audio_path')
            if not incoming_audio or incoming_audio == card.audio_path:
                card.audio_path = None
            else:
                card.audio_path = incoming_audio
        elif 'audio_path' in data and data.get('audio_path') is not None:
            card.audio_path = data.get('audio_path')
        card.front_text = new_front
    elif 'audio_path' in data and data.get('audio_path') is not None:
        card.audio_path = data.get('audio_path')

    if 'back' in data or 'back_text' in data:
        new_back = data.get('back') if 'back' in data else data.get('back_text')
        old_back_spoken = _prepare_tts_text(old_back) if old_back else ''
        new_back_spoken = _prepare_tts_text(new_back) if new_back else ''
        back_spoken_changed = bool(old_back_spoken and new_back_spoken and old_back_spoken != new_back_spoken)

        if back_spoken_changed:
            incoming_back_audio = data.get('audio_back_path')
            if not incoming_back_audio or incoming_back_audio == card.audio_back_path:
                card.audio_back_path = None
            else:
                card.audio_back_path = incoming_back_audio
        elif 'audio_back_path' in data and data.get('audio_back_path') is not None:
            card.audio_back_path = data.get('audio_back_path')
        card.back_text = new_back
    elif 'audio_back_path' in data and data.get('audio_back_path') is not None:
        card.audio_back_path = data.get('audio_back_path')

    if 'context' in data:
        card.context = data.get('context')
    if 'image_path' in data:
        card.image_path = data.get('image_path')
    if 'video_front_path' in data:
        card.video_front_path = data.get('video_front_path')
    if 'video_back_path' in data:
        card.video_back_path = data.get('video_back_path')

    if 'source' in data:
        card.source = data.get('source')
    elif not card.source:
        card.source = 'user'

    if 'topics' in data and data.get('topics') is not None:
        card.topics = data.get('topics')

    extracted_level = None
    if card.context:
        cleaned_ctx, extracted_level, extracted_topic = extract_context_markers(card.context)
        card.context = cleaned_ctx
        if extracted_topic and not data.get('topics'):
            card.topics = extracted_topic

    if 'tags' in data and data.get('tags') is not None:
        card.tags = data.get('tags')

    target_level = normalize_level(data.get('level')) or extracted_level
    if target_level:
        card.tags = update_level_tags(card.tags, target_level)

    if 'metadata' in data:
        card.metadata = serialize_card_metadata(parse_card_metadata(data.get('metadata')))
    if data.get('cefr') is not None:
        card.metadata = merge_cefr_metadata(card.metadata, data.get('cefr'))
    elif target_level:
        card.metadata = merge_cefr_metadata(card.metadata, build_local_cefr_payload({'level': target_level}))
    elif card.tags:
        tag_level = extract_level_from_tags(card.tags)
        if tag_level and not get_cefr_metadata(card.metadata):
            card.metadata = merge_cefr_metadata(card.metadata, build_local_cefr_payload({'level': tag_level}))

    explicit_type = data.get('card_type')
    if explicit_type in VALID_CARD_TYPES and explicit_type != 'standard':
        card.card_type = explicit_type
    elif 'card_type' in data or 'front' in data or 'front_text' in data or not card.card_type:
        card.card_type = detect_card_type(card.front_text or '')

    if card.front_text is None:
        card.front_text = ''
    if card.back_text is None:
        card.back_text = ''
    if card.context is None:
        card.context = ''
    if card.source is None:
        card.source = 'user'


def build_text_update_values(card: Any, row: dict, item: dict, now: Any) -> dict:
    """Build atomic UPDATE dict for card_text_update using shared level/tag/metadata rules."""
    values = {'updated_at': now}
    for key, field in (('front', 'front_text'), ('back', 'back_text'), ('context', 'context'), ('topics', 'topics')):
        if key in row['changed_fields']:
            values[field] = row['after'][key]
    if 'front' in row['changed_fields']:
        values['card_type'] = item.get('card_type') or detect_card_type(row['after']['front'])
    if 'level' in row['changed_fields']:
        level = row['after']['level']
        values['metadata'] = merge_cefr_metadata(card.metadata, build_manual_cefr_payload(level))
        values['tags'] = update_level_tags(card.tags, level)
    return values
