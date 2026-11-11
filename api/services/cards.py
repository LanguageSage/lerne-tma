import datetime
import logging
import json
import hashlib
from fastapi import HTTPException
from ..models import TMA_Deck, TMA_Card, TMAProgress, tma_db, TMAOfflineBatch
from .. import srs
from peewee import fn, JOIN, Case

logger = logging.getLogger(__name__)

from .media import resolve_media_url, _build_media_exists_map
from .utils import resolve_deck_metadata



def set_card_flag(card_id: int, user_id: int, flag: int):
    """Sets per-user flag (colour label) on a card via TMAProgress.
    Any authenticated user who can see the card can set their own flag.
    The canonical TMA_Card.flag is NOT modified.
    """
    try:
        card = TMA_Card.get_or_none((TMA_Card.id == card_id) & (TMA_Card.is_deleted == False))
        if not card:
            raise ValueError(f"Card {card_id} not found")
        # Verify user can access this card (has at least viewer role on its deck)
        from .collaborative_service import get_effective_user_role
        deck = TMA_Deck.get_or_none(TMA_Deck.id == card.deck_id) if card.deck_id else None
        if not deck or not get_effective_user_role(user_id, 'deck', card.deck_id):
            raise PermissionError("No access to this card")
        # Write to TMAProgress (per-user), not to TMA_Card (canonical)
        progress, _ = TMAProgress.get_or_create(
            card_id=card_id,
            user_id=user_id,
            defaults={'queue': 'new', 'flag': 0, 'want_to_learn': False}
        )
        progress.flag = int(flag) if flag is not None else 0
        progress.updated_at = datetime.datetime.now()
        progress.save(only=[TMAProgress.flag, TMAProgress.updated_at])
        return {'id': card_id, 'flag': progress.flag}
    except Exception as e:
        logger.error(f"Error setting card flag: {e}", exc_info=True)
        raise e





def _build_card_dict(c, p=None, media_exists=None, include_intervals=False, creator=None):
    is_dict = isinstance(c, dict)
    get_val = lambda k_dict, k_obj: c.get(k_dict) if is_dict else getattr(c, k_obj, None)

    audio_path = get_val('audio_path', 'audio_path')
    audio_back_path = get_val('audio_back_path', 'audio_back_path')
    image_path = get_val('image_path', 'image_path')
    video_front = get_val('video_front_path', 'video_front_path')
    video_back = get_val('video_back_path', 'video_back_path')

    creator_name = None
    creator_avatar = None
    if creator:
        if isinstance(creator, dict):
            creator_name = creator.get('username') or creator.get('first_name')
            creator_avatar = creator.get('photo_url')
        else:
            creator_name = creator.username or creator.first_name
            creator_avatar = creator.photo_url

    get_p = lambda k: p.get(k) if isinstance(p, dict) else getattr(p, k, None) if p else None
    lapses = get_p('lapses') or 0
    queue = get_p('queue') or "new"
    interval = get_p('interval') or 0
    flag = get_p('flag')
    if flag is None:
        flag = get_val('flag', 'flag')

    result = {
        "id": get_val('id', 'id'),
        "deck_id": get_val('deck_id', 'deck_id'),
        "audio_url": resolve_media_url(audio_path, "audio", exists_map=media_exists),
        "audio_back_url": resolve_media_url(audio_back_path, "audio", exists_map=media_exists),
        "image_url": resolve_media_url(image_path, "images", exists_map=media_exists),
        "video_front_url": resolve_media_url(video_front, "videos", exists_map=media_exists),
        "video_back_url": resolve_media_url(video_back, "videos", exists_map=media_exists),
        "image_path": image_path,
        "audio_path": audio_path,
        "audio_back_path": audio_back_path,
        "video_front_path": video_front,
        "video_back_path": video_back,
        # flag and want_to_learn are per-user: read from TMAProgress (p) first
        "flag": int(flag or 0),
        "want_to_learn": bool(get_p('want_to_learn') or get_val('want_to_learn', 'want_to_learn') or False),
        "creator_name": creator_name,
        "creator_avatar": creator_avatar,
        "is_leech": srs.is_leech(lapses),
        "lapses": lapses,
        "queue": queue,
        "interval": interval
    }

    from .structured_card_api import content_response
    result.update(content_response(c))

    if include_intervals:
        result["intervals"] = srs.get_next_intervals(p)
    else:
        nr = get_p('next_review')
        result["next_review"] = nr.isoformat() if hasattr(nr, 'isoformat') else (str(nr) if nr else None)

    return result


def get_cards_for_study(deck_id: int, user_id: int):
    """Возвращает список всех карточек в колоде. Оптимизировано: проекция полей без BLOB и исключение лишних проверок."""
    try:
        from .collaborative_service import get_effective_user_role
        if not get_effective_user_role(user_id, 'deck', deck_id):
            raise HTTPException(status_code=403, detail="Access denied")
        # Явная проекция колонок без загрузки тяжелого image_data BLOB и history
        cards_query = TMA_Card.select(
            TMA_Card.id,
            TMA_Card.deck.alias('deck_id'),
            TMA_Card.content_v2,
            TMA_Card.updated_at,
            TMA_Card.audio_path,
            TMA_Card.audio_back_path,
            TMA_Card.image_path,
            TMA_Card.video_front_path,
            TMA_Card.video_back_path,
            TMA_Card.position,
            TMA_Card.creator_id,
            TMA_Card.source
        ).where(
            TMA_Card.deck_id == deck_id,
            TMA_Card.is_deleted == False
        ).order_by(TMA_Card.position.asc(), TMA_Card.id.asc())

        cards_query = cards_query.where(TMA_Card.content_v2.is_null(False))
        cards = list(cards_query.dicts())

        if not cards:
            return []

        # Получаем прогресс напрямую по ID карточек через уникальный индекс (user_id, card_id) в формате dict
        card_ids = [c['id'] for c in cards]
        progress_map = {}
        if card_ids:
            for i in range(0, len(card_ids), 500):
                chunk = card_ids[i:i+500]
                chunk_query = (TMAProgress.select(
                                  TMAProgress.card_id,
                                  TMAProgress.queue,
                                  TMAProgress.interval,
                                  TMAProgress.lapses,
                                  TMAProgress.next_review,
                                  TMAProgress.flag,
                                  TMAProgress.want_to_learn
                              )
                              .where((TMAProgress.user_id == user_id) & (TMAProgress.card_id << chunk))
                              .dicts())
                for p in chunk_query:
                    progress_map[p['card_id']] = p

        creator_ids = list(set([c.get('creator_id') for c in cards if c.get('creator_id')]))
        creators = {}
        if creator_ids:
            from ..models import TMAUser
            for u in TMAUser.select(TMAUser.user_id, TMAUser.username, TMAUser.first_name, TMAUser.photo_url).where(TMAUser.user_id << creator_ids).dicts():
                creators[u['user_id']] = u

        # Audio URLs resolve directly to Storage; batch only image/video existence checks.
        media_exists = _build_media_exists_map([
            {field: card.get(field) for field in ('image_path', 'video_front_path', 'video_back_path')}
            for card in cards
        ])
        result = []
        for c in cards:
            p = progress_map.get(c['id'])
            creator = creators.get(c.get('creator_id'))
            result.append(_build_card_dict(c, p=p, media_exists=media_exists, creator=creator))
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_cards_for_study: {e}", exc_info=True)
        raise e


def get_next_card(user_id: int, deck_id: int, exclude_ids: list = None, learn_more: bool = False, review_context='scheduled'):
    """Выбирает следующую карту для изучения (SRS). Оптимизировано: JOIN вместо 2 запросов."""
    try:
        now = datetime.datetime.now()
        exclude_ids = exclude_ids or []
        learn_more = learn_more or review_context == 'forced'
        active_card = (TMA_Card.is_deleted == False)
        active_card &= TMA_Card.content_v2.is_null(False)

        # Функция для поиска новой карты
        def get_new_card():
            subquery = TMAProgress.select(TMAProgress.card_id).where(
                TMAProgress.card_id == TMA_Card.id,
                TMAProgress.user_id == user_id
            )
            new_query = (TMA_Card.select()
                         .where(
                             TMA_Card.deck_id == deck_id,
                             active_card,
                             ~fn.EXISTS(subquery)
                         ))
            if exclude_ids:
                new_query = new_query.where(~(TMA_Card.id << exclude_ids))
            return new_query.order_by(TMA_Card.position, TMA_Card.id).first()

        # Функция для поиска карты на повторение (или раннее повторение при learn_more)
        def get_due_card():
            due_query = (TMAProgress
                        .select(TMAProgress, TMA_Card)
                        .join(TMA_Card, on=(TMAProgress.card_id == TMA_Card.id))
                        .where(
                            TMAProgress.user_id == user_id,
                            TMA_Card.deck_id == deck_id,
                            active_card
                        ))
            if not learn_more:
                due_query = due_query.where(TMAProgress.next_review <= now)

            if exclude_ids:
                due_query = due_query.where(~(TMAProgress.card_id << exclude_ids))

            p = due_query.order_by(TMAProgress.queue.asc(), TMAProgress.next_review.asc()).first()
            if p:
                c = getattr(p, 'tma_card', None) or getattr(p, 'card', None)
                if not c:
                    c = TMA_Card.get_by_id(p.card_id)
                return c, p
            return None, None

        # Функция для поиска карточек в процессе обучения, запланированных на сегодня
        def get_today_learning_card():
            end_of_day = now.replace(hour=23, minute=59, second=59, microsecond=999999)
            learning_query = (TMAProgress
                              .select(TMAProgress, TMA_Card)
                              .join(TMA_Card, on=(TMAProgress.card_id == TMA_Card.id))
                              .where(
                                  TMAProgress.user_id == user_id,
                                  TMA_Card.deck_id == deck_id,
                                  active_card,
                                  TMAProgress.queue << ['learning', 'relearning'],
                                  TMAProgress.next_review <= end_of_day
                              ))
            if exclude_ids:
                learning_query = learning_query.where(~(TMAProgress.card_id << exclude_ids))

            p = learning_query.order_by(TMAProgress.next_review.asc()).first()
            if p:
                c = getattr(p, 'tma_card', None) or getattr(p, 'card', None)
                if not c:
                    c = TMA_Card.get_by_id(p.card_id)
                return c, p
            return None, None

        # Forced traversal follows the deck order; SRS only affects grading.
        if learn_more:
            query = TMA_Card.select().where(
                TMA_Card.deck_id == deck_id,
                active_card,
            )
            if exclude_ids:
                query = query.where(~(TMA_Card.id << exclude_ids))
            card = query.order_by(TMA_Card.position.asc(), TMA_Card.id.asc()).first()
            if card:
                progress, _ = TMAProgress.get_or_create(
                    card_id=card.id,
                    user_id=user_id,
                    defaults={"queue": "new", "next_review": now}
                )
                return card, progress

            return None, None
        else:
            card, progress = get_due_card()
            if card:
                return card, progress

            card = get_new_card()
            if card:
                progress, _ = TMAProgress.get_or_create(
                    card_id=card.id,
                    user_id=user_id,
                    defaults={"queue": "new", "next_review": now}
                )
                return card, progress

            return get_today_learning_card()

    except Exception as e:
        logger.error(f"Error in get_next_card: {e}")
        raise


def format_card_for_study(card: TMA_Card, user_id: int, deck_obj = None, media_exists=None, deck_metadata=None):
    """Форматирует карту для StudyView (с URL и интервалами)."""
    is_new = getattr(card, '_is_new', False)
    progress = None
    if not is_new and hasattr(card, 'id') and card.id:
        progress = TMAProgress.get_or_none(
            TMAProgress.card_id == card.id,
            TMAProgress.user_id == user_id
        )

    res = _build_card_dict(card, p=progress, media_exists=media_exists, include_intervals=True)

    # ⚠️ CRITICAL STABILITY GUARANTEE: DO NOT ALTER OR REMOVE DECK RESOLUTION LOGIC.
    # Safely handle both model objects (TMA_Card) and dictionaries (.dicts()) without throwing AttributeError.
    deck = deck_obj or getattr(card, '_cached_deck', None)
    deck_id = card.get('deck_id') if isinstance(card, dict) else getattr(card, 'deck_id', None)
    if not deck and not isinstance(card, dict):
        try:
            deck = getattr(card, 'deck', None)
        except Exception:
            pass
    if not deck and deck_id:
        try:
            deck = TMA_Deck.get_or_none(TMA_Deck.id == deck_id)
        except Exception:
            pass

    deck_name = deck.name if deck else (card.get('deck_name') if isinstance(card, dict) else getattr(card, 'deck_name', None))
    res["deck_name"] = deck_name or "Без колоды"

    if deck_metadata is None:
        deck_metadata = resolve_deck_metadata(deck)

    res["deck_metadata"] = deck_metadata
    return res


def _native_duplicates(user_id):
    scope = ((TMA_Deck.user_id == user_id) & (TMA_Deck.is_deleted == False) &
             (TMA_Card.is_deleted == False) & TMA_Card.content_v2.is_null(False))
    keys = (TMA_Card.select(TMA_Card.content_v2).join(TMA_Deck).where(scope)
            .group_by(TMA_Card.content_v2).having(fn.COUNT(TMA_Card.id) > 1))
    return (TMA_Card.select(TMA_Card, TMA_Deck).join(TMA_Deck)
            .where(scope, TMA_Card.content_v2.in_(keys)).order_by(TMA_Card.deck_id, TMA_Card.position, TMA_Card.id))


def get_duplicate_cards(user_id: int):
    cards = list(_native_duplicates(user_id))
    flags = {progress.card_id: progress.flag for progress in TMAProgress.select(
        TMAProgress.card_id, TMAProgress.flag).where(
            TMAProgress.user_id == user_id, TMAProgress.card_id.in_([card.id for card in cards]))}
    return [{**_build_card_dict(card, p={'flag': flags.get(card.id, 0)}), 'deck_name': card.deck.name}
            for card in cards]


def get_next_duplicate_card(user_id: int, exclude_ids: list = None):
    query = _native_duplicates(user_id)
    if exclude_ids:
        query = query.where(TMA_Card.id.not_in(exclude_ids))
    card = query.first()
    if card is None:
        return None, None
    progress, _ = TMAProgress.get_or_create(card_id=card.id, user_id=user_id,
        defaults={'queue': 'new', 'next_review': datetime.datetime.now()})
    return card, progress


def prepare_ai_batch(request_data: dict, user_id: int, import_id: str = None) -> dict:
    """Authorize before provider work and replay a committed AI batch receipt."""
    with tma_db.connection_context():
        deck_id = request_data.get('deck_id')
        target_language = request_data.get('target_language') or 'de'
        if deck_id:
            deck = TMA_Deck.get_or_none((TMA_Deck.id == deck_id) & (TMA_Deck.is_deleted == False))
            if not deck:
                raise HTTPException(404, 'Колода не найдена')
            from .collaborative_service import _require_can_mutate
            _require_can_mutate(user_id, 'deck', deck_id)
            if target_language == 'de' and deck.target_language:
                target_language = deck.target_language
        response = None
        if import_id:
            receipt = TMAOfflineBatch.get_or_none(TMAOfflineBatch.key == f'ai:{user_id}:{import_id}')
            if receipt:
                response = _replay_ai_batch(receipt, request_data)
        return {'target_language': target_language, 'response': response}


def _ai_batch_hash(request_data):
    return hashlib.sha256(json.dumps(request_data, sort_keys=True, ensure_ascii=False,
                                     separators=(',', ':')).encode('utf-8')).hexdigest()


def _replay_ai_batch(receipt, request_data):
    if receipt.payload_hash != _ai_batch_hash(request_data):
        raise HTTPException(409, 'Идентификатор импорта уже использован с другими данными')
    return json.loads(receipt.response)


def save_ai_batch_result(result: dict, request_data: dict, user_id: int, import_id: str = None) -> dict:
    """Commit cards and their complete AI response together; concurrent retries replay."""
    with tma_db.connection_context(), tma_db.atomic():
        receipt = None
        if import_id:
            key = f'ai:{user_id}:{import_id}'
            inserted = list(TMAOfflineBatch.insert(
                key=key, payload_hash=_ai_batch_hash(request_data), response='')
                .on_conflict_ignore().returning(TMAOfflineBatch.key).execute())
            receipt = TMAOfflineBatch.get_by_id(key)
            if not inserted:
                return _replay_ai_batch(receipt, request_data)

        from uuid import uuid4
        from .structured_card_api import BulkSave, bulk_save

        payload = [{'deck_id': request_data['deck_id'], 'content_v2': card['content_v2']}
                   for card in result['cards']]
        saved = bulk_save(BulkSave(import_id=uuid4(), cards=payload,
                                  placement=request_data.get('placement', 'end')), user_id)
        response = {**result, 'saved_cards': saved['cards'], 'save_result': saved, 'status': 'success'}
        serialized = json.dumps(response, ensure_ascii=False)
        if receipt:
            receipt.response = serialized
            receipt.save()
        return json.loads(serialized)




def get_deck_stats_counts(user_id: int, deck_id: int) -> dict:
    """Подсчитывает живое распределение карточек колоды: new, due (сегодня), learning, total."""
    try:
        now = datetime.datetime.now()
        tracked_case = Case(None, [(TMAProgress.queue != 'new', 1)], None)
        learning_case = Case(None, [(TMAProgress.queue << ['learning', 'relearning'], 1)], None)
        due_case = Case(None, [((TMAProgress.queue == 'review') & (TMAProgress.next_review <= now), 1)], None)

        scope = (TMA_Card.deck_id == deck_id) & (TMA_Card.is_deleted == False)
        scope &= TMA_Card.content_v2.is_null(False)
        row = (TMA_Card
               .select(
                   fn.COUNT(TMA_Card.id).alias('total'),
                   fn.COUNT(tracked_case).alias('tracked'),
                   fn.COUNT(learning_case).alias('learning'),
                   fn.COUNT(due_case).alias('due')
               )
               .join(TMAProgress, JOIN.LEFT_OUTER, on=(
                   (TMAProgress.card_id == TMA_Card.id) & (TMAProgress.user_id == user_id)
               ))
               .where(scope)
               .dicts()
               .first())

        if not row:
            return {"total": 0, "new": 0, "learning": 0, "due": 0}

        total = int(row.get('total') or 0)
        tracked = int(row.get('tracked') or 0)
        return {
            "total": total,
            "new": max(0, total - tracked),
            "learning": int(row.get('learning') or 0),
            "due": int(row.get('due') or 0)
        }
    except Exception as e:
        return {"total": 0, "new": 0, "learning": 0, "due": 0}


import unicodedata

def _norm(text: str) -> str:
    if not text:
        return ""
    t = unicodedata.normalize('NFD', str(text).lower())
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn')
    return t.replace('ß', 'ss').replace('ä', 'a').replace('ö', 'o').replace('ü', 'u').strip()

def search_all_in_scope(user_id: int, query: str, folder_id: int = None, target_language: str = 'de', limit: int = 60):
    """Сквозной поиск по папкам, колодам и карточкам (front/back) в области видимости."""
    from .folders import get_active_folders
    from .decks import get_active_decks
    from ..models import TMA_Folder, TMA_Card
    from .structured_card_api import content_response

    def searchable(node):
        if isinstance(node, str):
            yield node
        elif isinstance(node, (dict, list)):
            values = node.values() if isinstance(node, dict) else node
            for value in values:
                yield from searchable(value)

    q = (query or '').strip()
    if not q:
        return {"folders": [], "decks": [], "cards": []}

    qn = _norm(q)
    match_fn = lambda s: bool(s and (q.lower() in str(s).lower() or qn in _norm(s)))
    lang = (target_language or 'de').lower().strip()

    all_folders = get_active_folders(user_id)
    all_decks = get_active_decks(user_id)

    if folder_id:
        f_map = {f.id: getattr(f, 'parent_id', None) for f in TMA_Folder.select(TMA_Folder.id, TMA_Folder.parent).where(TMA_Folder.is_deleted == False)}
        scope_ids, q_ids = {int(folder_id)}, [int(folder_id)]
        while q_ids:
            curr = q_ids.pop(0)
            kids = [fid for fid, pid in f_map.items() if pid == curr and fid not in scope_ids]
            scope_ids.update(kids)
            q_ids.extend(kids)
        scoped_folders = [f for f in all_folders if f.get('id') in scope_ids and f.get('id') != int(folder_id)]
        scoped_decks = [d for d in all_decks if d.get('folder_id') in scope_ids]
    else:
        scoped_folders = [f for f in all_folders if (f.get('target_language') or 'de') == lang]
        scoped_decks = [d for d in all_decks if (d.get('target_language') or 'de') == lang]

    matched_folders = [f for f in scoped_folders if match_fn(f.get('name'))]
    matched_decks = [d for d in scoped_decks if match_fn(d.get('name')) or match_fn(d.get('topic'))]

    deck_map = {d['id']: d for d in scoped_decks}
    matched_cards = []
    deck_card_ids = {}
    if deck_map:
        cards_q = TMA_Card.select().where(TMA_Card.deck_id.in_(list(deck_map)), TMA_Card.is_deleted == False,
                                          TMA_Card.content_v2.is_null(False)).order_by(
                                              TMA_Card.deck_id, TMA_Card.position, TMA_Card.id)
        for c in cards_q:
            content = content_response(c)
            card = content['content_v2']['card']
            if any(match_fn(text) for field in ('data', 'info', 'explanation', 'topics')
                   for text in searchable(card.get(field))):
                if c.deck_id not in deck_card_ids:
                    deck_card_ids[c.deck_id] = [
                        item.id for item in TMA_Card.select(TMA_Card.id)
                        .where(TMA_Card.deck_id == c.deck_id, TMA_Card.is_deleted == False,
                               TMA_Card.content_v2.is_null(False))
                        .order_by(TMA_Card.position.asc(), TMA_Card.id.asc())
                    ]
                card_ids_in_deck = deck_card_ids[c.deck_id]
                try:
                    card_num = card_ids_in_deck.index(c.id) + 1
                except ValueError:
                    card_num = (c.position or 0) + 1

                matched_cards.append({
                    "id": c.id,
                    **content,
                    "deck_id": c.deck_id,
                    "deck_name": deck_map[c.deck_id]['name'],
                    "folder_id": deck_map[c.deck_id].get('folder_id'),
                    "position": c.position,
                    "card_number": card_num,
                    "total_cards": len(card_ids_in_deck),
                    "flag": 0,
                })
                if len(matched_cards) >= limit:
                    break

    if matched_cards:
        flags = {p.card_id: p.flag for p in TMAProgress.select(TMAProgress.card_id, TMAProgress.flag).where(
            (TMAProgress.user_id == user_id) & (TMAProgress.card_id.in_([c['id'] for c in matched_cards]))
        )}
        for card in matched_cards:
            card['flag'] = flags.get(card['id'], 0)
    return {"folders": matched_folders, "decks": matched_decks, "cards": matched_cards}
