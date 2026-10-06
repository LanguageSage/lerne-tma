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

from api.models import TMA_Card, TMA_Deck, TMA_Folder, TMAUser, TMAOfflineBatch, tma_db
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


def _require_account(user_id):
    user = TMAUser.get_or_none(TMAUser.user_id == user_id)
    if user and user.is_guest:
        raise HTTPException(403, 'Для обновления колоды требуется авторизация.')


def _require_deck(deck_id, user_id, lock=False):
    _require_account(user_id)
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


def _row(item, before, errors, deck_id=None):
    after = {key: _text(item[key]) for key in ('front', 'back', 'context', 'topics')}
    after['level'] = item.get('level') or (before['level'] if before else None)
    changed = [key for key in CONTENT_FIELDS if before and before[key] != after[key]]
    identifier = item.get('card_id')
    status = ('error' if errors else 'missing' if identifier and not before else
              'new' if not identifier else 'update' if changed else 'unchanged')
    return {'number': item['number'], 'card_id': identifier, 'deck_id': deck_id,
            'status': status, 'errors': list(dict.fromkeys(errors)), 'changed_fields': changed,
            'before': before, 'after': after}


def _counts(rows):
    return {key: sum(row['status'] == status for row in rows) for key, status in
            (('updated', 'update'), ('unchanged', 'unchanged'), ('new', 'new'), ('missing', 'missing'), ('errors', 'error'))}


def _preview(deck, items, lock=False, duplicates=None):
    query = TMA_Card.select().where((TMA_Card.deck_id == deck.id) & (TMA_Card.is_deleted == False)).order_by(TMA_Card.id)
    if lock and tma_db.for_update:
        query = query.for_update()
    live = {card.id: card for card in query}
    ids = [item['card_id'] for item in items if item.get('card_id')]
    duplicates = Counter(ids) if duplicates is None else duplicates
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
        rows.append(_row(item, before, errors, deck.id))
    counts = _counts(rows)
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



def _apply_rows(deck, items, preview, user_id, include_new, touch=True):
    deck_id = deck.id
    now = datetime.datetime.now()
    update_ids = [row['card_id'] for row in preview['cards'] if row['status'] == 'update']
    existing = {card.id: card for card in TMA_Card.select().where(TMA_Card.id.in_(update_ids))} if update_ids else {}
    max_position = TMA_Card.select(fn.Max(TMA_Card.position)).where(
        (TMA_Card.deck_id == deck_id) & (TMA_Card.is_deleted == False)).scalar() or 0
    updated = created = 0
    for item, row in zip(items, preview['cards']):
        if row['status'] == 'update':
            card = existing[row['card_id']]
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
    if touch and (updated or created):
        touch_deck_and_parent_folders(deck_id, deck_obj=deck)
    return {'status': 'success', 'updated': updated, 'created': created,
              'unchanged': preview['unchanged'], 'skipped_new': preview['new'] - created}


def _claim_receipt(key, payload_hash):
    inserted = list(TMAOfflineBatch.insert(key=key, payload_hash=payload_hash, response='')
                    .on_conflict_ignore().returning(TMAOfflineBatch.key).execute())
    receipt = TMAOfflineBatch.get_by_id(key)
    if not inserted:
        if receipt.payload_hash != payload_hash:
            raise HTTPException(409, {'code': 'request_changed'})
        return receipt, json.loads(receipt.response)
    return receipt, None


def apply_text_update(deck_id, user_id, items, preview_token, request_id, include_new=False):
    """Recheck under row locks; receipt and ALL content writes share one transaction."""
    payload_hash = _digest({'deck_id': deck_id, 'items': items, 'preview_token': preview_token,
                            'include_new': include_new})
    with tma_db.atomic():
        deck = _require_deck(deck_id, user_id, lock=True)
        key = f'text-update:{user_id}:{request_id}'
        receipt, replay = _claim_receipt(key, payload_hash)
        if replay is not None:
            return replay
        preview = _preview(deck, items, lock=True)
        if not preview['can_apply']:
            raise HTTPException(422, {'code': 'invalid_update', 'cards': preview['cards']})
        if preview['preview_token'] != preview_token:
            raise HTTPException(409, {'code': 'preview_changed'})
        result = _apply_rows(deck, items, preview, user_id, include_new)
        receipt.response = json.dumps(result, ensure_ascii=False)
        receipt.save()
        return result


def _require_folder(folder_id, user_id):
    _require_account(user_id)
    folder = TMA_Folder.get_or_none((TMA_Folder.id == folder_id) & (TMA_Folder.is_deleted == False))
    if not folder:
        raise HTTPException(404, 'Папка не найдена.')
    _require_can_mutate(user_id, 'folder', folder_id)
    return folder


def _folder_paths(folder_id, decks, lock=False):
    """Read only ancestors of referenced decks; never depend on unrelated descendants.

    Deck locks precede sorted folder locks, as deck maintenance already locks a
    deck before updating its ancestors. Recheck ancestry from locked row values.
    """
    folders = {}
    frontier = {folder_id, *(deck.folder_id for deck in decks.values() if deck.folder_id)}
    while frontier:
        rows = list(TMA_Folder.select(TMA_Folder.id, TMA_Folder.parent, TMA_Folder.is_deleted)
                    .where(TMA_Folder.id.in_(frontier)))
        for row in rows:
            folders[row.id] = row
        visited = set(folders) | frontier
        frontier = {row.parent_id for row in rows if row.parent_id and row.parent_id not in visited}
    if lock and tma_db.for_update:
        rows = TMA_Folder.select(TMA_Folder.id, TMA_Folder.parent, TMA_Folder.is_deleted).where(
            TMA_Folder.id.in_(folders)).order_by(TMA_Folder.id).for_update()
        folders = {row.id: row for row in rows}
    paths = {}
    for deck in decks.values():
        path, visited, current = [], set(), deck.folder_id
        while current and current not in visited:
            visited.add(current)
            row = folders.get(current)
            if not row or row.is_deleted:
                break
            path.append(current)
            if current == folder_id:
                paths[deck.id] = path
                break
            current = row.parent_id
    return paths


def _folder_preview(folder, user_id, items, lock=False):
    grouped = {}
    for item in items:
        grouped.setdefault(item.get('deck_id'), []).append(item)
    identifiers = [identifier for identifier in grouped if identifier is not None]
    query = TMA_Deck.select().where(TMA_Deck.id.in_(identifiers)).order_by(TMA_Deck.id)
    if lock and tma_db.for_update:
        query = query.for_update()
    decks = {deck.id: deck for deck in query}
    paths = _folder_paths(folder.id, decks, lock)
    # Root permissions are checked again after the ancestry rows were locked.
    _require_folder(folder.id, user_id)
    duplicates = Counter(item['card_id'] for item in items if item.get('card_id'))
    previews = {}
    # Stable ordering also avoids cross-folder operations locking cards in reverse order.
    for identifier in sorted(grouped, key=lambda value: value or 0):
        candidates = grouped[identifier]
        deck = decks.get(identifier)
        scope_errors = []
        if identifier is None:
            scope_errors.append('missing_deck_id')
        elif not deck or deck.is_deleted:
            scope_errors.append('missing_deck')
        elif identifier not in paths:
            scope_errors.append('deck_outside_folder')
        else:
            try:
                _require_can_mutate(user_id, 'deck', identifier)
            except HTTPException as error:
                if error.status_code != 403:
                    raise
                scope_errors.append('readonly_deck')
        if scope_errors:
            rows = [_row(item, None, _structure_errors(item) + scope_errors +
                         (['duplicate_card_id'] if duplicates[item.get('card_id')] > 1 else []), identifier)
                    for item in candidates]
            preview = {'deck_id': identifier, 'deck_name': None, 'total': len(rows), **_counts(rows),
                       'can_apply': False, 'cards': rows,
                       'preview_token': _digest({'items': candidates, 'scope_errors': scope_errors})}
        else:
            preview = _preview(deck, candidates, lock, duplicates)
        preview['scope_errors'] = scope_errors
        previews[identifier] = preview
    ordered = [previews[identifier] for identifier in grouped]
    rows = sorted([row for preview in ordered for row in preview['cards']], key=lambda row: row['number'])
    counts = _counts(rows)
    fingerprint = {'folder_id': folder.id, 'items': items,
                   'decks': [{'id': identifier, 'path': paths.get(identifier),
                              'token': previews[identifier]['preview_token']} for identifier in sorted(previews, key=lambda value: value or 0)]}
    result = {'folder_id': folder.id, 'folder_name': folder.name, 'total': len(items),
              'deck_count': len(identifiers), **counts, 'can_apply': all(preview['can_apply'] for preview in ordered),
              'preview_token': _digest(fingerprint), 'decks': ordered, 'cards': rows}
    return result, decks, grouped


def preview_folder_text_update(folder_id, user_id, items):
    return _folder_preview(_require_folder(folder_id, user_id), user_id, items)[0]


def apply_folder_text_update(folder_id, user_id, items, preview_token, request_id, include_new=False):
    payload_hash = _digest({'folder_id': folder_id, 'items': items, 'preview_token': preview_token,
                            'include_new': include_new})
    with tma_db.atomic():
        folder = _require_folder(folder_id, user_id)
        preview, decks, grouped = _folder_preview(folder, user_id, items, lock=True)
        receipt, replay = _claim_receipt(f'folder-text-update:{user_id}:{request_id}', payload_hash)
        if replay is not None:
            if any(deck['scope_errors'] for deck in preview['decks']):
                raise HTTPException(403, {'code': 'invalid_update'})
            return replay
        # A once-valid preview becoming missing/invalid must also report staleness.
        if preview['preview_token'] != preview_token:
            raise HTTPException(409, {'code': 'preview_changed'})
        if not preview['can_apply']:
            raise HTTPException(422, {'code': 'invalid_update', 'cards': preview['cards']})
        results = []
        for deck_preview in sorted(preview['decks'], key=lambda value: value['deck_id']):
            identifier = deck_preview['deck_id']
            # Folder maintenance leaves folder/deck timestamps and structure untouched.
            result = _apply_rows(decks[identifier], grouped[identifier], deck_preview, user_id, include_new, touch=False)
            results.append({'deck_id': identifier, **result})
        result = {'status': 'success', 'decks': results,
                  **{key: sum(row[key] for row in results) for key in ('updated', 'created', 'unchanged', 'skipped_new')}}
        receipt.response = json.dumps(result, ensure_ascii=False)
        receipt.save()
        return result
