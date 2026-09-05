"""Durable offline batches. A committed request can be retried without duplication."""
import datetime
import hashlib
import json

from fastapi import HTTPException

from api import models
from api.services.collaborative_service import (
    get_effective_user_role, get_user_accessible_deck_ids,
    get_user_accessible_folder_ids, get_batch_collaborative_info,
)


FIELDS = {
    'folders': ('name', 'parent_id', 'color', 'target_language', 'is_deleted', 'position'),
    'decks': ('name', 'level', 'topic', 'target_language', 'is_deleted', 'is_pinned', 'position', 'folder_id', 'metadata'),
    'cards': ('deck_id', 'front_text', 'back_text', 'context', 'image_path', 'audio_path',
              'audio_back_path', 'video_front_path', 'video_back_path', 'is_deleted',
              'flag', 'position', 'tags', 'metadata', 'card_type'),
    'progress': ('queue', 'interval', 'ease_factor', 'repetitions', 'lapses', 'step_index', 'next_review', 'last_reviewed'),
}


def require_access(user_id: int, kind: str, item_id: int, write: bool = True) -> None:
    model = models.TMA_Deck if kind == 'deck' else models.TMA_Folder
    item = model.get_or_none(model.id == item_id)
    if item and item.user_id == user_id:
        return
    role = get_effective_user_role(user_id, kind, item_id)
    if not role or (write and role not in ('owner', 'editor', 'admin')):
        raise HTTPException(403, 'Нет доступа к записи. Локальные изменения сохранены.')


def timestamp(value: str | None) -> datetime.datetime | None:
    if not value:
        return None
    parsed = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo:
        parsed = parsed.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    return parsed


def push_offline(request, user_id: int) -> dict:
    payload = request.model_dump(mode='json')
    fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    key = f'{user_id}:{request.request_id}'
    maps = {'folders': {}, 'decks': {}, 'cards': {}}
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    table_map = {'folders': models.TMA_Folder, 'decks': models.TMA_Deck, 'cards': models.TMA_Card}

    def resolve(kind: str, item_id: int | None) -> int | None:
        if item_id is None:
            return None
        if item_id < 0:
            resolved = maps[kind].get(str(item_id))
            if resolved is None:
                raise HTTPException(422, 'Не найдена родительская запись в пакете синхронизации')
            return resolved
        return item_id

    with models.tma_db.atomic():
        # The unique key serializes duplicate requests, including across server workers.
        receipt, created = models.TMAOfflineBatch.get_or_create(
            key=key, defaults={'payload_hash': fingerprint, 'response': ''})
        if not created:
            if receipt.payload_hash != fingerprint:
                raise HTTPException(409, 'Идентификатор пакета уже использован с другими данными')
            return json.loads(receipt.response)

        folders = list(request.folders)
        sorted_folders = []
        while folders:
            remaining = {f.id for f in folders}
            ready = [f for f in folders if f.parent_id not in remaining]
            if not ready:
                raise HTTPException(422, 'Папки образуют цикл')
            sorted_folders.extend(ready)
            folders = [f for f in folders if f not in ready]

        for name, items in (('folders', sorted_folders), ('decks', request.decks), ('cards', request.cards)):
            model = table_map[name]
            if len({item.id for item in items}) != len(items):
                raise HTTPException(422, 'Повторяющиеся идентификаторы в пакете')
            for item in items:
                raw = item.model_dump(exclude_unset=True)
                values = {field: raw[field] for field in FIELDS[name] if field in raw}
                existing = model.get_or_none(model.id == item.id) if item.id > 0 else None
                if item.id >= 0 and existing is None:
                    raise HTTPException(409, 'Запись удалена на сервере. Локальные изменения сохранены.')
                if existing:
                    if name == 'cards':
                        require_access(user_id, 'deck', existing.deck_id)
                    else:
                        require_access(user_id, name[:-1], existing.id)

                if name == 'folders':
                    parent_id = resolve('folders', item.parent_id)
                    if parent_id:
                        require_access(user_id, 'folder', parent_id)
                        seen = {existing.id} if existing else set()
                        ancestor = parent_id
                        while ancestor:
                            if ancestor in seen:
                                raise HTTPException(422, 'Папки образуют цикл')
                            seen.add(ancestor)
                            folder = models.TMA_Folder.get_or_none(models.TMA_Folder.id == ancestor)
                            ancestor = folder.parent_id if folder else None
                    values['parent_id'] = parent_id
                elif name == 'decks':
                    folder_id = resolve('folders', item.folder_id)
                    if folder_id:
                        require_access(user_id, 'folder', folder_id)
                    values['folder_id'] = folder_id
                    if values.get('metadata') is None:
                        values.pop('metadata', None)
                else:
                    deck_id = resolve('decks', item.deck_id)
                    if not deck_id:
                        raise HTTPException(422, 'Карточке нужна колода')
                    require_access(user_id, 'deck', deck_id)
                    values['deck_id'] = deck_id

                # Last committed edit wins across devices; client clock skew cannot hide it.
                values['updated_at'] = now
                if existing:
                    for field, value in values.items():
                        setattr(existing, field, value)
                    existing.save()
                else:
                    values['created_at'] = now
                    if name != 'cards':
                        values['user_id'] = user_id
                    else:
                        values['source'] = 'user'
                        values['creator_id'] = user_id
                    new_item = model.create(**values)
                    maps[name][str(item.id)] = new_item.id

        for item in request.progress:
            card_id = resolve('cards', item.card_id)
            card = models.TMA_Card.get_or_none(models.TMA_Card.id == card_id)
            if not card:
                raise HTTPException(409, 'Карточка удалена на сервере')
            require_access(user_id, 'deck', card.deck_id, write=False)
            values = {field: getattr(item, field) for field in FIELDS['progress']}
            for field in ('next_review', 'last_reviewed'):
                values[field] = timestamp(values[field])
            values['updated_at'] = now
            progress, _ = models.TMAProgress.get_or_create(card_id=card_id, user_id=user_id)
            for field, value in values.items():
                setattr(progress, field, value)
            progress.save()

        response = {'status': 'success', 'mappings': maps}
        receipt.response = json.dumps(response)
        receipt.save()
        return response


def pull_offline(user_id: int) -> dict:
    from api.services.decks import ensure_starter_decks
    user = models.TMAUser.get_or_none(models.TMAUser.user_id == user_id)
    if not user or not user.default_decks_initialized:
        ensure_starter_decks(user_id)

    folder_ids = set(get_user_accessible_folder_ids(user_id))
    deck_ids = set(get_user_accessible_deck_ids(user_id))
    # Owned tombstones must reach devices as well as active shared content.
    folder_ids.update(f.id for f in models.TMA_Folder.select(models.TMA_Folder.id).where(models.TMA_Folder.user_id == user_id))
    deck_ids.update(d.id for d in models.TMA_Deck.select(models.TMA_Deck.id).where(models.TMA_Deck.user_id == user_id))
    folders = list(models.TMA_Folder.select().where(models.TMA_Folder.id.in_(folder_ids)))
    decks = list(models.TMA_Deck.select().where(models.TMA_Deck.id.in_(deck_ids)))
    cards = list(models.TMA_Card.select().where(models.TMA_Card.deck_id.in_(deck_ids)))
    progress = list(models.TMAProgress.select().where(
        (models.TMAProgress.user_id == user_id) & models.TMAProgress.card_id.in_([c.id for c in cards])))
    roles = get_batch_collaborative_info(user_id, decks=decks, folders=folders)

    def serialize(name: str, item) -> dict:
        fields = ['id', *FIELDS[name], 'created_at', 'updated_at']
        if name == 'progress':
            fields = ['card_id', 'user_id', *FIELDS[name], 'created_at', 'updated_at']
        elif name in ('decks', 'folders'):
            fields.append('user_id')
        if name == 'decks':
            fields.append('is_inbox')
        data = {field: getattr(item, field) for field in fields}
        for field, value in data.items():
            if isinstance(value, datetime.datetime):
                data[field] = value.isoformat() + 'Z'
        if name in ('decks', 'folders'):
            info = roles.get(name, {}).get(item.id, {})
            data.update(info)
            data['role'] = info.get('role') or ('owner' if item.user_id == user_id else 'viewer')
            data['is_owner'] = data['role'] == 'owner'
        return data

    return {'status': 'success', 'protocol': 2,
            'folders': [serialize('folders', f) for f in folders],
            'decks': [serialize('decks', d) for d in decks],
            'cards': [serialize('cards', c) for c in cards],
            'progress': [serialize('progress', p) for p in progress],
            'server_time': datetime.datetime.now(datetime.timezone.utc).isoformat()}
