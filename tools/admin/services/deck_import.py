"""Two-phase local folder imports. Identity is the existing database card_id.

TMAOfflineBatch stores import receipts, never an alternative author identifier.
Existing cards receive only explicit media column updates; text/SRS are untouched.
"""
import datetime
import json
from collections import defaultdict

from fastapi import HTTPException

from api import models, services
from api.services import author_service
from api.services.card_text_update import _digest, _require_account, _claim_receipt
from api.services.collaborative_service import (
    _require_can_mutate, can_edit_audio, get_effective_user_role, touch_deck_and_parent_folders,
)
from api.services.deck_passport import read_metadata
from tools.admin.services.deck_import_media import (
    media_exists, media_path, store_media, storage_configured,
)

from tools.admin.services.deck_import_sources import read_sources, MEDIA_FIELDS


def _destination_key(payload, user_id):
    return f"folder-destination:{user_id}:{_digest(payload['new_folder_name'].strip())}"


def _folder(payload, lock=False):
    folder = None
    if payload.get('target_folder_id'):
        query = models.TMA_Folder.select().where(models.TMA_Folder.id == payload['target_folder_id'],
                                                 models.TMA_Folder.is_deleted == False)
        if lock and models.tma_db.for_update:
            query = query.for_update()
        folder = query.first()
        if not folder:
            raise HTTPException(404, 'Целевая папка не найдена.')
    elif not (payload.get('new_folder_name') or '').strip() or payload['mode'] == 'media':
        raise ValueError('Выберите целевую папку.')
    user_id = author_service.get_effective_user_id(payload.get('user_id'), folder)
    _require_account(user_id)
    if not folder and payload.get('new_folder_name'):
        receipt = models.TMAOfflineBatch.get_or_none(models.TMAOfflineBatch.key == _destination_key(payload, user_id))
        if receipt:
            identifier = json.loads(receipt.response)['folder_id']
            query = models.TMA_Folder.select().where(models.TMA_Folder.id == identifier, models.TMA_Folder.is_deleted == False)
            if lock and models.tma_db.for_update:
                query = query.for_update()
            folder = query.first()
            if not folder:
                raise HTTPException(409, 'Ранее импортированная папка удалена. Выберите другую цель.')
    if folder:
        if payload['mode'] == 'import':
            _require_can_mutate(user_id, 'folder', folder.id)
    return folder, user_id


def build_plan(payload, sources, lock=False):
    documents, hints, links, resources, assets, problems = sources
    problems = list(problems)
    folder, user_id = _folder(payload)
    groups, rows, snapshot, seen_names = [], {}, [], set()
    decisions = payload.get('decisions', {})
    for file, doc in documents.items():
        by_name = defaultdict(list)
        for card in doc['cards']:
            by_name[card['deck_name']].append(card)
        for name, items in by_name.items():
            if name in seen_names:
                problems.append(f'{name}: одинаковые названия в нескольких файлах. Импортируйте раздельно.')
            seen_names.add(name)
            query = models.TMA_Deck.select().where(models.TMA_Deck.folder_id == folder.id,
                        models.TMA_Deck.name == name, models.TMA_Deck.is_deleted == False).order_by(models.TMA_Deck.id) if folder else []
            if lock and folder and models.tma_db.for_update:
                query = query.for_update()
            matches = list(query)
            deck = matches[0] if len(matches) == 1 else None
            if len(matches) > 1:
                problems.append(f'{name}: несколько существующих колод; устраните неоднозначность.')
            if payload['mode'] == 'media' and not deck:
                problems.append(f'{name}: колода не найдена в целевой папке.')
            live = {}
            if deck:
                if get_effective_user_role(user_id, 'deck', deck.id) is None:
                    raise HTTPException(403, 'Access denied')
                if payload['mode'] == 'import':
                    _require_can_mutate(user_id, 'deck', deck.id)
                query = models.TMA_Card.select(models.TMA_Card.id, models.TMA_Card.deck,
                    models.TMA_Card.front_text, models.TMA_Card.creator_id,
                    *[getattr(models.TMA_Card, field) for field in MEDIA_FIELDS.values()]).where(
                    models.TMA_Card.deck_id == deck.id, models.TMA_Card.is_deleted == False).order_by(models.TMA_Card.id)
                if lock and models.tma_db.for_update:
                    query = query.for_update()
                live = {card.id: card for card in query}
            identity = _digest({'name': name, 'cards': items})
            receipt_key = f'folder-source:{folder.id if folder else "new"}:{identity}'
            receipt = models.TMAOfflineBatch.get_or_none(models.TMAOfflineBatch.key == receipt_key) if folder else None
            prior = json.loads(receipt.response) if receipt else {}
            known = dict(zip([str(c['number']) for c in items], prior.get('card_ids', [])))
            group = {'file': file, 'name': name, 'deck_id': deck.id if deck else None,
                     'receipt_key': receipt_key, 'identity': identity, 'items': items,
                     'candidates': [{'id': c.id, 'front': c.front_text[:100]} for c in live.values()], 'rows': []}
            used_ids = set()
            for item in items:
                key = f"{file}#{item['number']}"
                identifier = item.get('card_id') or hints.get(key) or known.get(str(item['number']))
                decision = decisions.get(key)
                error = None
                if item.get('deck_id') and (not deck or item['deck_id'] != deck.id):
                    error = 'deck_id вне целевой колоды'
                if identifier:
                    if identifier not in live or (prior and prior.get('deck_id') != group['deck_id']):
                        error = 'неизвестный или чужой card_id; автоматическая замена ID запрещена'
                    if decision not in (None, str(identifier), identifier, 'skip') and not (known.get(str(item['number'])) and decision == 'new'):
                        error = 'существующий card_id нельзя заменить'
                elif decision not in (None, 'new', 'skip'):
                    try:
                        identifier = int(decision)
                    except (ValueError, TypeError):
                        error = 'неверный выбор карточки'
                    if identifier not in live:
                        error = 'выбранная карточка вне целевой колоды'
                status = 'existing' if identifier in live else 'new'
                if decision == 'skip':
                    status = 'skip'
                    error = None
                elif error:
                    status = 'error'
                elif not identifier and (payload['mode'] == 'media' or (deck and decision != 'new')):
                    status = 'conflict'
                    error = 'выберите существующую карточку' + (' или явно подтвердите создание' if payload['mode'] == 'import' else '')
                if identifier and status != 'skip':
                    if identifier in used_ids:
                        error, status = 'одна карточка сопоставлена нескольким строкам', 'error'
                    used_ids.add(identifier)
                if error:
                    problems.append(f'{key}: {error}')
                row = {'key': key, 'number': item['number'], 'card_id': identifier, 'status': status,
                       'front': item['front'][:160], 'error': error}
                group['rows'].append(row)
                rows[key] = (row, live.get(identifier), group)
            groups.append(group)
            # Snapshot never includes image_data, progress or review history.
            snapshot.append({'deck': {'id': deck.id, 'owner': deck.user_id, 'folder': deck.folder_id,
                                      'metadata': deck.metadata} if deck else None,
                             'cards': [{'id': c.id, 'creator': c.creator_id,
                                        **{f: getattr(c, f) for f in MEDIA_FIELDS.values()}} for c in live.values()]})
    operations = []
    for link in links:
        row, card, group = rows.get(link['card_key'], (None, None, None))
        if not row or row['status'] in ('skip', 'error', 'conflict') or 'asset_key' not in link:
            continue
        role, asset = link['role'], assets[link['asset_key']]
        before = getattr(card, MEDIA_FIELDS[role]) if card else None
        after = media_path(asset)
        choice = payload.get('media_choices', {}).get(link['key'], 'ask')
        if card:
            if role == 'image':
                _require_can_mutate(user_id, 'deck', card.deck_id)
            elif not can_edit_audio(user_id, 'deck', card.deck_id):
                raise HTTPException(403, 'Недостаточно прав для изменения аудио.')
        action = 'unchanged' if before == after else 'attach' if not before else choice
        if choice == 'skip':
            action = 'skip'
        if action == 'ask':
            problems.append(f"{link['key']}: выберите оставить, заменить или пропустить существующее медиа.")
        operations.append({**link, 'before': before, 'after': after, 'action': action})
    resource_ops = []
    for resource in resources:
        group = next((g for g in groups if g['file'] == resource['file'] and g['name'] == resource['deck_name']), None)
        if not group or 'asset_key' not in resource:
            continue
        if group['deck_id']:
            _require_can_mutate(user_id, 'deck', group['deck_id'])
            metadata = json.loads(models.TMA_Deck.get_by_id(group['deck_id']).metadata or '{}')
            if not isinstance(metadata, dict) or not isinstance(metadata.get('resources', []), list) or any(
                    not isinstance(entry, dict) for entry in metadata.get('resources', [])):
                problems.append(f"{group['name']}: повреждены ресурсы колоды; исправьте их перед добавлением аудио.")
        elif not any(row['status'] == 'new' for row in group['rows']):
            problems.append(f"{group['name']}: для учебного аудио нужна существующая колода или новые карточки.")
        resource_ops.append({**resource, 'url': media_path(assets[resource['asset_key']])})
    if not groups:
        problems.append('В выбранных файлах нет карточек.')
    needs_audio = any(op['role'] != 'image' and op['action'] in ('attach', 'replace') for op in operations) or bool(resource_ops)
    if needs_audio and not storage_configured():
        problems.append('Для аудио настройте существующий Supabase Storage: SUPABASE_URL и SUPABASE_KEY.')
    if lock:
        # Match maintenance flows: lock decks/cards before their parent folder.
        folder, _ = _folder(payload, lock=True)
    fingerprint = _digest({'payload': {k: v for k, v in payload.items() if k not in ('preview_token', 'request_id', 'confirmed')},
                           'documents': documents, 'hints': hints, 'links': links, 'resources': resources,
                           'groups': groups, 'snapshot': snapshot, 'operations': operations, 'resource_ops': resource_ops,
                           'assets': [{k: v for k, v in a.items() if k != 'data'} for a in assets.values()],
                           'folder_owner': folder.user_id if folder else None, 'user_id': user_id})
    return {'groups': groups, 'operations': operations, 'resources': resource_ops, 'problems': list(dict.fromkeys(problems)),
            'can_apply': not problems, 'preview_token': fingerprint, 'user_id': user_id,
            'folder_id': folder.id if folder else None, 'folder_name': folder.name if folder else payload.get('new_folder_name'),
            'assets': [{**{k: v for k, v in a.items() if k != 'data'}, 'reused': media_exists(a)} for a in assets.values()],
            'created_cards': sum(r['status'] == 'new' for g in groups for r in g['rows']),
            'existing_cards': sum(r['status'] == 'existing' for g in groups for r in g['rows'])}


def apply_import(payload, sources):
    if not payload.get('confirmed') or not payload.get('preview_token') or not payload.get('request_id'):
        raise ValueError('Требуются предпросмотр и явное подтверждение.')
    plan = build_plan(payload, sources)
    # Response-loss replay is checked before freshness. Always recheck access first.
    key = f"folder-import:{plan['user_id']}:{payload['request_id']}"
    prior = models.TMAOfflineBatch.get_or_none(models.TMAOfflineBatch.key == key)
    stable_hash = _digest({'payload': {k: v for k, v in payload.items() if k != 'request_id'},
                           'sources': sources[0], 'hints': sources[1], 'links': sources[2],
                           'resources': sources[3], 'hashes': [a['sha256'] for a in sources[4].values()]})
    if prior:
        if prior.payload_hash != stable_hash:
            raise HTTPException(409, 'Запрос с этим request_id уже изменён.')
        result = json.loads(prior.response)
        if 'deck_ids' not in result:
            keys = [f"folder-source:{result['folder_id']}:{group['identity']}" for group in plan['groups']]
            receipts = models.TMAOfflineBatch.select().where(models.TMAOfflineBatch.key.in_(keys))
            result['deck_ids'] = sorted({json.loads(row.response)['deck_id'] for row in receipts})
        return result
    if not plan['can_apply']:
        raise HTTPException(422, {'problems': plan['problems']})
    if plan['preview_token'] != payload['preview_token']:
        raise HTTPException(409, 'Предпросмотр устарел. Выполните его повторно.')
    # Only actionable selected assets reach storage; no network in the DB transaction.
    needed = {tuple(op['asset_key']) for op in plan['operations'] if op['action'] in ('attach', 'replace')}
    needed.update(tuple(op['asset_key']) for op in plan['resources'])
    for asset_key in sorted(needed):
        store_media(sources[4][asset_key])
    options = {'lock_type': 'IMMEDIATE'} if not models.tma_db.for_update else {}
    with models.tma_db.atomic(**options):
        current = build_plan(payload, sources, lock=True)
        receipt, replay = _claim_receipt(key, stable_hash)
        if replay is not None:
            return replay
        if not current['can_apply'] or current['preview_token'] != payload['preview_token']:
            raise HTTPException(409, 'Предпросмотр устарел. Привязки не изменены.')
        folder_id = current['folder_id']
        if not folder_id:
            destination, replay = _claim_receipt(_destination_key(payload, plan['user_id']), _digest(payload['new_folder_name'].strip()))
            if replay is not None:
                raise HTTPException(409, 'Целевая папка уже создана. Повторите предпросмотр.')
            folder_id = services.create_folder(payload['new_folder_name'].strip(), plan['user_id']).id
            destination.response = json.dumps({'folder_id': folder_id})
            destination.save()
        updated = created = 0
        targets, target_decks, touched = {}, {}, set()
        for group in current['groups']:
            deck_id = group['deck_id']
            if not deck_id:
                if not any(row['status'] == 'new' for row in group['rows']):
                    continue
                deck = services.create_deck(group['name'], plan['user_id'], folder_id)
                deck_id = deck.id
                for passport in sources[0][group['file']]['passports']:
                    if passport['deck_name'] == group['name']:
                        author_service._save_passport(deck, passport['passport'])
            targets[(group['file'], group['name'])] = deck_id
            new_rows = [(item, row) for item, row in zip(group['items'], group['rows']) if row['status'] == 'new']
            if new_rows:
                data = []
                for item, _ in new_rows:
                    data.append({'deck_id': deck_id, 'front_text': item['front'], 'back_text': item['back'],
                                 'context': item.get('context', ''), 'topics': item.get('topics', ''),
                                 'tags': item.get('level') or '', 'level': item.get('level'),
                                 'card_type': item.get('card_type') or 'standard',
                                 **({'metadata': item['metadata']} if 'metadata' in item else {})})
                saved = services.bulk_save_cards(data, plan['user_id'])
                if saved.get('failed_count') or len(saved['cards']) != len(data):
                    raise ValueError('Ошибка сохранения; импорт полностью отменён.')
                for (_, row), card in zip(new_rows, saved['cards']):
                    row['card_id'] = card['id']
                created += len(data)
            for row in group['rows']:
                if row['status'] in ('new', 'existing'):
                    targets[row['key']] = row['card_id']
                    target_decks[row['key']] = deck_id
            source_key = f"folder-source:{folder_id}:{group['identity']}"
            if not models.TMAOfflineBatch.select().where(models.TMAOfflineBatch.key == source_key).exists():
                models.TMAOfflineBatch.create(key=source_key, payload_hash=group['identity'], response=json.dumps({
                    'deck_id': deck_id, 'card_ids': [targets.get(row['key']) for row in group['rows']]}))
        now = datetime.datetime.now()
        for op in current['operations']:
            if op['action'] not in ('attach', 'replace'):
                continue
            identifier = targets[op['card_key']]
            deck_id = target_decks[op['card_key']]
            affected = models.TMA_Card.update(**{MEDIA_FIELDS[op['role']]: op['after'], 'updated_at': now}).where(
                models.TMA_Card.id == identifier, models.TMA_Card.deck_id == deck_id,
                models.TMA_Card.is_deleted == False).execute()
            if affected != 1:
                raise HTTPException(409, 'Карточка изменилась. Привязки не сохранены.')
            updated += 1
            touched.add(deck_id)
        for op in current['resources']:
            deck_id = targets[(op['file'], op['deck_name'])]
            deck = models.TMA_Deck.get_by_id(deck_id)
            metadata = read_metadata(deck.metadata)
            entries = metadata.setdefault('resources', [])
            if not any(r.get('type') == 'audio' and r.get('url') == op['url'] for r in entries):
                entries.append({'type': 'audio', 'url': op['url'], 'title': op['title']})
                models.TMA_Deck.update(metadata=json.dumps(metadata, ensure_ascii=False), updated_at=now).where(
                    models.TMA_Deck.id == deck_id).execute()
                touched.add(deck_id)
        for deck_id in sorted(touched):
            touch_deck_and_parent_folders(deck_id)
        result = {'status': 'success', 'created_cards': created, 'updated_media': updated,
                  'folder_id': folder_id, 'folder_name': current['folder_name'],
                  'deck_ids': sorted(set(target_decks.values()))}
        receipt.response = json.dumps(result, ensure_ascii=False)
        receipt.save()
        return result
