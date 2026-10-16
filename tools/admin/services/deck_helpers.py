"""Deck-level helper utilities for the Admin Panel."""
import datetime
import logging
from typing import Optional, Tuple

from api import models

logger = logging.getLogger(__name__)


def get_deck_and_cards(deck_id_val):
    """Resolves a deck_id string to a (deck, cards, is_library) tuple."""
    s_id = str(deck_id_val).strip()
    if s_id.startswith("lib_"):
        raw_id = int(s_id.replace("lib_", ""))
        deck = models.Deck.get_or_none(models.Deck.id == raw_id)
        if not deck:
            return None, [], True
        cards = list(
            models.Card.select()
            .where((models.Card.deck == deck) & (models.Card.is_deleted == False))
            .order_by(models.Card.position.asc(), models.Card.id.asc())
        )
        return deck, cards, True
    else:
        try:
            d_id = int(s_id)
            deck = models.TMA_Deck.get_or_none(models.TMA_Deck.id == d_id)
            if deck:
                cards = list(
                    models.TMA_Card.select()
                    .where((models.TMA_Card.deck_id == deck.id) & (models.TMA_Card.is_deleted == False))
                    .order_by(models.TMA_Card.position.asc(), models.TMA_Card.id.asc())
                )
                return deck, cards, False
            deck = models.Deck.get_or_none(models.Deck.id == d_id)
            if deck:
                cards = list(
                    models.Card.select()
                    .where((models.Card.deck == deck) & (models.Card.is_deleted == False))
                    .order_by(models.Card.position.asc(), models.Card.id.asc())
                )
                return deck, cards, True
            return None, [], False
        except ValueError:
            return None, [], False


def matching_card_targets(source_deck, fronts, projected_fronts=None):
    """Materialize the exact FRONT targets; IDs never cross library/TMA namespaces."""
    clean_name = source_deck.name.replace("⭐ ", "").strip()
    names = {source_deck.name, clean_name, f"⭐ {clean_name}"}
    targets, deck_count = [], 0
    projected_fronts = projected_fronts or {}
    for deck_model, card_model in ((models.TMA_Deck, models.TMA_Card), (models.Deck, models.Card)):
        query = deck_model.select().where(deck_model.name.in_(names) & (deck_model.is_deleted == False))
        if isinstance(source_deck, deck_model) and source_deck.id is not None:
            query = query.where(deck_model.id != source_deck.id)
        decks = list(query)
        deck_count += len(decks)
        changed_ids = [identifier for model, identifier in projected_fronts if model is card_model]
        candidates = card_model.select().where(
            card_model.deck_id.in_([d.id for d in decks]) & (card_model.is_deleted == False) &
            (card_model.front_text.in_(fronts) | card_model.id.in_(changed_ids)))
        targets.extend(c for c in candidates
                       if projected_fronts.get((card_model, c.id), c.front_text) in fronts)
    return deck_count, targets


def preflight_card_writes(writes):
    """Resolve all targets before DML; caller owns a short transaction scope.

    Row locks suffice: writes use only these materialized IDs, never a later
    predicate UPDATE. New matching rows are left for a subsequent operation.
    """
    from api.services.legacy_card_writes import require_legacy_cards

    resolved, ids = [], []
    projected_fronts = {}
    for write in writes:
        card = write.get('card')
        targets = []
        if write.get('sync'):
            fronts = {write['front'], write.get('values', {}).get('front_text', write['front'])}
            _, targets = matching_card_targets(write['deck'], fronts, projected_fronts)
        if card is not None:
            targets = [card, *targets]
        if 'front_text' in write.get('values', {}):
            for target in targets:
                projected_fronts[(type(target), target.id)] = write['values']['front_text']
        ids.extend(c.id for c in targets if isinstance(c, models.TMA_Card))
        resolved.append((write, targets))
    require_legacy_cards(ids)
    return resolved


def apply_card_writes(writes, *, preview=False, new_deck=None, default_owner=None):
    """Commit prepared results together, after AI/TTS; never save stale ORM rows."""
    from api.services.legacy_card_writes import legacy_lifecycle_scope
    from tools.admin.services.card_helpers import save_audio_to_db_or_cloud

    with legacy_lifecycle_scope(lock_membership=False):
        resolved = preflight_card_writes(writes)
        if new_deck is not None:
            new_deck.save(force_insert=True)
            if default_owner is not None:
                import json
                for user in models.TMAUser.select():
                    if user.user_id != default_owner:
                        models.TMA_Deck.create(user_id=user.user_id, name=new_deck.name,
                            target_language=new_deck.target_language, level=new_deck.level, topic=new_deck.topic,
                            metadata=json.dumps({'source_deck_id': new_deck.id, 'is_default': True}), is_deleted=False)
        count = 0
        for write, targets in resolved:
            values = dict(write.get('values', {}))
            if write.get('audio'):
                values['audio_path'] = save_audio_to_db_or_cloud(write['audio'])
            if preview:
                write['result']['audio_path'] = values.get('audio_path')
                continue
            if write.get('create'):
                model, attributes = write['create']
                attributes = dict(attributes, deck_id=write['deck'].id, **values)
                model.create(**attributes)
                count += 1
            values['updated_at'] = datetime.datetime.now()
            for target in targets:
                model = type(target)
                current = model.get_or_none(model.id == target.id)
                if current is None:
                    continue
                updates = dict(values)
                if write.get('level'):
                    cleaned = ','.join(t for t in (current.tags or '').split(',')
                                       if t and t.upper() not in {'A1', 'A2', 'B1', 'B2', 'C1', 'C2'})
                    updates['tags'] = f"{cleaned},{write['level']}".strip(',')
                count += model.update(**updates).where(model.id == target.id).execute()
        return count


def sync_card_audio_to_matching_decks(source_deck, front_query: str, audio_path: str) -> Tuple[int, int]:
    total, _ = matching_card_targets(source_deck, {front_query})
    count = apply_card_writes([dict(deck=source_deck, front=front_query, sync=True,
                                    values={'audio_path': audio_path})])
    return total, count


def sync_card_updates_to_matching_decks(
    source_deck, front_query: str, new_front: str, new_back: str, new_context: str,
    new_level: Optional[str] = None, new_audio_path: Optional[str] = None,
) -> Tuple[int, int]:
    total, _ = matching_card_targets(source_deck, {front_query, new_front})
    values = dict(front_text=new_front, back_text=new_back, context=new_context)
    if new_audio_path:
        values['audio_path'] = new_audio_path
    count = apply_card_writes([dict(deck=source_deck, front=front_query, sync=True,
                                    values=values, level=new_level)])
    return total, count
