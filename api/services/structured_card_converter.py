"""Service wrapper re-exporting pure V1 -> V2 structured card converter."""

from api.v1_to_v2_converter import (
    ConversionDiagnostic,
    V1ConversionError,
    convert_v1_card,
    convert_v1_document,
    convert_v1_snapshot,
    decode_v2_content,
    encode_v2_content,
    inspect_v1_card,
    main,
)

__all__ = [
    'ConversionDiagnostic',
    'V1ConversionError',
    'convert_v1_card',
    'convert_v1_document',
    'convert_v1_snapshot',
    'decode_v2_content',
    'encode_v2_content',
    'inspect_v1_card',
    'main',
]
