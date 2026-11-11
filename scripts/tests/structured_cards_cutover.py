"""Synthetic cutover observations and rollback drill, disposable cluster ONLY."""
import json
import os
import re
import subprocess
import sys
import unittest
from unittest.mock import patch
from uuid import uuid4


def verify(db, binaries, scratch):
    os.environ['SUPABASE_DB_URL'] = f'postgresql://cards_test@127.0.0.1:{db.connect_params["port"]}/postgres'
    from peewee import Model, PostgresqlDatabase
    from fastapi.testclient import TestClient
    from api import models
    from api.auth.service import _create_session, utcnow
    from api.card_cutover_preflight import inspect_postgres
    from api.main import app

    models.tma_db.initialize(db)
    models.lerne_db.initialize(db)
    tables = [value for value in vars(models).values() if isinstance(value, type)
              and issubclass(value, Model) and value.__module__ == models.__name__
              and value is not models.BaseModel]
    db.create_tables(tables)
    # Fixture DDL, not a migration. Never invokes app lifespan or migration code.
    db.execute_sql('CREATE TABLE tma_migration_history (migration_id int PRIMARY KEY)')
    db.execute_sql('INSERT INTO tma_migration_history VALUES (92), (93), (94)')
    db.execute_sql('ALTER TABLE tma_card ADD CONSTRAINT cutover_fixture_positive_id CHECK (id > 0)')
    folder = models.TMA_Folder.create(user_id=1, name='Synthetic folder')
    deck = models.TMA_Deck.create(user_id=1, folder=folder, name='Synthetic deck')
    legacy = models.TMA_Card.create(deck=deck, front_text='Literal [[V1]]', back_text='Antwort',
        context='Контекст', history='["original"]', topics='Synthetic', metadata='{"retained":true}',
        image_data=b'\x00\xfforiginal-image', audio_path='audio/embedded.wav', position=9)
    models.TMA_Card.create(deck=deck, front_text='Deleted V1', back_text='', is_deleted=True)
    native = models.TMA_Card.create(deck=deck, front_text=None, back_text=None, card_type=None,
        content_v2={'schema_version': 2, 'card': {'type': 'standard', 'data': {'front': 'Native', 'back': 'Back'}}})
    models.TMAProgress.create(card_id=legacy.id, user_id=1, repetitions=4, interval=19, flag=3, want_to_learn=True)
    review = models.TMAReviewHistory.create(card_id=legacy.id, user_id=1, rating=3)
    models.TMACardNote.create(id=str(uuid4()), card=legacy, user_id=1, text='Retain tombstone', is_deleted=True)
    models.TMACardRating.create(card=legacy, user_id=1, rating=1)
    models.TMAUserMessage.create(id=str(uuid4()), user_id=1, sender='user', kind='suggestion', text='Synthetic message', card_id=legacy.id)
    ki = models.TMAKnowledgeItem.create(name='Synthetic KI')
    models.TMACardKnowledgeItem.create(card_id=legacy.id, knowledge_item=ki)
    models.TMAKnowledgeAttempt.create(user_id=1, knowledge_item=ki, card_id=legacy.id,
        client_event_id='immutable-event', review_id=review.id, evaluation_data='{"score":1}')
    models.TMAUserKnowledgeState.create(user_id=1, knowledge_item=ki, attempts_count=3, state_data='{"synthetic":true}')
    models.TMAMedia.create(folder='audio', filename='embedded.wav', content=b'\x00\xffRIFF-original')
    models.TMASetting.create(key='USER_SETTINGS_1', value='{"retained":true}')
    models.TMAOfflineBatch.create(key='immutable-receipt', payload_hash='synthetic', response='{"mapping":{"-8":1}}')
    models.TMA_Collaborator.create(target_type='deck', target_id=deck.id, user_id=2, role='editor')
    library = models.Deck.create(name='Synthetic library')
    models.Card.create(deck=library, front_text='Library V1', back_text='Original')
    models.TMAUser.create(user_id=1, default_decks_initialized=True)
    account = models.TMAAuthAccount.create(user=1)
    tokens = _create_session(account, utcnow())
    headers = {'Authorization': 'Bearer ' + tokens.access_token}
    connection = ['-h', '127.0.0.1', '-p', str(db.connect_params['port']), '-U', 'cards_test']

    def pg(name, *args, success=True):
        suffix = '.exe' if os.name == 'nt' else ''
        result = subprocess.run([str(binaries / (name + suffix)), *connection, *map(str, args)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if success and result.returncode:
            raise AssertionError(f'{name} failed ({result.returncode})')
        return result

    class CutoverTests(unittest.TestCase):
        def assert_restored(self, actual, expected):
            self.assertEqual(actual['data_fingerprint'], expected['data_fingerprint'])
            self.assertEqual(actual['manifest']['sequences'], expected['manifest']['sequences'])
            self.assertEqual(set(actual['manifest']['tables']), set(expected['manifest']['tables']))
            for name, original in expected['manifest']['tables'].items():
                recovered = actual['manifest']['tables'][name]
                self.assertEqual({k: v for k, v in recovered.items() if k != 'constraints'},
                                 {k: v for k, v in original.items() if k != 'constraints'}, name)
                self.assertEqual(len(recovered['constraints']), len(original['constraints']), name)
                for restored, source in zip(recovered['constraints'], original['constraints']):
                    self.assertEqual((restored[0], restored[2]), (source[0], source[2]))
                    if restored[1] == source[1]:
                        continue
                    # PG17 reparses varchar[]::text[] membership checks into
                    # per-element casts during pg_restore. Permit only this
                    # observed equivalent varchar IN-list expressions. All other
                    # constraint text, including every FK, must match exactly.
                    self.assertIn(name, ('tma_auth_challenge', 'tma_auth_identity', 'tma_auth_token', 'tma_card_knowledge_item'))
                    def membership(expression):
                        expression = re.sub(r'::(?:character varying|text)(?:\[\])?', '', expression)
                        expression = re.sub(r'[()\s]', '', expression)
                        self.assertRegex(expression, r"^CHECK(?:provider|purpose|kind|role)=ANYARRAY\['[a-z_]+'(?:,'[a-z_]+')*\]$")
                        return expression
                    self.assertEqual(membership(restored[1]), membership(source[1]))

        def test_01_inventory_is_repeatable_read_only_and_includes_deleted_library_and_private_data(self):
            statements = []
            execute = db.execute_sql
            def record(sql, *args, **kwargs):
                statements.append(sql)
                return execute(sql, *args, **kwargs)
            with patch.object(db, 'execute_sql', side_effect=record):
                first = inspect_postgres(db)
            second = inspect_postgres(db)
            self.assertEqual(first['manifest'], second['manifest'])
            self.assertEqual(first['fingerprint'], second['fingerprint'])
            self.assertFalse(first['safe_to_stop_v1_writes'])
            self.assertEqual(first['cards']['tma_card'], {'v1_active': 1, 'v1_deleted': 1, 'v2': 1})
            self.assertEqual(first['cards']['card']['v1_active'], 1)
            for name in ('tma_card_note', 'tma_card_rating', 'tma_user_message', 'tmareviewhistory',
                         'tma_knowledge_attempt', 'tma_offline_batch', 'tmamedia', 'tma_auth_token', 'tma_migration_history'):
                self.assertGreater(first['manifest']['tables'][name]['rows'], 0, name)
            self.assertIn('READ ONLY', statements[0])
            self.assertFalse(any(sql.lstrip().split()[0].upper() in {'INSERT', 'UPDATE', 'DELETE', 'ALTER', 'CREATE', 'DROP'} for sql in statements))
            with db.atomic(), self.assertRaisesRegex(ValueError, 'own read-only'):
                inspect_postgres(db)

        def test_02_legacy_http_writer_and_immutable_replay_are_still_live(self):
            client = TestClient(app)  # no lifespan => no startup migrations/seed
            body = {'request_id': str(uuid4()), 'cards': [{'id': -17, 'deck_id': deck.id,
                    'front_text': 'Old device create', 'back_text': 'Keep original'}]}
            self.assertEqual(client.post('/api/sync/v2/push', json=body).status_code, 401)
            result = client.post('/api/sync/v2/push', json=body, headers=headers)
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(client.post('/api/sync/v2/push', json=body, headers=headers).json(), result.json())
            created = models.TMA_Card.get_by_id(result.json()['mappings']['cards']['-17'])
            self.assertIsNone(created.content_v2)
            self.assertEqual(created.front_text, body['cards'][0]['front_text'])
            old_push = client.post('/api/sync/push', headers=headers, json={'cards': [{
                'id': -18, 'deck_id': deck.id, 'front_text': 'Old non-idempotent protocol',
                'back_text': 'Original', 'created_at': '2026-01-01T00:00:00', 'updated_at': '2026-01-01T00:00:00'}]})
            self.assertEqual(old_push.status_code, 200, old_push.text)
            self.assertEqual(models.TMA_Card.select().where(models.TMA_Card.front_text == 'Old non-idempotent protocol').count(), 1)
            # A mixed request rolls back even its earlier accepted V1 creation.
            before = inspect_postgres(db)['manifest']
            rejected = {**body, 'request_id': str(uuid4()), 'cards': [body['cards'][0],
                {**body['cards'][0], 'id': native.id}]}
            response = client.post('/api/sync/v2/push', json=rejected, headers=headers)
            self.assertEqual(response.status_code, 409, response.text)
            after = inspect_postgres(db)['manifest']
            self.assertEqual(after['tables'], before['tables'])
            # nextval is intentionally not transactional; a rejected batch can
            # leave an ID gap without committing a row or receipt.
            self.assertGreaterEqual(after['sequences']['tma_card_id_seq'][0], before['sequences']['tma_card_id_seq'][0])
            self.assertEqual(client.post('/api/cards/save', json={'front': 'Legacy', 'back': 'No conversion'}, headers=headers).status_code, 422)
            client.close()

        def test_03_dump_restore_matches_every_public_row_schema_sequence_and_detects_loss(self):
            before = inspect_postgres(db)
            dump = scratch / 'cutover.dump'
            # Same complete custom-dump options used by LOCAL backup.
            pg('pg_dump', '-d', 'postgres', '--format=custom', '--no-owner', '--no-acl', '-f', dump)
            pg('createdb', 'cutover_restored')
            pg('pg_restore', '-d', 'cutover_restored', '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', dump)
            restored = PostgresqlDatabase('cutover_restored', **db.connect_params)
            with restored.connection_context():
                recovered = inspect_postgres(restored)
                self.assert_restored(recovered, before)
                restored.execute_sql('DELETE FROM tma_offline_batch')
                self.assertNotEqual(inspect_postgres(restored)['fingerprint'], before['fingerprint'])
            self.assertEqual(inspect_postgres(db)['fingerprint'], before['fingerprint'])

        def test_04_restore_sql_failure_rolls_back_and_same_archive_can_be_retried(self):
            pg('createdb', 'cutover_retry')
            retry = PostgresqlDatabase('cutover_retry', **db.connect_params)
            # Existing late-sorted table forces a failure after earlier CREATEs.
            retry.execute_sql('CREATE TABLE tmasetting (sentinel text)')
            retry.execute_sql("INSERT INTO tmasetting VALUES ('retain')")
            before = inspect_postgres(retry)['manifest']
            failure = pg('pg_restore', '-d', 'cutover_retry', '--exit-on-error', '--single-transaction',
                         '--no-owner', '--no-acl', scratch / 'cutover.dump', success=False)
            self.assertNotEqual(failure.returncode, 0)
            self.assertEqual(inspect_postgres(retry)['manifest'], before)
            retry.execute_sql('DROP TABLE tmasetting')  # disposable test fixture only
            pg('pg_restore', '-d', 'cutover_retry', '--exit-on-error', '--single-transaction',
               '--no-owner', '--no-acl', scratch / 'cutover.dump')
            self.assert_restored(inspect_postgres(retry), inspect_postgres(db))
            retry.close()

        def test_05_cli_does_not_import_application_and_always_reports_missing_global_evidence(self):
            url = f'postgresql://cards_test@127.0.0.1:{db.connect_params["port"]}/postgres'
            result = subprocess.run([sys.executable, 'scripts/structured_cards_preflight.py', '--dsn-env', 'CUTOVER_TEST_URL'],
                env={**os.environ, 'CUTOVER_TEST_URL': url}, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, timeout=60, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertNotIn('DATABASE', result.stderr)
            report = json.loads(result.stdout)
            self.assertFalse(report['safe_to_stop_v1_writes'])
            self.assertEqual(report['fingerprint'], inspect_postgres(db)['fingerprint'])

        def test_06_read_failure_and_rls_never_produce_success_and_retry_is_safe(self):
            before = inspect_postgres(db)['manifest']
            execute = db.execute_sql
            def attempt_write(sql, *args, **kwargs):
                if 'FROM pg_class' in sql:
                    execute("INSERT INTO tmasetting (key,value) VALUES ('must_not_exist','x')")
                return execute(sql, *args, **kwargs)
            from peewee import InternalError
            with patch.object(db, 'execute_sql', side_effect=attempt_write), self.assertRaises(InternalError):
                inspect_postgres(db)
            self.assertEqual(inspect_postgres(db)['manifest'], before)
            db.execute_sql('CREATE ROLE cutover_restricted')
            db.execute_sql('GRANT USAGE ON SCHEMA public TO cutover_restricted')
            db.execute_sql('GRANT SELECT ON ALL TABLES IN SCHEMA public TO cutover_restricted')
            db.execute_sql('ALTER TABLE tma_card ENABLE ROW LEVEL SECURITY')
            try:
                db.execute_sql('SET ROLE cutover_restricted')
                with self.assertRaisesRegex(ValueError, 'cannot observe all rows'):
                    inspect_postgres(db)
            finally:
                db.execute_sql('RESET ROLE')
                db.execute_sql('ALTER TABLE tma_card DISABLE ROW LEVEL SECURITY')
            self.assertEqual(inspect_postgres(db)['manifest'], before)

    return unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(CutoverTests)).wasSuccessful()
