"""Offline V2 validation/schema/legacy preview. Reads files; writes only stdout."""
import argparse
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Pure package imports avoid application/database initialization entirely.
os.environ.update(VERCEL='1', RUN_MIGRATIONS='false', FORCE_LOCAL_DB='false')


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('validate', 'schema', 'to-legacy'))
    parser.add_argument('file', nargs='?', type=Path)
    args = parser.parse_args(argv)
    if args.command != 'schema' and args.file is None:
        parser.error('file is required for validate and to-legacy')

    from pydantic import ValidationError
    from api.card_core.lerne_card_core.structured_cards_v2 import Document, load_document
    from api.card_core.lerne_card_core.structured_cards_legacy import to_legacy_document

    try:
        if args.command == 'schema':
            result = Document.model_json_schema()
        else:
            document = load_document(args.file.read_text(encoding='utf-8-sig'))
            result = (to_legacy_document(document) if args.command == 'to-legacy'
                      else {'valid': True, 'cards': len(document.cards)})
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (OSError, ValueError) as exc:
        # Pydantic's default exception includes the input; show paths/messages only.
        errors = (exc.errors(include_input=False, include_url=False) if isinstance(exc, ValidationError)
                  else [{'message': str(exc)}])
        print(json.dumps({'valid': False, 'errors': errors}, ensure_ascii=False,
                         indent=2, default=str), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
