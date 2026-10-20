"""One local/CI entry point. Run every gate and preserve all failures."""
import os
from pathlib import Path
import shutil
import subprocess


def main():
    root = Path(__file__).resolve().parents[1]
    npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
    if not npm:
        raise SystemExit('npm is required (Node 22.13+).')
    commands = {
        'frontend': [npm, 'run', 'test:frontend'],
        'backend': [npm, 'run', 'test:backend'],
        'browser': [npm, 'run', 'test:browser'],
        'lint': [npm, '--prefix', 'app', 'run', 'lint'],
        'build': [npm, '--prefix', 'app', 'run', 'build'],
    }
    failed = []
    for name, command in commands.items():
        print(f'\n=== {name} ===', flush=True)
        if subprocess.run(command, cwd=root).returncode:
            failed.append(name)
    print('\nChecks failed: ' + ', '.join(failed) if failed else '\nAll checks passed.', flush=True)
    return int(bool(failed))


if __name__ == '__main__':
    raise SystemExit(main())
