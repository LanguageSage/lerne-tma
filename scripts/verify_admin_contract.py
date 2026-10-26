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


def canonical_dump(node):
    """Keep the reviewed Python 3.14 AST representation on older interpreters."""
    if isinstance(node, ast.AST):
        fields = []
        for name, value in ast.iter_fields(node):
            if value == []:
                continue
            # Optional fields are omitted; a literal None remains significant.
            if value is None and not (name == 'value' and isinstance(node, (ast.Constant, ast.MatchSingleton))):
                continue
            fields.append(f'{name}={canonical_dump(value)}')
        return f'{type(node).__name__}(' + ', '.join(fields) + ')'
    if isinstance(node, list):
        return '[' + ', '.join(canonical_dump(item) for item in node) + ']'
    return repr(node)


def source_hash(paths):
    trees = []
    for p in paths:
        source = ROOT / p
        shared = ROOT / 'api/card_core/lerne_card_core' / source.name
        if p.startswith('api/services/') and shared.is_file():
            name = source.stem
            expected = ('\"\"\"Compatibility import; implementation belongs to lerne-card-core.\"\"\"\n'
                        'import sys\n'
                        f'from api.card_core.lerne_card_core import {name} as _implementation\n'
                        'sys.modules[__name__] = _implementation\n')
            if canonical_dump(ast.parse(source.read_text())) != canonical_dump(ast.parse(expected)):
                raise RuntimeError(f'Unexpected card package adapter: {p}')
            node = ast.parse(shared.read_text(encoding='utf-8'))
            # Preserve logical source identity across a package-only move.
            # Actual implementation changes still change the reviewed fingerprint.
            for item in ast.walk(node):
                if isinstance(item, ast.ImportFrom) and item.level == 1:
                    item.level = 0
                    item.module = 'api.services.' + item.module
        else:
            node = ast.parse(source.read_text(encoding='utf-8-sig'))
        trees.append(canonical_dump(node))
    tree = '\n'.join(trees)
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
