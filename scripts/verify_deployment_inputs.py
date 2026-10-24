"""Audit tracked source inputs under .vercelignore; no upload or deployment.

Run after npm ci/build and from a clean checkout for a reproducible source list.
This does not claim to inspect a remote Vercel function bundle.
"""
import argparse
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def git_paths(*args):
    raw = subprocess.check_output(['git', *args, '-z'], cwd=ROOT)
    return {name for name in raw.decode('utf-8').split('\0') if name}


def verify():
    tracked = git_paths('ls-files', '--cached')
    excluded = git_paths('ls-files', '--cached', '--ignored', '--exclude-from=.vercelignore')
    included = tracked - excluded
    required = {'api/index.py', 'api/requirements.txt', 'api/admin_contract.json',
                'app/index.html', 'app/package.json', 'app/package-lock.json',
                'app/vite.config.js', 'app/src/data/bundeslaender.js',
                'package.json', 'package-lock.json', 'vercel.json'}
    required.update(p for p in tracked if p.endswith('.json') and (
        p.startswith('api/services/classifier/data/') or p.startswith('app/src/')))
    missing = sorted(p for p in required if p not in included or not (ROOT / p).is_file())
    private = sorted(p for p in included if (
        p.startswith(('tools/', 'scripts/', 'local/', 'data/', 'scratch/', 'venv/', '.venv/'))
        or Path(p).name.startswith('.env')
        or Path(p).name in {'admin_config.json', 'admin_task_state.json', 'transfer.json', 'local.json'}
        or p.endswith(('.db', '.sqlite', '.sqlite3', '.dump', '.backup', '.log'))))
    if missing or private:
        raise RuntimeError(f'Invalid deployment inputs: missing={missing}, private={private}')
    config = json.loads((ROOT / 'vercel.json').read_text(encoding='utf-8-sig'))
    entries = {build['src'] for build in config['builds']}
    if entries != {'api/index.py', 'app/package.json'}:
        raise RuntimeError('Review changed Vercel build entry points')
    return {'required_resources': sorted(required), 'source_files': sorted(included)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='Optional local manifest; do not commit private build artifacts')
    args = parser.parse_args()
    result = verify()
    if args.output:
        args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(f"PASS: {len(result['required_resources'])} mandatory resources, "
          f"{len(result['source_files'])} tracked Vercel source inputs; no private/local/admin files")
