"""Build/verify a byte-exact card-core release from reviewed Git sources.

No DB, application imports, network, or contract updates. Build scratch is confined
to local/test-data; pip uses only the installed setuptools backend.
"""
import argparse
import base64
import csv
import datetime
from hashlib import sha256
import io
from importlib import metadata
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tomllib
from uuid import uuid4
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / 'api/card_core'


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])


def verify_sources():
    release = json.loads((PROJECT / 'provenance.json').read_text(encoding='utf-8'))
    if b'\r' in (PROJECT / 'provenance.json').read_bytes():
        raise RuntimeError('Provenance must use LF')
    if release['newline'] != 'LF':
        raise RuntimeError('Release must use LF')
    version = tomllib.loads((PROJECT / 'pyproject.toml').read_text(encoding='utf-8'))['project']['version']
    if version != release['version']:
        raise RuntimeError('Project/provenance version differs')
    names = {p.name for p in (PROJECT / 'lerne_card_core').glob('*.py')}
    if names != set(release['files']):
        raise RuntimeError('Incomplete package file catalog')
    for name, expected in release['files'].items():
        relative = 'api/card_core/lerne_card_core/' + name
        original = git('show', release['source_revision'] + ':' + relative)
        if sha256(original).hexdigest() != release['source_files'][relative]:
            raise RuntimeError('Git source differs: ' + name)
        # 0.1.3 changes packaging only. The sole declared source delta is version.
        reviewed = original
        if name == '__init__.py':
            old = ('__version__ = "' + release['source_version'] + '"').encode()
            new = ('__version__ = "' + release['version'] + '"').encode()
            if original.count(old) != 1:
                raise RuntimeError('Unexpected base version')
            reviewed = original.replace(old, new)
        actual = (PROJECT / 'lerne_card_core' / name).read_bytes()
        if b'\r' in actual or actual != reviewed or sha256(actual).hexdigest() != expected:
            raise RuntimeError('Reviewed LF source differs: ' + name)
    return release


def verify_wheel(path):
    release = verify_sources()
    with zipfile.ZipFile(path) as wheel:
        provenance = wheel.read('lerne_card_core/provenance.json')
        if provenance != (PROJECT / 'provenance.json').read_bytes():
            raise RuntimeError('Wheel provenance differs')
        members = wheel.namelist()
        expected_py = {'lerne_card_core/' + name for name in release['files']}
        if {n for n in members if n.endswith('.py')} != expected_py or len(members) != len(set(members)):
            raise RuntimeError('Unexpected wheel sources')
        for name, expected in release['files'].items():
            raw = wheel.read('lerne_card_core/' + name)
            if sha256(raw).hexdigest() != expected:
                raise RuntimeError('Wheel source differs: ' + name)
        info = 'lerne_card_core-' + release['version'] + '.dist-info/'
        expected_members = expected_py | {'lerne_card_core/provenance.json'} | {
            info + name for name in ('METADATA', 'WHEEL', 'top_level.txt', 'RECORD')}
        if set(members) != expected_members:
            raise RuntimeError('Unexpected wheel contents')
        metadata = wheel.read(info + 'METADATA').decode()
        if 'Version: ' + release['version'] not in metadata.splitlines():
            raise RuntimeError('Wheel version differs')
        rows = list(csv.reader(io.StringIO(wheel.read(info + 'RECORD').decode())))
        if {r[0] for r in rows} != set(members) or len(rows) != len(members):
            raise RuntimeError('Incomplete wheel RECORD')
        for name, digest, size in rows:
            if name == info + 'RECORD':
                if digest or size:
                    raise RuntimeError('Unexpected RECORD self-hash')
                continue
            raw = wheel.read(name)
            expected = 'sha256=' + base64.urlsafe_b64encode(sha256(raw).digest()).rstrip(b'=').decode()
            if digest != expected or size != str(len(raw)):
                raise RuntimeError('Wheel RECORD differs: ' + name)
    return release


def canonical_wheel(path, epoch):
    """Normalize generated wheel metadata/ZIP only; never normalize source bytes."""
    with zipfile.ZipFile(path) as wheel:
        members = {name: wheel.read(name) for name in wheel.namelist()}
    record, = [name for name in members if name.endswith('.dist-info/RECORD')]
    for name in members:
        if '.dist-info/' in name:
            members[name] = members[name].replace(b'\r\n', b'\n')
    rows = []
    for name in sorted(members):
        if name == record:
            continue
        raw = members[name]
        digest = base64.urlsafe_b64encode(sha256(raw).digest()).rstrip(b'=').decode()
        rows.append((name, 'sha256=' + digest, str(len(raw))))
    rows.append((record, '', ''))
    buffer = io.StringIO(newline='')
    csv.writer(buffer, lineterminator='\n').writerows(rows)
    members[record] = buffer.getvalue().encode()
    stamp = datetime.datetime.fromtimestamp(max(315532800, int(epoch)), datetime.timezone.utc).timetuple()[:6]
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as wheel:
        for name in sorted(members):
            info = zipfile.ZipInfo(name, stamp)
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            wheel.writestr(info, members[name], compresslevel=9)


def build(output):
    release = verify_sources()
    for name in ('setuptools', 'wheel'):
        if metadata.version(name) != release['build'][name]:
            raise RuntimeError('Install the reviewed build tool: ' + name + '==' + release['build'][name])
    scratch_root = ROOT / 'local/test-data/card-core-release'
    scratch_root.mkdir(parents=True, exist_ok=True)
    scratch = scratch_root / uuid4().hex
    scratch.mkdir()
    try:
        shutil.copyfile(PROJECT / 'pyproject.toml', scratch / 'pyproject.toml')
        package = scratch / 'lerne_card_core'
        package.mkdir()
        for name in release['files']:
            shutil.copyfile(PROJECT / 'lerne_card_core' / name, package / name)
        shutil.copyfile(PROJECT / 'provenance.json', package / 'provenance.json')
        env = {k: v for k, v in os.environ.items() if k.upper() not in {'PYTHONPATH', 'PYTHONHOME'}}
        env['SOURCE_DATE_EPOCH'] = git('show', '-s', '--format=%ct', release['source_revision']).decode().strip()
        wheels = scratch / 'wheels'
        subprocess.run([sys.executable, '-m', 'pip', 'wheel', '--no-deps', '--no-index',
                        '--no-build-isolation', '--disable-pip-version-check',
                        '--wheel-dir', str(wheels), str(scratch)], env=env, check=True)
        wheel, = wheels.glob('*.whl')
        canonical_wheel(wheel, env['SOURCE_DATE_EPOCH'])
        verify_wheel(wheel)
        output.mkdir(parents=True, exist_ok=True)
        target = output / wheel.name
        if target.exists() and target.read_bytes() != wheel.read_bytes():
            raise RuntimeError('Refusing to overwrite a different release wheel')
        shutil.copyfile(wheel, target)
        print(str(target) + '\nSHA256 ' + sha256(target.read_bytes()).hexdigest())
        return target
    finally:
        assert scratch.resolve().parent == scratch_root.resolve()
        shutil.rmtree(scratch)


if __name__ == '__main__':
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('--output', type=Path)
    args.add_argument('--wheel', type=Path)
    options = args.parse_args()
    if options.wheel:
        verify_wheel(options.wheel)
    elif options.output:
        build(options.output.resolve())
    else:
        verify_sources()
    print('PASS: Git baseline + declared version change → LF provenance → release sources' +
          (' → wheel/RECORD' if options.wheel or options.output else ''))
