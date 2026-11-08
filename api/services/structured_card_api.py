"""HTTP operations on the native card store and the existing deck/ACL model."""
import datetime
import json
from typing import Annotated, Literal
from uuid import UUID

from fastapi import HTTPException
from peewee import fn, Value
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from api.models import TMA_Card, TMA_Deck, TMAUser, TMACardKnowledgeItem, tma_db
from .card_text_update import _claim_receipt, _digest
from .collaborative_service import _require_can_mutate, get_effective_user_role, touch_deck_and_parent_folders
from .structured_card_storage import create_v2_card, decode_v2_content, replace_v2_card
from .structured_cards_v2 import Card, Document, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_CARDS

ID = Annotated[int, Field(strict=True, gt=0, le=2147483647)]
Revision = Annotated[str, Field(pattern=r'^[0-9a-f]{64}$')]
MEDIA_PATHS = ('image_path', 'audio_path', 'audio_back_path', 'video_front_path', 'video_back_path')


class Request(BaseModel):
    model_config = ConfigDict(extra='forbid')


class ContentV2(Request):
    schema_version: Literal[2]
    card: Card

    @field_validator('schema_version', mode='before')
    @classmethod
    def strict_version(cls, value):
        if type(value) is not int:
            raise ValueError('schema_version must be integer 2')
        return value


class MediaFields(Request):
    image_path: str | None = None
    audio_path: str | None = None
    audio_back_path: str | None = None
    video_front_path: str | None = None
    video_back_path: str | None = None

    @field_validator(*MEDIA_PATHS)
    @classmethod
    def valid_path(cls, value):
        if value is not None and (not value.strip() or '\x00' in value or len(value) > 4096):
            raise ValueError('Invalid media path')
        return value


class NewCard(MediaFields):
    content_v2: ContentV2
    deck_id: ID


class SaveCard(MediaFields):
    content_v2: ContentV2
    deck_id: ID | None = None
    request_id: UUID
    after_card_id: ID | None = None


class CardReplacement(MediaFields):
    revision: Revision
    content_v2: ContentV2


class UpdateCard(CardReplacement):
    request_id: UUID


class RestoreCard(Request):
    revision: Revision
    request_id: UUID


class BulkUpdate(CardReplacement):
    card_id: ID


class BulkSave(Request):
    import_id: UUID
    cards: Annotated[list[NewCard | BulkUpdate], Field(min_length=1, max_length=MAX_DOCUMENT_CARDS)]
    placement: Literal['start', 'end'] = 'end'

    @model_validator(mode='after')
    def consistent_batch(self):
        updates = [item.card_id for item in self.cards if isinstance(item, BulkUpdate)]
        if len(updates) != len(set(updates)):
            raise ValueError('Repeated update card_id in bulk request')
        if self.placement == 'start' and (updates or len({item.deck_id for item in self.cards}) != 1):
            raise ValueError('Placement at start requires new cards in one deck')
        return self


class DeckImport(Request):
    import_id: UUID
    document: Document


class CodexImport(Request):
    import_id: UUID
    codex: Annotated[str, Field(min_length=1, max_length=MAX_DOCUMENT_BYTES)]
    default_deck_name: Annotated[str, Field(min_length=1)] | None = None


class DeckCopy(Request):
    request_id: UUID
    folder_id: ID | None = None


class Selection(Request):
    request_id: UUID
    card_ids: Annotated[list[ID], Field(min_length=1, max_length=MAX_DOCUMENT_CARDS)]

    @field_validator('card_ids')
    @classmethod
    def unique_cards(cls, values):
        if len(set(values)) != len(values):
            raise ValueError('card_ids must be unique')
        return values


class RevisionSelection(Selection):
    revisions: dict[int, Revision]

    @model_validator(mode='after')
    def covers_selection(self):
        if self.revisions.keys() != set(self.card_ids):
            raise ValueError('revisions must cover exactly card_ids')
        return self


class Transfer(Selection):
    target_deck_id: ID
    on_duplicate: Literal['skip', 'keep', 'overwrite'] = 'skip'
    revisions: dict[int, Revision] | None = None

    @model_validator(mode='after')
    def covers_transfer(self):
        if self.revisions is not None and self.revisions.keys() != set(self.card_ids):
            raise ValueError('revisions must cover exactly card_ids')
        return self


class MoveSelection(Transfer):
    revisions: dict[int, Revision]


class OrderSelection(Selection):
    revisions: dict[int, Revision] | None = None

    @model_validator(mode='after')
    def covers_order(self):
        if self.revisions is not None and self.revisions.keys() != set(self.card_ids):
            raise ValueError('revisions must cover exactly card_ids')
        return self


def require_account(user_id):
    if TMAUser.select().where(TMAUser.user_id == user_id, TMAUser.is_guest == True).exists():
        raise HTTPException(403, 'Guest accounts cannot change cards')


def require_native(card):
    if card.content_v2 is None:
        raise HTTPException(409, {'code': 'card_requires_migration', 'card_id': card.id})
    return decode_v2_content(card.content_v2)


def authored_side_text(content, side):
    """Speak the existing physical side using authored V2 text and answer order."""
    card = decode_v2_content(content)
    kind, data = card.type, card.data
    if side == 'back':
        field = {
            'theory': 'summary', 'standard': 'answer', 'trainer': 'back_note',
            'quiz': 'back_note', 'match': 'back_note', 'puzzle': 'translation',
            'free_text': 'sample_answer', 'editable_text': 'correct_text',
        }.get(kind)
        return getattr(data, field) if field else ''
    if kind == 'trainer':
        return ''.join(part.text if part.type == 'text' else part.answers[0] if part.type == 'input'
                       else next(option.text for option in part.options if option.correct) for part in data.parts)
    if kind == 'word_bank':
        return ''.join(part.text if part.type == 'text' else data.options[part.option] for part in data.parts)
    if kind == 'puzzle':
        return ' '.join(data.tokens)
    if kind == 'match':
        return '\n'.join(f'{pair.left} → {pair.right}' for pair in data.pairs)
    if kind == 'theory':
        return data.text
    if kind == 'editable_text':
        return data.source_text
    if kind == 'quiz' and not data.prompt:
        visible = {item.index for item in card.layout or [] if item.type == 'info'
                   and item.visibility == 'before_answer'} if card.layout is not None else set(range(len(card.info)))
        return next((block.text for index, block in enumerate(card.info)
                     if index in visible and block.type in ('task', 'source')), '')
    return data.prompt


def content_response(card):
    if isinstance(card, dict):
        raw = card['content_v2']
        identity = card['id']
        updated = card.get('updated_at')
        deck_id, position = card['deck_id'], card['position']
        media = [card.get(field) for field in MEDIA_PATHS]
    else:
        raw = card.content_v2
        identity = card.id
        updated = card.updated_at
        deck_id, position = card.deck_id, card.position
        media = [getattr(card, field) for field in MEDIA_PATHS]
    if raw is None:
        raise HTTPException(409, {'code': 'card_requires_migration', 'card_id': identity})
    value = decode_v2_content(raw).model_dump(mode='json')
    return {
        'content_v2': {'schema_version': 2, 'card': value},
        'revision': _digest([identity, deck_id, position, str(updated), raw, *media]),
        'position': position,
    }


def _lock_decks(ids, user_id, *, writable, trash_owner=False):
    query = TMA_Deck.select().where(TMA_Deck.id.in_(ids))
    if trash_owner:
        query = query.where(TMA_Deck.user_id == user_id)
    else:
        query = query.where(TMA_Deck.is_deleted == False)
    decks = {deck.id: deck for deck in query.order_by(TMA_Deck.id).for_update()}
    if len(decks) != len(ids):
        raise HTTPException(404, 'Deck not found')
    for deck_id in sorted(ids):
        if deck_id in writable:
            _require_can_mutate(user_id, 'deck', deck_id, allow_deleted=trash_owner)
        elif not get_effective_user_role(user_id, 'deck', deck_id):
            raise HTTPException(403, 'Access denied')
    return decks


def _lock_cards(ids, user_id, *, targets=(), write=True, allow_deleted=False, trash_owner=False):
    locations = dict(TMA_Card.select(TMA_Card.id, TMA_Card.deck).where(TMA_Card.id.in_(ids)).tuples())
    if len(locations) != len(ids):
        raise HTTPException(404, 'Card not found')
    sources = set(locations.values())
    targets = set(targets)
    decks = _lock_decks(sources | targets, user_id, writable=(sources if write else set()) | targets,
                        trash_owner=trash_owner)
    cards = {card.id: card for card in TMA_Card.select().where(TMA_Card.id.in_(ids))
             .order_by(TMA_Card.id).for_update()}
    for card_id, location in locations.items():
        card = cards.get(card_id)
        if card is None or card.deck_id != location:
            raise HTTPException(409, {'code': 'card_location_changed'})
        if card.is_deleted and not allow_deleted:
            raise HTTPException(404, 'Card not found')
        require_native(card)
    return [cards[card_id] for card_id in ids], decks


def _receipt(operation, user_id, request_id, data):
    return _claim_receipt(f'cards-v2:{operation}:{user_id}:{request_id}', _digest(data))


def _finish(receipt, result):
    receipt.response = json.dumps(result, ensure_ascii=False)
    receipt.save(only=[type(receipt).response])
    return result


def _touch(decks):
    for deck_id, deck in sorted(decks.items()):
        touch_deck_and_parent_folders(deck_id, deck_obj=deck)


def lifecycle_state(card):
    return {**content_response(card), 'id': card.id, 'deck_id': card.deck_id,
            'is_deleted': card.is_deleted, 'updated_at': card.updated_at.isoformat() if card.updated_at else None,
            **{field: getattr(card, field) for field in MEDIA_PATHS}}


def _lifecycle_conflict(card):
    return HTTPException(409, {'code': 'card_revision_conflict', 'card_id': card.id,
                               'card': lifecycle_state(card)})


def _position(deck_id, *, start=False, count=1):
    edge = fn.MIN if start else fn.MAX
    position = TMA_Card.select(edge(TMA_Card.position)).where(
        TMA_Card.deck == deck_id, TMA_Card.is_deleted == False
    ).scalar()
    return position - count if start and position is not None else (position or 0) + 1


def _set_media(card, media):
    from .media import validate_new_audio_path

    for field in ('audio_path', 'audio_back_path'):
        if field in media:
            validate_new_audio_path(media[field], getattr(card, field))
    if media:
        TMA_Card.update(**media).where(TMA_Card.id == card.id).execute()
        for field, value in media.items():
            setattr(card, field, value)


def _create(item, user_id, position):
    validate_layout_images(item.content_v2.card)
    try:
        card = create_v2_card(item.content_v2.card, deck_id=item.deck_id, creator_id=user_id, position=position)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    _set_media(card, item.model_dump(include=set(MEDIA_PATHS), exclude_unset=True))
    return card


def _response(card, user_id, deck):
    from .cards import format_card_for_study

    return format_card_for_study(card, user_id, deck_obj=deck)


def save_card(data, user_id):
    require_account(user_id)
    with tma_db.atomic():
        payload = data.model_dump(mode='json')
        if data.deck_id is None:
            from .decks import ensure_inbox_deck
            data = data.model_copy(update={'deck_id': ensure_inbox_deck(user_id).id})
        decks = _lock_decks({data.deck_id}, user_id, writable={data.deck_id})
        receipt, replay = _receipt('save', user_id, data.request_id, payload)
        if replay is not None:
            return replay
        position = _position(data.deck_id)
        if data.after_card_id is not None:
            reference = TMA_Card.get_or_none(TMA_Card.id == data.after_card_id,
                TMA_Card.deck == data.deck_id, TMA_Card.is_deleted == False)
            if reference is None:
                raise HTTPException(404, 'Placement card not found in target deck')
            require_native(reference)
            if TMA_Card.select().where(TMA_Card.deck == data.deck_id,
                    TMA_Card.is_deleted == False, TMA_Card.content_v2.is_null(True)).exists():
                raise HTTPException(409, {'code': 'deck_requires_migration'})
            position = reference.position + 1
            TMA_Card.update(position=TMA_Card.position + 1).where(
                TMA_Card.deck == data.deck_id, TMA_Card.is_deleted == False, TMA_Card.position >= position,
                TMA_Card.content_v2.is_null(False)
            ).execute()
        card = _create(data, user_id, position)
        _touch(decks)
        return _finish(receipt, _response(card, user_id, decks[card.deck_id]))


def bulk_save(data, user_id):
    require_account(user_id)
    payload = data.model_dump(mode='json', exclude_unset=True)
    if len(json.dumps(payload, ensure_ascii=False).encode('utf-8')) > MAX_DOCUMENT_BYTES:
        raise HTTPException(422, 'Bulk content exceeds the V2 document byte limit')
    destinations = {item.deck_id for item in data.cards if isinstance(item, NewCard)}
    updates = [item.card_id for item in data.cards if isinstance(item, BulkUpdate)]
    with tma_db.atomic():
        cards, decks = _lock_cards(updates, user_id, targets=destinations)
        receipt, replay = _receipt('bulk-save', user_id, data.import_id, payload)
        if replay is not None:
            return replay
        by_id = {card.id: card for card in cards}
        positions = {deck_id: _position(deck_id, start=data.placement == 'start', count=len(data.cards))
                     for deck_id in destinations}
        saved = []
        for item in data.cards:
            if isinstance(item, NewCard):
                card = _create(item, user_id, positions[item.deck_id])
                positions[item.deck_id] += 1
            else:
                card = _replace(by_id[item.card_id], item)
            saved.append(_response(card, user_id, decks[card.deck_id]))
        _touch(decks)
        count = len(saved)
        created = count - len(updates)
        return _finish(receipt, {'status': 'success', 'count': count, 'requested': count, 'created': created,
                                 'updated': len(updates), 'created_count': created,
                                 'failed_count': 0, 'failed': [], 'cards': saved})


def _replace(card, data):
    from .utils import add_to_history

    if content_response(card)['revision'] != data.revision:
        raise HTTPException(409, {'code': 'card_revision_conflict', 'card_id': card.id})
    validate_layout_images(data.content_v2.card, require_native(card))
    try:
        replace_v2_card(card.id, data.content_v2.card)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    _set_media(card, data.model_dump(include=set(MEDIA_PATHS), exclude_unset=True))
    TMA_Card.update(history=add_to_history(card.history, 'Edited manually')).where(TMA_Card.id == card.id).execute()
    return TMA_Card.get_by_id(card.id)


def validate_layout_images(content, previous=None):
    """New links must refer to uploaded media; old links never block text edits."""
    from api.models import TMAMedia
    paths = {item.path for item in content.layout or [] if item.type == 'image'}
    old = {item.path for item in previous.layout or [] if item.type == 'image'} if previous else set()
    names = {path.removeprefix('images/') for path in paths - old}
    if names:
        existing = {row.filename for row in TMAMedia.select(TMAMedia.filename).where(
            TMAMedia.folder == 'images', TMAMedia.filename.in_(names))}
        if existing != names:
            raise HTTPException(422, 'Upload or select an existing image before attaching it to layout')


def update_card(card_id, data, user_id):
    require_account(user_id)
    with tma_db.atomic():
        (card,), decks = _lock_cards([card_id], user_id, allow_deleted=True)
        receipt, replay = _receipt('update', user_id, data.request_id,
                                   [card_id, data.model_dump(mode='json', exclude_unset=True)])
        if replay is not None:
            return replay
        if card.is_deleted:
            raise _lifecycle_conflict(card)
        card = _replace(card, data)
        _touch(decks)
        return _finish(receipt, _response(card, user_id, decks[card.deck_id]))


def get_card(card_id, user_id):
    card = TMA_Card.get_or_none(TMA_Card.id == card_id, TMA_Card.is_deleted == False)
    if card is None:
        raise HTTPException(404, 'Card not found')
    if not get_effective_user_role(user_id, 'deck', card.deck_id):
        raise HTTPException(403, 'Access denied')
    require_native(card)
    return _response(card, user_id, card.deck)


def transfer_cards(data, user_id, *, move):
    require_account(user_id)
    target = data.target_deck_id
    operation = 'move' if move else 'copy'
    with tma_db.atomic():
        payload = data.model_dump(mode='json')
        if not move and data.revisions is None:
            payload.pop('revisions')  # Preserve fingerprints of older copy requests.
        # Serialize retries before reading source locations for both operations.
        receipt, replay = _receipt(operation, user_id, data.request_id, payload)
        cards, decks = _lock_cards(data.card_ids, user_id, targets=(target,), write=move)
        if replay is not None:
            return replay
        if data.revisions is not None:
            for card in cards:
                if content_response(card)['revision'] != data.revisions[card.id]:
                    raise HTTPException(409, {'code': 'card_revision_conflict', 'card_id': card.id})
        existing = {}
        for card in TMA_Card.select().where(TMA_Card.deck == target, TMA_Card.is_deleted == False,
                TMA_Card.content_v2.is_null(False)).order_by(TMA_Card.position, TMA_Card.id):
            existing.setdefault(_digest(card.content_v2), card)
        position = _position(target)
        created, moved, updated, skipped = 0, 0, 0, 0
        touched = {}
        copies = []
        now = datetime.datetime.now()
        for card in cards:
            if move and card.deck_id == target:
                continue
            key = _digest(card.content_v2)
            match = existing.get(key)
            if match and data.on_duplicate == 'skip':
                skipped += 1
                if not move:
                    copies.append({'source_id': card.id, 'card': None})
                continue
            media = {field: getattr(card, field) for field in (*MEDIA_PATHS, 'image_data')}
            if match and data.on_duplicate == 'overwrite':
                if move or any(value is not None and getattr(match, field) not in (None, value)
                               for field, value in media.items()):
                    raise HTTPException(409, {'code': 'unsafe_duplicate_overwrite', 'card_id': match.id})
                media = {field: value for field, value in media.items() if getattr(match, field) is None}
                TMA_Card.update(**media, updated_at=now).where(TMA_Card.id == match.id).execute()
                for field, value in media.items():
                    setattr(match, field, value)
                updated += 1
                match.updated_at = now
                copies.append({'source_id': card.id, 'card': {
                    **lifecycle_state(match), 'creator_id': match.creator_id}})
            elif move:
                touched[card.deck_id] = decks[card.deck_id]
                TMA_Card.update(deck=target, position=position, updated_at=now).where(TMA_Card.id == card.id).execute()
                card.deck_id, card.position, card.updated_at = target, position, now
                position += 1
                moved += 1
                existing.setdefault(key, card)
            else:
                copied = _clone(card, target, position, media=media)
                position += 1
                created += 1
                existing.setdefault(key, copied)
                copies.append({'source_id': card.id, 'card': {
                    **lifecycle_state(copied), 'creator_id': copied.creator_id}})
        if moved or updated or created:
            touched[target] = decks[target]
            _touch(touched)
        result = {'status': 'success', 'count': moved + updated + created,
                  ('moved' if move else 'created'): moved if move else created,
                  'updated': updated, 'skipped': skipped}
        if move:
            result['placements'] = [
                {'id': card.id, 'deck_id': card.deck_id, 'position': card.position,
                 'revision': content_response(card)['revision']} for card in cards
            ]
        else:
            result['copies'] = copies
        return _finish(receipt, result)


def change_selection(data, user_id, *, delete):
    require_account(user_id)
    operation = 'batch-delete' if delete else 'reorder'
    with tma_db.atomic():
        payload = data.model_dump(mode='json')
        if not delete and data.revisions is None:
            payload.pop('revisions')
        receipt, replay = _receipt(operation, user_id, data.request_id, payload)
        cards, decks = _lock_cards(data.card_ids, user_id, allow_deleted=delete)
        if replay is not None:
            return replay
        now = datetime.datetime.now()
        if delete:
            for card in cards:
                if card.is_deleted or content_response(card)['revision'] != data.revisions[card.id]:
                    if len(cards) == 1:
                        raise _lifecycle_conflict(card)
                    raise HTTPException(409, {'code': 'card_revision_conflict', 'card_id': card.id})
            count = TMA_Card.update(is_deleted=True, updated_at=now).where(
                TMA_Card.id.in_(data.card_ids), TMA_Card.is_deleted == False).execute()
            for card in cards:
                card.is_deleted, card.updated_at = True, now
        else:
            if len(decks) != 1:
                raise HTTPException(422, 'Reordering requires one deck')
            if data.revisions is not None:
                for card in cards:
                    if content_response(card)['revision'] != data.revisions[card.id]:
                        raise _lifecycle_conflict(card)
            # Reassign the selected positions, preserving unselected rows and their order.
            for position, card in zip(sorted(item.position for item in cards), cards):
                TMA_Card.update(position=position, updated_at=now).where(TMA_Card.id == card.id).execute()
                card.position, card.updated_at = position, now
            count = len(cards)
        _touch(decks)
        result = {'status': 'success', 'count': count, 'cards': [lifecycle_state(card) for card in cards]}
        if delete and len(cards) == 1:
            card.is_deleted, card.updated_at = True, now
            result['card'] = lifecycle_state(card)
        return _finish(receipt, result)


def restore_card(card_id, data, user_id):
    require_account(user_id)
    with tma_db.atomic():
        (card,), decks = _lock_cards([card_id], user_id, allow_deleted=True, trash_owner=True)
        receipt, replay = _receipt('restore', user_id, data.request_id, [card_id, data.model_dump(mode='json')])
        if replay is not None:
            return replay
        if not card.is_deleted or content_response(card)['revision'] != data.revision:
            raise _lifecycle_conflict(card)
        now = datetime.datetime.now()
        card.is_deleted, card.updated_at = False, now
        card.save(only=[TMA_Card.is_deleted, TMA_Card.updated_at])
        deck = decks[card.deck_id]
        if deck.is_deleted:
            deck.is_deleted = False
            deck.save(only=[TMA_Deck.is_deleted])
        _touch(decks)
        return _finish(receipt, {'status': 'success', 'card': lifecycle_state(card)})


def delete_card(card_id, revision, user_id):
    require_account(user_id)
    with tma_db.atomic():
        (card,), decks = _lock_cards([card_id], user_id, allow_deleted=True)
        if not card.is_deleted:
            if content_response(card)['revision'] != revision:
                raise HTTPException(409, {'code': 'card_revision_conflict'})
            TMA_Card.update(is_deleted=True, updated_at=datetime.datetime.now()).where(TMA_Card.id == card_id).execute()
            _touch(decks)
        return {'status': 'success'}


def _clone(card, deck_id, position, *, media=None):
    if media is None:
        media = {field: getattr(card, field) for field in (*MEDIA_PATHS, 'image_data')}
    copied = create_v2_card(require_native(card), deck_id=deck_id, creator_id=card.creator_id, position=position)
    # Skill mappings describe the authored task. Attempts/mastery and other
    # personal records stay at the source ID. The caller owns this transaction.
    fields = ('card_id', 'knowledge_item', 'role', 'complexity', 'weight')
    TMACardKnowledgeItem.insert_from(TMACardKnowledgeItem.select(
        Value(copied.id), *(getattr(TMACardKnowledgeItem, field) for field in fields[1:]),
        Value(datetime.datetime.now())
    ).where(TMACardKnowledgeItem.card_id == card.id), (*fields, 'created_at')).execute()
    TMA_Card.update(**media, source='user').where(TMA_Card.id == copied.id).execute()
    for field, value in media.items():
        setattr(copied, field, value)
    return copied


def copy_deck(deck_id, data, user_id):
    from .decks import create_deck

    require_account(user_id)
    with tma_db.atomic():
        source = _lock_decks({deck_id}, user_id, writable=set())[deck_id]
        if data.folder_id is not None:
            _require_can_mutate(user_id, 'folder', data.folder_id)
        receipt, replay = _receipt('deck-copy', user_id, data.request_id, [deck_id, data.folder_id])
        if replay is not None:
            return replay
        cards = list(TMA_Card.select().where(TMA_Card.deck == deck_id, TMA_Card.is_deleted == False)
                     .order_by(TMA_Card.position, TMA_Card.id))
        for card in cards:
            require_native(card)
        deck = create_deck(f'{source.name} (Копия)', user_id, data.folder_id, source.target_language or 'de')
        TMA_Deck.update(metadata=source.metadata, level=source.level, topic=source.topic).where(
            TMA_Deck.id == deck.id).execute()
        for card in cards:
            _clone(card, deck.id, card.position)
        touch_deck_and_parent_folders(deck.id, deck_obj=deck)
        return _finish(receipt, {'status': 'success', 'id': deck.id})


def import_deck(data, user_id):
    from api.card_core.lerne_card_core.structured_cards_import import import_documents
    from .deck_passport import merge_passport
    from .decks import create_deck

    require_account(user_id)
    try:
        documents = (import_documents(data.codex, default_deck_name=data.default_deck_name)
                     if isinstance(data, CodexImport)
                     else import_documents(data.document.model_dump_json(), json_input=True))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    with tma_db.atomic():
        receipt, replay = _receipt('deck-import', user_id, data.import_id,
                                   [doc.model_dump(mode='json') for doc in documents])
        if replay is not None:
            return replay
        deck_ids = []
        for document in documents:
            deck = create_deck(document.deck.name, user_id)
            metadata = document.deck.metadata
            if document.deck.passport:
                metadata = merge_passport(metadata, document.deck.passport)
            TMA_Deck.update(metadata=json.dumps(metadata, ensure_ascii=False)).where(TMA_Deck.id == deck.id).execute()
            for position, card in enumerate(document.cards, 1):
                try:
                    create_v2_card(card, deck_id=deck.id, creator_id=user_id, position=position)
                except ValueError as exc:
                    raise HTTPException(422, str(exc)) from exc
            deck_ids.append(deck.id)
        return _finish(receipt, {'status': 'success', 'deck_id': deck_ids[0], 'deck_ids': deck_ids})


def require_legacy_decks(deck_ids):
    """Keep legacy catalog/share writers from consuming or replacing native content."""
    if tma_db.for_update:
        list(TMA_Deck.select(TMA_Deck.id).where(TMA_Deck.id.in_(deck_ids))
             .order_by(TMA_Deck.id).for_update())
    if TMA_Card.select().where(TMA_Card.deck.in_(deck_ids), TMA_Card.content_v2.is_null(False)).exists():
        raise HTTPException(409, {'code': 'native_content_unsupported_by_legacy_operation'})
