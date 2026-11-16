"""Ratings gate: synthetic inputs, existing disposable PostgreSQL/socket runner only."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
import subprocess
from unittest.mock import patch


def verify_ratings(client, models, headers, cards, config, root):
    def request(method, path, body=None, user=1, status=200):
        response = client.request(method, path, headers=headers.get(user, {}), json=body)
        assert response.status_code == status, (path, response.status_code, response.text)
        return response.json()

    cid = cards[0]['id']
    path = f'card-ratings/{cid}'
    deck = f"card-ratings/deck/{config['deck']['id']}?include_counts=true"
    request('GET', deck, user=0, status=401)
    for method, route, body in [('GET', deck, None), ('GET', path, None), ('PUT', path, {'rating': 1})]:
        request(method, route, body, user=3, status=403)
    for value in [0, 2, 'bad']:
        request('PUT', path, {'rating': value}, status=422)
    request('PUT', path, {'rating': 1, 'user_id': 2}, status=422)
    request('GET', 'card-ratings/99999999', status=404)
    request('PUT', 'card-ratings/99999999', {'rating': 1}, status=404)
    # Simulate an unprepared schema only inside this disposable cluster.
    binding = models.TMA_Card._meta.database
    db = getattr(binding, 'obj', binding)
    db.execute_sql('ALTER TABLE tma_card_rating RENAME TO rating_fixture_unavailable')
    try:
        request('GET', path, status=503)
        request('GET', deck, status=503)
        request('PUT', path, {'rating': 1}, status=503)
    finally:
        db.execute_sql('ALTER TABLE rating_fixture_unavailable RENAME TO tma_card_rating')
    # Both users race on the same initially absent row. Deletes must not make a
    # competing upsert's response SELECT fail, and unique votes must not multiply.
    actions = [(user, vote) for _ in range(16) for user in (1, 2) for vote in (1, -1, None)]
    def race(action):
        user, vote = action
        row = request('PUT', path, {'rating': vote}, user=user)
        assert row['rating'] == vote
        assert row['likes'] + row['dislikes'] <= 2
        assert 'user_id' not in row and 'id' not in row
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(race, actions))
    assert models.TMACardRating.select().where(models.TMACardRating.card == cid).count() <= 2
    for card in cards:
        route = f"card-ratings/{card['id']}"
        request('PUT', route, {'rating': None})
        request('PUT', route, {'rating': -1, 'reason': 'boring'}, user=2)
    # One aggregate SELECT for all cards; permissions/catalog checks are constant.
    with patch.object(db, 'execute_sql', wraps=db.execute_sql) as execute:
        rows = request('GET', deck)
    assert len(rows) == 10  # Nine types + separate concurrency probe.
    assert sum('GROUP BY' in call.args[0] for call in execute.call_args_list) == 1
    for row in rows:
        assert set(row) == {'card_id', 'likes', 'dislikes', 'rating', 'reason', 'updated_at'}
        assert row['rating'] is None and row['reason'] is None
    print('PASS: real migration 92, 96 concurrent writes, auth/ACL/validation, anonymous batch aggregation', flush=True)
    result = subprocess.run(['node', 'node_modules/@playwright/test/cli.js', 'test',
        'native-card-rating.spec.cjs', '--project=extended', '--workers=1'], cwd=root,
        env={**os.environ, 'LERNE_NATIVE_LEARNING_FIXTURE': json.dumps(config)}, timeout=360)
    if result.returncode:
        return False
    for card in cards:
        records = list(models.TMACardRating.select().where(models.TMACardRating.card == card['id']).dicts())
        assert len(records) == 2
        assert {row['user_id']: row['rating'] for row in records} == {1: 1, 2: -1}
        row = request('GET', f"card-ratings/{card['id']}")
        assert (row['likes'], row['dislikes'], row['rating']) == (1, 1, 1)
    print('PASS: PostgreSQL confirms all nine final personal votes and exact anonymous totals', flush=True)
    return True

