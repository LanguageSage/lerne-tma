"""Opt-in real HTTP + native PostgreSQL + Chromium Knowledge contract test.

Creates its own cluster under local/test-data; never reads .env/local.json or
connects to an existing database. No Knowledge-route/auth/scoring/transport mocks;
the Free Text AI verdict is synthetic, Trainer uses its actual checker.
Production startup/lifespan is intentionally not imported: only real routers.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
PG_USER = 'knowledge_test'
PG_DATABASE = 'knowledge_disposable'


def free_port():
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


def loopback_only(event, args):
    if event == 'socket.getaddrinfo':
        host = args[0]
    elif event in ('socket.connect', 'socket.sendto'):
        if not isinstance(args[-1], tuple):
            raise RuntimeError('Only loopback networking is allowed')
        host = args[-1][0]
    else:
        return
    if host not in ('127.0.0.1', 'localhost', '::1'):
        raise RuntimeError('External networking disabled in Knowledge HTTP test')


def database(port, name=PG_DATABASE):
    from peewee import PostgresqlDatabase
    return PostgresqlDatabase(name, user=PG_USER, host='127.0.0.1', port=port,
                              sslmode='disable', connect_timeout=5,
                              options='-c statement_timeout=20000 -c lock_timeout=15000')


def bind_models(db):
    from api.database import tma_db, lerne_db
    tma_db.initialize(db)
    lerne_db.initialize(db)
    from api import models
    return models


def serve(pg_port, http_port):
    """Use genuine routers/dependencies/services, with fresh fixture schema."""
    import uvicorn
    from fastapi import FastAPI
    bind_models(database(pg_port))
    from api.routers import auth_v2, cards, decks, study, sync, knowledge, settings, card_notes
    app = FastAPI(title='Disposable Knowledge HTTP validation')
    for router in (auth_v2.router, cards.router, decks.router, study.router, sync.router,
                   knowledge.router, settings.router, card_notes.router):
        app.include_router(router, prefix='/api')
    uvicorn.run(app, host='127.0.0.1', port=http_port, log_level='warning', access_log=False)


def wait_http(url, process):
    import httpx
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError('HTTP process exited; inspect its log')
        try:
            if httpx.get(url, timeout=1, trust_env=False).status_code == 200:
                return
        except httpx.TransportError:
            pass
        time.sleep(.1)
    raise RuntimeError('HTTP process did not become ready')


def checked(response, status=200):
    if response.status_code != status:
        raise AssertionError(f'HTTP {response.status_code}, expected {status}: {response.text[:600]}')
    return response.json()


def lock_id(user_id, ki):
    return int.from_bytes(hashlib.blake2b(f'{user_id}:{ki}'.encode('ascii'), digest_size=8).digest(), 'big', signed=True)


def run_backend(client, db, models, report):
    def register(label):
        session = checked(client.post('/api/auth/v2/email-password/register', json={
            'email': f'{label}@example.invalid', 'password': 'synthetic knowledge password'}))
        headers = {'Authorization': 'Bearer ' + session['access_token']}
        profile = checked(client.get('/api/auth/v2/me', headers=headers))
        return {'session': session, 'headers': headers, 'profile': profile}

    a, b = register('owner'), register('other')

    def material(account, label):
        deck = checked(client.post('/api/decks', headers=account['headers'], json={'name': label}))['id']
        card = checked(client.post('/api/cards/save', headers=account['headers'], json={
            'deck_id': deck, 'front': f'Synthetic {label}', 'back': 'Synthetic answer',
            'auto_generate_audio': False}))['id']
        return deck, card

    deck_a, card_a = material(a, 'practice-a')
    deck_b, card_b = material(b, 'practice-b')
    ki = models.TMAKnowledgeItem.create(name='Synthetic primary')
    ki2 = models.TMAKnowledgeItem.create(name='Synthetic remapped')
    secondary = models.TMAKnowledgeItem.create(name='Synthetic secondary')
    for card in (card_a, card_b):
        models.TMACardKnowledgeItem.create(card_id=card, knowledge_item=ki.id, role='primary')
    models.TMACardKnowledgeItem.create(card_id=card_a, knowledge_item=secondary.id, role='secondary')
    user_a, user_b = a['profile']['user_id'], b['profile']['user_id']

    def event(event_id, **changes):
        return {**{'client_event_id': event_id, 'card_id': card_a, 'knowledge_item_id': ki.id,
                   'event_time': '2026-10-30T10:00:00.123Z', 'review_id': None,
                   'evaluation_data': {'schema_version': 1, 'evaluation_type': 'self_rating', 'rating': 'good'}}, **changes}

    def send(item, account=a):
        return checked(client.post('/api/knowledge/attempts/sync', headers=account['headers'],
                                   json={'attempts': [item]}))['results'][0]

    def state(count, positive=None):
        data = checked(client.get(f'/api/knowledge/diagnostics/items/{ki.id}', headers=a['headers']))
        stored = data['materialized_state']
        assert data['state_matches_rebuild'] is True, data
        assert stored['evidence_event_count'] == count, stored
        if positive is not None:
            assert math.isclose(stored['positive_evidence'], positive, abs_tol=1e-12), stored
        return data

    content = checked(client.get(f'/api/knowledge/decks/{deck_a}', headers=a['headers']))
    assert card_a in content['card_ids']
    grade = checked(client.post('/api/study/grade', headers=a['headers'], json={
        'card_id': card_a, 'deck_id': deck_a, 'grade': 2, 'return_next': False}))
    assert grade == {'status': 'success'}
    review = models.TMAReviewHistory.get(models.TMAReviewHistory.user_id == user_a)
    first = event('http-grade', review_id=review.id)
    assert send(first)['status'] == 'created'
    before = state(1, .375)
    assert math.isclose(before['materialized_state']['proficiency'], .55, abs_tol=1e-12)
    assert send(first)['status'] == 'duplicate'
    assert state(1)['materialized_state'] == before['materialized_state']
    report['http_grade_attempt_mastery'] = 'PASS'

    # Hold the genuine mastery advisory lock until multiple HTTP workers wait on it.
    concurrent_event = event('http-concurrent')
    with db.atomic():
        db.execute_sql('SELECT pg_advisory_xact_lock(%s)', (lock_id(user_a, ki.id),))
        pool = ThreadPoolExecutor(max_workers=8)
        futures = [pool.submit(send, concurrent_event) for _ in range(8)]
        deadline = time.monotonic() + 8
        waiting = 0
        while time.monotonic() < deadline:
            db.execute_sql('SELECT pg_stat_clear_snapshot()')
            waiting = db.execute_sql("SELECT COUNT(*) FROM pg_stat_activity WHERE datname = %s AND wait_event = 'advisory'",
                                     (PG_DATABASE,)).fetchone()[0]
            if waiting >= 2:
                break
            time.sleep(.05)
        assert waiting >= 2, 'Concurrent overlap was not observed in PostgreSQL'
    statuses = [future.result(timeout=20)['status'] for future in futures]
    pool.shutdown()
    assert statuses.count('created') == 1 and statuses.count('duplicate') == 7, statuses
    assert models.TMAKnowledgeAttempt.select().where(models.TMAKnowledgeAttempt.client_event_id == 'http-concurrent').count() == 1
    state(2, .75)
    conflict = event('http-concurrent', evaluation_data={'schema_version': 1, 'evaluation_type': 'self_rating', 'rating': 'easy'})
    assert send(conflict)['status'] == 'event_conflict'
    state(2, .75)
    report['http_concurrent_duplicate'] = {'status': 'PASS', 'created': 1, 'duplicate': 7, 'observed_waiters': waiting}

    review_b = checked(client.post('/api/study/grade', headers=b['headers'], json={
        'card_id': card_b, 'deck_id': deck_b, 'grade': 2, 'return_next': False}))
    assert review_b['status'] == 'success'
    foreign_review = models.TMAReviewHistory.get(models.TMAReviewHistory.user_id == user_b)
    extra_card = checked(client.post('/api/cards/save', headers=a['headers'], json={
        'deck_id': deck_a, 'front': 'Other review', 'back': 'Synthetic', 'auto_generate_audio': False}))['id']
    checked(client.post('/api/study/grade', headers=a['headers'], json={
        'card_id': extra_card, 'deck_id': deck_a, 'grade': 2, 'return_next': False}))
    other_review = models.TMAReviewHistory.get(models.TMAReviewHistory.card_id == extra_card)
    invalid = [({'card_id': card_b}, 'card_knowledge_not_accessible'),
               ({'card_id': 999999}, 'card_knowledge_not_accessible'),
               ({'card_id': None}, 'card_knowledge_not_accessible'),
               ({'knowledge_item_id': secondary.id}, 'card_knowledge_not_accessible'),
               ({'knowledge_item_id': ki2.id}, 'card_knowledge_not_accessible'),
               ({'knowledge_item_id': 999999}, 'knowledge_item_not_found'),
               ({'review_id': foreign_review.id}, 'review_not_found_or_unauthorized'),
               ({'review_id': other_review.id}, 'review_not_found_or_unauthorized'),
               ({'review_id': 999999}, 'review_not_found_or_unauthorized')]
    for index, (changes, error) in enumerate(invalid):
        result = send(event(f'forged-{index}', **changes))
        assert (result['status'], result['error_code']) == ('rejected', error), result
    checked(client.get(f'/api/knowledge/decks/{deck_a}', headers=b['headers']), 403)
    checked(client.post('/api/knowledge/attempts/sync', json={'attempts': [event('anonymous')]}), 401)
    checked(client.post('/api/knowledge/attempts/sync', headers={'X-User-ID': str(user_a)}, json={'attempts': [event('header-forged')]}), 401)
    assert models.TMAKnowledgeAttempt.select().count() == 2
    state(2, .75)
    report['http_origin_and_auth_rejection'] = {'status': 'PASS', 'invalid_events': len(invalid), 'auth_checks': 3}
    report['postgres_version'] = db.execute_sql('SHOW server_version').fetchone()[0]
    # Fresh browser card: backend probes above have already scheduled their cards in SRS.
    deck_a, card_a = material(a, 'browser-practice-a')
    models.TMACardKnowledgeItem.create(card_id=card_a, knowledge_item=ki.id, role='primary')
    return {'a': a, 'b': b, 'deckA': deck_a, 'deckB': deck_b, 'cardA': card_a, 'cardB': card_b,
            'ki': ki.id, 'ki2': ki2.id, 'lockA': str(lock_id(user_a, ki.id))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bin-dir', type=Path)
    parser.add_argument('--d14-support', action='store_true', help='Opt-in local D14 snapshot clones in the disposable cluster')
    parser.add_argument('--serve', nargs=2, type=int, metavar=('PG_PORT', 'HTTP_PORT'))
    args = parser.parse_args()
    # Clean environment before API imports; neither .env nor existing LOCAL config participates.
    clean = {k: v for k, v in os.environ.items() if k.upper() in {'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'}}
    clean.update(PYTHON_DOTENV_DISABLED='1', LERNE_SKIP_SCHEMA_INIT='1', RUN_MIGRATIONS='false',
                 PGCLIENTENCODING='UTF8', PGCONNECT_TIMEOUT='5', PYTHONIOENCODING='utf-8')
    os.environ.clear()
    os.environ.update(clean)
    sys.path.insert(0, str(ROOT))
    sys.addaudithook(loopback_only)
    if args.serve:
        serve(*args.serve)
        return 0
    if not args.bin_dir:
        parser.error('--bin-dir is required; no existing PostgreSQL server is used')
    binaries = args.bin_dir.resolve()
    suffix = '.exe' if os.name == 'nt' else ''
    for name in ('initdb', 'pg_ctl', 'psql'):
        if not (binaries / (name + suffix)).is_file():
            parser.error('Missing PostgreSQL binary: ' + name)
    run_root = ROOT / 'local/test-data/knowledge-postgres' / uuid4().hex
    run_root.mkdir(parents=True)
    pgdata = run_root / 'pgdata'
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    pg_port, http_port, web_port = free_port(), free_port(), free_port()
    report = {'critical_mocks': False, 'production_access': False, 'results': {}}
    processes, streams = [], []
    started = False
    db = None

    def pg(name, *arguments):
        with (run_root / f'{name}.log').open('ab') as output:
            result = subprocess.run([str(binaries / (name + suffix)), *map(str, arguments)],
                                    env=clean, stdout=output, stderr=output, timeout=90, creationflags=flags)
        if result.returncode:
            raise RuntimeError(f'{name} failed; inspect {run_root / (name + ".log")}')

    def start(command, log, environment=clean):
        stream = (run_root / log).open('wb')
        streams.append(stream)
        process = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=stream, stderr=stream, creationflags=flags)
        processes.append(process)
        return process

    try:
        pg('initdb', '-D', pgdata, '-U', PG_USER, '-A', 'trust', '--no-locale', '-E', 'UTF8')
        sockets = '' if os.name == 'nt' else f' -k "{run_root}"'
        pg('pg_ctl', '-D', pgdata, '-l', run_root / 'postgres.log', '-o',
           f'-h 127.0.0.1 -p {pg_port} -c max_connections=80{sockets}', '-w', 'start')
        started = True
        admin = database(pg_port, 'postgres')
        admin.execute_sql('CREATE DATABASE knowledge_disposable')
        admin.close()
        db = database(pg_port)
        models = bind_models(db)
        from peewee import Model
        tables = [value for value in vars(models).values() if isinstance(value, type)
                  and issubclass(value, Model) and value not in (Model, models.BaseModel)
                  and value._meta.database in (models.tma_db, models.lerne_db)]
        db.create_tables(tables)
        db.execute_sql("CREATE UNIQUE INDEX idx_tma_card_ki_primary ON tma_card_knowledge_item(card_id) WHERE role = 'primary'")
        server = start([sys.executable, __file__, '--serve', str(pg_port), str(http_port)], 'api.log')
        target = f'http://127.0.0.1:{http_port}'
        wait_http(target + '/openapi.json', server)
        import httpx
        with httpx.Client(base_url=target, timeout=25, trust_env=False) as client:
            fixture = run_backend(client, db, models, report['results'])
        if args.d14_support:
            snapshot = json.loads((ROOT / 'local/test-data/lesson-qa/corrected.snapshot.json').read_text(encoding='utf-8'))
            source_ids = (358365, 358375, 358385)
            sources = [next(card for card in snapshot['cards'] if card['id'] == source_id) for source_id in source_ids]
            # Protocol fixtures only: never assign production numeric KI IDs or edit source mappings.
            deck = models.TMA_Deck.create(user_id=fixture['a']['profile']['user_id'], name='Disposable D14 support subset')
            fixture['d14Support'] = []
            for source in sources:
                card = models.TMA_Card.create(deck=deck, front_text=source['front_text'], back_text=source['back_text'],
                                               metadata=source.get('metadata'))
                models.TMACardKnowledgeItem.create(card_id=card.id, knowledge_item_id=fixture['ki'], role='primary')
                fixture['d14Support'].append({'sourceId': source['id'], 'id': card.id, 'deck_id': deck.id,
                    'front': card.front_text, 'back': card.back_text, 'metadata': json.loads(card.metadata or '{}')})
        manifest = run_root / 'fixture.json'
        fixture.update(api=target, web=f'http://127.0.0.1:{web_port}', pgPort=pg_port,
                       pgUser=PG_USER, pgDatabase=PG_DATABASE, psql=str(binaries / ('psql' + suffix)),
                       output=str(run_root / 'browser-results.json'))
        manifest.write_text(json.dumps(fixture), encoding='utf-8')
        vite_env = {**clean, 'LERNE_ISOLATED_CHECKS': '1', 'KNOWLEDGE_HTTP_TARGET': target}
        vite = start(['node', 'app/node_modules/vite/bin/vite.js', '--config', 'scripts/tests/knowledge_http_vite.config.mjs',
                      '--host', '127.0.0.1', '--port', str(web_port), '--strictPort'], 'vite.log', vite_env)
        wait_http(fixture['web'] + '/knowledge-harness.html', vite)
        browser = start(['node', 'scripts/tests/knowledge_http_browser.cjs', str(manifest)], 'browser.log')
        code = browser.wait(timeout=150)
        if (run_root / 'browser-results.json').is_file():
            report['results'].update(json.loads((run_root / 'browser-results.json').read_text(encoding='utf-8')))
        if code:
            raise AssertionError('Real HTTP browser checks failed; inspect browser.log')
        report['status'] = 'PASS'
        print(json.dumps(report, indent=2), flush=True)
        return 0
    except Exception as error:
        report.update(status='FAIL', error=str(error))
        print(f'FAIL: {error}', flush=True)
        return 1
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        for stream in streams:
            stream.close()
        if db and not db.is_closed():
            db.close()
        if started:
            pg('pg_ctl', '-D', pgdata, '-m', 'fast', '-w', '-t', '60', 'stop')
        if pgdata.exists():
            # Delete only the newly generated cluster, never a configured/user path.
            assert pgdata.resolve().parent == run_root.resolve() and pgdata.name == 'pgdata'
            assert run_root.parent.resolve() == (ROOT / 'local/test-data/knowledge-postgres').resolve()
            shutil.rmtree(pgdata)
        (run_root / 'fixture.json').unlink(missing_ok=True)  # Synthetic session tokens need not persist.
        report['cluster_stopped_and_removed'] = True
        (run_root / 'results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print('Evidence: ' + str(run_root), flush=True)


if __name__ == '__main__':
    raise SystemExit(main())
