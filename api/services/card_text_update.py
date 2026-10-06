"""Authoritative content preview and atomic maintenance updates, without SRS writes.

The browser's existing Lerne parsers own text import. This service accepts only
their content projection, validates identifiers/structure, and compares live rows.
"""
import datetime
import hashlib
import json
import re
from collections import Counter

from fastapi import HTTPException
from peewee import fn

from api.models import TMA_Card, TMA_Deck, TMAUser, TMAOfflineBatch, tma_db
from .cefr_metadata import get_cefr_metadata, build_manual_cefr_payload, merge_cefr_metadata
from .collaborative_service import _require_can_mutate, touch_deck_and_parent_folders
from .input_parser import parse_exercise_content

LEVELS = ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')
CONTENT_FIELDS = ('front', 'back', 'context', 'level', 'topics')


def _text(value):
    return str(value or '').replace('\r\n', '\n').replace('\r', '\n').strip()


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    separators=(',', ':')).encode('utf-8')).hexdigest()


def _content(card):
    cefr = get_cefr_metadata(card.metadata) or {}
    # Match the existing study/API level projection; technical classifier fields do not matter.
    level = cefr.get('level') if cefr.get('level') in LEVELS else next(
        (value for value in LEVELS if value in str(card.tags or '').upper()), None)
    return {'front': _text(card.front_text), 'back': _text(card.back_text),
            'context': _text(card.context), 'level': level, 'topics': _text(card.topics)}


def _require_deck(deck_id, user_id, lock=False):
    user = TMAUser.get_or_none(TMAUser.user_id == user_id)
    if user and user.is_guest:
        raise HTTPException(403, 'Для обновления колоды требуется авторизация.')
    query = TMA_Deck.select().where((TMA_Deck.id == deck_id) & (TMA_Deck.is_deleted == False))
    if lock and tma_db.for_update:
        query = query.for_update()
    deck = query.first()
    if not deck:
        raise HTTPException(404, 'Колода не найдена.')
    _require_can_mutate(user_id, 'deck', deck_id)
    return deck


def _structure_errors(item):
    """Validate the content contract using the existing backend information parser.

    Exercise-specific interpretation is handled by the established browser parsers;
    this does not introduce a second text-file grammar on the server.
    """
    errors = []
    if not _text(item['front']):
        errors.append('invalid_sections')
    exercise = parse_exercise_content(item['front'])['exercise']
    for opening, closing in (('[[', ']]'), ('{', '}'), ('<<', '>>')):
        chunks = exercise.split(opening)
        if closing in chunks[0] or any(len(chunk.split(closing)) != 2 for chunk in chunks[1:]):
            errors.append('unclosed_syntax')
    if item['card_type'] in ('match', 'free_text', 'puzzle', 'word_bank'):
        if not re.sub(r'@(match|free|puzzle|wordbank)\b', '', exercise, flags=re.I).strip():
            errors.append('invalid_exercise')
    # Service metadata and transport section boundaries must never be submitted as content.
    for field in ('front', 'back', 'context'):
        if re.search(r'(?im)^\s*(?:<<<LERNE_CARD>>>\s*$|(?:FRONT|BACK|CONTEXT)\s*:)', item[field]):
            errors.append('invalid_sections')
    return list(dict.fromkeys(errors))


def _preview(deck, items, lock=False):
    query = TMA_Card.select().where((TMA_Card.deck_id == deck.id) & (TMA_Card.is_deleted == False)).order_by(TMA_Card.id)
    if lock and tma_db.for_update:
        query = query.for_update()
    live = {card.id: card for card in query}
    ids = [item['card_id'] for item in items if item.get('card_id')]
    duplicates = Counter(ids)
    # Foreign rows expose identifiers only, never their private text or deck names.
    foreign = {card.id for card in TMA_Card.select(TMA_Card.id).where(
        (TMA_Card.id.in_(ids)) & (TMA_Card.deck_id != deck.id))} if ids else set()
    rows = []
    for item in items:
        errors = _structure_errors(item)
        identifier = item.get('card_id')
        if item.get('deck_id') is not None and item['deck_id'] != deck.id:
            errors.append('wrong_deck')
        if identifier and duplicates[identifier] > 1:
            errors.append('duplicate_card_id')
        if identifier in foreign:
            errors.append('foreign_card_id')
        before = _content(live[identifier]) if identifier in live else None
        after = {key: _text(item[key]) for key in ('front', 'back', 'context', 'topics')}
        after['level'] = item.get('level') or (before['level'] if before else None)
        changed = [key for key in CONTENT_FIELDS if before and before[key] != after[key]]
        status = ('error' if errors else 'missing' if identifier and not before else
                  'new' if not identifier else 'update' if changed else 'unchanged')
        rows.append({'number': item['number'], 'card_id': identifier, 'status': status,
                     'errors': errors, 'changed_fields': changed, 'before': before, 'after': after})
    counts = {key: sum(row['status'] == status for row in rows) for key, status in
              (('updated', 'update'), ('unchanged', 'unchanged'), ('new', 'new'), ('missing', 'missing'), ('errors', 'error'))}
    snapshot = [{'id': card.id, 'content': _content(card)} for card in live.values()]
    token = _digest({'deck_id': deck.id, 'snapshot': snapshot, 'items': items})
    return {'deck_id': deck.id, 'deck_name': deck.name, 'total': len(items), **counts,
            'can_apply': not counts['errors'] and not counts['missing'], 'preview_token': token, 'cards': rows}


def preview_text_update(deck_id, user_id, items):
    return _preview(_require_deck(deck_id, user_id), items)


def _update_values(card, row, item, now):
    values = {'updated_at': now}
    for key, field in (('front', 'front_text'), ('back', 'back_text'), ('context', 'context'), ('topics', 'topics')):
        if key in row['changed_fields']:
            values[field] = row['after'][key]
    if 'front' in row['changed_fields']:
        values['card_type'] = item['card_type']
    if 'level' in row['changed_fields']:
        level = row['after']['level']
        values['metadata'] = merge_cefr_metadata(card.metadata, build_manual_cefr_payload(level))
        try:
            tags = json.loads(card.tags or '')
        except (TypeError, ValueError):
            tags = None
        if isinstance(tags, list):
            values['tags'] = json.dumps([tag for tag in tags if str(tag).upper() not in LEVELS] + [level], ensure_ascii=False)
        else:
            tags = [tag.strip() for tag in (card.tags or '').split(',') if tag.strip() and tag.strip().upper() not in LEVELS]
            values['tags'] = ','.join(tags + [level])
    return values


def apply_text_update(deck_id, user_id, items, preview_token, request_id, include_new=False):
    """Recheck under row locks; receipt and ALL content writes share one transaction."""
    payload_hash = _digest({'deck_id': deck_id, 'items': items, 'preview_token': preview_token,
                            'include_new': include_new})
    with tma_db.atomic():
        deck = _require_deck(deck_id, user_id, lock=True)
        key = f'text-update:{user_id}:{request_id}'
        inserted = list(TMAOfflineBatch.insert(key=key, payload_hash=payload_hash, response='')
                        .on_conflict_ignore().returning(TMAOfflineBatch.key).execute())
        receipt = TMAOfflineBatch.get_by_id(key)
        if not inserted:
            if receipt.payload_hash != payload_hash:
                raise HTTPException(409, {'code': 'request_changed'})
            return json.loads(receipt.response)
        preview = _preview(deck, items, lock=True)
        if not preview['can_apply']:
            raise HTTPException(422, {'code': 'invalid_update', 'cards': preview['cards']})
        if preview['preview_token'] != preview_token:
            raise HTTPException(409, {'code': 'preview_changed'})
        now = datetime.datetime.now()
        max_position = TMA_Card.select(fn.Max(TMA_Card.position)).where(
            (TMA_Card.deck_id == deck_id) & (TMA_Card.is_deleted == False)).scalar() or 0
        updated = created = 0
        for item, row in zip(items, preview['cards']):
            if row['status'] == 'update':
                card = TMA_Card.get_by_id(row['card_id'])
                # Membership is also constrained on the UPDATE, even after validation.
                affected = TMA_Card.update(**_update_values(card, row, item, now)).where(
                    (TMA_Card.id == card.id) & (TMA_Card.deck_id == deck_id) & (TMA_Card.is_deleted == False)).execute()
                if affected != 1:
                    raise HTTPException(409, {'code': 'preview_changed'})
                updated += 1
            elif row['status'] == 'new' and include_new:
                created += 1
                level = row['after']['level']
                TMA_Card.create(deck_id=deck_id, front_text=row['after']['front'], back_text=row['after']['back'],
                                context=row['after']['context'], topics=row['after']['topics'], card_type=item['card_type'],
                                tags=level, metadata=merge_cefr_metadata(None, build_manual_cefr_payload(level)) if level else None,
                                position=max_position + created, creator_id=user_id, source='text_update', updated_at=now)
        if updated or created:
            touch_deck_and_parent_folders(deck_id, deck_obj=deck)
        result = {'status': 'success', 'updated': updated, 'created': created,
                  'unchanged': preview['unchanged'], 'skipped_new': preview['new'] - created}
        receipt.response = json.dumps(result, ensure_ascii=False)
        receipt.save()
        return result
