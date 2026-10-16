"""Storage-version guard shared by legacy writers, including schema flag-off.

Call inside the writer's transaction, before side effects. PostgreSQL row locks
keep the checked version stable until commit; old databases need no new columns.
Never infer a content version from a projection or a client-supplied version.
"""
from contextlib import contextmanager

from fastapi import HTTPException
from peewee import SQL

from api.models import TMA_Card, TMA_Deck, TMA_Folder


class LegacyCardWriteBlocked(HTTPException):
    def __init__(self):
        super().__init__(409, {'code': 'legacy_card_write_blocked',
                               'message': 'Эта версия карточки не поддерживает старый способ записи.'})


@contextmanager
def legacy_lifecycle_scope(*, lock_membership=True):
    """Freeze lifecycle membership, including writers without a shared lock protocol.

    Row locks on existing cards alone cannot protect new children or rows moved
    into a folder/deck. Until all writers share parent locks, use PostgreSQL
    table locks conflicting with INSERT/UPDATE/DELETE, held through commit.
    Reads remain available. No external I/O belongs inside this scope.
    """
    database = TMA_Card._meta.database
    with database.atomic(*(() if database.for_update else ('IMMEDIATE',))):
        if lock_membership and database.for_update:
            tables = ', '.join('"%s"' % model._meta.table_name
                               for model in (TMA_Folder, TMA_Deck, TMA_Card))
            database.execute_sql(f'LOCK TABLE {tables} IN SHARE ROW EXCLUSIVE MODE')
        yield


def require_legacy_deck_cards(deck_ids):
    """Caller authorizes the decks and holds legacy_lifecycle_scope."""
    require_legacy_cards(row.id for row in TMA_Card.select(TMA_Card.id).where(
        TMA_Card.deck_id.in_(deck_ids)))


def require_legacy_folder_cards(folder_id, owner_id):
    """Match folder deletion's owned subtree, including deleted folders/decks."""
    from .folders import get_descendant_folder_ids

    folder_ids = [folder_id, *get_descendant_folder_ids(folder_id, owner_id)]
    deck_ids = [row.id for row in TMA_Deck.select(TMA_Deck.id).where(
        TMA_Deck.folder_id.in_(folder_ids) & (TMA_Deck.user_id == owner_id))]
    require_legacy_deck_cards(deck_ids)
    return folder_ids, deck_ids


def require_legacy_sync_lifecycle(request, require_access, *, implicit_delete=False, mappings=None):
    """Preflight parent tombstones/restores before receipts or any batch writes.

    Sync v1 writes default is_deleted even when omitted; v2 writes only supplied
    fields. A receipt replay also checks resolved temporary parent IDs.
    Authorization precedes inspecting contents, including on receipt replay.
    """
    for kind, model in (('folder', TMA_Folder), ('deck', TMA_Deck)):
        for item in getattr(request, kind + 's'):
            mapped_id = (mappings or {}).get(kind + 's', {}).get(str(item.id))
            item_id = mapped_id if mapped_id is not None else item.id
            if item_id <= 0:
                continue
            if not (implicit_delete or mapped_id is not None or 'is_deleted' in item.model_fields_set):
                continue
            require_access(kind, item_id)
            parent = model.get_or_none(model.id == item_id)
            if parent is None:
                continue
            if kind == 'deck':
                require_legacy_deck_cards([parent.id])
            else:
                require_legacy_folder_cards(parent.id, parent.user_id)


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
