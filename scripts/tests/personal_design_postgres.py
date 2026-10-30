"""Design migration and recovery against a new disposable native PostgreSQL cluster."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import unittest
from uuid import uuid4


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bin-dir', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    scratch = root / 'local/test-data' / ('personal-design-pg-' + uuid4().hex)
    scratch.mkdir(parents=True)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    safe = {k: v for k, v in os.environ.items()
            if k.upper() in {'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'}}
    safe.update(PYTHON_DOTENV_DISABLED='1', RUN_MIGRATIONS='false', VERCEL='1', PGCLIENTENCODING='UTF8')
    os.environ.clear()
    os.environ.update(safe)

    def run(name, *params):
        with (scratch / (name + '.log')).open('ab') as output:
            subprocess.run([str(args.bin_dir / name), *map(str, params)], env=safe,
                           stdout=output, stderr=output, check=True, timeout=60,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))

    started = False
    db = None
    try:
        run('initdb', '-D', scratch / 'data', '-U', 'design_test', '-A', 'trust', '--no-locale', '-E', 'UTF8')
        run('pg_ctl', '-D', scratch / 'data', '-l', scratch / 'postgres.log',
            '-o', f'-h 127.0.0.1 -p {port}', '-w', 'start')
        started = True
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from test_personal_design_migration import PersonalDesignMigrationTests, models, design
        from api.services.user_settings import save_user_settings, read_user_settings, read_design_backup
        from fastapi import HTTPException
        from peewee import PostgresqlDatabase
        db = PostgresqlDatabase('postgres', host='127.0.0.1', port=port, user='design_test')

        class PostgresDesignTests(PersonalDesignMigrationTests):
            def setUp(self):
                self.database = db
                self.previous_db = models.TMASetting._meta.database
                db.bind([models.TMASetting])
                db.create_tables([models.TMASetting])
                self.raw = '{ "cardFont": "Georgia", "userDesign": {"extra": [1,2]}, "studyMode": "speak", "unknown": true }'
                models.TMASetting.create(key='USER_SETTINGS_1', value=self.raw)

            def tearDown(self):
                db.drop_tables([models.TMASetting])

        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(PostgresDesignTests))
        if not result.wasSuccessful():
            raise RuntimeError('PostgreSQL migration tests failed')

        db.create_tables([models.TMASetting])
        original = '{ "cardFont": "Georgia", "cardBgFront": "liquid_emerald", "unknown": [1,2] }'
        models.TMASetting.create(key='USER_SETTINGS_1', value=original)
        save_user_settings(1, {'designV2': design()})
        barrier = threading.Barrier(2)

        def write(font):
            try:
                with db.connection_context():
                    barrier.wait(timeout=10)
                    try:
                        save_user_settings(1, {'designV2': design(1, font)})
                        return 200
                    except HTTPException as error:
                        return error.status_code
            finally:
                if not db.is_closed():
                    db.close()

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = sorted(pool.map(write, ['serif-new', 'monospace']))
        assert statuses == [200, 409], statuses
        before = read_user_settings(1)
        assert before['designV2']['revision'] == 2
        connection = ['-h', '127.0.0.1', '-p', port, '-U', 'design_test']
        run('pg_dump', *connection, '-d', 'postgres', '-Fc', '-f', scratch / 'backup.dump')
        # Restore into another new database; no existing database is replaced.
        run('createdb', *connection, 'design_recovered')
        run('pg_restore', *connection, '-d', 'design_recovered', '--exit-on-error', scratch / 'backup.dump')
        db.close()
        recovered = PostgresqlDatabase('design_recovered', host='127.0.0.1', port=port, user='design_test')
        with recovered.bind_ctx([models.TMASetting]):
            assert read_user_settings(1) == before
            assert read_design_backup(1)['raw'] == original
            # Exercise the actual JS backup converter before saving a new revision.
            converter = "import {migrateLegacyDesignSettings as convert} from './app/src/design/legacyAdapter.js'; process.stdout.write(JSON.stringify(convert(JSON.parse(process.argv[1]))));"
            converted = subprocess.run(['node', '--input-type=module', '-e', converter, original],
                                       cwd=root, env=safe, check=True, capture_output=True, text=True, timeout=30)
            config = json.loads(converted.stdout)
            restored = save_user_settings(1, {'designV2': {**before['designV2'], 'config': config}})['designV2']
            assert restored['revision'] == 3
            assert restored['config']['front']['mainText']['font'] == 'Georgia'
            assert restored['config']['front']['card']['background'] == 'liquid_emerald'
            assert read_design_backup(1)['raw'] == original
        recovered.close()
        (scratch / 'result.json').write_text(json.dumps({'tests': result.testsRun, 'concurrent': statuses,
            'physical_restore': True, 'converted_backup_revision': 3}, indent=2), encoding='utf-8')
        print(f'PASS: migration, concurrency, physical restore, JS backup conversion; artifacts: {scratch}')
    finally:
        if db is not None and not db.is_closed():
            db.close()
        if started:
            run('pg_ctl', '-D', scratch / 'data', '-m', 'immediate', '-w', 'stop')


if __name__ == '__main__':
    main()
