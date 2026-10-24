"""Offline Production source manifest audit. No Vercel login/build/upload or DB I/O."""
import argparse
from contextlib import contextmanager
import fnmatch
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]


def git_files(root):
    names = subprocess.check_output(['git', '-C', str(root), 'ls-files', '--cached', '--others', '--exclude-standard'], text=True)
    return sorted({name for name in names.splitlines() if (root / name).is_file()})


@contextmanager
def temporary_git():
    parent = Path(tempfile.gettempdir()).resolve()
    root = parent / ('lerne-deploy-check-' + uuid4().hex)
    root.mkdir()  # Inherit ACLs; supports restricted Windows Python 3.14 processes.
    try:
        subprocess.run(['git', 'init', '--quiet', str(root)], check=True)
        yield root
    finally:
        assert root.parent == parent and root.name.startswith('lerne-deploy-check-')
        shutil.rmtree(root)


def ignored_paths(patterns, names):
    with temporary_git() as root:
        (root / '.gitignore').write_text(patterns, encoding='utf-8')
        for name in names:
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.touch()
        result = subprocess.run(['git', '-C', str(root), '-c', 'core.excludesFile=',
                                 'check-ignore', '--no-index', '-z', '--stdin'],
                                input=('\0'.join(names) + '\0').encode('utf-8'), capture_output=True)
        if result.returncode not in (0, 1):
            raise RuntimeError('Unable to evaluate deployment ignore rules')
        return set(result.stdout.decode('utf-8').rstrip('\0').split('\0')) if result.stdout else set()


def expand_braces(pattern):
    if '{' not in pattern:
        return [pattern]
    start, end = pattern.index('{'), pattern.index('}')
    return [value for item in pattern[start + 1:end].split(',')
            for value in expand_braces(pattern[:start] + item + pattern[end + 1:])]


def inspect(root=ROOT):
    names = git_files(root)
    required = ['api/index.py', 'api/requirements.txt', 'app/package.json',
                'app/src/data/bundeslaender.js']
    required += [f'{base}/vocab_de{suffix}.json'
                 for base in ('api/services/classifier/data', 'app/src/services/classifier/data')
                 for suffix in ('', '_medium', '_max')]
    required += [p for p in names if p.endswith('.json') and
                 (p.startswith('api/services/classifier/data/') or p.startswith('app/src/'))
                 and '/__tests__/' not in p]
    blocked = ['tools/admin/server.py', 'local/runtime.py', 'scripts/local_dev.py',
               '.env', 'api/.env', 'data/config/local.json', 'api/data/backups/private.json',
               'api/example.sqlite', 'app/private.db', 'api/admin_task_state.json',
               'reports/lesson-qa/pre-change-backup.json', '.venv/pyvenv.cfg',
               'api/__pycache__/models.pyc', 'app/node_modules/example/index.js']
    patterns = (root / '.vercelignore').read_text(encoding='utf-8')
    ignored = ignored_paths(patterns, sorted(set(names + required + blocked)))
    missing = [p for p in required if p not in names or not (root / p).is_file() or p in ignored]
    leaked = [p for p in blocked if p not in ignored]
    config = json.loads((root / 'vercel.json').read_text(encoding='utf-8'))
    python_config = next(b['config'] for b in config['builds'] if b['src'] == 'api/index.py')
    excluded = python_config.get('excludeFiles', [])
    excluded = [excluded] if isinstance(excluded, str) else excluded
    excluded = [item for pattern in excluded for item in expand_braces(pattern)]
    missing += [p for p in required if any(fnmatch.fnmatchcase(p, x) for x in excluded)]
    for path in required:
        if path.endswith('.json'):
            json.loads((root / path).read_text(encoding='utf-8'))
    if missing or leaked:
        raise RuntimeError('Required source excluded: ' + ', '.join(missing) + '; private paths allowed: ' + ', '.join(leaked))
    return {'required_resources': sorted(set(required)), 'source_files': [p for p in names if p not in ignored],
            'private_path_checks': len(blocked), 'scope': 'source upload + configured Python exclusions; no deployment'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    report = inspect()
    if args.output:
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f"PASS: {len(report['required_resources'])} required resources, {len(report['source_files'])} upload inputs; private paths excluded")


if __name__ == '__main__':
    main()
