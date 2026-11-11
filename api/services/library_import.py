"""Copy canonical library material without changing study progress."""
import datetime
import json
import logging
from collections import defaultdict, deque

from fastapi import HTTPException
from peewee import PostgresqlDatabase, fn

from ..models import TMA_Deck, TMA_Card, TMAUser, Deck, Card, tma_db
from .utils import add_to_history

logger = logging.getLogger('api.services.decks')


def _require_library_schema():
    database = tma_db.obj
    if not isinstance(database, PostgresqlDatabase) or not any(
        column.name == 'content_v2' and column.data_type == 'jsonb' for column in database.get_columns('card')
    ):
        raise HTTPException(409, {'code': 'library_requires_migration'})


def _active_cards(model, deck_id):
    return list(model.select().where(model.deck == deck_id, model.is_deleted == False)
                .order_by(model.position, model.id))


def _copy_content(source_model, source_id, target_model, target_id, *, replace=False, creator=None):
    from .structured_card_api import MEDIA_PATHS
    from .structured_card_storage import decode_v2_content

    source = _active_cards(source_model, source_id)
    target = _active_cards(target_model, target_id)
    available = defaultdict(deque)

    def key(card):
        if card.content_v2 is None:
            raise HTTPException(409, {'code': 'card_requires_migration', 'card_id': card.id})
        return json.dumps(decode_v2_content(card.content_v2).model_dump(mode='json'), sort_keys=True)

    source_keys = [key(card) for card in source]
    for card in target:
        available[key(card)].append(card)

    position = target_model.select(fn.MAX(target_model.position)).where(
        target_model.deck == target_id, target_model.is_deleted == False).scalar() or 0
    now = datetime.datetime.now()
    for order, (card, fingerprint) in enumerate(zip(source, source_keys, strict=True), 1):
        fields = {field: getattr(card, field) for field in MEDIA_PATHS}
        if available[fingerprint]:
            previous = available[fingerprint].popleft()
            media = {field: value for field, value in fields.items() if value and
                     (replace or not getattr(previous, field))}
            if replace or media:
                order_fields = {'position': order} if replace else {}
                target_model.update(updated_at=now, **order_fields, **media).where(
                    target_model.id == previous.id).execute()
            continue
        position += 1
        row = dict(deck=target_id, content_v2=card.content_v2, card_type=None, source='library',
                   position=order if replace else position, updated_at=now,
                   history=add_to_history('[]', 'Imported from library'), **fields)
        if target_model is TMA_Card:
            row['creator_id'] = creator
        target_model.create(**row)
    if replace:
        unused = [card.id for matching in available.values() for card in matching]
        if unused:
            target_model.update(is_deleted=True, updated_at=now).where(target_model.id.in_(unused)).execute()


def import_deck(external_deck_id: int, user_id: int, mode: str = 'merge', local_deck_id: int = None, force_trash: bool = False):
    from .collaborative_service import _require_can_mutate, touch_deck_and_parent_folders
    from .structured_card_api import require_account

    _require_library_schema()
    if mode not in {'copy', 'merge', 'replace'}:
        raise HTTPException(422, 'Unknown library import mode')
    require_account(user_id)
    with tma_db.atomic():
        # Serialize destination creation for concurrent imports by the same user.
        TMAUser.select().where(TMAUser.user_id == user_id).for_update().first()
        source = Deck.select().where(Deck.id == external_deck_id, Deck.is_deleted == False).for_update().first()
        if not source:
            raise HTTPException(404, 'Library deck not found')
        name = f'{source.name} (v2)' if mode == 'copy' else source.name
        query = TMA_Deck.select()
        if local_deck_id:
            target = query.where(TMA_Deck.id == local_deck_id).for_update().first()
            if not target:
                raise HTTPException(404, 'Study deck not found')
        else:
            target = query.where(TMA_Deck.user_id == user_id, TMA_Deck.name == name).order_by(
                TMA_Deck.is_deleted, TMA_Deck.id).for_update().first()
        if target and target.is_deleted and not force_trash and not local_deck_id and mode != 'copy':
            return {'status': 'in_trash', 'name': source.name, 'deck_name': source.name,
                    'deck_id': external_deck_id, 'trash_deck_id': target.id}
        if target is None:
            target = TMA_Deck.create(user_id=user_id, name=name, level=source.level, topic=source.topic,
                                     target_language=source.target_language or 'de', metadata=source.metadata)
        _require_can_mutate(user_id, 'deck', target.id, allow_deleted=True)
        _copy_content(Card, source.id, TMA_Card, target.id, replace=mode == 'replace', creator=user_id)
        metadata = json.loads(target.metadata or '{}')
        metadata['source_library_id'] = source.id
        target.metadata = json.dumps(metadata, ensure_ascii=False)
        target.is_deleted = False
        target.target_language = source.target_language or 'de'
        target.save(only=[TMA_Deck.metadata, TMA_Deck.is_deleted, TMA_Deck.target_language])
        touch_deck_and_parent_folders(target.id, deck_obj=target)
        return target


def promote_to_library(deck_id):
    _require_library_schema()
    with tma_db.atomic():
        # Use library-before-study lock ordering for both transfer directions.
        original = TMA_Deck.get_or_none(TMA_Deck.id == deck_id, TMA_Deck.is_deleted == False)
        if not original:
            raise HTTPException(404, 'Study deck not found')
        target = Deck.select().where(Deck.name == original.name, Deck.is_deleted == False).for_update().first()
        if not target:
            target = Deck.create(name=original.name, level=original.level, topic=original.topic,
                                 target_language=original.target_language, metadata=original.metadata)
        source = TMA_Deck.select().where(TMA_Deck.id == deck_id, TMA_Deck.is_deleted == False).for_update().first()
        if not source or source.name != original.name:
            raise HTTPException(409, 'Study deck changed during transfer')
        _copy_content(TMA_Card, source.id, Card, target.id)
        Deck.update(updated_at=datetime.datetime.now()).where(Deck.id == target.id).execute()
        return target


def import_decks_batch(external_deck_ids: list[int], user_id: int, mode: str = 'merge', force_trash: bool = False):
    """Массовый импорт нескольких колод из библиотеки."""
    imported_ids = []
    for deck_id in external_deck_ids:
        try:
            d = import_deck(deck_id, user_id, mode=mode, force_trash=force_trash)
            if isinstance(d, dict) and d.get("status") == "in_trash":
                continue
            if d:
                imported_ids.append(getattr(d, 'id', d))
        except Exception as err:
            logger.error(f"Error importing batch deck {deck_id}: {err}")
    return imported_ids


def sync_deck_with_library(user_id: int, deck_id: int, mode: str = 'merge'):
    try:
        local = TMA_Deck.get_by_id(deck_id)
        logger.info(f"SYNC START: local_name='{local.name}', user_id={user_id}")
        ext = Deck.get_or_none(Deck.name == local.name)
        if ext:
            logger.info(f"SYNC MATCH: Found library deck '{ext.name}' (id={ext.id})")
            import_deck(ext.id, user_id, mode=mode, local_deck_id=local.id)
            return True
        logger.warning(f"SYNC FAIL: No matching deck in library for '{local.name}'")
        return False
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error syncing deck: {e}")
        return False
