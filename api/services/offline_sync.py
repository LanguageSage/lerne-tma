"""Durable offline batches. A committed request can be retried without duplication."""
import datetime
import hashlib
import json

from fastapi import HTTPException

from api import models
from api.services.collaborative_service import (
    get_effective_user_role, get_user_accessible_deck_ids,
    get_user_accessible_folder_ids, get_batch_collaborative_info,
    _require_can_mutate,
    get_folder_access_map,
)


FIELDS = {
    'folders': ('name', 'parent_id', 'color', 'target_language', 'is_deleted', 'position'),
    'decks': ('name', 'level', 'topic', 'target_language', 'is_deleted', 'is_pinned', 'position', 'folder_id', 'metadata'),
    'cards': ('deck_id', 'front_text', 'back_text', 'context', 'image_path', 'audio_path',
              'audio_back_path', 'video_front_path', 'video_back_path', 'is_deleted',
              'position', 'tags', 'metadata', 'card_type'),
    'progress': ('queue', 'interval', 'ease_factor', 'repetitions', 'lapses', 'step_index', 'next_review', 'last_reviewed', 'flag', 'want_to_learn'),
}

# Keep the projection and wire serializer together. Include raw FK fields so
# accessing deck_id/parent_id/folder_id never resolves a related model.
PULL_FIELDS = {
    name: ('id', *fields, 'created_at', 'updated_at', *(
        ('user_id', 'is_inbox') if name == 'decks' else
        ('user_id',) if name == 'folders' else ()))
    for name, fields in FIELDS.items() if name != 'progress'
}
PULL_FIELDS['progress'] = ('card_id', 'user_id', *FIELDS['progress'], 'created_at', 'updated_at')


def require_access(user_id: int, kind: str, item_id: int, write: bool = True) -> None:
    model = models.TMA_Deck if kind == 'deck' else models.TMA_Folder
    item = model.select(model.id, model.user_id, model.is_deleted).where(model.id == item_id).first()
    # Owners may restore their soft-deleted records. Collaborative lookup
    # intentionally excludes deleted targets; it cannot establish this case.
    if item is not None and item.is_deleted and item.user_id == user_id:
        _require_can_mutate(user_id, kind, item_id, allow_deleted=True)
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
    # Keep fingerprints of batches created by older clients compatible.
    if not payload.get('reviews'):
        payload.pop('reviews', None)
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
                lookup_fields = (model.id, model.deck_id) if name == 'cards' else (model.id,)
                existing = model.select(*lookup_fields).where(model.id == item.id).first() if item.id > 0 else None
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
                            folder = models.TMA_Folder.select(models.TMA_Folder.parent_id).where(models.TMA_Folder.id == ancestor).first()
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
                    if not existing or existing.deck_id != deck_id:
                        require_access(user_id, 'deck', deck_id)
                    values['deck_id'] = deck_id

                # Last committed edit wins across devices; client clock skew cannot hide it.
                values['updated_at'] = now
                if existing:
                    for field, value in values.items():
                        setattr(existing, field, value)
                    existing.save(only=[getattr(model, field) for field in values])
                else:
                    values['created_at'] = now
                    if name != 'cards':
                        values['user_id'] = user_id
                    else:
                        values['source'] = 'user'
                        values['creator_id'] = user_id
                    new_item = model.create(**values)
                    maps[name][str(item.id)] = new_item.id

        study_card_ids = {maps['cards'].get(str(item.card_id), item.card_id)
                          for item in (*request.progress, *request.reviews)}
        study_cards = {card.id: card for card in models.TMA_Card.select(
            models.TMA_Card.id, models.TMA_Card.deck_id).where(models.TMA_Card.id.in_(study_card_ids))} if study_card_ids else {}
        readable_decks = set()

        def require_study_card(card_id):
            card = study_cards.get(card_id)
            if not card:
                raise HTTPException(409, 'Карточка удалена на сервере')
            if card.deck_id not in readable_decks:
                require_access(user_id, 'deck', card.deck_id, write=False)
                readable_decks.add(card.deck_id)

        for item in request.progress:
            card_id = resolve('cards', item.card_id)
            require_study_card(card_id)
            raw_progress = item.model_dump(exclude_unset=True)
            values = {field: raw_progress[field] for field in FIELDS['progress'] if field in raw_progress}
            for field in ('next_review', 'last_reviewed'):
                if field in values:
                    values[field] = timestamp(values[field])
            values['updated_at'] = now
            progress, _ = models.TMAProgress.get_or_create(card_id=card_id, user_id=user_id)
            for field, value in values.items():
                setattr(progress, field, value)
            progress.save()

        for event in request.reviews:
            card_id = resolve('cards', event.card_id)
            require_study_card(card_id)
            if not event.is_extended and event.rating > 3:
                raise HTTPException(422, 'Некорректная оценка')
            models.TMAReviewHistory.create(card_id=card_id, user_id=user_id, rating=event.rating,
                scheduled_interval=event.scheduled_interval, review_time=timestamp(event.review_time))

        response = {'status': 'success', 'mappings': maps, 'review_count': len(request.reviews)}
        receipt.response = json.dumps(response)
        receipt.save()
        return response


def pull_offline(user_id: int) -> dict:
    from api.services.decks import ensure_starter_decks
    from api.services.decks import _learning_key
    user = models.TMAUser.select(models.TMAUser.default_decks_initialized).where(models.TMAUser.user_id == user_id).first()
    if not user or not user.default_decks_initialized:
        ensure_starter_decks(user_id)

    folder_map = get_folder_access_map()
    folder_ids = set(get_user_accessible_folder_ids(user_id, folder_map=folder_map))
    deck_ids = set(get_user_accessible_deck_ids(user_id, folder_map=folder_map, accessible_folder_ids=folder_ids))
    # Owned tombstones must reach devices as well as active shared content.
    folder_ids.update(f.id for f in models.TMA_Folder.select(models.TMA_Folder.id).where(models.TMA_Folder.user_id == user_id))
    deck_ids.update(d.id for d in models.TMA_Deck.select(models.TMA_Deck.id).where(models.TMA_Deck.user_id == user_id))
    folders = list(models.TMA_Folder.select(*(getattr(models.TMA_Folder, f) for f in PULL_FIELDS['folders'])).where(models.TMA_Folder.id.in_(folder_ids)))
    decks = list(models.TMA_Deck.select(*(getattr(models.TMA_Deck, f) for f in PULL_FIELDS['decks'])).where(models.TMA_Deck.id.in_(deck_ids)))
    cards = list(models.TMA_Card.select(*(getattr(models.TMA_Card, f) for f in PULL_FIELDS['cards'])).where(models.TMA_Card.deck_id.in_(deck_ids)))
    progress = list(models.TMAProgress.select(*(getattr(models.TMAProgress, f) for f in PULL_FIELDS['progress'])).where(
        (models.TMAProgress.user_id == user_id) & models.TMAProgress.card_id.in_([c.id for c in cards])))
    roles = get_batch_collaborative_info(user_id, decks=decks, folders=folders, folder_map=folder_map)
    learning_keys = {_learning_key(user_id, deck.id): deck.id for deck in decks}
    learning_states = {learning_keys[row.key]: row.value == '1' for row in models.TMASetting.select(
        models.TMASetting.key, models.TMASetting.value).where(models.TMASetting.key.in_(list(learning_keys)))}

    def serialize(name: str, item) -> dict:
        data = {field: getattr(item, field) for field in PULL_FIELDS[name]}
        for field, value in data.items():
            if isinstance(value, datetime.datetime):
                data[field] = value.isoformat() + 'Z'
        if name in ('decks', 'folders'):
            info = roles.get(name, {}).get(item.id, {})
            data.update(info)
            data['role'] = info.get('role') or ('owner' if item.user_id == user_id else 'viewer')
            data['is_owner'] = data['role'] == 'owner'
        if name == 'decks':
            from api.services.utils import resolve_deck_metadata
            data['is_learning'] = learning_states.get(item.id,
                bool(resolve_deck_metadata(item, resolve_media_urls=False).get('is_learning', False)) if item.user_id == user_id else False)
        return data

    return {'status': 'success', 'protocol': 2,
            'folders': [serialize('folders', f) for f in folders],
            'decks': [serialize('decks', d) for d in decks],
            'cards': [serialize('cards', c) for c in cards],
            'progress': [serialize('progress', p) for p in progress],
            'server_time': datetime.datetime.now(datetime.timezone.utc).isoformat()}
