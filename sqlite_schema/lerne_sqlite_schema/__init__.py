"""Canonical SQLite schema, shared migration runner, and media contract for Lerne."""

__version__ = "0.1.1"

from .media_contract import (
    MEDIA_FOLDERS,
    MediaRef,
    canonical_media_filename,
    canonical_media_rel_path,
    compute_tts_cache_key,
    extract_card_media_refs,
    extract_deck_media_refs,
    is_canonical_media_filename,
    normalize_media_rel_path,
)
from .migrator import (
    MigrationError,
    SchemaIntegrityError,
    load_manifest,
    migrate,
    migration_status,
    open_sqlite,
    verify_integrity,
)

__all__ = [
    "__version__",
    "MEDIA_FOLDERS",
    "MediaRef",
    "MigrationError",
    "SchemaIntegrityError",
    "canonical_media_filename",
    "canonical_media_rel_path",
    "compute_tts_cache_key",
    "extract_card_media_refs",
    "extract_deck_media_refs",
    "is_canonical_media_filename",
    "load_manifest",
    "migrate",
    "migration_status",
    "normalize_media_rel_path",
    "open_sqlite",
    "verify_integrity",
]
