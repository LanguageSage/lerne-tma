"""Versioned admin interoperability artifact. Updating it never changes a database."""
import argparse
import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'api/admin_contract.json'
COMPONENTS = {
    'schema': ['api/models.py'],
    'permissions': ['api/permissions.py', 'api/services/collaborative_service.py'],
    'cards': ['api/services/input_parser.py', 'api/services/structured_cards_v2.py',
              'api/services/structured_cards_legacy.py', 'api/services/deck_passport.py'],
    'import': ['api/services/author_service.py', 'api/services/card_text_update.py',
               'api/services/card_content_service.py', 'api/services/cards.py',
               'api/services/decks.py', 'api/services/folders.py'],
}


def source_hash(paths):
    tree = '\n'.join(ast.dump(ast.parse((ROOT / p).read_text(encoding='utf-8-sig')),
                              include_attributes=False) for p in paths)
    return hashlib.sha256(tree.encode()).hexdigest()


def verify():
    data = json.loads(TARGET.read_text())
    for name, paths in COMPONENTS.items():
        if data[name]['source_sha256'] != source_hash(paths):
            raise RuntimeError(f'{name} contract changed: review compatibility/version and explicitly update artifact')
    return data


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--update', action='store_true', help='Prepare a reviewed contract change; never writes DB metadata')
    args = parser.parse_args()
    if args.update:
        old = json.loads(TARGET.read_text()) if TARGET.exists() else {}
        data = {name: {'version': old.get(name, {}).get('version', 1), 'source_sha256': source_hash(paths)}
                for name, paths in COMPONENTS.items()}
        TARGET.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
    verify()
    print('PASS: schema, permissions, card and import contracts match reviewed sources')
