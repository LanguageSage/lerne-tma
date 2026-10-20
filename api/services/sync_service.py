import logging
import datetime
from typing import Optional
from fastapi import HTTPException

from api import models
from api.services.decks import ensure_inbox_deck

logger = logging.getLogger(__name__)

# These are the legacy wire fields; v2 additionally carries card metadata/tags.
FOLDER_PULL_FIELDS = (
    models.TMA_Folder.id, models.TMA_Folder.name, models.TMA_Folder.parent_id,
    models.TMA_Folder.color, models.TMA_Folder.target_language, models.TMA_Folder.is_deleted,
    models.TMA_Folder.position, models.TMA_Folder.created_at, models.TMA_Folder.updated_at,
)
DECK_PULL_FIELDS = (
    models.TMA_Deck.id, models.TMA_Deck.name, models.TMA_Deck.level, models.TMA_Deck.topic,
    models.TMA_Deck.target_language, models.TMA_Deck.is_deleted, models.TMA_Deck.is_inbox,
    models.TMA_Deck.is_pinned, models.TMA_Deck.position, models.TMA_Deck.folder_id,
    models.TMA_Deck.created_at, models.TMA_Deck.updated_at,
)
CARD_PULL_FIELDS = (
    models.TMA_Card.id, models.TMA_Card.deck_id, models.TMA_Card.front_text,
    models.TMA_Card.back_text, models.TMA_Card.context, models.TMA_Card.image_path,
    models.TMA_Card.audio_path, models.TMA_Card.audio_back_path,
    models.TMA_Card.video_front_path, models.TMA_Card.video_back_path,
    models.TMA_Card.is_deleted, models.TMA_Card.position, models.TMA_Card.created_at,
    models.TMA_Card.updated_at,
)
PROGRESS_PULL_FIELDS = (
    models.TMAProgress.card_id, models.TMAProgress.queue, models.TMAProgress.interval,
    models.TMAProgress.ease_factor, models.TMAProgress.repetitions, models.TMAProgress.lapses,
    models.TMAProgress.flag, models.TMAProgress.want_to_learn, models.TMAProgress.step_index,
    models.TMAProgress.next_review, models.TMAProgress.last_reviewed,
    models.TMAProgress.created_at, models.TMAProgress.updated_at,
)
CARD_PUSH_FIELDS = (
    models.TMA_Card.id, models.TMA_Card.deck_id, models.TMA_Card.updated_at,
    models.TMA_Card.image_path, models.TMA_Card.audio_path, models.TMA_Card.audio_back_path,
    models.TMA_Card.video_front_path, models.TMA_Card.video_back_path,
)


def parse_iso_datetime(iso_str: Optional[str]) -> datetime.datetime:
    if not iso_str:
        return datetime.datetime.now()
    if iso_str.endswith('Z'):
        iso_str = iso_str[:-1] + '+00:00'
    try:
        dt = datetime.datetime.fromisoformat(iso_str)
        return dt.replace(tzinfo=None)
    except Exception:
        return datetime.datetime.now()


def _merge_media_field(client_val: Optional[str], server_val: Optional[str]) -> Optional[str]:
    """
    Smart selection rule for media preservation:
    If client explicitly sent a non-empty media path, use client's value.
    If client sent None or empty string, but server has a non-empty media path, preserve server's value.
    """
    if client_val and str(client_val).strip():
        return client_val
    return server_val


def execute_sync_push(request, user_id: int) -> dict:
    """Processes offline client changes and applies updates in a single DB transaction."""
    logger.info(f"Sync Push Service: starting for user {user_id}")
    folder_id_map = {}
    deck_id_map = {}
    card_id_map = {}

    try:
        existing_card_ids = [c.id for c in request.cards if c.id > 0]
        existing_cards = {c.id: c for c in models.TMA_Card.select(*CARD_PUSH_FIELDS).where(
            models.TMA_Card.id.in_(existing_card_ids))} if existing_card_ids else {}
        # Validate the whole legacy batch before applying any canonical writes.
        from api.services.collaborative_service import get_effective_user_role
        def require_write(kind, item_id):
            if item_id and item_id > 0 and get_effective_user_role(user_id, kind, item_id) not in ('owner', 'editor'):
                raise HTTPException(status_code=403, detail="Нет доступа к записи")

        for folder in request.folders:
            require_write('folder', folder.id)
            require_write('folder', folder.parent_id)
        for deck in request.decks:
            require_write('deck', deck.id)
            require_write('folder', deck.folder_id)
        for card in request.cards:
            require_write('deck', card.deck_id)
            if card.id > 0:
                existing_card = existing_cards.get(card.id)
                if not existing_card:
                    raise HTTPException(status_code=409, detail="Карточка удалена на сервере")
                require_write('deck', existing_card.deck_id)

        with models.tma_db.atomic():
            # Preload existing entities to eliminate N+1 queries during bulk sync
            existing_folder_ids = [f.id for f in request.folders if f.id > 0]
            existing_folders = {
                f.id: f for f in models.TMA_Folder.select(models.TMA_Folder.id, models.TMA_Folder.updated_at).where(
                    models.TMA_Folder.id << existing_folder_ids
                )
            } if existing_folder_ids else {}

            existing_deck_ids = [d.id for d in request.decks if d.id > 0]
            existing_decks = {
                d.id: d for d in models.TMA_Deck.select(models.TMA_Deck.id, models.TMA_Deck.updated_at).where(
                    models.TMA_Deck.id << existing_deck_ids
                )
            } if existing_deck_ids else {}

            # 0. Process Folders
            for f in request.folders:
                resolved_parent_id = f.parent_id
                if resolved_parent_id and resolved_parent_id < 0:
                    resolved_parent_id = folder_id_map.get(str(resolved_parent_id))

                client_updated_at = parse_iso_datetime(f.updated_at)
                if f.id < 0:
                    new_folder = models.TMA_Folder.create(
                        user_id=user_id,
                        name=f.name,
                        parent_id=resolved_parent_id,
                        color=f.color,
                        target_language=f.target_language or 'de',
                        is_deleted=f.is_deleted,
                        is_pinned=f.is_pinned,
                        position=f.position,
                        created_at=parse_iso_datetime(f.created_at),
                        updated_at=client_updated_at
                    )
                    folder_id_map[str(f.id)] = new_folder.id
                else:
                    folder = existing_folders.get(f.id)
                    if folder:
                        if not folder.updated_at or client_updated_at > folder.updated_at:
                            folder.name = f.name
                            folder.parent_id = resolved_parent_id
                            folder.color = f.color
                            folder.target_language = f.target_language or 'de'
                            folder.is_deleted = f.is_deleted
                            folder.is_pinned = f.is_pinned
                            folder.position = f.position
                            folder.updated_at = client_updated_at
                            folder.save()

            # 1. Process Decks
            for d in request.decks:
                resolved_folder_id = d.folder_id
                if resolved_folder_id and resolved_folder_id < 0:
                    resolved_folder_id = folder_id_map.get(str(resolved_folder_id))
                    
                client_updated_at = parse_iso_datetime(d.updated_at)
                if d.id < 0:
                    new_deck = models.TMA_Deck.create(
                        user_id=user_id,
                        name=d.name,
                        level=d.level,
                        topic=d.topic,
                        is_deleted=d.is_deleted,
                        is_inbox=False,
                        is_pinned=d.is_pinned,
                        position=d.position,
                        folder_id=resolved_folder_id,
                        created_at=parse_iso_datetime(d.created_at),
                        updated_at=client_updated_at
                    )
                    deck_id_map[str(d.id)] = new_deck.id
                else:
                    deck = existing_decks.get(d.id)
                    if deck:
                        if not deck.updated_at or client_updated_at > deck.updated_at:
                            deck.name = d.name
                            deck.level = d.level
                            deck.topic = d.topic
                            deck.is_deleted = d.is_deleted
                            deck.is_pinned = d.is_pinned
                            deck.position = d.position
                            deck.folder_id = resolved_folder_id
                            deck.updated_at = client_updated_at
                            deck.save()

            # 2. Process Cards (including accessible collaborative decks)
            from api.services.collaborative_service import get_user_accessible_deck_ids
            user_deck_ids = set(get_user_accessible_deck_ids(user_id)) if request.cards else set()
            for c in request.cards:
                resolved_deck_id = c.deck_id
                if not resolved_deck_id or resolved_deck_id < 0:
                    resolved_deck_id = deck_id_map.get(str(resolved_deck_id))
                    if not resolved_deck_id:
                        inbox = ensure_inbox_deck(user_id)
                        resolved_deck_id = inbox.id
                
                client_updated_at = parse_iso_datetime(c.updated_at)
                card_pos = getattr(c, 'position', None)
                if c.id < 0:
                    new_card = models.TMA_Card.create(
                        deck_id=resolved_deck_id,
                        front_text=c.front_text,
                        back_text=c.back_text,
                        context=c.context,
                        image_path=c.image_path,
                        audio_path=c.audio_path,
                        audio_back_path=c.audio_back_path,
                        video_front_path=c.video_front_path,
                        video_back_path=c.video_back_path,
                        is_deleted=c.is_deleted,
                        position=card_pos,
                        source='user',
                        created_at=parse_iso_datetime(c.created_at),
                        updated_at=client_updated_at
                    )
                    card_id_map[str(c.id)] = new_card.id
                else:
                    card = existing_cards.get(c.id)
                    if card:
                        if card.deck_id in user_deck_ids:
                            if not card.updated_at or client_updated_at > card.updated_at:
                                card.deck_id = resolved_deck_id
                                card.front_text = c.front_text
                                card.back_text = c.back_text
                                card.context = c.context
                                card.image_path = _merge_media_field(c.image_path, card.image_path)
                                card.audio_path = _merge_media_field(c.audio_path, card.audio_path)
                                card.audio_back_path = _merge_media_field(c.audio_back_path, card.audio_back_path)
                                card.video_front_path = _merge_media_field(c.video_front_path, card.video_front_path)
                                card.video_back_path = _merge_media_field(c.video_back_path, card.video_back_path)
                                card.is_deleted = c.is_deleted
                                if card_pos is not None:
                                    card.position = card_pos
                                card.updated_at = client_updated_at
                                card.save()
                    else:
                        new_card = models.TMA_Card.create(
                            deck_id=resolved_deck_id,
                            front_text=c.front_text,
                            back_text=c.back_text,
                            context=c.context,
                            image_path=c.image_path,
                            audio_path=c.audio_path,
                            audio_back_path=c.audio_back_path,
                            video_front_path=c.video_front_path,
                            video_back_path=c.video_back_path,
                            is_deleted=c.is_deleted,
                            position=card_pos,
                            source='user',
                            created_at=parse_iso_datetime(c.created_at),
                            updated_at=client_updated_at
                        )
                        card_id_map[str(c.id)] = new_card.id

            # 3. Process Card Progress
            progress_card_ids = {card_id_map.get(str(p.card_id), p.card_id) for p in request.progress}
            progress_cards = {c.id: c for c in models.TMA_Card.select(
                models.TMA_Card.id, models.TMA_Card.deck_id).where(
                models.TMA_Card.id.in_(progress_card_ids))} if progress_card_ids else {}
            readable_decks = set()
            for p in request.progress:
                resolved_card_id = p.card_id
                if resolved_card_id < 0:
                    resolved_card_id = card_id_map.get(str(resolved_card_id))
                    if not resolved_card_id:
                        continue

                progress_card = progress_cards.get(resolved_card_id)
                if not progress_card:
                    raise HTTPException(status_code=403, detail="Нет доступа к карточке")
                if progress_card.deck_id not in readable_decks:
                    if get_effective_user_role(user_id, 'deck', progress_card.deck_id) is None:
                        raise HTTPException(status_code=403, detail="Нет доступа к карточке")
                    readable_decks.add(progress_card.deck_id)

                client_updated_at = parse_iso_datetime(p.updated_at)
                progress, created = models.TMAProgress.get_or_create(
                    card_id=resolved_card_id,
                    user_id=user_id,
                    defaults={
                        "queue": p.queue,
                        "interval": p.interval,
                        "ease_factor": p.ease_factor,
                        "repetitions": p.repetitions,
                        "lapses": p.lapses,
                        "step_index": p.step_index,
                        "next_review": parse_iso_datetime(p.next_review),
                        "last_reviewed": parse_iso_datetime(p.last_reviewed) if p.last_reviewed else None,
                        "created_at": parse_iso_datetime(p.created_at),
                        "updated_at": client_updated_at
                    }
                )

                if created and 'flag' in p.model_fields_set:
                    progress.flag = p.flag
                    progress.save()
                if created and 'want_to_learn' in p.model_fields_set:
                    progress.want_to_learn = p.want_to_learn
                    progress.save()

                if not created:
                    if not progress.updated_at or client_updated_at > progress.updated_at:
                        progress.queue = p.queue
                        progress.interval = p.interval
                        progress.ease_factor = p.ease_factor
                        progress.repetitions = p.repetitions
                        progress.lapses = p.lapses
                        progress.step_index = p.step_index
                        progress.next_review = parse_iso_datetime(p.next_review)
                        progress.last_reviewed = parse_iso_datetime(p.last_reviewed) if p.last_reviewed else None
                        if 'flag' in p.model_fields_set:
                            progress.flag = p.flag
                        if 'want_to_learn' in p.model_fields_set:
                            progress.want_to_learn = p.want_to_learn
                        progress.updated_at = client_updated_at
                        progress.save()

        return {
            "status": "success",
            "mappings": {
                "folders": folder_id_map,
                "decks": deck_id_map,
                "cards": card_id_map
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Sync Push Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database sync failed: {str(e)}")


def execute_sync_pull(since: Optional[str], user_id: int) -> dict:
    """Fetches all server entities updated since timestamp for the given user."""
    logger.info(f"Sync Pull Service: starting for user {user_id} since={since}")
    since_dt = parse_iso_datetime(since) if since else datetime.datetime.min

    try:
        # Ensure starter decks exist for new/uninitialized users
        user = models.TMAUser.select(models.TMAUser.default_decks_initialized).where(models.TMAUser.user_id == user_id).first()
        if not user or not getattr(user, 'default_decks_initialized', False):
            try:
                from .decks import ensure_starter_decks
                ensure_starter_decks(user_id)
            except Exception as e:
                logger.warning(f"Failed to auto-ensure starter decks during sync pull: {e}")

        folders = models.TMA_Folder.select(*FOLDER_PULL_FIELDS).where(
            (models.TMA_Folder.user_id == user_id) &
            (models.TMA_Folder.updated_at > since_dt)
        )

        decks = models.TMA_Deck.select(*DECK_PULL_FIELDS).where(
            (models.TMA_Deck.user_id == user_id) &
            (models.TMA_Deck.updated_at > since_dt)
        )

        user_decks = models.TMA_Deck.select(models.TMA_Deck.id).where(models.TMA_Deck.user_id == user_id)
        cards = models.TMA_Card.select(*CARD_PULL_FIELDS).where(
            (models.TMA_Card.deck_id << user_decks) &
            (models.TMA_Card.updated_at > since_dt)
        )

        progress = models.TMAProgress.select(*PROGRESS_PULL_FIELDS).where(
            (models.TMAProgress.user_id == user_id) &
            (models.TMAProgress.updated_at > since_dt)
        )

        folders_data = [
            {
                "id": f.id,
                "name": f.name,
                "parent_id": getattr(f, 'parent_id', None),
                "color": f.color,
                "target_language": getattr(f, 'target_language', 'de') or 'de',
                "is_deleted": bool(f.is_deleted),
                "is_pinned": bool(getattr(f, 'is_pinned', False)),
                "position": int(getattr(f, 'position', 0) or 0),
                "created_at": f.created_at.isoformat() if f.created_at else None,
                "updated_at": f.updated_at.isoformat() if f.updated_at else None
            }
            for f in folders
        ]

        decks_data = [
            {
                "id": d.id,
                "name": d.name,
                "level": d.level or "",
                "topic": d.topic or "",
                "target_language": getattr(d, 'target_language', 'de') or 'de',
                "is_deleted": bool(d.is_deleted),
                "is_inbox": bool(d.is_inbox),
                "is_pinned": bool(getattr(d, 'is_pinned', False)),
                "position": int(d.position or 0),
                "folder_id": d.folder_id,
                "created_at": d.created_at.isoformat() if d.created_at else None,
                "updated_at": d.updated_at.isoformat() if d.updated_at else None
            }
            for d in decks
        ]

        cards_data = [
            {
                "id": c.id,
                "deck_id": c.deck_id,
                "front_text": c.front_text,
                "back_text": c.back_text,
                "context": c.context or "",
                "image_path": c.image_path or "",
                "audio_path": c.audio_path or "",
                "audio_back_path": c.audio_back_path or "",
                "video_front_path": c.video_front_path or "",
                "video_back_path": c.video_back_path or "",
                "is_deleted": bool(c.is_deleted),
                "position": getattr(c, 'position', 0) or 0,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "updated_at": c.updated_at.isoformat() if c.updated_at else None
            }
            for c in cards
        ]

        progress_data = [
            {
                "card_id": p.card_id,
                "queue": p.queue,
                "interval": p.interval,
                "ease_factor": p.ease_factor,
                "repetitions": p.repetitions,
                "lapses": p.lapses,
                "flag": p.flag,
                "want_to_learn": p.want_to_learn,
                "step_index": p.step_index,
                "next_review": p.next_review.isoformat() if p.next_review else None,
                "last_reviewed": p.last_reviewed.isoformat() if p.last_reviewed else None,
                "created_at": p.created_at.isoformat() if p.created_at else None,
                "updated_at": p.updated_at.isoformat() if p.updated_at else None
            }
            for p in progress
        ]

        return {
            "status": "success",
            "folders": folders_data,
            "decks": decks_data,
            "cards": cards_data,
            "progress": progress_data,
            "server_time": datetime.datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Sync Pull Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch updates from database: {str(e)}")


def execute_collab_pull(since: Optional[str], user_id: int) -> dict:
    """Returns changes from ALL participants in shared folders/decks the user has access to.
    This is the backbone of real-time collaborative sync polling.
    """
    from api.services.collaborative_service import get_user_accessible_deck_ids, get_user_accessible_folder_ids, _get_all_subfolder_ids, get_folder_access_map

    since_dt = parse_iso_datetime(since) if since else datetime.datetime.min

    try:
        # 1. Get all folder and deck IDs accessible to this user (owned + collaborative)
        folder_map = get_folder_access_map()
        accessible_folder_ids = get_user_accessible_folder_ids(user_id, folder_map=folder_map)
        accessible_deck_ids = get_user_accessible_deck_ids(user_id, folder_map=folder_map, accessible_folder_ids=accessible_folder_ids)

        # Expand to include all sub-folders
        all_folder_ids = set()
        for fid in accessible_folder_ids:
            all_folder_ids.update(_get_all_subfolder_ids(fid, folder_map=folder_map))

        has_changes = False

        # 2. Folders: changed by anyone, within accessible folders, since timestamp
        folders_data = []
        if all_folder_ids:
            changed_folders = models.TMA_Folder.select(
                *(field for field in FOLDER_PULL_FIELDS if field is not models.TMA_Folder.created_at),
                models.TMA_Folder.user_id).where(
                (models.TMA_Folder.id << list(all_folder_ids)) &
                (models.TMA_Folder.updated_at > since_dt)
            )
            for f in changed_folders:
                # Skip own changes — the client already has those
                if f.user_id == user_id:
                    continue
                has_changes = True
                folders_data.append({
                    "id": f.id,
                    "name": f.name,
                    "parent_id": getattr(f, 'parent_id', None),
                    "color": f.color,
                    "target_language": getattr(f, 'target_language', 'de') or 'de',
                    "is_deleted": bool(f.is_deleted),
                    "is_pinned": bool(f.is_pinned),
                    "position": int(getattr(f, 'position', 0) or 0),
                    "user_id": f.user_id,
                    "updated_at": f.updated_at.isoformat() if f.updated_at else None
                })

        # 3. Decks: changed by anyone, within accessible decks, since timestamp
        decks_data = []
        if accessible_deck_ids:
            changed_decks = models.TMA_Deck.select(
                *(field for field in DECK_PULL_FIELDS if field is not models.TMA_Deck.created_at and field is not models.TMA_Deck.target_language),
                models.TMA_Deck.user_id).where(
                (models.TMA_Deck.id << list(accessible_deck_ids)) &
                (models.TMA_Deck.updated_at > since_dt) &
                (models.TMA_Deck.is_deleted == False)
            )
            for d in changed_decks:
                if d.user_id == user_id:
                    continue
                has_changes = True
                decks_data.append({
                    "id": d.id,
                    "name": d.name,
                    "level": d.level or "",
                    "topic": d.topic or "",
                    "is_deleted": bool(d.is_deleted),
                    "is_inbox": bool(d.is_inbox),
                    "is_pinned": bool(d.is_pinned),
                    "position": int(d.position or 0),
                    "folder_id": d.folder_id,
                    "user_id": d.user_id,
                    "updated_at": d.updated_at.isoformat() if d.updated_at else None
                })

        # 4. Cards: changed by anyone, within accessible decks, since timestamp
        cards_data = []
        if accessible_deck_ids:
            changed_cards = models.TMA_Card.select(
                *(field for field in CARD_PULL_FIELDS if field is not models.TMA_Card.created_at)).where(
                (models.TMA_Card.deck_id << list(accessible_deck_ids)) &
                (models.TMA_Card.updated_at > since_dt)
            )
            for c in changed_cards:
                has_changes = True
                cards_data.append({
                    "id": c.id,
                    "deck_id": c.deck_id,
                    "front_text": c.front_text or "",
                    "back_text": c.back_text or "",
                    "context": c.context or "",
                    "image_path": c.image_path or "",
                    "audio_path": c.audio_path or "",
                    "audio_back_path": c.audio_back_path or "",
                    "video_front_path": c.video_front_path or "",
                    "video_back_path": c.video_back_path or "",
                    "is_deleted": bool(c.is_deleted),
                    "position": getattr(c, 'position', 0) or 0,
                    "updated_at": c.updated_at.isoformat() if c.updated_at else None
                })

        return {
            "has_changes": has_changes,
            "folders": folders_data,
            "decks": decks_data,
            "cards": cards_data,
            "server_time": datetime.datetime.utcnow().isoformat() + "Z"
        }

    except Exception as e:
        logger.error(f"Collab Pull Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Collaborative sync failed: {str(e)}")
