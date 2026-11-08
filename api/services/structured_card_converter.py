"""Service wrapper re-exporting pure V1 -> V2 structured card converter and LOCAL DB reader."""

from api.services.db_v1_reader import (
    categorize_migration_fixes,
    check_local_db_availability,
    fetch_v1_snapshot_from_db,
    format_db_dry_run_summary,
    run_local_db_migration_dry_run,
)
from api.v1_to_v2_converter import (
    ConversionDiagnostic,
    V1ConversionError,
    convert_v1_card,
    convert_v1_document,
    convert_v1_snapshot,
    decode_v2_content,
    encode_v2_content,
    format_dry_run_summary,
    inspect_v1_card,
    main,
    run_v1_migration_dry_run,
)

__all__ = [
    'ConversionDiagnostic',
    'V1ConversionError',
    'categorize_migration_fixes',
    'check_local_db_availability',
    'convert_v1_card',
    'convert_v1_document',
    'convert_v1_snapshot',
    'decode_v2_content',
    'encode_v2_content',
    'fetch_v1_snapshot_from_db',
    'format_db_dry_run_summary',
    'format_dry_run_summary',
    'inspect_v1_card',
    'main',
    'run_local_db_migration_dry_run',
    'run_v1_migration_dry_run',
]
