"""Pure converter audit of active AND deleted rows from a private rehearsal snapshot.

No database/application imports; no content is ever persisted. Not a migration.
"""
import argparse
import copy
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    source, output = args.snapshot_dir.resolve(), args.output.resolve()
    if not source.is_relative_to(ROOT / 'local/test-data') or not output.is_relative_to(ROOT / 'local/test-data') or output.exists():
        parser.error('Use private snapshot inputs and a new ignored output directory')
    output.mkdir(parents=True)
    from api.v1_to_v2_converter import run_v1_migration_dry_run
    summaries = {}
    for scope in ('tma', 'library'):
        original = json.loads((source / (scope + '-snapshot.json')).read_text(encoding='utf-8'))
        summaries[scope] = {}
        for group in ('active', 'deleted'):
            value = {'decks': copy.deepcopy(original['decks']),
                     'cards': [c for c in original['cards'] if bool(c.get('is_deleted')) == (group == 'deleted')]}
            value['cards'].sort(key=lambda c: (c['deck_id'], c.get('position') or 0, c['id']))
            report = run_v1_migration_dry_run(value, allow_shared_positions=True,
                                               include_converted_payloads=False)
            path = output / f'{scope}-{group}.json'
            path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            keys = ('ok', 'checked', 'converted_count', 'blocked_count', 'blocked_deck_ids', 'counts_by_code', 'warning_counts_by_code', 'invariants')
            summaries[scope][group] = {k: report[k] for k in keys}
            print(scope, group, json.dumps(summaries[scope][group], ensure_ascii=False), flush=True)
    (output / 'summary.json').write_text(json.dumps(summaries, ensure_ascii=False, indent=2), encoding='utf-8')
    # A completed scan containing blocked historical rows is not a successful gate.
    return 0 if all(group['ok'] for scope in summaries.values() for group in scope.values()) else 2


if __name__ == '__main__':
    raise SystemExit(main())
