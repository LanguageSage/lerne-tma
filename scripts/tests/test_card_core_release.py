"""Release checks reject newline drift, undeclared changes and wheel tampering."""
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import shutil
import unittest
from unittest.mock import patch
from uuid import uuid4
import zipfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('build_card_core', ROOT / 'scripts/build_card_core.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class CardCoreReleaseTests(unittest.TestCase):
    def setUp(self):
        self.release = builder.verify_sources()
        self.root = ROOT / 'local/test-data/card-core-release' / uuid4().hex
        self.root.mkdir(parents=True)
        self.addCleanup(self.cleanup)

    def cleanup(self):
        assert self.root.resolve().parent == (ROOT / 'local/test-data/card-core-release').resolve()
        shutil.rmtree(self.root)

    def test_reviewed_release_matches_actual_git_blobs(self):
        self.assertEqual(self.release['version'], '0.1.3')
        self.assertEqual(self.release['source_version'], '0.1.2')

    def test_crlf_and_undeclared_source_change_are_rejected(self):
        project = self.root / 'project'
        package = project / 'lerne_card_core'
        package.mkdir(parents=True)
        for name in ('provenance.json', 'pyproject.toml'):
            shutil.copyfile(builder.PROJECT / name, project / name)
        for name in self.release['files']:
            shutil.copyfile(builder.PROJECT / 'lerne_card_core' / name, package / name)
        target = package / '__init__.py'
        raw = target.read_bytes()
        with patch.object(builder, 'PROJECT', project):
            builder.verify_sources()
            target.write_bytes(raw.replace(b'\n', b'\r\n'))
            with self.assertRaisesRegex(RuntimeError, 'Reviewed LF source differs'):
                builder.verify_sources()
            target.write_bytes(raw + b'# undeclared change\n')
            with self.assertRaisesRegex(RuntimeError, 'Reviewed LF source differs'):
                builder.verify_sources()

    def wheel(self, changes=None):
        info = 'lerne_card_core-0.1.3.dist-info/'
        members = {'lerne_card_core/' + name: (builder.PROJECT / 'lerne_card_core' / name).read_bytes()
                   for name in self.release['files']}
        members['lerne_card_core/provenance.json'] = (builder.PROJECT / 'provenance.json').read_bytes()
        members[info + 'METADATA'] = b'Name: lerne-card-core\nVersion: 0.1.3\n'
        members[info + 'WHEEL'] = b'Wheel-Version: 1.0\n'
        members[info + 'top_level.txt'] = b'lerne_card_core\n'
        members[info + 'RECORD'] = b''
        members.update(changes or {})
        path = self.root / 'synthetic.whl'
        with zipfile.ZipFile(path, 'w') as wheel:
            for name, raw in members.items():
                wheel.writestr(name, raw)
        builder.canonical_wheel(path, 1700000000)
        return path

    def test_wheel_source_and_provenance_are_verified_beyond_record(self):
        builder.verify_wheel(self.wheel())
        for name, raw, message in (
            ('lerne_card_core/input_parser.py', b'# tampered\n', 'Wheel source differs'),
            ('lerne_card_core/provenance.json', b'{}\n', 'Wheel provenance differs'),
        ):
            with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, message):
                builder.verify_wheel(self.wheel({name: raw}))

    def test_generated_metadata_and_zip_bytes_are_reproducible(self):
        path = self.wheel()
        original = path.read_bytes()
        builder.canonical_wheel(path, 1700000000)
        self.assertEqual(path.read_bytes(), original)
        path = self.wheel({'lerne_card_core-0.1.3.dist-info/top_level.txt': b'lerne_card_core\r\n'})
        self.assertEqual(path.read_bytes(), original)

    def test_record_tampering_is_rejected(self):
        path = self.wheel()
        with zipfile.ZipFile(path) as wheel:
            members = {name: wheel.read(name) for name in wheel.namelist()}
        members['lerne_card_core-0.1.3.dist-info/METADATA'] += b'Summary: tampered\n'
        with zipfile.ZipFile(path, 'w') as wheel:
            for name, raw in members.items():
                wheel.writestr(name, raw)
        with self.assertRaisesRegex(RuntimeError, 'Wheel RECORD differs'):
            builder.verify_wheel(path)
