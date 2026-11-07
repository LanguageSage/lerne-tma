"""Service wrapper re-exporting pure V1 -> V2 structured card converter."""

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
    'convert_v1_card',
    'convert_v1_document',
    'convert_v1_snapshot',
    'decode_v2_content',
    'encode_v2_content',
    'format_dry_run_summary',
    'inspect_v1_card',
    'main',
    'run_v1_migration_dry_run',
]
