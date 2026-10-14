"""Read-only Lesson QA: canonical passports + actual frontend parsers. No AI calls."""
import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# api.models has legacy import-time schema setup in local mode. This dedicated
# audit CLI must disable it BEFORE importing any api service, even offline.
os.environ.update(VERCEL='1', RUN_MIGRATIONS='false', FORCE_LOCAL_DB='false')


def validate_passports(snapshot):
    from api.services.deck_passport import passport_from_metadata, validate_passport
    findings = []
    for deck in snapshot['decks']:
        try:
            passport = passport_from_metadata(deck.get('metadata'))
            errors = validate_passport(passport) if passport else []
        except (TypeError, ValueError):
            errors = ['metadata is not a valid JSON object']
        for message in errors:
            findings.append(dict(severity='ERROR', code='passport.schema', deck_id=deck['id'],
                                 deck_name=deck['name'], message=message))
    return findings


def read_database(folder_id=None, deck_id=None):
    # Lazy import: offline snapshots never open a database connection.
    from api.models import TMA_Deck, TMA_Card, TMA_Folder, tma_db
    if tma_db.obj is None:
        from api.database import initialize_database
        if not initialize_database():
            raise ValueError('Database unavailable')
    with tma_db.connection_context(), tma_db.atomic():
        # PostgreSQL rejects writes for the entire transaction, even if a future
        # serializer accidentally tries one. No initialization/migration routines.
        tma_db.execute_sql('SET TRANSACTION READ ONLY')
        ids = [folder_id]
        if folder_id is not None:
            folders = list(TMA_Folder.select(TMA_Folder.id, TMA_Folder.parent)
                           .where(TMA_Folder.is_deleted == False).dicts())
            while True:
                expanded = ids + [f['id'] for f in folders if f['parent'] in ids and f['id'] not in ids]
                if len(expanded) == len(ids):
                    break
                ids = expanded
        query = TMA_Deck.select(TMA_Deck.id, TMA_Deck.name, TMA_Deck.position,
                                TMA_Deck.metadata, TMA_Deck.target_language).where(TMA_Deck.is_deleted == False)
        query = query.where(TMA_Deck.id == deck_id) if deck_id is not None else query.where(TMA_Deck.folder.in_(ids))
        decks = list(query.order_by(TMA_Deck.position, TMA_Deck.id).dicts())
        if not decks:
            raise ValueError('No active decks in the requested scope')
        cards = list(TMA_Card.select(TMA_Card.id, TMA_Card.deck, TMA_Card.position,
                    TMA_Card.front_text, TMA_Card.back_text, TMA_Card.context,
                    TMA_Card.metadata, TMA_Card.card_type, TMA_Card.topics)
                    .where(TMA_Card.deck.in_([d['id'] for d in decks]), TMA_Card.is_deleted == False)
                    .order_by(TMA_Card.deck, TMA_Card.position, TMA_Card.id).dicts())
        for card in cards:
            card['deck_id'] = card.pop('deck')
        return dict(folder_id=folder_id, decks=decks, cards=cards)


def validate_answer_settings(snapshot):
    from api.services.answer_contract import GradingPolicy
    from pydantic import ValidationError
    findings = []
    for card in snapshot['cards']:
        try:
            value = card.get('metadata') or {}
            metadata = json.loads(value) if isinstance(value, str) else value
            if not isinstance(metadata, dict):
                continue  # frontend metadata diagnostic already covers this
        except (ValueError, TypeError):
            continue
        target = dict(card_id=card['id'], deck_id=card['deck_id'], severity='ERROR')
        if 'grading_policy' in metadata:
            try:
                GradingPolicy.model_validate(metadata['grading_policy'])
            except ValidationError as exc:
                findings.append(dict(target, code='answer.invalid_policy', message='Grading policy violates the server contract.',
                    details=exc.errors(include_input=False, include_url=False)))
        variants = metadata.get('accepted_answers', [])
        if not isinstance(variants, list) or len(variants) > 20 or any(not isinstance(v, str) or len(v) > 4000 for v in variants):
            findings.append(dict(target, code='answer.invalid_variants', message='Accepted answers violate the server contract.'))
    return findings


def read_import(path):
    from api.services.author_service import parse_document
    doc = parse_document(path.read_text(encoding='utf-8-sig'))
    passports = {p['deck_name']: p['passport'] for p in doc['passports']}
    decks, cards = [], []
    for ordinal, deck in enumerate(doc['decks'], 1):
        name = deck['deck_name']
        decks.append(dict(id=ordinal, name=name, position=ordinal, metadata=passports.get(name, {})))
        for position, card in enumerate(c for c in doc['cards'] if (c['deck_name'] or 'Без названия') == name):
            cards.append({**card, 'id': card.get('card_id') or -len(cards)-1, 'deck_id': ordinal, 'position': position})
    return dict(decks=decks, cards=cards, import_errors=doc['structure_errors'])


def run_audit(snapshot):
    process = subprocess.run(['node', str(ROOT / 'tools/lesson_qa.mjs')],
        input=json.dumps(snapshot, ensure_ascii=False), capture_output=True, text=True,
        encoding='utf-8', cwd=ROOT, timeout=120)
    if process.returncode:
        raise ValueError(process.stderr.strip())
    report = json.loads(process.stdout)
    report['findings'].extend(validate_passports(snapshot))
    report['findings'].extend(validate_answer_settings(snapshot))
    report['counts'] = {s: sum(f['severity'] == s for f in report['findings'])
                        for s in ('ERROR', 'WARNING', 'SUGGESTION')}
    report['source_sha256'] = hashlib.sha256(json.dumps(snapshot, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--snapshot', type=Path)
    source.add_argument('--import-file', type=Path)
    source.add_argument('--folder-id', type=int)
    source.add_argument('--deck-id', type=int)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--save-snapshot', type=Path)
    args = parser.parse_args()
    try:
        snapshot = (json.loads(args.snapshot.read_text(encoding='utf-8-sig')) if args.snapshot
                    else read_import(args.import_file) if args.import_file
                    else read_database(args.folder_id, args.deck_id))
        report = run_audit(snapshot)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        if args.save_snapshot:
            args.save_snapshot.parent.mkdir(parents=True, exist_ok=True)
            args.save_snapshot.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'checked': report['checked'], 'counts': report['counts'], 'output': str(args.output)}))
        return 1 if report['counts']['ERROR'] else 0
    except (ValueError, OSError, subprocess.TimeoutExpired) as exc:
        print(f'Lesson QA failed: {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
