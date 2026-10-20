"""Destructive tests ONLY in a fresh local PostgreSQL database created here.

No .env loading, no configurable hostname, no production connections.
Run on a disposable cluster: python scripts/test_supabase_security.py --disposable
CI uses PostgreSQL 17; local --port defaults to 55439.
"""
import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sys
import time
from urllib.parse import urlencode
from unittest.mock import patch
from uuid import uuid4

import psycopg2
from psycopg2 import sql

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
SECURITY = ROOT / 'security' / 'supabase'
# Production catalog at audit time, names only. No production records are copied.
TABLES = '''card deck grammartopic library_category progress promptpreset reviewhistory
setting systemprompt tma_card tma_custom_prompt tma_deck tma_feedback tma_folder
tma_game_attempt tma_linked_session tma_migration_history tma_user tmamedia
tmaprogress tmareviewhistory tmasetting tmauserprompt uservoice tma_offline_batch
tma_auth_code tma_auth_account tma_collaborator tma_auth_identity tma_auth_proof
tma_auth_session tma_auth_token tma_auth_challenge tma_auth_password
tma_auth_password_throttle tma_knowledge_item tma_card_knowledge_item
tma_knowledge_attempt tma_user_knowledge_state'''.split()
OPEN_TABLES = set('''tma_offline_batch tma_auth_code tma_auth_account tma_collaborator
tma_auth_identity tma_auth_proof tma_auth_session tma_auth_token tma_auth_challenge
tma_auth_password tma_auth_password_throttle tma_knowledge_item tma_card_knowledge_item
tma_knowledge_attempt tma_user_knowledge_state'''.split())


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def run(port, bootstrap_user):
    connection_args = dict(host='127.0.0.1', port=port, user='postgres',
                           password=os.getenv('LERNE_SECURITY_TEST_PASSWORD', ''),
                           connect_timeout=5)
    name = 'lerne_security_test_' + uuid4().hex
    admin = psycopg2.connect(dbname='postgres', **{**connection_args, 'user': bootstrap_user})
    admin.autocommit = True
    created_roles = []
    database = None
    conn = None
    try:
        with admin.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_roles WHERE rolname='postgres'")
            if not cur.fetchone():
                cur.execute('CREATE ROLE postgres LOGIN NOSUPERUSER BYPASSRLS PASSWORD %s',
                            (connection_args['password'],))
                created_roles.append('postgres')
            for role in ('anon', 'authenticated', 'service_role'):
                cur.execute('SELECT 1 FROM pg_roles WHERE rolname = %s', (role,))
                if not cur.fetchone():
                    cur.execute(sql.SQL('CREATE ROLE {} NOLOGIN {}').format(
                        sql.Identifier(role), sql.SQL('BYPASSRLS' if role == 'service_role' else 'NOBYPASSRLS')))
                    created_roles.append(role)
            cur.execute('GRANT anon, authenticated, service_role TO postgres')
            cur.execute(sql.SQL('CREATE DATABASE {} OWNER postgres').format(sql.Identifier(name)))
        conn = psycopg2.connect(dbname=name, **connection_args)
        conn.autocommit = True
        cur = conn.cursor()
        execute = cur.execute
        execute("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")
        print('Server role postgres (superuser, bypassrls): ' + str(cur.fetchone()), flush=True)
        # The API imports must never consume developer or production environment.
        with patch.dict(os.environ, {'VERCEL': '1', 'LERNE_SKIP_SCHEMA_INIT': '1'}, clear=True), \
                patch('dotenv.load_dotenv', return_value=False):
            from api import database as module
            with patch.object(module, 'initialize_database', return_value=False):
                from api import models
        from peewee import Model, PostgresqlDatabase
        database = PostgresqlDatabase(name, thread_safe=False, **connection_args)
        models.tma_db.initialize(database)
        models.lerne_db.initialize(database)
        model_types = [v for v in vars(models).values() if isinstance(v, type)
                       and issubclass(v, Model) and v not in (Model, models.BaseModel)]
        database.create_tables(model_types)
        for table in TABLES:
            execute(sql.SQL('CREATE TABLE IF NOT EXISTS {} (id serial PRIMARY KEY, value text)').format(
                sql.Identifier(table)))
            if table not in OPEN_TABLES:
                execute(sql.SQL('ALTER TABLE {} ENABLE ROW LEVEL SECURITY').format(sql.Identifier(table)))
        execute('CREATE TABLE tma_security_probe (id serial PRIMARY KEY, value text)')
        execute("INSERT INTO tma_security_probe(value) VALUES ('synthetic')")
        # Reproduce Supabase's old default ACLs, including non-DML privileges.
        execute('GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role')
        execute('GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role')
        execute('GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role')
        execute('GRANT SELECT (value) ON tma_security_probe TO PUBLIC')
        for kind in ('TABLES', 'SEQUENCES', 'FUNCTIONS'):
            execute(f'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON {kind} '
                    'TO anon, authenticated, service_role')
        audit = (SECURITY / 'audit.sql').read_text(encoding='utf-8')
        execute(audit)
        check(any(row[0] == 'rls_disabled' for row in cur.fetchall()), 'Gate missed old RLS failure')
        execute('SET ROLE anon')
        execute('SELECT count(*) FROM tma_security_probe')
        check(cur.fetchone()[0] == 1, 'Old vulnerability was not reproduced')
        execute('RESET ROLE')
        print('PASS: reproduced previous exposure and failing catalog gate', flush=True)

        def metadata():
            execute("SELECT relname, relrowsecurity, ARRAY(SELECT "
                    "format('%s:%s:%s:%s',grantor,grantee,privilege_type,is_grantable) "
                    "FROM aclexplode(relacl) ORDER BY grantor,grantee,privilege_type) FROM pg_class "
                    "WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p','S') ORDER BY 1")
            objects = cur.fetchall()
            execute("SELECT defaclnamespace, defaclobjtype, ARRAY(SELECT "
                    "format('%s:%s:%s:%s',grantor,grantee,privilege_type,is_grantable) "
                    "FROM aclexplode(defaclacl) ORDER BY grantor,grantee,privilege_type) FROM pg_default_acl "
                    "WHERE defaclrole = 'postgres'::regrole ORDER BY 1,2")
            defaults = cur.fetchall()
            execute("SELECT attname,attacl::text FROM pg_attribute "
                    "WHERE attrelid='tma_security_probe'::regclass AND attnum>0 ORDER BY 1")
            columns = cur.fetchall()
            execute("SELECT ARRAY(SELECT format('%s:%s:%s:%s',grantor,grantee,privilege_type,is_grantable) "
                    "FROM aclexplode(nspacl) ORDER BY grantor,grantee,privilege_type) "
                    "FROM pg_namespace WHERE nspname='public'")
            return objects, defaults, columns, cur.fetchall()

        original = metadata()
        migration = (SECURITY / '20261020_lock_public.sql').read_text(encoding='utf-8')
        execute("CREATE FUNCTION public.unreviewed_rpc() RETURNS int LANGUAGE sql AS 'SELECT 1'")
        try:
            execute(migration)
        except psycopg2.errors.RaiseException:
            execute('ROLLBACK')
        else:
            raise AssertionError('Migration accepted unreviewed RPC')
        execute('DROP FUNCTION unreviewed_rpc()')
        check(metadata() == original, 'Failed migration changed original protection metadata')
        execute(migration)
        execute(audit)
        check(not cur.fetchall(), 'Catalog gate failed after migration')
        hardened = metadata()
        execute(migration)
        check(metadata() == hardened, 'Migration rerun changed ACL/RLS')

        # Actual executor checks as both API roles, in rollback-only transactions.
        # An unexpected successful INSERT can never leave a row behind.
        execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")
        tables = [row[0] for row in cur.fetchall()]
        denied = 0
        for role in ('anon', 'authenticated'):
            for table in tables:
                execute("SELECT attname FROM pg_attribute WHERE attrelid=%s::regclass "
                        "AND attnum>0 AND NOT attisdropped ORDER BY attnum LIMIT 1", (table,))
                column = cur.fetchone()[0]
                identifier = sql.Identifier('public', table)
                commands = [sql.SQL('SELECT * FROM {} LIMIT 1').format(identifier),
                            sql.SQL('INSERT INTO {} DEFAULT VALUES').format(identifier),
                            sql.SQL('UPDATE {} SET {}={} WHERE false').format(
                                identifier, sql.Identifier(column), sql.Identifier(column)),
                            sql.SQL('DELETE FROM {} WHERE false').format(identifier),
                            sql.SQL('TRUNCATE {}').format(identifier)]
                for command in commands:
                    execute('BEGIN')
                    try:
                        execute(sql.SQL('SET LOCAL ROLE {}').format(sql.Identifier(role)))
                        try:
                            execute(command)
                        except psycopg2.errors.InsufficientPrivilege:
                            denied += 1
                        else:
                            raise AssertionError(f'{role} unexpectedly accessed {table}')
                    finally:
                        execute('ROLLBACK')
        print(f'PASS: {denied} SELECT/INSERT/UPDATE/DELETE/TRUNCATE denials over {len(tables)} tables', flush=True)

        # RLS still denies rows if someone accidentally re-grants DML.
        execute('GRANT USAGE ON SCHEMA public TO anon, authenticated')
        execute('GRANT SELECT,INSERT,UPDATE,DELETE ON tma_security_probe TO anon, authenticated')
        execute('GRANT USAGE ON tma_security_probe_id_seq TO anon, authenticated')
        for role in ('anon', 'authenticated'):
            execute(sql.SQL('SET ROLE {}').format(sql.Identifier(role)))
            execute('SELECT * FROM tma_security_probe')
            check(cur.fetchall() == [], 'RLS leaked rows after accidental grant')
            execute("UPDATE tma_security_probe SET value='forged'")
            check(cur.rowcount == 0, 'RLS allowed update')
            execute('DELETE FROM tma_security_probe')
            check(cur.rowcount == 0, 'RLS allowed delete')
            try:
                execute("INSERT INTO tma_security_probe(value) VALUES ('forged')")
            except psycopg2.errors.InsufficientPrivilege:
                pass
            else:
                raise AssertionError('RLS allowed insert')
            execute('RESET ROLE')
        execute('REVOKE ALL ON tma_security_probe, tma_security_probe_id_seq FROM anon, authenticated')
        execute('REVOKE ALL ON SCHEMA public FROM anon, authenticated')

        # Both server paths retain real CRUD. service_role is NOT the owner.
        for role in ('postgres', 'service_role'):
            execute(sql.SQL('SET ROLE {}').format(sql.Identifier(role)))
            execute("INSERT INTO tma_security_probe(value) VALUES ('server') RETURNING id")
            row_id = cur.fetchone()[0]
            execute('SELECT value FROM tma_security_probe WHERE id=%s', (row_id,))
            check(cur.fetchone() == ('server',), 'Server read failed')
            execute("UPDATE tma_security_probe SET value='server updated' WHERE id=%s", (row_id,))
            check(cur.rowcount == 1, 'Server update failed')
            execute('DELETE FROM tma_security_probe WHERE id=%s', (row_id,))
            check(cur.rowcount == 1, 'Server delete failed')
            execute('RESET ROLE')
        print('PASS: RLS defense in depth and postgres/service_role CRUD', flush=True)

        verify_http(models)

        # New tables/sequences/functions stay private by default. Missing RLS
        # is detected even though ACLs already deny public access.
        execute('CREATE TABLE future_table (id serial PRIMARY KEY, value text)')
        execute("CREATE FUNCTION public.future_rpc() RETURNS int LANGUAGE sql AS 'SELECT 1'")
        execute(audit)
        findings = cur.fetchall()
        check(findings == [('rls_disabled', 'future_table', '')], f'Unsafe future defaults: {findings}')
        execute('ALTER TABLE future_table ENABLE ROW LEVEL SECURITY')
        execute('GRANT SELECT(value) ON future_table TO anon')
        execute(audit)
        check(any(row[0] == 'column_privilege' for row in cur.fetchall()), 'Gate missed column grant')
        execute('REVOKE SELECT(value) ON future_table FROM anon')
        execute('CREATE POLICY unsafe ON future_table TO authenticated USING (true)')
        execute(audit)
        check(any(row[0] == 'unexpected_policy' for row in cur.fetchall()), 'Gate missed permissive policy')
        execute('DROP TABLE future_table')
        execute('DROP FUNCTION future_rpc()')
        print('PASS: future tables, sequences, RPC defaults and drift detection', flush=True)

        rollback = (SECURITY / 'rollback_20261020.sql').read_text(encoding='utf-8')
        try:
            execute(rollback)
        except psycopg2.errors.RaiseException:
            execute('ROLLBACK')
        else:
            raise AssertionError('Unsafe rollback ran without opt-in')
        execute(rollback.replace('BEGIN;', "BEGIN; SET LOCAL lerne.allow_unsafe_security_rollback='approved';", 1))
        check(metadata() == original, 'Rollback did not restore original ACL/RLS metadata')
        execute(migration)
        execute(audit)
        check(not cur.fetchall(), 'Reapply after rollback failed')
        print('PASS: guarded exact rollback, reapply and final catalog gate', flush=True)
        containment = (SECURITY / 'incident_containment.sql').read_text(encoding='utf-8')
        models.TMAAuthCode.create(code='123456', user_id=1)
        from api.auth import service
        service.create_challenge('telegram', 'login')
        session_count = models.TMAAuthSession.select().count()
        try:
            execute(containment)
        except psycopg2.errors.RaiseException:
            execute('ROLLBACK')
        else:
            raise AssertionError('Session containment ran without opt-in')
        execute(containment.replace('BEGIN;', "BEGIN; SET LOCAL lerne.approve_session_containment='approved';", 1))
        check(models.TMAAuthSession.select().count() == session_count, 'Containment deleted session evidence')
        check(models.TMAAuthSession.select().where(models.TMAAuthSession.revoked_at.is_null()).count() == 0,
              'Containment left sessions active')
        check(models.TMAAuthCode.select().where(models.TMAAuthCode.is_used == False).count() == 0,
              'Containment left login codes active')
        check(models.TMAAuthChallenge.select().where(models.TMAAuthChallenge.completed_at.is_null()).count() == 0,
              'Containment left challenges active')
        print('PASS: separately guarded incident containment preserves evidence', flush=True)
        execute('SHOW server_version')
        print('PostgreSQL ' + cur.fetchone()[0] + ': security checks passed.', flush=True)
    finally:
        if database is not None and not database.is_closed():
            database.close()
        if conn is not None:
            conn.close()
        with admin.cursor() as cur:
            # Name is generated by this process, never supplied by the caller.
            cur.execute(sql.SQL('DROP DATABASE IF EXISTS {} WITH (FORCE)').format(sql.Identifier(name)))
            for role in reversed(created_roles):
                cur.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(role)))
        admin.close()


def verify_http(models):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import auth_v2, cards, study, sync, collaborative, knowledge
    app = FastAPI()
    for router in (auth_v2.router, cards.router, study.router, sync.router, collaborative.router, knowledge.router):
        app.include_router(router, prefix='/api')
    with TestClient(app) as client, patch.dict(os.environ, BOT_TOKEN='synthetic-local-test-bot'):
        data = {'auth_date': str(int(time.time())),
                'user': json.dumps({'id': 123456789, 'first_name': 'Synthetic'}),
                'query_id': secrets.token_hex(12)}
        signing_key = hmac.new(b'WebAppData', b'synthetic-local-test-bot', hashlib.sha256).digest()
        signed = '\n'.join(f'{k}={v}' for k, v in sorted(data.items()))
        data['hash'] = hmac.new(signing_key, signed.encode(), hashlib.sha256).hexdigest()
        response = client.post('/api/auth/v2/telegram/mini-app', json={'init_data': urlencode(data)})
        check(response.status_code == 200, f'Signed Telegram login failed: {response.status_code}')
        session = response.json()
        headers = {'Authorization': 'Bearer ' + session['access_token']}
        me = client.get('/api/auth/v2/me', headers=headers)
        check(me.status_code == 200, 'Session profile failed')
        account_id = me.json()['user_id']
        deck = models.TMA_Deck.create(user_id=account_id, name='Synthetic')
        response = client.post('/api/cards/save', headers=headers, json={
            'deck_id': deck.id, 'front': 'Haus', 'back': 'дом', 'auto_generate_audio': False})
        check(response.status_code == 200, 'Server card creation failed')
        card_id = response.json()['id']
        response = client.post('/api/study/grade', headers=headers, json={
            'deck_id': deck.id, 'card_id': card_id, 'grade': 2, 'return_next': False})
        check(response.status_code == 200, 'Progress persistence failed')
        check(models.TMAProgress.select().count() == 1, 'Progress missing')
        batch = {'request_id': str(uuid4()), 'cards': [
            {'id': -1, 'deck_id': deck.id, 'front_text': 'offline', 'back_text': 'synthetic'}]}
        first = client.post('/api/sync/v2/push', headers=headers, json=batch)
        retry = client.post('/api/sync/v2/push', headers=headers, json=batch)
        check(first.status_code == retry.status_code == 200 and first.json() == retry.json(),
              'Offline batch retry failed')
        check(models.TMA_Card.select().count() == 2, 'Offline retry duplicated data')
        check(client.get('/api/sync/v2/pull', headers=headers).status_code == 200, 'Sync pull failed')
        check(client.get('/api/collaborative/check-access', headers=headers,
                         params={'type': 'deck', 'id': deck.id}).status_code == 200, 'Sharing owner lookup failed')
        other = client.post('/api/auth/v2/email-password/register', json={
            'email': 'synthetic@example.invalid', 'password': 'synthetic security test password'})
        check(other.status_code == 200, 'Second account login failed')
        other_headers = {'Authorization': 'Bearer ' + other.json()['access_token']}
        other_id = client.get('/api/auth/v2/me', headers=other_headers).json()['user_id']
        # The username lookup also supports negative v2 account IDs.
        models.TMAUser.update(username='security_fixture').where(models.TMAUser.user_id == other_id).execute()
        added = client.post(f'/api/collaborative/deck/{deck.id}/add', headers=headers,
                            json={'user_identifier': '@security_fixture', 'role': 'viewer'})
        check(added.status_code == 200, 'Adding viewer failed')
        payload = {'deck_id': deck.id, 'card_id': card_id, 'front': 'viewer forged', 'auto_generate_audio': False}
        check(client.post('/api/cards/save', headers=other_headers, json=payload).status_code == 403,
              'Viewer can edit')
        changed = client.put(f'/api/collaborative/deck/{deck.id}/role', headers=headers,
                             json={'user_id_to_update': other_id, 'role': 'editor'})
        check(changed.status_code == 200, 'Promoting editor failed')
        payload['front'] = 'editor allowed'
        check(client.post('/api/cards/save', headers=other_headers, json=payload).status_code == 200,
              'Editor cannot edit')
        item = models.TMAKnowledgeItem.create(name='Synthetic knowledge')
        models.TMACardKnowledgeItem.create(card_id=card_id, knowledge_item=item, role='primary')
        attempt = {'attempts': [{'client_event_id': 'security-attempt', 'card_id': card_id,
                   'knowledge_item_id': item.id, 'evaluation_data': {
                       'schema_version': 1, 'evaluation_type': 'self_rating', 'rating': 'good'}}]}
        first_attempt = client.post('/api/knowledge/attempts/sync', headers=headers, json=attempt)
        repeat_attempt = client.post('/api/knowledge/attempts/sync', headers=headers, json=attempt)
        check(first_attempt.status_code == repeat_attempt.status_code == 200, 'Knowledge transport failed')
        check(first_attempt.json()['results'][0]['status'] == 'created' and
              repeat_attempt.json()['results'][0]['status'] == 'duplicate', 'Knowledge idempotency failed')
        check(models.TMAKnowledgeAttempt.select().count() == 1 and
              models.TMAUserKnowledgeState.select().count() == 1, 'Knowledge persistence failed')
        refreshed = client.post('/api/auth/v2/refresh', json={'refresh_token': session['refresh_token']})
        check(refreshed.status_code == 200, 'Refresh failed')
        headers = {'Authorization': 'Bearer ' + refreshed.json()['access_token'], 'X-User-ID': str(account_id)}
        check(client.post('/api/auth/v2/logout', headers=headers, json={}).status_code == 204, 'Logout failed')
        check(client.get('/api/sync/v2/pull', headers=headers).status_code == 401, 'Revoked session accepted')
        check(client.get('/api/sync/v2/pull', headers={'X-User-ID': str(account_id)}).status_code == 401,
              'Header impersonation accepted')
    print('PASS: real HTTP Telegram/session/refresh/logout/cards/progress/viewer/editor/offline/Knowledge on protected PostgreSQL', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--disposable', action='store_true', help='Confirm this is a disposable local cluster')
    parser.add_argument('--port', type=int, default=55439)
    parser.add_argument('--bootstrap-user', default='postgres',
                        help='Local cluster administrator; use a separate bootstrap user to test non-superuser postgres')
    args = parser.parse_args()
    if not args.disposable:
        parser.error('--disposable is required; never point this test at a shared database')
    run(args.port, args.bootstrap_user)
