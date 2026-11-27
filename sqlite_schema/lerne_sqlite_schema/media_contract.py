"""Portable OS-independent media reference, SHA-256 naming, and TTS cache key contract."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import PurePosixPath
import re
from typing import Any, Optional
from urllib.parse import urlsplit

MEDIA_FOLDERS = ("images", "audio", "videos", "backgrounds")
_MEDIA_FOLDER_SET = frozenset(MEDIA_FOLDERS)
_ROLE_TO_FOLDER = {
    "image": "images",
    "images": "images",
    "audio": "audio",
    "tma-audio": "audio",
    "video": "videos",
    "videos": "videos",
    "background": "backgrounds",
    "backgrounds": "backgrounds",
}
_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
_EXT_RE = re.compile(r"^\.[a-z0-9]{2,5}$")
_CANONICAL_NAME_RE = re.compile(r"^archive_[a-f0-9]{64}\.[a-z0-9]{2,5}$")
_CARD_ATTACHMENT_SLOTS = (
    ("image_path", "images"),
    ("audio_path", "audio"),
    ("audio_back_path", "audio"),
    ("video_front_path", "videos"),
    ("video_back_path", "videos"),
)


@dataclass(frozen=True)
class MediaRef:
    folder: str
    filename: str
    rel_path: str


def _normalize_folder(raw_folder: Optional[str]) -> Optional[str]:
    if not raw_folder:
        return None
    return _ROLE_TO_FOLDER.get(str(raw_folder).strip().lower())


def is_canonical_media_filename(filename: str) -> bool:
    return isinstance(filename, str) and bool(_CANONICAL_NAME_RE.fullmatch(filename))


def canonical_media_filename(sha256_hex: str, ext: str) -> str:
    digest = str(sha256_hex or "").strip().lower()
    if not _SHA256_RE.fullmatch(digest):
        raise ValueError(f"Invalid SHA-256 hex digest: {sha256_hex!r}")
    suffix = str(ext or "").strip().lower()
    if not suffix.startswith("."):
        suffix = f".{suffix}"
    if not _EXT_RE.fullmatch(suffix):
        raise ValueError(f"Invalid media file extension: {ext!r}")
    return f"archive_{digest}{suffix}"


def canonical_media_rel_path(folder: str, sha256_hex: str, ext: str) -> str:
    normalized = _normalize_folder(folder)
    if normalized not in _MEDIA_FOLDER_SET:
        raise ValueError(f"Unsupported media folder: {folder!r}")
    return f"{normalized}/{canonical_media_filename(sha256_hex, ext)}"


def normalize_media_rel_path(raw_path: Any, default_folder: Optional[str] = None) -> Optional[MediaRef]:
    """Normalize an OS-independent relative path or legacy /api/media/ link to <folder>/<filename>."""
    if not isinstance(raw_path, str):
        return None
    trimmed = raw_path.strip()
    if not trimmed or trimmed.lower().startswith(("blob:", "data:", "archive://")):
        return None
    if "\\" in trimmed or ":" in trimmed and not trimmed.lower().startswith(("http://", "https://")) or "\x00" in trimmed:
        return None

    path_part = trimmed
    if trimmed.lower().startswith(("http://", "https://")):
        parsed = urlsplit(trimmed)
        if parsed.query or parsed.fragment:
            return None
        path_part = parsed.path
    elif "?" in trimmed or "#" in trimmed:
        return None

    folder: Optional[str] = None
    filename: Optional[str] = None

    if path_part.startswith("/api/media/"):
        rest = path_part[len("/api/media/"):].split("/")
        if len(rest) != 2:
            return None
        folder = _normalize_folder(rest[0])
        filename = rest[1]
    elif not path_part.startswith("/"):
        parts = path_part.split("/")
        if len(parts) == 2:
            folder = _normalize_folder(parts[0])
            filename = parts[1]
        elif len(parts) == 1 and default_folder is not None and is_canonical_media_filename(parts[0]):
            folder = _normalize_folder(default_folder)
            filename = parts[0]
        else:
            return None
    else:
        return None

    if folder not in _MEDIA_FOLDER_SET or not filename:
        return None
    if filename in (".", "..") or "/" in filename or "\\" in filename or ":" in filename or "\x00" in filename:
        return None
    rel_path = f"{folder}/{filename}"
    if str(PurePosixPath(rel_path)) != rel_path:
        return None
    return MediaRef(folder=folder, filename=filename, rel_path=rel_path)


def compute_tts_cache_key(
    *,
    text_norm: str,
    lang: str,
    provider: str,
    voice: str,
    model: str = "",
    rate: str = "+0%",
    options: Optional[dict[str, Any]] = None,
) -> str:
    """Compute a deterministic SHA-256 lookup key for TTS audio reuse."""
    clean_text = str(text_norm or "").strip()
    if not clean_text:
        raise ValueError("TTS cache key requires non-empty text_norm")
    clean_lang = str(lang or "de").strip().lower().replace("_", "-")
    clean_provider = str(provider or "").strip().lower()
    if not clean_provider:
        raise ValueError("TTS cache key requires provider")
    clean_voice = str(voice or "").strip()
    if not clean_voice:
        raise ValueError("TTS cache key requires voice")
    clean_model = str(model or "").strip()
    clean_rate = str(rate or "+0%").strip() or "+0%"
    options_json = json.dumps(options or {}, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    payload = "|".join([
        "lerne-tts-cache-v1",
        clean_provider,
        clean_model,
        clean_voice,
        clean_lang,
        clean_rate,
        options_json,
        clean_text,
    ])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _extract_resources(resources: Any, prefix: str = "resource") -> list[tuple[str, MediaRef]]:
    refs: list[tuple[str, MediaRef]] = []
    if not isinstance(resources, list):
        return refs
    for idx, item in enumerate(resources):
        if not isinstance(item, dict):
            continue
        res_type = str(item.get("type") or "").strip().lower()
        expected_folder = _normalize_folder(res_type)
        if not expected_folder:
            continue
        candidate = item.get("path") or item.get("url")
        parsed = normalize_media_rel_path(candidate, default_folder=expected_folder)
        if parsed and parsed.folder == expected_folder:
            refs.append((f"{prefix}:{idx}", parsed))
    return refs


def extract_card_media_refs(
    card_row: Optional[dict[str, Any]] = None,
    content_v2: Optional[dict[str, Any]] = None,
) -> list[tuple[str, MediaRef]]:
    """Extract all durable (slot, MediaRef) bindings from a card row and its Native V2 envelope."""
    refs: list[tuple[str, MediaRef]] = []
    row = card_row or {}
    for field, folder in _CARD_ATTACHMENT_SLOTS:
        parsed = normalize_media_rel_path(row.get(field), default_folder=folder)
        if parsed and parsed.folder == folder:
            refs.append((field, parsed))

    envelope = content_v2
    if envelope is None and isinstance(row.get("content_v2_json"), str):
        try:
            envelope = json.loads(row["content_v2_json"])
        except ValueError:
            envelope = None

    card = envelope.get("card") if isinstance(envelope, dict) else None
    if isinstance(card, dict):
        cover = normalize_media_rel_path(card.get("image"), default_folder="images")
        if cover and cover.folder == "images":
            refs.append(("card.image", cover))
        layout = card.get("layout")
        if isinstance(layout, list):
            for idx, item in enumerate(layout):
                if isinstance(item, dict) and item.get("type") == "image":
                    parsed = normalize_media_rel_path(item.get("path"), default_folder="images")
                    if parsed and parsed.folder == "images":
                        item_id = str(item.get("id") or idx)
                        refs.append((f"layout:{item_id}", parsed))
        metadata = card.get("metadata")
        if isinstance(metadata, dict):
            refs.extend(_extract_resources(metadata.get("resources"), prefix="card_resource"))
    return refs


def extract_deck_media_refs(metadata: Any) -> list[tuple[str, MediaRef]]:
    """Extract all durable (slot, MediaRef) bindings from deck metadata JSON/dict."""
    meta = metadata
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except ValueError:
            return []
    if not isinstance(meta, dict):
        return []
    return _extract_resources(meta.get("resources"), prefix="deck_resource")
