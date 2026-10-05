from fastapi import APIRouter, HTTPException, Depends
import logging
from typing import Literal
from pydantic import BaseModel, Field, model_validator
from api.services.collaborative_service import get_effective_user_role

try:
    from api import services, srs, models
except ImportError:
    import services, srs, models
from api.dependencies.auth import get_user_id

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["study"],
)

async def _card_to_response(card, progress, user_id: int, review_context='scheduled'):
    """Формирует ответ с данными карты. Вынесено для переиспользования."""
    creator_name = None
    creator_avatar = None
    if getattr(card, 'creator_id', None):
        creator = models.TMAUser.get_or_none(models.TMAUser.user_id == card.creator_id)
        if creator:
            creator_name = creator.username or creator.first_name
            creator_avatar = creator.photo_url

    # Fetch deck explicitly to bypass any Peewee relationship caching issues
    deck = None
    if card.deck_id:
        try:
            deck = models.TMA_Deck.get_or_none(models.TMA_Deck.id == card.deck_id)
        except Exception:
            pass

    import json
    deck_metadata = {"resources": []}
    if deck and getattr(deck, 'metadata', None):
        try:
            deck_metadata = json.loads(deck.metadata)
        except Exception: pass
    
    resolved_resources = []
    for res in deck_metadata.get('resources', []):
        res_type = res.get('type')
        path = res.get('path')
        url = res.get('url')
        if path:
            if res_type == 'image':
                url = services.resolve_media_url(path, 'images')
            elif res_type == 'audio':
                url = services.resolve_media_url(path, 'audio')
            elif res_type == 'video':
                url = services.resolve_media_url(path, 'videos')
        item = {**res}
        if url:
            item['url'] = url
        resolved_resources.append(item)
    deck_metadata['resources'] = resolved_resources

    lapses = getattr(progress, 'lapses', 0) or 0
    is_leech_flag = srs.is_leech(lapses)
    queue = getattr(progress, 'queue', 'new') or 'new'
    interval = getattr(progress, 'interval', 0) or 0
    ease_factor = getattr(progress, 'ease_factor', 2.5) or 2.5
    repetitions = getattr(progress, 'repetitions', 0) or 0

    tags_val = getattr(card, 'tags', None)
    level_label = None
    if tags_val:
        for lvl in ["A1", "A2", "B1", "B2", "C1", "C2"]:
            if lvl in str(tags_val).upper():
                level_label = lvl
                break
    if not getattr(card, 'audio_path', None) and getattr(card, 'front_text', None):
        try:
            await services.ensure_card_audio(card, user_id)
        except Exception as audio_err:
            logger.warning(f"Failed to ensure card audio in _card_to_response: {audio_err}")

    return {
        "id": card.id,
        "front": card.front_text,
        "back": card.back_text,
        "context": card.context,
        "tags": tags_val,
        "level": level_label,
        "audio_url": services.resolve_media_url(card.audio_path, "audio"),
        "audio_back_url": services.resolve_media_url(card.audio_back_path, "audio"),
        "image_url": services.resolve_media_url(card.image_path, "images"),
        "video_front_url": services.resolve_media_url(card.video_front_path, "videos"),
        "video_back_url": services.resolve_media_url(card.video_back_path, "videos"),
        "intervals": srs.get_next_intervals(progress, review_context=review_context),
        "next_review": progress.next_review.isoformat() if progress.next_review else None,
        "last_reviewed": progress.last_reviewed.isoformat() if progress.last_reviewed else None,
        "is_leech": is_leech_flag,
        "lapses": lapses,
        "queue": queue,
        "interval": interval,
        "ease_factor": ease_factor,
        "repetitions": repetitions,
        "audio_path": card.audio_path,
        "audio_back_path": card.audio_back_path,
        "creator_name": creator_name,
        "creator_avatar": creator_avatar,
        "flag": int(getattr(progress, 'flag', 0) or 0),
        "deck_id": card.deck_id,
        "deck_name": deck.name if deck else None,
        "deck_metadata": deck_metadata,
        "deck_stats": services.get_deck_stats_counts(user_id, card.deck_id)
    }

@router.get("/study/stats")
async def get_study_stats(user_id: int = Depends(get_user_id)):
    """Возвращает аналитику интервального повторения (SRS) пользователя."""
    now = models.datetime.datetime.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    try:
        # 1. Сбор карточек пользователя и их SRS-прогресса
        user_cards_query = (
            models.TMA_Card
            .select(
                models.TMA_Card.id,
                models.TMAProgress.queue,
                models.TMAProgress.interval,
                models.TMAProgress.lapses,
                models.TMAProgress.next_review
            )
            .join(models.TMA_Deck, on=(models.TMA_Card.deck == models.TMA_Deck.id))
            .join(
                models.TMAProgress,
                models.JOIN.LEFT_OUTER,
                on=((models.TMAProgress.card_id == models.TMA_Card.id) & (models.TMAProgress.user_id == user_id))
            )
            .where(
                (models.TMA_Deck.user_id == user_id) &
                (models.TMA_Deck.is_deleted == False) &
                (models.TMA_Card.is_deleted == False)
            )
        )

        total_cards = 0
        new_count = 0
        learning_count = 0
        young_count = 0
        mature_count = 0
        leech_count = 0
        forecast_days = [0] * 7

        for row in user_cards_query.dicts():
            total_cards += 1
            q = row.get('queue') or 'new'
            interval = row.get('interval') or 0
            lapses = row.get('lapses') or 0
            next_review = row.get('next_review')

            if q == 'new':
                new_count += 1
            elif q in ['learning', 'relearning']:
                learning_count += 1
            elif q == 'review':
                if interval >= 21:
                    mature_count += 1
                else:
                    young_count += 1

            if srs.is_leech(lapses):
                leech_count += 1

            if next_review:
                if isinstance(next_review, str):
                    try:
                        next_review = models.datetime.datetime.fromisoformat(next_review)
                    except Exception:
                        next_review = None
                if isinstance(next_review, models.datetime.datetime):
                    diff = (next_review.date() - today_start.date()).days
                    if 0 <= diff < 7:
                        forecast_days[diff] += 1

        # 2. Retention rate за последние 30 дней
        thirty_days_ago = now - models.datetime.timedelta(days=30)
        reviews_30d = list(
            models.TMAReviewHistory
            .select(models.TMAReviewHistory.rating)
            .where(
                (models.TMAReviewHistory.user_id == user_id) &
                (models.TMAReviewHistory.review_time >= thirty_days_ago)
            )
        )

        total_reviews = len(reviews_30d)
        success_reviews = sum(1 for r in reviews_30d if (r.rating in [2, 3] if r.rating <= 3 else r.rating >= 4))
        retention_rate = round((success_reviews / total_reviews * 100), 1) if total_reviews > 0 else 85.0

        day_names = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
        forecast_result = []
        for i in range(7):
            target_date = today_start + models.datetime.timedelta(days=i)
            forecast_result.append({
                "day_index": i,
                "date": target_date.strftime("%Y-%m-%d"),
                "day_name": day_names[target_date.weekday()],
                "count": forecast_days[i]
            })

        return {
            "total_cards": total_cards,
            "new_cards": new_count,
            "learning_cards": learning_count,
            "young_cards": young_count,
            "mature_cards": mature_count,
            "leech_cards": leech_count,
            "total_reviews_30d": total_reviews,
            "retention_rate": retention_rate,
            "forecast_7d": forecast_result
        }
    except Exception as e:
        logger.error(f"Error in get_study_stats: {e}", exc_info=True)
        return {
            "total_cards": 0,
            "new_cards": 0,
            "learning_cards": 0,
            "young_cards": 0,
            "mature_cards": 0,
            "leech_cards": 0,
            "total_reviews_30d": 0,
            "retention_rate": 85.0,
            "forecast_7d": []
        }

@router.get("/study/card/{card_id}")
async def get_study_card(card_id: int, user_id: int = Depends(get_user_id)):
    """Возвращает конкретную карту для изучения."""
    card = models.TMA_Card.get_or_none((models.TMA_Card.id == card_id) & (models.TMA_Card.is_deleted == False))
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
        
    progress, _ = models.TMAProgress.get_or_create(
        card_id=card.id,
        user_id=user_id,
        defaults={"queue": "new", "next_review": models.datetime.datetime.now()}
    )
    return await _card_to_response(card, progress, user_id)

@router.get("/decks/{deck_id}/next")
async def get_next_card(deck_id: int, exclude_ids: str = None, learn_more: bool = False, user_id: int = Depends(get_user_id), review_context: Literal['scheduled', 'forced'] = 'scheduled'):
    """Выбор следующей карты для изучения (SRS)."""
    parsed_exclude = []
    if exclude_ids:
        try:
            parsed_exclude = [int(i) for i in exclude_ids.split(',') if i.strip()]
        except ValueError:
            pass

    _require_study_access(user_id, deck_id)
    context = 'forced' if learn_more else review_context
    card, progress = services.get_next_card(user_id, deck_id, exclude_ids=parsed_exclude, review_context=context)
    
    if isinstance(card, dict) and "error" in card:
        return card # Возвращаем ошибку для отладки
        
    if not card:
        logger.info(f"User {user_id} finished deck {deck_id}")
        return {"finished": True}
    
    logger.info(f"NEXT CARD: user={user_id}, deck={deck_id}, card={card.id}")
    return await _card_to_response(card, progress, user_id, context)


def _require_study_access(user_id, deck_id, card_id=None):
    deck = models.TMA_Deck.get_or_none((models.TMA_Deck.id == deck_id) & (models.TMA_Deck.is_deleted == False))
    if not deck or not get_effective_user_role(user_id, 'deck', deck_id):
        raise HTTPException(403, 'Нет доступа к колоде')
    if card_id is not None and not models.TMA_Card.get_or_none(
        (models.TMA_Card.id == card_id) & (models.TMA_Card.deck_id == deck_id) & (models.TMA_Card.is_deleted == False)
    ):
        raise HTTPException(404, 'Card not found in deck')


class StudyGradeRequest(BaseModel):
    card_id: int
    deck_id: int
    grade: int = Field(ge=0, le=7)
    is_extended: bool = False
    learn_more: bool = False
    review_context: Literal['scheduled', 'forced'] = 'scheduled'
    exclude_ids: list[int] = Field(default_factory=list)

    @model_validator(mode='after')
    def standard_scale(self):
        if not self.is_extended and self.grade > 3:
            raise ValueError('Standard grade must be between 0 and 3')
        return self

@router.post("/study/grade")
async def submit_grade(data: StudyGradeRequest, user_id: int = Depends(get_user_id)):
    _require_study_access(user_id, data.deck_id, data.card_id)
    context = 'forced' if data.learn_more else data.review_context
    async def run_grade():
        logger.info(f"submit_grade: User {user_id}, Data: {data}")
        services.update_card_progress(
            data.card_id,
            user_id, 
            data.grade,
            is_extended=data.is_extended,
            review_context=context
        )
        logger.info("submit_grade: Progress updated successfully")
        
        # Сразу получаем следующую карту (без повторного HTTP-вызова)
        exclude = list(set([*data.exclude_ids, data.card_id])) if context == 'forced' else data.exclude_ids
        card, progress = services.get_next_card(user_id, data.deck_id, exclude_ids=exclude, review_context=context)
        if isinstance(card, dict) and "error" in card:
            return card
        if not card:
            return {"finished": True}
        return await _card_to_response(card, progress, user_id, context)

    try:
        return await run_grade()
    except Exception as e:
        if "connection already closed" in str(e).lower():
            try:
                models.tma_db.close()
            except Exception:
                pass
            try:
                models.tma_db.connect(reuse_if_open=True)
                return await run_grade()
            except Exception as retry_error:
                logger.error(f"submit_grade RETRY ERROR: {retry_error}")
                raise HTTPException(status_code=500, detail=str(retry_error))
        logger.error(f"submit_grade ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/study/duplicates/next")
async def get_next_duplicate_card(exclude_ids: str = None, user_id: int = Depends(get_user_id)):
    """Выбор следующего дубликата для изучения."""
    parsed_exclude = []
    if exclude_ids:
        try:
            parsed_exclude = [int(i) for i in exclude_ids.split(',') if i.strip()]
        except ValueError: pass
    
    card, progress = services.get_next_duplicate_card(user_id, exclude_ids=parsed_exclude)
    if not card:
        return {"finished": True}
    return await _card_to_response(card, progress, user_id)

@router.post("/study/duplicates/grade")
async def submit_duplicate_grade(data: dict, user_id: int = Depends(get_user_id)):
    """Сохранение оценки для дубликата и переход к следующему."""
    services.update_card_progress(
        data['card_id'], 
        user_id, 
        data['grade'], 
        is_extended=bool(data.get('is_extended', False))
    )
    card, progress = services.get_next_duplicate_card(user_id)
    if not card:
        return {"finished": True}
    return await _card_to_response(card, progress, user_id)
