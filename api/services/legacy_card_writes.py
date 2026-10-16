"""Storage-version guard shared by legacy writers, including schema flag-off.

Call inside the writer's transaction, before side effects. PostgreSQL row locks
keep the checked version stable until commit; old databases need no new columns.
Never infer a content version from a projection or a client-supplied version.
"""
from fastapi import HTTPException
from peewee import SQL

from api.models import TMA_Card


class LegacyCardWriteBlocked(HTTPException):
    def __init__(self):
        super().__init__(409, {'code': 'legacy_card_write_blocked',
                               'message': 'Эта версия карточки не поддерживает старый способ записи.'})


def legacy_card_id(data):
    """Match the historical save_card identifier resolution, including strings."""
    raw = data.get('card_id') or data.get('id')
    try:
        return int(raw) if raw else None
    except (TypeError, ValueError):
        return None


def require_legacy_cards(card_ids, *, lock=True):
    ids = sorted({identifier for identifier in card_ids if identifier is not None})
    if not ids:
        return
    database = TMA_Card._meta.database
    # Inspect storage, not optional ORM fields: flag-off must still protect V2.
    if 'content_version' not in {column.name for column in database.get_columns(TMA_Card._meta.table_name)}:
        return
    for offset in range(0, len(ids), 500):
        query = (TMA_Card.select(TMA_Card.id, SQL('"content_version"').alias('saved_content_version'))
                 .where(TMA_Card.id.in_(ids[offset:offset + 500])).order_by(TMA_Card.id))
        if lock and database.for_update:
            query = query.for_update()
        if any(row.saved_content_version != 1 for row in query):
            # Unknown/null versions also fail closed, never downgrade to legacy.
            raise LegacyCardWriteBlocked()
