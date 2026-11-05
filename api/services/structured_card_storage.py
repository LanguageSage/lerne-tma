"""Native Structured Cards V2 persistence. The caller owns access and placement."""
import datetime

from peewee import PostgresqlDatabase

from api.models import TMA_Card
from api.services.structured_cards_v2 import Card, validate_card


class V2CardNotFound(LookupError):
    """No active native card exists for this ID."""


def _postgres():
    database = TMA_Card._meta.database
    database = getattr(database, 'obj', database)
    if not isinstance(database, PostgresqlDatabase):
        raise RuntimeError('Structured Cards V2 storage requires PostgreSQL')
    return database


def _encode_card(card: Card) -> dict:
    payload = card.model_dump(mode='json')

    # PostgreSQL JSONB cannot store U+0000, including inside a JSON object key.
    # Reject it before opening the write transaction.
    def check_strings(node, path):
        if isinstance(node, dict):
            for key, child in node.items():
                if '\x00' in key:
                    raise ValueError(f'{path}: JSON object key contains U+0000')
                check_strings(child, f'{path}.{key}')
        elif isinstance(node, list):
            for index, child in enumerate(node):
                check_strings(child, f'{path}[{index}]')
        elif isinstance(node, str) and '\x00' in node:
            raise ValueError(f'{path}: JSON string contains U+0000')

    check_strings(payload, 'card')
    return {'schema_version': 2, 'card': payload}


def _native_row(card_id):
    return (
        (TMA_Card.id == card_id) &
        (TMA_Card.is_deleted == False) &
        TMA_Card.content_v2.is_null(False)
    )


def create_v2_card(value, *, deck_id: int, creator_id: int, position: int,
                   image_path: str | None = None) -> TMA_Card:
    """Insert validated V2 into an authorized deck at a caller-assigned position."""
    envelope = _encode_card(validate_card(value))
    with _postgres().atomic():
        return TMA_Card.create(
            content_v2=envelope, card_type=None,
            deck=deck_id, creator_id=creator_id, position=position, image_path=image_path,
            updated_at=datetime.datetime.now(),
        )


def read_v2_card(card_id: int) -> Card:
    """Read and validate the persisted content; no legacy conversion or fallback."""
    _postgres()
    row = TMA_Card.select(TMA_Card.content_v2).where(_native_row(card_id)).get_or_none()
    if row is None:
        raise V2CardNotFound(card_id)
    envelope = row.content_v2
    if (not isinstance(envelope, dict) or envelope.keys() != {'schema_version', 'card'}
            or type(envelope['schema_version']) is not int or envelope['schema_version'] != 2):
        raise ValueError(f'Card {card_id}: invalid stored Structured Cards V2 envelope')
    return validate_card(envelope['card'])


def replace_v2_card(card_id: int, value) -> Card:
    """Replace the complete content of an active native card with one guarded UPDATE."""
    card = validate_card(value)
    envelope = _encode_card(card)
    with _postgres().atomic():
        updated = TMA_Card.update(content_v2=envelope, updated_at=datetime.datetime.now()).where(
            _native_row(card_id)
        ).execute()
        if updated != 1:
            raise V2CardNotFound(card_id)
    return card
