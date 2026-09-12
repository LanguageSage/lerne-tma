import datetime
import json
import logging
import os
import re
from typing import List, Optional

logger = logging.getLogger(__name__)

# project_root is two levels up from tools/admin/
_THIS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PROJECT_ROOT = os.path.dirname(os.path.dirname(_THIS_DIR))


def get_admin_config_path() -> str:
    return os.path.join(_THIS_DIR, "admin_config.json")


def load_admin_config() -> dict:
    p = get_admin_config_path()
    if os.path.exists(p):
        try:
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"custom_backup_dir": "", "auto_backup_enabled": False}


def save_admin_config(data: dict) -> None:
    p = get_admin_config_path()
    try:
        with open(p, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def get_effective_backup_dir() -> str:
    """Returns the effective backup directory (custom if configured and accessible, else default)."""
    cfg = load_admin_config()
    custom_dir = cfg.get("custom_backup_dir", "").strip()
    if custom_dir:
        try:
            os.makedirs(custom_dir, exist_ok=True)
            if os.path.exists(custom_dir):
                return custom_dir
        except Exception as e:
            logger.warning(f"Could not use custom backup dir '{custom_dir}': {e}")
    default_dir = os.path.join(_PROJECT_ROOT, "backups")
    os.makedirs(default_dir, exist_ok=True)
    return default_dir


def get_all_backup_search_dirs() -> List[str]:
    """Returns all directories to search for backup files without duplicates."""
    cfg = load_admin_config()
    custom_dir = cfg.get("custom_backup_dir", "").strip()

    dirs = [
        os.path.join(_PROJECT_ROOT, "backups"),
        os.path.join(_PROJECT_ROOT, "api", "data", "backups"),
        os.path.join(_PROJECT_ROOT, "..", "data"),
    ]
    if custom_dir:
        dirs.insert(0, custom_dir)
        dirs.append(os.path.join(custom_dir, "backups"))

    valid_dirs = []
    seen = set()
    for d in dirs:
        try:
            norm = os.path.normpath(os.path.abspath(d))
            if norm not in seen and os.path.exists(norm) and os.path.isdir(norm):
                seen.add(norm)
                valid_dirs.append(norm)
        except Exception:
            pass
    return valid_dirs


_CACHE = {}


def resolve_backup_path(filename: str, folder: Optional[str] = None) -> str:
    """Resolves and validates the absolute path of a backup file."""
    if ".." in filename or "/" in filename or "\\" in filename:
        raise ValueError("Invalid backup filename")

    search_dirs = [folder] if folder else get_all_backup_search_dirs()
    for d in search_dirs:
        if not d or not os.path.exists(d):
            continue
        fp = os.path.normpath(os.path.join(d, filename))
        if os.path.exists(fp) and os.path.isfile(fp):
            return fp
    raise FileNotFoundError(f"Backup file not found: {filename}")


def _load_backup_data(filepath: str) -> dict:
    """Loads backup JSON with in-memory caching based on modification time."""
    stat = os.stat(filepath)
    cache_key = (filepath, stat.st_mtime)
    if cache_key in _CACHE:
        return _CACHE[cache_key]

    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Keep cache small (max 3 files)
    if len(_CACHE) >= 3:
        _CACHE.clear()
    _CACHE[cache_key] = data
    return data


def inspect_backup(filename: str, folder: Optional[str] = None) -> dict:
    """Parses and returns structured overview of users, folders, and decks in a backup file."""
    filepath = resolve_backup_path(filename, folder)
    data = _load_backup_data(filepath)

    raw_users = data.get("users", [])
    raw_folders = data.get("folders", [])
    if not raw_folders and isinstance(data.get("folder"), dict):
        raw_folders = [data["folder"]]
    raw_decks = data.get("decks", [])
    if not raw_decks and isinstance(data.get("deck"), dict):
        raw_decks = [data["deck"]]
    raw_cards = data.get("cards", [])

    if len(raw_decks) == 1:
        single_deck_id = raw_decks[0].get("id")
        for c in raw_cards:
            if not c.get("deck") and not c.get("deck_id") and single_deck_id is not None:
                c["deck_id"] = single_deck_id

    # Card counts and image counts per deck
    cards_per_deck = {}
    images_per_deck = {}
    total_images = 0

    for c in raw_cards:
        did = c.get("deck") or c.get("deck_id")
        if did is not None:
            cards_per_deck[did] = cards_per_deck.get(did, 0) + 1
            has_img = bool(c.get("image_path") or c.get("image_data"))
            if has_img:
                images_per_deck[did] = images_per_deck.get(did, 0) + 1
                total_images += 1

    # Decks formatting
    decks_by_user = {}
    decks_by_folder = {}
    formatted_decks = []

    for d in raw_decks:
        did = d.get("id")
        uid = d.get("user") or d.get("user_id")
        fid = d.get("folder") or d.get("folder_id")
        c_count = cards_per_deck.get(did, 0)
        img_count = images_per_deck.get(did, 0)

        deck_item = {
            "id": did,
            "name": d.get("name", "Без названия"),
            "user_id": uid,
            "folder_id": fid,
            "target_language": d.get("target_language", "de"),
            "level": d.get("level"),
            "is_pinned": bool(d.get("is_pinned")),
            "cards_count": c_count,
            "images_count": img_count
        }
        formatted_decks.append(deck_item)

        if uid is not None:
            decks_by_user.setdefault(uid, []).append(deck_item)
        if fid is not None:
            decks_by_folder.setdefault(fid, []).append(deck_item)

    # Folders formatting
    formatted_folders = []
    if raw_folders:
        for fld in raw_folders:
            fid = fld.get("id")
            uid = fld.get("user") or fld.get("user_id")
            folder_decks = decks_by_folder.get(fid, [])
            formatted_folders.append({
                "id": fid,
                "name": fld.get("name", "Без названия"),
                "user_id": uid,
                "color": fld.get("color", "#4f46e5"),
                "decks_count": len(folder_decks),
                "cards_count": sum(d["cards_count"] for d in folder_decks),
                "images_count": sum(d["images_count"] for d in folder_decks)
            })
    else:
        # Synthesize folders from folder_id references across decks
        from api import models
        known_folder_ids = [fid for fid in decks_by_folder.keys() if fid is not None]
        db_folder_map = {}
        if known_folder_ids:
            try:
                for f in models.TMA_Folder.select().where(models.TMA_Folder.id.in_(known_folder_ids)):
                    db_folder_map[f.id] = (f.name, f.color or "#4f46e5")
            except Exception:
                pass

        for fid, folder_decks in decks_by_folder.items():
            f_name, f_color = db_folder_map.get(fid, (f"Папка #{fid}", "#4f46e5"))
            f_uid = folder_decks[0]["user_id"] if folder_decks else None
            formatted_folders.append({
                "id": fid,
                "name": f_name,
                "user_id": f_uid,
                "color": f_color,
                "decks_count": len(folder_decks),
                "cards_count": sum(d["cards_count"] for d in folder_decks),
                "images_count": sum(d["images_count"] for d in folder_decks)
            })

    # Users formatting
    formatted_users = []
    for u in raw_users:
        uid = u.get("user_id") or u.get("id")
        u_decks = decks_by_user.get(uid, [])
        formatted_users.append({
            "user_id": uid,
            "username": u.get("username"),
            "first_name": u.get("first_name"),
            "decks_count": len(u_decks),
            "cards_count": sum(d["cards_count"] for d in u_decks)
        })

    # Sort decks: first pinned, then by name
    formatted_decks.sort(key=lambda x: (not x["is_pinned"], x["name"].lower()))

    return {
        "filename": filename,
        "filepath": filepath,
        "summary": {
            "total_users": len(formatted_users),
            "total_folders": len(formatted_folders),
            "total_decks": len(formatted_decks),
            "total_cards": len(raw_cards),
            "total_images": total_images
        },
        "users": formatted_users,
        "folders": formatted_folders,
        "decks": formatted_decks
    }


def get_backup_deck_cards(filename: str, folder: Optional[str], deck_id: int) -> dict:
    """Returns deck metadata and full list of cards from backup for visual preview."""
    filepath = resolve_backup_path(filename, folder)
    data = _load_backup_data(filepath)

    raw_decks = data.get("decks", [])
    if not raw_decks and isinstance(data.get("deck"), dict):
        raw_decks = [data["deck"]]
    raw_cards = data.get("cards", [])

    if len(raw_decks) == 1:
        single_deck_id = raw_decks[0].get("id")
        for c in raw_cards:
            if not c.get("deck") and not c.get("deck_id") and single_deck_id is not None:
                c["deck_id"] = single_deck_id

    matched_deck = next((d for d in raw_decks if d.get("id") == deck_id), None)
    if not matched_deck:
        raise ValueError(f"Deck ID {deck_id} not found in backup {filename}")

    deck_cards = []
    for c in raw_cards:
        if (c.get("deck") or c.get("deck_id")) == deck_id:
            img = c.get("image_path") or ""
            deck_cards.append({
                "id": c.get("id"),
                "front_text": c.get("front_text", ""),
                "back_text": c.get("back_text", ""),
                "context": c.get("context", ""),
                "image_path": img,
                "has_image": bool(img),
                "card_type": c.get("card_type", "translation"),
                "level": c.get("level")
            })

    return {
        "deck": {
            "id": matched_deck.get("id"),
            "name": matched_deck.get("name"),
            "user_id": matched_deck.get("user") or matched_deck.get("user_id"),
            "folder_id": matched_deck.get("folder") or matched_deck.get("folder_id"),
            "cards_count": len(deck_cards),
            "images_count": sum(1 for c in deck_cards if c["has_image"])
        },
        "cards": deck_cards
    }


def restore_deck_from_backup(
    filename: str,
    folder: Optional[str],
    deck_id: int,
    target_user_id: Optional[int] = None,
    target_folder_id: Optional[int] = None,
    mode: str = "replace",
    apply_to_all_users: bool = False
) -> dict:
    """Restores a deck and its cards from backup either to a single user or to all matching users."""
    from api import models, services

    filepath = resolve_backup_path(filename, folder)
    data = _load_backup_data(filepath)

    raw_decks = data.get("decks", [])
    if not raw_decks and isinstance(data.get("deck"), dict):
        raw_decks = [data["deck"]]

    matched_deck = next((d for d in raw_decks if d.get("id") == deck_id), None)
    if not matched_deck and len(raw_decks) == 1:
        matched_deck = raw_decks[0]
    if not matched_deck:
        raise ValueError(f"Deck ID {deck_id} not found in backup")

    deck_name = matched_deck.get("name", "Восстановленная колода")
    deck_lang = matched_deck.get("target_language", "de")
    deck_level = matched_deck.get("level")

    raw_cards = data.get("cards", [])
    deck_cards = [c for c in raw_cards if (c.get("deck") or c.get("deck_id")) == deck_id]
    if not deck_cards and len(raw_decks) == 1:
        deck_cards = raw_cards

    # Target users
    if apply_to_all_users:
        target_users = list(models.TMAUser.select(models.TMAUser.user_id))
    elif target_user_id:
        target_users = [models.TMAUser.get_or_none(models.TMAUser.user_id == target_user_id)]
        target_users = [u for u in target_users if u]
    else:
        orig_uid = matched_deck.get("user") or matched_deck.get("user_id")
        target_users = [models.TMAUser.get_or_none(models.TMAUser.user_id == orig_uid)]
        target_users = [u for u in target_users if u]

    if not target_users:
        raise ValueError("No valid target users found to restore deck to")

    restored_decks = []
    total_saved_cards = 0

    with models.tma_db.atomic():
        for u in target_users:
            uid = u.user_id

            if mode == "replace":
                existing_deck = models.TMA_Deck.get_or_none(
                    (models.TMA_Deck.user_id == uid) &
                    (models.TMA_Deck.name == deck_name) &
                    (models.TMA_Deck.is_deleted == False)
                )
                if existing_deck:
                    dest_deck = existing_deck
                else:
                    dest_deck = models.TMA_Deck.create(
                        user_id=uid,
                        folder_id=target_folder_id,
                        name=deck_name,
                        target_language=deck_lang,
                        level=deck_level
                    )
                # Clear old cards
                models.TMA_Card.delete().where(models.TMA_Card.deck == dest_deck).execute()
            else:
                # Copy mode
                dest_deck = models.TMA_Deck.create(
                    user_id=uid,
                    folder_id=target_folder_id,
                    name=f"{deck_name} (копия из бэкапа)",
                    target_language=deck_lang,
                    level=deck_level
                )

            # Insert cards
            payloads = []
            for c in deck_cards:
                payloads.append({
                    "deck_id": dest_deck.id,
                    "front": c.get("front_text", ""),
                    "back": c.get("back_text", ""),
                    "context": c.get("context", ""),
                    "image_path": c.get("image_path", ""),
                    "card_type": c.get("card_type", "translation"),
                    "level": c.get("level") or deck_level
                })

            saved = services.bulk_save_cards(payloads, uid)
            total_saved_cards += len(saved)
            restored_decks.append({"deck_id": dest_deck.id, "deck_name": dest_deck.name, "user_id": uid})

    return {
        "status": "ok",
        "mode": mode,
        "restored_decks_count": len(restored_decks),
        "total_cards_restored": total_saved_cards,
        "restored_decks": restored_decks
    }


def restore_folder_from_backup(
    filename: str,
    folder: Optional[str],
    backup_folder_id: int,
    target_user_id: Optional[int] = None,
    mode: str = "replace",
    apply_to_all_users: bool = False
) -> dict:
    """Restores an entire folder and all its decks/cards from backup."""
    from api import models, services

    filepath = resolve_backup_path(filename, folder)
    data = _load_backup_data(filepath)

    raw_folders = data.get("folders", [])
    if not raw_folders and isinstance(data.get("folder"), dict):
        raw_folders = [data["folder"]]

    matched_fld = next((f for f in raw_folders if f.get("id") == backup_folder_id), None)
    if not matched_fld and len(raw_folders) == 1:
        matched_fld = raw_folders[0]
    if not matched_fld:
        raise ValueError(f"Folder ID {backup_folder_id} not found in backup")

    fld_name = matched_fld.get("name", "Восстановленная папка")
    fld_color = matched_fld.get("color", "#4f46e5")

    raw_decks = data.get("decks", [])
    if not raw_decks and isinstance(data.get("deck"), dict):
        raw_decks = [data["deck"]]

    fld_decks = [d for d in raw_decks if (d.get("folder") or d.get("folder_id")) == backup_folder_id]
    if not fld_decks and len(raw_folders) == 1:
        fld_decks = raw_decks

    if apply_to_all_users:
        target_users = list(models.TMAUser.select(models.TMAUser.user_id))
    elif target_user_id:
        target_users = [models.TMAUser.get_or_none(models.TMAUser.user_id == target_user_id)]
        target_users = [u for u in target_users if u]
    else:
        orig_uid = matched_fld.get("user") or matched_fld.get("user_id")
        target_users = [models.TMAUser.get_or_none(models.TMAUser.user_id == orig_uid)]
        target_users = [u for u in target_users if u]

    if not target_users:
        raise ValueError("No valid target users found to restore folder to")

    total_restored_decks = 0
    total_restored_cards = 0

    with models.tma_db.atomic():
        for u in target_users:
            uid = u.user_id

            if mode == "replace":
                dest_fld = models.TMA_Folder.get_or_none(
                    (models.TMA_Folder.user_id == uid) &
                    (models.TMA_Folder.name == fld_name) &
                    (models.TMA_Folder.is_deleted == False)
                )
                if not dest_fld:
                    dest_fld = models.TMA_Folder.create(
                        user_id=uid,
                        name=fld_name,
                        color=fld_color
                    )
            else:
                dest_fld = models.TMA_Folder.create(
                    user_id=uid,
                    name=fld_name if apply_to_all_users else f"{fld_name} (копия из бэкапа)",
                    color=fld_color
                )

            for d in fld_decks:
                d_id = d.get("id")
                d_name = d.get("name")
                d_cards = [c for c in data.get("cards", []) if (c.get("deck") or c.get("deck_id")) == d_id]

                if mode == "replace":
                    existing_d = models.TMA_Deck.get_or_none(
                        (models.TMA_Deck.user_id == uid) &
                        (models.TMA_Deck.folder == dest_fld) &
                        (models.TMA_Deck.name == d_name) &
                        (models.TMA_Deck.is_deleted == False)
                    )
                    if existing_d:
                        dest_deck = existing_d
                    else:
                        dest_deck = models.TMA_Deck.create(
                            user_id=uid,
                            folder=dest_fld,
                            name=d_name,
                            target_language=d.get("target_language", "de"),
                            level=d.get("level"),
                            is_pinned=bool(d.get("is_pinned"))
                        )
                    models.TMA_Card.delete().where(models.TMA_Card.deck == dest_deck).execute()
                else:
                    dest_deck = models.TMA_Deck.create(
                        user_id=uid,
                        folder=dest_fld,
                        name=d_name,
                        target_language=d.get("target_language", "de"),
                        level=d.get("level"),
                        is_pinned=bool(d.get("is_pinned"))
                    )

                payloads = []
                for c in d_cards:
                    payloads.append({
                        "deck_id": dest_deck.id,
                        "front": c.get("front_text", ""),
                        "back": c.get("back_text", ""),
                        "context": c.get("context", ""),
                        "image_path": c.get("image_path", ""),
                        "card_type": c.get("card_type", "quiz" if "quiz" in str(c.get("card_type")) else "translation"),
                        "level": c.get("level") or dest_deck.level
                    })

                saved = services.bulk_save_cards(payloads, uid)
                total_restored_cards += len(saved)
                total_restored_decks += 1

    return {
        "status": "ok",
        "folder_name": fld_name,
        "mode": mode,
        "users_count": len(target_users),
        "decks_count": total_restored_decks,
        "cards_count": total_restored_cards
    }


def create_deck_backup(deck_id_val: str) -> dict:
    """Creates a standalone JSON snapshot of a single deck and its cards."""
    from tools.admin.services.deck_helpers import get_deck_and_cards

    deck, cards, is_lib = get_deck_and_cards(deck_id_val)
    if not deck:
        raise ValueError(f"Deck not found: {deck_id_val}")

    deck_data = deck.__data__.copy()
    for k in ("created_at", "updated_at"):
        if isinstance(deck_data.get(k), datetime.datetime):
            deck_data[k] = str(deck_data[k])

    deck_id = deck.id
    deck_name = deck.name or "Deck"
    slug = re.sub(r'[^a-zA-Z0-9а-яА-ЯёЁ_-]', '_', deck_name).strip('_')[:30]
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    fname = f"deck_{deck_id}_{slug}_{timestamp}.json" if slug else f"deck_{deck_id}_{timestamp}.json"
    target_dir = get_effective_backup_dir()
    fpath = os.path.join(target_dir, fname)

    cards_data = []
    for c in cards:
        cd = c.__data__.copy()
        for k in ("created_at", "updated_at"):
            if isinstance(cd.get(k), datetime.datetime):
                cd[k] = str(cd[k])
        cd.pop("image_data", None)
        cd["deck_id"] = deck_id
        cards_data.append(cd)

    dump_data = {
        "backup_type": "deck",
        "timestamp": timestamp,
        "is_library": is_lib,
        "decks_count": 1,
        "cards_count": len(cards_data),
        "decks": [deck_data],
        "cards": cards_data
    }

    with open(fpath, "w", encoding="utf-8") as f:
        json.dump(dump_data, f, ensure_ascii=False, indent=2)

    return {
        "status": "ok",
        "filename": fname,
        "filepath": fpath,
        "folder": target_dir,
        "deck_id": deck_id,
        "deck_name": deck_name,
        "cards_count": len(cards_data)
    }


def create_folder_backup(folder_id: int) -> dict:
    """Creates a standalone JSON snapshot of a folder with all its decks and cards."""
    from api import models

    folder = models.TMA_Folder.get_or_none(models.TMA_Folder.id == folder_id)
    is_lib = False
    if not folder:
        folder = models.Folder.get_or_none(models.Folder.id == folder_id)
        is_lib = True

    if not folder:
        raise ValueError(f"Folder not found: {folder_id}")

    folder_data = folder.__data__.copy()
    for k in ("created_at", "updated_at"):
        if isinstance(folder_data.get(k), datetime.datetime):
            folder_data[k] = str(folder_data[k])

    folder_name = folder.name or "Folder"
    slug = re.sub(r'[^a-zA-Z0-9а-яА-ЯёЁ_-]', '_', folder_name).strip('_')[:30]
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    fname = f"folder_{folder.id}_{slug}_{timestamp}.json" if slug else f"folder_{folder.id}_{timestamp}.json"
    target_dir = get_effective_backup_dir()
    fpath = os.path.join(target_dir, fname)

    if is_lib:
        decks = list(models.Deck.select().where((models.Deck.folder == folder) & (models.Deck.is_deleted == False)))
        cards_model = models.Card
    else:
        decks = list(models.TMA_Deck.select().where((models.TMA_Deck.folder == folder) & (models.TMA_Deck.is_deleted == False)))
        cards_model = models.TMA_Card

    decks_data = []
    cards_data = []

    for d in decks:
        dd = d.__data__.copy()
        for k in ("created_at", "updated_at"):
            if isinstance(dd.get(k), datetime.datetime):
                dd[k] = str(dd[k])
        dd["folder_id"] = folder.id
        decks_data.append(dd)

        cards = list(cards_model.select().where((cards_model.deck_id == d.id) & (cards_model.is_deleted == False)))
        for c in cards:
            cd = c.__data__.copy()
            for k in ("created_at", "updated_at"):
                if isinstance(cd.get(k), datetime.datetime):
                    cd[k] = str(cd[k])
            cd.pop("image_data", None)
            cd["deck_id"] = d.id
            cards_data.append(cd)

    dump_data = {
        "backup_type": "folder",
        "timestamp": timestamp,
        "is_library": is_lib,
        "folders_count": 1,
        "decks_count": len(decks_data),
        "cards_count": len(cards_data),
        "folders": [folder_data],
        "decks": decks_data,
        "cards": cards_data
    }

    with open(fpath, "w", encoding="utf-8") as f:
        json.dump(dump_data, f, ensure_ascii=False, indent=2)

    return {
        "status": "ok",
        "filename": fname,
        "filepath": fpath,
        "folder": target_dir,
        "folder_id": folder.id,
        "folder_name": folder_name,
        "decks_count": len(decks_data),
        "cards_count": len(cards_data)
    }

