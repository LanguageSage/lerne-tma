"""Batch transfers between decks: access, duplicate policy and atomic sync updates.

The public functions remain re-exported from cards and api.services.
This module does not depend on card saving, study selection or AI imports.
"""
import datetime
import logging
import unicodedata

from peewee import fn

from ..models import TMA_Deck, TMA_Card, tma_db

# Preserve the existing logging category for callers and log filters.
logger = logging.getLogger('api.services.cards')


def normalize_card_key(text: str) -> str:
    """Comparison only: NFKC → Unicode letters/marks/numbers → lowercase → NFKC.

    Matches offlineApi.normalizeCardKey; ä/a and ß/ss remain distinct.
    """
    if not text:
        return ""
    normalized = unicodedata.normalize('NFKC', str(text))
    compact = ''.join(char for char in normalized if unicodedata.category(char)[0] in 'LMN')
    return unicodedata.normalize('NFKC', compact.lower())

def batch_move_cards(card_ids: list[int], target_deck_id: int, user_id: int, on_duplicate: str = 'skip') -> dict:
    """Массово перемещает карточки в целевую колоду с сохранением SRS-прогресса."""
    from fastapi import HTTPException
    from .collaborative_service import _require_can_mutate, _require_cards_access, touch_deck_and_parent_folders
    from .media import validate_new_audio_path

    if not card_ids:
        return {"status": "success", "count": 0}

    target_deck = TMA_Deck.get_or_none(TMA_Deck.id == target_deck_id)
    if not target_deck or target_deck.is_deleted:
        raise HTTPException(status_code=404, detail="Целевая колода не найдена")

    _require_can_mutate(user_id, 'deck', target_deck_id)
    _require_cards_access(card_ids, user_id)

    # Вычисляем максимальную позицию в целевой колоде
    max_pos = TMA_Card.select(fn.MAX(TMA_Card.position)).where(
        (TMA_Card.deck_id == target_deck_id) & (TMA_Card.is_deleted == False)
    ).scalar() or 0

    cards = list(TMA_Card.select().where((TMA_Card.id.in_(card_ids)) & (TMA_Card.is_deleted == False)))
    affected_source_decks = set()
    valid_cards = []

    for card in cards:
        if card.deck_id != target_deck_id:
            valid_cards.append(card)
            affected_source_decks.add(card.deck_id)

    # Сохраняем строгий порядок выбора карточек пользователем
    card_by_id = {c.id: c for c in valid_cards}
    valid_cards = [card_by_id[cid] for cid in card_ids if cid in card_by_id]

    # Загружаем существующие карточки целевой колоды для проверки совпадений по лицевой стороне
    existing_cards = list(TMA_Card.select().where(
        (TMA_Card.deck_id == target_deck_id) & (TMA_Card.is_deleted == False)
    ))
    existing_by_front = {
        normalize_card_key(c.front_text): c
        for c in existing_cards if normalize_card_key(c.front_text)
    }

    now = datetime.datetime.now()
    moved_count = 0
    updated_count = 0
    skipped_count = 0

    with tma_db.atomic():
        for idx, card in enumerate(valid_cards):
            front_key = normalize_card_key(card.front_text)
            existing_match = existing_by_front.get(front_key) if front_key else None

            if existing_match and on_duplicate == 'skip':
                skipped_count += 1
                continue

            if existing_match and on_duplicate == 'overwrite':
                validate_new_audio_path(card.audio_path, existing_match.audio_path)
                validate_new_audio_path(card.audio_back_path, existing_match.audio_back_path)
                existing_match.front_text = card.front_text or ''
                existing_match.back_text = card.back_text or ''
                existing_match.card_type = card.card_type or existing_match.card_type or 'standard'
                existing_match.context = card.context or ''
                if card.image_path:
                    existing_match.image_path = card.image_path
                if card.audio_path:
                    existing_match.audio_path = card.audio_path
                if card.audio_back_path:
                    existing_match.audio_back_path = card.audio_back_path
                if card.video_front_path:
                    existing_match.video_front_path = card.video_front_path
                if card.video_back_path:
                    existing_match.video_back_path = card.video_back_path
                if card.tags:
                    existing_match.tags = card.tags
                if card.metadata:
                    existing_match.metadata = card.metadata
                # Синхронизируем позицию согласно выбранному порядку (1..N)
                existing_match.position = idx + 1
                existing_match.updated_at = now
                existing_match.save()

                # Мягко удаляем исходную перемещаемую карточку
                card.is_deleted = True
                card.updated_at = now
                card.save()
                updated_count += 1
                continue

            # on_duplicate == 'keep' или совпадений нет -> перемещаем карточку в целевую колоду
            if max_pos == 0 and len(existing_cards) == 0:
                card_pos = card.position if (card.position is not None and card.position > 0) else (idx + 1)
            else:
                max_pos += 1
                card_pos = max_pos
            card.deck_id = target_deck_id
            card.position = card_pos
            card.updated_at = now
            card.save()
            moved_count += 1
            if front_key:
                existing_by_front[front_key] = card

        touch_deck_and_parent_folders(target_deck_id, deck_obj=target_deck)
        for s_deck_id in affected_source_decks:
            touch_deck_and_parent_folders(s_deck_id)

    logger.info(f"User {user_id} moved cards to deck {target_deck_id}: moved={moved_count}, updated={updated_count}, skipped={skipped_count}")
    return {"status": "success", "count": moved_count + updated_count, "moved": moved_count, "updated": updated_count, "skipped": skipped_count}


def batch_copy_cards(card_ids: list[int], target_deck_id: int, user_id: int, on_duplicate: str = 'skip') -> dict:
    """Массово копирует карточки в целевую колоду с обработкой совпадений по front_text."""
    from fastapi import HTTPException
    from .collaborative_service import _require_can_mutate, _require_cards_access, touch_deck_and_parent_folders
    from .media import validate_new_audio_path

    if not card_ids:
        return {"status": "success", "count": 0, "created": 0, "updated": 0, "skipped": 0}

    target_deck = TMA_Deck.get_or_none(TMA_Deck.id == target_deck_id)
    if not target_deck or target_deck.is_deleted:
        raise HTTPException(status_code=404, detail="Целевая колода не найдена")

    _require_can_mutate(user_id, 'deck', target_deck_id)
    _require_cards_access(card_ids, user_id, write=False)

    # Вычисляем максимальную позицию в целевой колоде
    max_pos = TMA_Card.select(fn.MAX(TMA_Card.position)).where(
        (TMA_Card.deck_id == target_deck_id) & (TMA_Card.is_deleted == False)
    ).scalar() or 0

    cards = list(TMA_Card.select().where((TMA_Card.id.in_(card_ids)) & (TMA_Card.is_deleted == False)))
    valid_cards = cards

    if not valid_cards:
        return {"status": "success", "count": 0, "created": 0, "updated": 0, "skipped": 0}

    # Сохраняем строгий порядок выбора карточек пользователем
    card_by_id = {c.id: c for c in valid_cards}
    valid_cards = [card_by_id[cid] for cid in card_ids if cid in card_by_id]

    # Загружаем существующие карточки целевой колоды для проверки совпадений по front_text
    existing_cards = list(TMA_Card.select().where(
        (TMA_Card.deck_id == target_deck_id) & (TMA_Card.is_deleted == False)
    ))
    existing_by_front = {
        normalize_card_key(c.front_text): c
        for c in existing_cards if normalize_card_key(c.front_text)
    }

    created_count = 0
    updated_count = 0
    skipped_count = 0
    now = datetime.datetime.now()

    with tma_db.atomic():
        for idx, card in enumerate(valid_cards):
            front_key = normalize_card_key(card.front_text)
            existing_match = existing_by_front.get(front_key) if front_key else None

            if existing_match and on_duplicate == 'skip':
                skipped_count += 1
                continue

            if existing_match and on_duplicate == 'overwrite':
                validate_new_audio_path(card.audio_path, existing_match.audio_path)
                validate_new_audio_path(card.audio_back_path, existing_match.audio_back_path)
                existing_match.front_text = card.front_text or ''
                existing_match.back_text = card.back_text or ''
                existing_match.card_type = card.card_type or existing_match.card_type or 'standard'
                existing_match.context = card.context or ''
                if card.image_path:
                    existing_match.image_path = card.image_path
                if card.audio_path:
                    existing_match.audio_path = card.audio_path
                if card.audio_back_path:
                    existing_match.audio_back_path = card.audio_back_path
                if card.video_front_path:
                    existing_match.video_front_path = card.video_front_path
                if card.video_back_path:
                    existing_match.video_back_path = card.video_back_path
                if card.tags:
                    existing_match.tags = card.tags
                if card.metadata:
                    existing_match.metadata = card.metadata
                # Синхронизируем позицию согласно выбранному порядку (1..N)
                existing_match.position = idx + 1
                existing_match.updated_at = now
                existing_match.save()
                updated_count += 1
                continue

            # on_duplicate == 'keep' или совпадений нет -> создаем новую карточку
            validate_new_audio_path(card.audio_path)
            validate_new_audio_path(card.audio_back_path)
            if max_pos == 0 and len(existing_cards) == 0:
                card_pos = card.position if (card.position is not None and card.position > 0) else (idx + 1)
            else:
                max_pos += 1
                card_pos = max_pos
            new_c = TMA_Card.create(
                deck_id=target_deck_id,
                front_text=card.front_text or '',
                back_text=card.back_text or '',
                context=card.context or '',
                image_path=card.image_path,
                audio_path=card.audio_path,
                audio_back_path=card.audio_back_path,
                video_front_path=card.video_front_path,
                video_back_path=card.video_back_path,
                card_type=card.card_type or 'standard',
                tags=card.tags or '',
                metadata=card.metadata,
                position=card_pos,
                source='user',
                creator_id=card.creator_id,
                is_deleted=False,
                created_at=now,
                updated_at=now
            )
            created_count += 1
            if front_key:
                existing_by_front[front_key] = new_c

        touch_deck_and_parent_folders(target_deck_id, deck_obj=target_deck)

    logger.info(f"User {user_id} copied cards to deck {target_deck_id}: created={created_count}, updated={updated_count}, skipped={skipped_count}")
    return {"status": "success", "count": created_count + updated_count, "created": created_count, "updated": updated_count, "skipped": skipped_count}
