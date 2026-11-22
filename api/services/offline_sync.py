"""Durable offline batches. A committed request can be retried without duplication."""
import datetime

from fastapi import HTTPException
from peewee import PostgresqlDatabase, SQL, fn

from api import models
from api.services.receipts import _claim_receipt, _digest, batch_digest, finish_receipt
from api.services.collaborative_service import (
    get_effective_user_role, get_user_accessible_deck_ids,
    get_user_accessible_folder_ids, get_batch_collaborative_info,
    _require_can_mutate,
    get_folder_access_map,
    is_deck_active, is_folder_chain_active,
)


FIELDS = {
    'folders': ('name', 'parent_id', 'color', 'target_language', 'is_deleted', 'position'),
    'decks': ('name', 'level', 'topic', 'target_language', 'is_deleted', 'is_pinned', 'position', 'folder_id', 'metadata'),
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


def push_offline(request, user_id: int, *, drain_legacy: bool = False) -> dict:
    payload = request.model_dump(mode='json')
    payload.pop('drain_bases', None)  # Never change the hash of a durable batch.
    # Keep fingerprints of batches created by older clients compatible.
    if not payload.get('reviews'):
        payload.pop('reviews', None)
    for event in payload.get('reviews', []):
        if event.get('action_id') is None:
            event.pop('action_id', None)
    for progress in payload.get('progress', []):
        if not progress.get('flag_only'):
            progress.pop('flag_only', None)  # Preserve receipts from before 6B.6.
    fingerprint = batch_digest(payload)
    key = f'{user_id}:{request.request_id}'
    maps = {'folders': {}, 'decks': {}, 'cards': {}}
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    table_map = {'folders': models.TMA_Folder, 'decks': models.TMA_Deck, 'cards': models.TMA_Card}

    def guard_existing(kind, identifier, current, values, *, required=False):
        if not (drain_legacy or required) or not current:
            return
        key = f'{kind}:{identifier}'
        if key in request.drain_bases:
            try:
                if request.drain_bases[key] == '':
                    raise ValueError('Empty base')
                base = timestamp(request.drain_bases[key])
            except ValueError:
                raise HTTPException(422, {'code': 'legacy_invalid_base'}) from None
            if base != current.updated_at:
                raise HTTPException(409, {'code': 'legacy_revision_conflict', 'entity': kind, 'id': identifier})
        elif any(getattr(current, field) != value for field, value in values.items()):
            raise HTTPException(409, {'code': 'legacy_base_unknown', 'entity': kind, 'id': identifier})

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
        receipt, replay = _claim_receipt(
            key, fingerprint, 'Идентификатор пакета уже использован с другими данными')
        if replay is not None:
            return replay

        if request.cards:
            raise HTTPException(409, {'code': 'legacy_queue_requires_recovery',
                'message': 'Legacy card queue retained; use the explicit recovery tools.'})

        from .media import audio_references, validate_new_audio_paths
        new_audio = set()

        folders = list(request.folders)
        sorted_folders = []
        while folders:
            remaining = {f.id for f in folders}
            ready = [f for f in folders if f.parent_id not in remaining]
            if not ready:
                raise HTTPException(422, 'Папки образуют цикл')
            sorted_folders.extend(ready)
            folders = [f for f in folders if f not in ready]

        deleted_in_batch_folders = set()
        for name, items in (('folders', sorted_folders), ('decks', request.decks)):
            model = table_map[name]
            if len({item.id for item in items}) != len(items):
                raise HTTPException(422, 'Повторяющиеся идентификаторы в пакете')
            for item in items:
                raw = item.model_dump(exclude_unset=True)
                values = {field: raw[field] for field in FIELDS[name] if field in raw}
                lookup_fields = (model.id,)
                if name == 'decks':
                    lookup_fields = (model.id, model.metadata, model.folder_id, model.is_deleted)
                elif name == 'folders':
                    lookup_fields = (model.id, model.user_id, model.parent_id, model.is_deleted)
                if drain_legacy:
                    lookup_fields = (model.id, *(getattr(model, field) for field in FIELDS[name]), model.updated_at,
                                     *((model.user_id,) if name == 'folders' else ()))
                lookup = model.select(*lookup_fields)
                if drain_legacy:
                    lookup = lookup.for_update()
                existing = lookup.where(model.id == item.id).first() if item.id > 0 else None
                if item.id >= 0 and existing is None:
                    raise HTTPException(409, 'Запись удалена на сервере. Локальные изменения сохранены.')
                if existing:
                    require_access(user_id, name[:-1], existing.id)
                    if name == 'folders' and values.get('is_deleted') is True and not existing.is_deleted and existing.user_id != user_id:
                        raise HTTPException(403, 'Только владелец может удалить папку')

                restoring = bool(existing and existing.is_deleted and values.get('is_deleted') is False)
                effective_deleted = values.get('is_deleted', existing.is_deleted if existing else False)

                if name == 'folders':
                    parent_id = resolve('folders', item.parent_id) if 'parent_id' in values else (existing.parent_id if existing else None)
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
                        if restoring or (not effective_deleted and parent_id not in deleted_in_batch_folders):
                            if not is_folder_chain_active(parent_id):
                                raise HTTPException(409, {'code': 'parent_folder_deleted', 'message': 'Сначала восстановите родительскую папку.'})
                    if 'parent_id' in values:
                        values['parent_id'] = parent_id
                elif name == 'decks':
                    folder_id = resolve('folders', item.folder_id) if 'folder_id' in values else (existing.folder_id if existing else None)
                    if folder_id:
                        require_access(user_id, 'folder', folder_id)
                        if restoring or (not effective_deleted and folder_id not in deleted_in_batch_folders):
                            if not is_folder_chain_active(folder_id):
                                raise HTTPException(409, {'code': 'parent_folder_deleted', 'message': 'Сначала восстановите родительскую папку.'})
                    if 'folder_id' in values:
                        values['folder_id'] = folder_id
                    if values.get('metadata') is None:
                        values.pop('metadata', None)
                    elif 'metadata' in values:
                        new_audio.update(audio_references(values['metadata']) - audio_references(existing.metadata if existing else None))
                guard_existing(name, item.id, existing, values)
                # Original push retains its contract; guarded drain checks the
                # actual server base, never the client's edit timestamp.
                values['updated_at'] = now
                if existing:
                    query = model.update(**values).where(model.id == existing.id)
                    if name == 'decks' and 'metadata' in values:
                        query = query.where(model.metadata == existing.metadata)
                    if not query.execute():
                        raise HTTPException(409, 'Запись изменена на сервере. Повторите синхронизацию.')
                    if name == 'folders' and effective_deleted:
                        deleted_in_batch_folders.add(existing.id)
                else:
                    values['created_at'] = now
                    values['user_id'] = user_id
                    new_item = model.create(**values)
                    maps[name][str(item.id)] = new_item.id
                    if name == 'folders' and effective_deleted:
                        deleted_in_batch_folders.add(new_item.id)

        # Every deck has passed authorization. Validation stays before COMMIT;
        # a missing object rolls back all rows and the receipt together.
        validate_new_audio_paths(new_audio)

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

        action_cards = {resolve('cards', event.card_id) for event in request.reviews if event.action_id}
        for item in request.progress:
            card_id = resolve('cards', item.card_id)
            require_study_card(card_id)
            raw_progress = item.model_dump(exclude_unset=True)
            values = {field: raw_progress[field] for field in FIELDS['progress'] if field in raw_progress}
            if item.flag_only:
                # Changing a personal label never replaces another device's SRS
                # or bookmark with the stale offline snapshot carried alongside it.
                values = {field: value for field, value in values.items() if field == 'flag'}
            elif card_id in action_cards:
                # UUID events apply once against authoritative SRS; stale fallback
                # snapshots must never overwrite an already committed grade.
                values = {field: value for field, value in values.items() if field in ('flag', 'want_to_learn')}
                if not values:
                    continue
            for field in ('next_review', 'last_reviewed'):
                if field in values:
                    values[field] = timestamp(values[field])
            progress, created_progress = models.TMAProgress.get_or_create(card_id=card_id, user_id=user_id)
            # A snapshot is not a review action. Lock/check its observed base
            # even on native push, otherwise a delayed offline reset can erase
            # grades committed by another device after that snapshot was taken.
            if not created_progress and item.card_id > 0 and not item.flag_only:
                progress = models.TMAProgress.select().where(models.TMAProgress.id == progress.id).for_update().get()
                checked = values if drain_legacy else {
                    field: value for field, value in values.items() if field not in ('flag', 'want_to_learn')}
                guard_existing('progress', item.card_id, progress, checked,
                               required=card_id not in action_cards)
            values['updated_at'] = now
            for field, value in values.items():
                setattr(progress, field, value)
            progress.save()

        for event in sorted(request.reviews, key=lambda event: timestamp(event.review_time)):
            card_id = resolve('cards', event.card_id)
            require_study_card(card_id)
            if not event.is_extended and event.rating > 3:
                raise HTTPException(422, 'Некорректная оценка')
            if event.action_id:
                from api.services.study import update_card_progress
                update_card_progress(card_id, user_id, event.rating, event.is_extended,
                                     event.review_context, str(event.action_id), timestamp(event.review_time))
                continue
            models.TMAReviewHistory.create(card_id=card_id, user_id=user_id, rating=event.rating,
                scheduled_interval=event.scheduled_interval, review_time=timestamp(event.review_time))

        response = {'status': 'success', 'mappings': maps, 'review_count': len(request.reviews)}
        if drain_legacy or request.progress:
            # Receipt-owned commit versions let a newer local edit rebase only
            # across this acknowledged write, never across an unseen peer edit.
            versions = {}
            for name, items in (('folders', request.folders), ('decks', request.decks), ('cards', request.cards), ('progress', request.progress)):
                if not items:
                    continue
                model = models.TMAProgress if name == 'progress' else table_map[name]
                originals = [item.card_id if name == 'progress' else item.id for item in items]
                resolved = {original: maps['cards' if name == 'progress' else name].get(str(original), original) for original in originals}
                identity = model.card_id if name == 'progress' else model.id
                query = model.select(identity, model.updated_at).where(identity.in_(list(resolved.values())))
                if name == 'progress':
                    query = query.where(model.user_id == user_id)
                current = {getattr(row, identity.name): row.updated_at for row in query}
                for original, identifier in resolved.items():
                    value = current[identifier]
                    versions[f'{name}:{original}'] = value.isoformat() + 'Z' if value else None
            response['versions'] = versions
        return finish_receipt(receipt, response)


def pull_offline(user_id: int, snapshot_version: str | None = None, content_version: str | None = None) -> dict:
    from api.services.decks import ensure_starter_decks
    user = models.TMAUser.select(models.TMAUser.default_decks_initialized).where(models.TMAUser.user_id == user_id).first()
    if not user or not user.default_decks_initialized:
        ensure_starter_decks(user_id)

    if snapshot_version is None:
        return _read_snapshot(user_id, None, postgres=False)

    database = models.tma_db.obj
    postgres = isinstance(database, PostgresqlDatabase)
    # Scope, row versions, and any returned payload must see the same commits.
    with database.atomic(**({'isolation_level': 'REPEATABLE READ'} if postgres else {})):
        return _read_snapshot(user_id, snapshot_version, postgres=postgres, content_version=content_version)


def _row_versions(query, model):
    # MVCC versions detect even writes without updated_at, and the ordered
    # set detects hard deletes/moves without reading large card content.
    stamp = fn.CONCAT_WS(':', model.id, SQL('xmin::text'), SQL('ctid::text'), model.updated_at)
    return query.select(fn.MD5(fn.STRING_AGG(stamp, ',').order_by(model.id))).scalar()


def _deck_summary_versions(user_id, decks, now, folder_map=None):
    from api.services.decks import get_library_update_sources

    card = models.TMA_Card
    personal = models.TMAProgress
    active_decks = [deck for deck in decks if is_deck_active(deck, folder_map=folder_map)]
    sources = get_library_update_sources({deck.name for deck in active_decks})
    due_by_deck = (personal.select(card.deck_id, fn.COUNT(personal.id))
                   .join(card, on=(personal.card_id == card.id))
                   .where(personal.user_id == user_id, personal.queue == 'review', personal.next_review <= now,
                          card.deck_id.in_([deck.id for deck in active_decks]),
                          card.is_deleted == False, card.content_v2.is_null(False))
                   .group_by(card.deck_id).order_by(card.deck_id).tuples())
    catalogue = {name: [updated_at.isoformat() if updated_at else None, count]
                 for name, (updated_at, count) in sources.items()}
    return _digest([catalogue, list(due_by_deck)]), _digest(catalogue)


def _read_snapshot(user_id: int, snapshot_version: str | None, *, postgres: bool,
                   content_version: str | None = None) -> dict:
    from api.services.decks import _learning_key
    from api.services.sync_generation import generation_state

    folder_map = get_folder_access_map()
    folder_ids = set(get_user_accessible_folder_ids(user_id, folder_map=folder_map))
    deck_ids = set(get_user_accessible_deck_ids(user_id, folder_map=folder_map, accessible_folder_ids=folder_ids))
    # Owned tombstones must reach devices as well as active shared content.
    owned_folders = list(models.TMA_Folder.select(models.TMA_Folder.id).where(models.TMA_Folder.user_id == user_id))
    folder_ids.update(f.id for f in owned_folders)
    owned_decks = list(models.TMA_Deck.select(models.TMA_Deck.id, models.TMA_Deck.folder_id).where(models.TMA_Deck.user_id == user_id))
    deck_ids.update(
        d.id for d in owned_decks
        if d.folder_id is None or d.folder_id in folder_ids or d.folder_id in folder_map
    )
    folders = list(models.TMA_Folder.select(*(getattr(models.TMA_Folder, f) for f in PULL_FIELDS['folders'])).where(models.TMA_Folder.id.in_(folder_ids)))
    decks = list(models.TMA_Deck.select(*(getattr(models.TMA_Deck, f) for f in PULL_FIELDS['decks'])).where(models.TMA_Deck.id.in_(deck_ids)))
    from api.services.structured_card_api import content_response
    card_fields = ('id', 'deck_id', 'is_deleted', 'position', 'created_at', 'updated_at',
                   'image_path', 'audio_path', 'audio_back_path', 'video_front_path', 'video_back_path')
    card = models.TMA_Card
    personal = models.TMAProgress
    cards = card.select(card.content_v2, *(getattr(card, f) for f in card_fields)).where(
        card.deck_id.in_(deck_ids), card.content_v2.is_null(False))
    progress = personal.select(*(getattr(personal, f) for f in PULL_FIELDS['progress'])).where(personal.user_id == user_id)
    roles = get_batch_collaborative_info(user_id, decks=decks, folders=folders, folder_map=folder_map)
    learning_keys = {_learning_key(user_id, deck.id): deck.id for deck in decks}
    learning_states = {learning_keys[row.key]: row.value == '1' for row in models.TMASetting.select(
        models.TMASetting.key, models.TMASetting.value).where(models.TMASetting.key.in_(list(learning_keys)))}

    def serialize(name: str, item) -> dict:
        fields = card_fields if name == 'cards' else PULL_FIELDS[name]
        data = {field: getattr(item, field) for field in fields}
        if name == 'cards':
            data.update(content_response(item))
        for field, value in data.items():
            if isinstance(value, datetime.datetime):
                data[field] = value.isoformat() + 'Z'
        if name in ('decks', 'folders'):
            info = roles.get(name, {}).get(item.id, {})
            data.update(info)
            data['role'] = info.get('role') or ('owner' if item.user_id == user_id else 'viewer')
            data['is_owner'] = data['role'] == 'owner'
        if name == 'decks':
            # Personal preference only; canonical metadata cannot opt a user in.
            data['is_learning'] = learning_states.get(item.id, False)
        return data

    def read_study_rows():
        card_rows = list(cards.order_by(card.id))
        progress_rows = progress.where(personal.card_id.in_([c.id for c in card_rows])).order_by(personal.id)
        return [[serialize('cards', c) for c in card_rows], [serialize('progress', p) for p in progress_rows]]

    library = {'folders': [serialize('folders', f) for f in sorted(folders, key=lambda row: row.id)],
               'decks': [serialize('decks', d) for d in sorted(decks, key=lambda row: row.id)]}
    result = {'status': 'success', 'protocol': 2, **generation_state(), 'card_schema': 2}
    result['server_time'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    study_rows = None
    if snapshot_version is not None:
        result['deck_summary_version'], catalogue_version = _deck_summary_versions(user_id, decks, datetime.datetime.now(), folder_map=folder_map)
        scoped_progress = progress.where(personal.card_id.in_(cards.select(card.id)))
        if postgres:
            rows = [_row_versions(cards, card), _row_versions(scoped_progress, personal)]
        else:
            # SQLite test/dev fixtures use the projected data as their revision.
            study_rows = rows = read_study_rows()
        # Bump the format number when the card/progress wire projection changes.
        scope = [1, user_id, result['server_generation'], library]
        version = _digest([*scope, rows])
        result['snapshot_version'] = version
        if content_version is not None:
            result['content_version'] = _digest([*scope, rows[0]])
            result['catalogue_version'] = catalogue_version
        same_content = content_version and content_version == result['content_version']
        if version == snapshot_version and (content_version is None or same_content):
            return {**result, 'status': 'unchanged'}
        if same_content:
            progress_rows = study_rows[1] if study_rows is not None else [
                serialize('progress', row) for row in scoped_progress.order_by(personal.id)]
            return {**result, 'status': 'progress_only', 'progress': progress_rows}

    serialized_cards, serialized_progress = study_rows if study_rows is not None else read_study_rows()
    return {**result, **library, 'cards': serialized_cards, 'progress': serialized_progress}
