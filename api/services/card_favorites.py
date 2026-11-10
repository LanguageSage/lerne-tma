"""Personal favorites reference existing cards through TMAProgress."""
import datetime

from fastapi import HTTPException

from api.models import TMA_Card, TMA_Deck, TMAProgress, TMAUser
from .cards import _build_card_dict
from .media import _build_media_exists_map
from .collaborative_service import _require_cards_access, get_user_accessible_deck_ids


def set_card_favorite(card_id: int, user_id: int, selected: bool):
    _require_cards_access([card_id], user_id, write=False)
    if not TMA_Card.select().where(
        (TMA_Card.id == card_id) & (TMA_Card.is_deleted == False)
    ).exists():
        raise HTTPException(404, 'Card not found')
    # Update only this annotation; never save a stale SRS model over a concurrent grade.
    now = datetime.datetime.now()
    TMAProgress.insert(card_id=card_id, user_id=user_id, want_to_learn=selected,
                       updated_at=now).on_conflict(
        conflict_target=(TMAProgress.user_id, TMAProgress.card_id),
        update={TMAProgress.want_to_learn: selected, TMAProgress.updated_at: now}
    ).execute()
    return {'id': card_id, 'want_to_learn': selected}


def get_favorite_cards(user_id: int, target_language: str):
    accessible = get_user_accessible_deck_ids(user_id)
    if not accessible:
        return []
    progress_fields = ('queue', 'interval', 'ease_factor', 'repetitions', 'lapses',
                       'step_index', 'next_review', 'last_reviewed', 'flag', 'want_to_learn')
    fields = [field.alias('deck_id') if name == 'deck' else field for name, field in TMA_Card._meta.fields.items()
              if name not in ('image_data', 'history', 'flag', 'want_to_learn')]
    language_filter = TMA_Deck.target_language == target_language
    if target_language == 'de':
        language_filter |= TMA_Deck.target_language.is_null()
    rows = list(TMA_Card.select(
        *fields, *(getattr(TMAProgress, name).alias(f'p_{name}') for name in progress_fields),
        TMA_Deck.name.alias('deck_name'), TMA_Deck.target_language
    ).join(TMAProgress, on=(TMAProgress.card_id == TMA_Card.id)).switch(TMA_Card).join(TMA_Deck).where(
        (TMAProgress.user_id == user_id) & (TMAProgress.want_to_learn == True) &
        (TMA_Card.is_deleted == False) & (TMA_Deck.is_deleted == False) &
        (TMA_Deck.id.in_(accessible)) & language_filter
    ).order_by(TMA_Deck.position, TMA_Deck.id, TMA_Card.position, TMA_Card.id).dicts())
    media = _build_media_exists_map(rows)
    creator_ids = {row['creator_id'] for row in rows if row.get('creator_id')}
    creators = {row['user_id']: row for row in TMAUser.select(
        TMAUser.user_id, TMAUser.username, TMAUser.first_name, TMAUser.photo_url
    ).where(TMAUser.user_id.in_(creator_ids)).dicts()} if creator_ids else {}
    result = []
    for row in rows:
        progress = {name: row[f'p_{name}'] for name in progress_fields}
        card = _build_card_dict(row, p=progress, media_exists=media,
                                creator=creators.get(row.get('creator_id')))
        result.append({**card, **progress, 'deck_name': row['deck_name'],
                       'target_language': row['target_language']})
    return result
