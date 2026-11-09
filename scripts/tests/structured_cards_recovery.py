"""Synthetic browser recovery drill; called only by the disposable PG runner."""
import json
import os
from pathlib import Path
import subprocess
from uuid import uuid4

def verify_recovery(client, port, models, headers, binaries, scratch):
    from api.main import app
    db = models.tma_db.obj
    models.TMAUser.update(native_language='ru', has_selected_language=True).where(models.TMAUser.user_id == 1).execute()
    deck = models.TMA_Deck.create(user_id=1, name='Synthetic recovery fixture', target_language='de')
    content = {'schema_version': 2, 'card': {'type': 'trainer', 'data': {'parts': [
        {'type': 'text', 'text': 'Ich sehe '}, {'type': 'choice', 'distractors': 'auto', 'options': [{'text': 'den', 'correct': True}]},
        {'type': 'text', 'text': ' Hund.'}]}}}
    response = client.post('cards/save', headers=headers[1], json={'deck_id': deck.id, 'request_id': str(uuid4()), 'content_v2': content})
    assert response.status_code == 200, response.text
    pg_env = dict(os.environ, PGHOST='127.0.0.1', PGPORT=str(port), PGUSER='cards_test', PGDATABASE='postgres')
    pg_env['PGPORT'] = str(db.connect_params['port'])
    snapshot = scratch / 'recovery-before.dump'
    def pg(name, *args):
        suffix = '.exe' if os.name == 'nt' else ''
        result = subprocess.run([str(binaries / (name + suffix)), *map(str, args)], env=pg_env, capture_output=True, timeout=90,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode:
            raise AssertionError(f'{name} failed: {result.stderr.decode(errors="replace")}')
    pg('pg_dump', '--format=custom', '--no-owner', '--no-acl', '--file', snapshot)
    @app.post('/api/__test_rollback')
    def rollback_only_disposable_cluster():
        # URL/port are from runner-owned random PostgreSQL, never from configuration.
        assert db.connect_params['user'] == 'cards_test' and (scratch / 'data/postmaster.pid').is_file()
        pg('pg_restore', '--clean', '--if-exists', '--no-owner', '--no-acl', '--single-transaction', '--exit-on-error', '--dbname', 'postgres', snapshot)
        return {'restored': True}
    fixture = {'origin': f'http://127.0.0.1:{port}', 'token': headers[1]['Authorization'].split(' ',1)[1], 'card': response.json(),
               'deck': {'id': deck.id, 'name': deck.name, 'user_id': 1, 'role': 'owner', 'target_language': 'de', 'stats': {'total': 1}}}
    result = subprocess.run(['node', 'node_modules/@playwright/test/cli.js', 'test', 'native-recovery.spec.cjs', '--project=extended', '--workers=1'],
                            cwd=Path(__file__).resolve().parents[2], env={**os.environ, 'LERNE_RECOVERY_FIXTURE': json.dumps(fixture)}, timeout=180)
    if result.returncode:
        return False
    assert models.TMA_Card.select().count() == 1, 'Quarantined client wrote into restored server'
    print('PASS: raw PostgreSQL rollback changes generation, preserves Dexie and rejects further writes', flush=True)
    return True
