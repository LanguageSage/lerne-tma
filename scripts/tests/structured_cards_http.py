"""Socket HTTP tests against the real authenticated routes on disposable PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import socket
import subprocess
from threading import Thread
import time
import unittest
from uuid import uuid4
from unittest.mock import patch

import httpx
import uvicorn


def verify(db, *, offline_create_browser=False, offline_edit_browser=False,
           offline_delivery_browser=False, offline_isolation_browser=False, offline_move_browser=False,
           offline_lifecycle_browser=False):
    from api import models
    from api.auth.service import _create_session, utcnow
    from api.migrations import run_library_cards_v2_migration, run_structured_cards_v2_migration
    from api.main import app
    from api.services.answer_evaluation import load_answer_context

    models.tma_db.initialize(db)
    models.lerne_db.initialize(db)
    db.create_tables([
        models.TMA_Folder, models.TMA_Deck, models.TMA_Card, models.TMA_Collaborator,
        models.TMAUser, models.TMAProgress, models.TMAReviewHistory, models.TMAOfflineBatch,
        models.TMASetting, models.TMAMedia, models.TMACardNote, models.TMAKnowledgeItem,
        models.TMACardKnowledgeItem, models.TMAKnowledgeAttempt, models.TMACardRating,
        models.LibraryCategory, models.Deck, models.Card,
        *models.AUTH_FOUNDATION_MODELS,
    ])
    run_structured_cards_v2_migration(db)
    db.execute_sql('ALTER TABLE card DROP COLUMN content_v2, ALTER COLUMN front_text SET NOT NULL, '
                   'ALTER COLUMN back_text SET NOT NULL, ALTER COLUMN card_type SET NOT NULL')
    legacy_library = models.Deck.create(name='Old library fixture')
    db.execute_sql('INSERT INTO card (deck_id, front_text, back_text, card_type, created_at, is_deleted, history, position, flag) '
                   "VALUES (%s, 'old prompt', 'old answer', 'standard', now(), false, '[]', 7, 0)", (legacy_library.id,))
    assert run_library_cards_v2_migration(db) == {'applied': True, 'migration_id': 94}
    assert run_library_cards_v2_migration(db) == {'applied': False, 'migration_id': 94}
    assert models.Card.select().where(models.Card.deck == legacy_library.id).get().front_text == 'old prompt'
    headers = {}
    for user_id in (1, 2, 3):
        models.TMAUser.create(user_id=user_id, is_guest=(user_id == 3), default_decks_initialized=True)
        account = models.TMAAuthAccount.create(user=user_id)
        tokens = _create_session(account, utcnow())
        headers[user_id] = {'Authorization': f'Bearer {tokens.access_token}'}

    server = uvicorn.Server(uvicorn.Config(app, log_level='error', lifespan='off', access_log=False))
    listener = socket.socket()
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
    thread = Thread(target=server.run, kwargs={'sockets': [listener]}, daemon=True)
    thread.start()
    try:
        for _ in range(100):
            if server.started or not thread.is_alive():
                break
            time.sleep(0.05)
        if not server.started:
            raise RuntimeError('HTTP test server failed to start')
        with httpx.Client(base_url=f'http://127.0.0.1:{port}/api/', trust_env=False) as client:
            if offline_create_browser:
                if not _run_offline_create_browser(port, models, headers[1]):
                    return False
                if not _run_all_types_create_browser(port, models, headers[2]):
                    return False
            if offline_edit_browser:
                if not _run_offline_edit_browser(client, port, models, headers):
                    return False
                if not _run_all_types_edit_browser(client, port, models, headers):
                    return False
            if offline_delivery_browser and not _run_offline_edit_browser(client, port, models, headers, delivery=True):
                return False
            if offline_isolation_browser and not _run_offline_isolation_browser(port, models):
                return False
            if offline_move_browser and not _run_offline_move_browser(client, port, models, headers):
                return False
            if offline_lifecycle_browser and not _run_offline_lifecycle_browser(client, port, models, headers):
                return False
            if (offline_create_browser or offline_edit_browser or offline_delivery_browser
                    or offline_isolation_browser or offline_move_browser or offline_lifecycle_browser):
                return True
            return _run_cases(client, models, headers, load_answer_context)
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        listener.close()
        if thread.is_alive():
            raise RuntimeError('HTTP test server failed to stop')


def _run_offline_create_browser(port, models, authorization):
    deck = models.TMA_Deck.create(user_id=1, name='Offline Standard fixture', target_language='de')
    legacy = models.TMA_Card.create(deck=deck, front_text='Preserve legacy prompt', back_text='Legacy answer')
    before = models.TMA_Card.select().where(models.TMA_Card.id == legacy.id).dicts().get()
    config = {'origin': f'http://127.0.0.1:{port}', 'deck_id': deck.id, 'legacy_id': legacy.id,
              'access_token': authorization['Authorization'].split(' ', 1)[1]}
    if not _run_offline_browser(config, 'persists Standard offline'):
        return False
    assert models.TMA_Card.select().where(models.TMA_Card.id == legacy.id).dicts().get() == before
    native = models.TMA_Card.select().where(models.TMA_Card.deck == deck,
                                           models.TMA_Card.content_v2.is_null(False)).get()
    assert models.TMA_Card.select().where(models.TMA_Card.deck == deck).count() == 2
    assert native.front_text is None and native.back_text is None
    receipt = models.TMAOfflineBatch.get(models.TMAOfflineBatch.key.startswith('cards-v2:save:1:'))
    assert json.loads(receipt.response)['id'] == native.id
    return True


def _native_examples():
    from api.services.structured_cards_v2 import validate_card

    fixture_dir = Path(__file__).resolve().parents[2] / 'tests/fixtures/structured_cards_v2'
    examples = {}
    for file in ('basics.json', 'puzzle_quiz.json', 'match.json', 'word_bank_free_text.json'):
        for card in json.loads((fixture_dir / file).read_text(encoding='utf-8'))['cards']:
            examples[card['type']] = card
    # Author Theory in the real form. The remaining fixtures exercise fields
    # such as nested metadata and ordered answer arrays through the app API.
    examples['theory'] = {'type': 'theory', 'data': {'text': 'Österreichische Regel', 'summary': 'Сводка'},
                          'explanation': 'Eine Erklärung'}
    examples['editable_text'] = {'type': 'editable_text', 'id': 'editable-synthetic',
        'data': {'source_text': 'Ich gehen.', 'correct_text': 'Ich gehe.',
                 'accepted_answers': ['Ich gehe!', 'Ich gehe jetzt.']},
        'info': [{'type': 'task', 'text': 'Korrigieren Sie den Satz.'}],
        'explanation': 'Verb conjugation', 'metadata': {'nested': [True, {'ranks': [3, 1, 2]}, None]}}
    return {kind: {'schema_version': 2, 'card': validate_card(card).model_dump(mode='json')}
            for kind, card in examples.items()}


def _run_all_types_create_browser(port, models, authorization):
    contents = _native_examples()
    deck = models.TMA_Deck.create(user_id=2, name='Offline V2 fixture', target_language='de')
    config = {'origin': f'http://127.0.0.1:{port}', 'deck_id': deck.id, 'user_id': 2,
              'deck_name': deck.name, 'contents': contents,
              'access_token': authorization['Authorization'].split(' ', 1)[1]}
    if not _run_offline_browser(config, 'creates all nine V2 types offline'):
        return False
    rows = list(models.TMA_Card.select().where(models.TMA_Card.deck == deck))
    assert len(rows) == 9
    assert {row.content_v2['card']['type']: row.content_v2 for row in rows} == contents
    assert all(row.front_text is None and row.back_text is None for row in rows)
    receipts = list(models.TMAOfflineBatch.select().where(models.TMAOfflineBatch.key.startswith('cards-v2:save:2:')))
    assert len(receipts) == 9
    assert {json.loads(receipt.response)['id'] for receipt in receipts} == {row.id for row in rows}
    return True


def _run_all_types_edit_browser(client, port, models, headers):
    deck = models.TMA_Deck.create(user_id=2, name='Offline V2 edit fixture', target_language='de')
    models.TMA_Collaborator.create(target_type='deck', target_id=deck.id, user_id=1, role='editor')
    examples = _native_examples()
    cards = {}
    for kind, content in examples.items():
        response = client.post('cards/save', headers=headers[2], json={
            'request_id': str(uuid4()), 'deck_id': deck.id, 'content_v2': content,
            'image_path': 'images/synthetic.webp',
        })
        response.raise_for_status()
        cards[kind] = response.json()

    config = {'origin': f'http://127.0.0.1:{port}', 'deck_id': deck.id, 'deck_name': deck.name,
              'edit_cards': cards, 'access_token': headers[1]['Authorization'].split(' ', 1)[1],
              'owner_token': headers[2]['Authorization'].split(' ', 1)[1]}
    if not _run_offline_browser(config, 'edits all nine V2 types'):
        return False
    rows = list(models.TMA_Card.select().where(models.TMA_Card.deck == deck))
    assert len(rows) == 9
    for row in rows:
        kind = row.content_v2['card']['type']
        expected = examples[kind]
        expected['card']['explanation'] = {
            'quiz': 'Lokaler Entwurf quiz', 'word_bank': 'Серверная версия word_bank',
        }.get(kind, f'Änderung {kind}\nКонтекст [[literal]]')
        if kind == 'quiz':
            expected['card']['data']['prompt'] = 'Korrigierte Quizfrage?'
        assert row.content_v2 == expected
        assert (row.id, row.position, row.image_path) == tuple(cards[kind][field]
                                                              for field in ('id', 'position', 'image_path'))
        assert row.front_text is None and row.back_text is None
    return True


def _run_offline_edit_browser(client, port, models, headers, *, delivery=False):
    deck = models.TMA_Deck.create(user_id=2, name='Offline Standard fixture', target_language='de')
    models.TMA_Collaborator.create(target_type='deck', target_id=deck.id, user_id=1, role='editor')
    content = {'schema_version': 2, 'card': {'type': 'standard', 'id': 'authored-id',
               'data': {'prompt': 'Original Standard prompt', 'answer': 'Original answer'},
               'info': [{'type': 'example', 'text': 'Authored example'}], 'metadata': {'fixture': ['ä', 'я']}}}
    response = client.post('cards/save', headers=headers[2], json={
        'request_id': str(uuid4()), 'deck_id': deck.id, 'content_v2': content,
        'image_path': 'images/synthetic.webp',
    })
    response.raise_for_status()
    card = response.json()
    models.TMAProgress.create(card_id=card['id'], user_id=1, flag=2, repetitions=3)
    config = {'origin': f'http://127.0.0.1:{port}', 'deck_id': deck.id, 'card': card,
              'access_token': headers[1]['Authorization'].split(' ', 1)[1],
              'owner_token': headers[2]['Authorization'].split(' ', 1)[1]}
    if delivery:
        second = client.post('cards/save', headers=headers[2], json={
            'request_id': str(uuid4()), 'deck_id': deck.id, 'content_v2': content,
        })
        second.raise_for_status()
        config['second_card'] = second.json()
        edits = models.TMAOfflineBatch.select().where(models.TMAOfflineBatch.key.startswith('cards-v2:update:1:'))
        before = edits.count()
        if not _run_offline_browser(config, 'survives interrupted Standard delivery'):
            return False
        # A, B, the independent edit, the concurrent server edit, and the edit after remap.
        assert edits.count() == before + 5
        assert models.TMA_Card.select().where(models.TMA_Card.deck == deck).count() == 4
        return True
    if not _run_offline_browser(config, 'resolves Standard revisions'):
        return False
    saved = client.get(f"cards/{card['id']}", headers=headers[2])
    saved.raise_for_status()
    final = saved.json()
    assert final['content_v2']['card']['data']['prompt'] == 'Manually merged Standard prompt'
    assert final['content_v2']['card']['metadata'] == content['card']['metadata']
    assert final['content_v2']['card']['id'] == content['card']['id']
    assert final['deck_id'] == deck.id and final['image_path'] == card['image_path']
    progress = models.TMAProgress.get(models.TMAProgress.card_id == card['id'], models.TMAProgress.user_id == 1)
    assert progress.flag == 2 and progress.repetitions == 3
    assert models.TMA_Card.select().where(models.TMA_Card.deck == deck).count() == 1
    return True


def _run_offline_isolation_browser(port, models):
    from api.auth.service import _create_session, utcnow

    def session(user_id):
        tokens = _create_session(models.TMAAuthAccount.get(user=user_id), utcnow())
        return {'account_id': user_id, 'access_token': tokens.access_token, 'refresh_token': tokens.refresh_token}

    first = models.TMA_Deck.create(user_id=1, name='Offline Standard fixture', target_language='de')
    second = models.TMA_Deck.create(user_id=2, name='Private B fixture', target_language='de')
    initial = session(1)
    config = {'origin': f'http://127.0.0.1:{port}', 'deck_id': first.id, 'isolation': True,
              'access_token': initial['access_token'], 'initial_session': initial, 'second_session': session(2),
              'new_session': session(1),
              'private_deck': {'id': second.id, 'name': second.name, 'user_id': 2,
                               'target_language': 'de', 'role': 'owner', 'stats': {'total': 0}}}
    receipts = models.TMAOfflineBatch.select().where(models.TMAOfflineBatch.key.startswith('cards-v2:save:'))
    before = receipts.count()
    if not _run_offline_browser(config, 'isolates Standard queues'):
        return False
    assert models.TMA_Card.select().where(models.TMA_Card.deck == first.id).count() == 3
    assert models.TMA_Card.select().where(models.TMA_Card.deck == second.id).count() == 1
    assert receipts.count() == before + 4
    return True


def _run_offline_move_browser(client, port, models, headers):
    authorization = headers[1]
    source = models.TMA_Deck.create(user_id=1, name='Ausgangsstapel für synthetische Übungen', target_language='de')
    target = models.TMA_Deck.create(user_id=1, name='Zielstapel mit längerer deutscher Bezeichnung', target_language='de')
    denied = models.TMA_Deck.create(user_id=2, name='Lesestapel', target_language='de')
    models.TMA_Collaborator.create(target_type='deck', target_id=denied.id, user_id=1, role='editor')

    def deck_view(deck, role):
        return {'id': deck.id, 'name': deck.name, 'user_id': deck.user_id, 'folder_id': deck.folder_id,
                'target_language': 'de', 'role': role, 'stats': {'total': 0}}

    cards = []
    knowledge = models.TMAKnowledgeItem.create(name='Synthetic move concept')
    for title in ('Online', 'Offline', 'Denied', 'Conflict'):
        response = client.post('cards/save', headers=authorization, json={
            'request_id': str(uuid4()), 'deck_id': source.id, 'image_path': 'images/synthetic-move.webp',
            'video_back_path': 'videos/synthetic-move.webm',
            'content_v2': {'schema_version': 2, 'card': {'type': 'quiz', 'id': f'move-{title}',
                'data': {'prompt': f'{title} fixture — Österreichische Grüße', 'options': [
                    {'text': 'Ja', 'correct': True}, {'text': 'Nein'}]},
                'info': [{'type': 'example', 'text': 'Beispiel'}], 'metadata': {'nested': ['ä', 'я']}}},
        })
        response.raise_for_status()
        card = response.json()
        card_id = card['id']
        models.TMA_Card.update(history='["fixture"]', share_id=f'move-{card_id}', image_data=b'synthetic',
                               audio_path='audio/synthetic-move.ogg').where(
            models.TMA_Card.id == card_id).execute()
        models.TMAProgress.create(card_id=card_id, user_id=1, repetitions=3, flag=2)
        review = models.TMAReviewHistory.create(card_id=card_id, user_id=1, rating=2)
        models.TMACardNote.create(id=str(uuid4()), card=card_id, user_id=1, text='Synthetic note')
        models.TMACardRating.create(card=card_id, user_id=1, rating=1)
        models.TMACardKnowledgeItem.create(card_id=card_id, knowledge_item=knowledge)
        models.TMAKnowledgeAttempt.create(card_id=card_id, user_id=1, knowledge_item=knowledge,
                                          client_event_id=str(uuid4()), review_id=review.id)
        current = client.get(f'cards/{card_id}', headers=authorization)
        current.raise_for_status()
        cards.append(current.json())

    before = {card['id']: _card_state(models, card['id']) for card in cards}
    count = models.TMA_Card.select().count()
    receipts = models.TMAOfflineBatch.select().where(models.TMAOfflineBatch.key.startswith('cards-v2:move:1:'))
    receipt_count = receipts.count()
    config = {'origin': f'http://127.0.0.1:{port}', 'deck_id': source.id,
              'access_token': authorization['Authorization'].split(' ', 1)[1],
              'owner_token': headers[2]['Authorization'].split(' ', 1)[1],
              'move': {'source': deck_view(source, 'owner'), 'target': deck_view(target, 'owner'),
                       'denied': deck_view(denied, 'editor'), 'cards': cards}}
    if not _run_offline_browser(config, 'moves V2 cards across decks'):
        return False
    assert models.TMA_Card.select().count() == count
    assert receipts.count() == receipt_count + 2
    for index, card in enumerate(cards):
        old = before[card['id']]
        new = _card_state(models, card['id'])
        row = new['card'][0]
        assert row['deck'] == (target.id if index < 2 else source.id)
        assert row['content_v2'] == old['card'][0]['content_v2']
        if index < 2:
            for field in ('deck', 'position', 'updated_at'):
                row[field] = old['card'][0][field]
        if index == 3:  # The peer edited this card to advance its revision.
            for field in ('history', 'updated_at'):
                row[field] = old['card'][0][field]
        assert new == old
    return True


def _card_state(models, card_id):
    def rows(model, condition):
        return list(model.select().where(condition).order_by(model.id).dicts())

    return {
        'card': rows(models.TMA_Card, models.TMA_Card.id == card_id),
        'progress': rows(models.TMAProgress, models.TMAProgress.card_id == card_id),
        'reviews': rows(models.TMAReviewHistory, models.TMAReviewHistory.card_id == card_id),
        'notes': rows(models.TMACardNote, models.TMACardNote.card == card_id),
        'ratings': rows(models.TMACardRating, models.TMACardRating.card == card_id),
        'knowledge': rows(models.TMACardKnowledgeItem, models.TMACardKnowledgeItem.card_id == card_id),
        'attempts': rows(models.TMAKnowledgeAttempt, models.TMAKnowledgeAttempt.card_id == card_id),
    }


def _run_offline_lifecycle_browser(client, port, models, headers):
    authorization = headers[1]
    deck = models.TMA_Deck.create(user_id=1, name='Papierkorb für synthetische Karten', target_language='de')
    models.TMA_Collaborator.create(target_type='deck', target_id=deck.id, user_id=2, role='editor')
    cards = []
    for prompt in ('Lange österreichische Überschrift für den Papierkorb', 'Synthetische Konfliktkarte'):
        response = client.post('cards/save', headers=authorization, json={
            'request_id': str(uuid4()), 'deck_id': deck.id, 'image_path': 'images/synthetic-trash.webp',
            'content_v2': {'schema_version': 2, 'card': {'type': 'standard',
                'data': {'prompt': prompt, 'answer': 'Синтетический ответ'}, 'metadata': {'values': ['ä', 'я']}}},
        })
        response.raise_for_status()
        cards.append(response.json())
    card_id = cards[0]['id']
    models.TMA_Card.update(history='["fixture"]', share_id='lifecycle-fixture', image_data=b'synthetic').where(
        models.TMA_Card.id == card_id).execute()
    models.TMAProgress.create(card_id=card_id, user_id=1, repetitions=3, flag=2)
    review = models.TMAReviewHistory.create(card_id=card_id, user_id=1, rating=2)
    models.TMACardNote.create(id=str(uuid4()), card=card_id, user_id=1, text='Synthetic note')
    models.TMACardRating.create(card=card_id, user_id=1, rating=1)
    knowledge = models.TMAKnowledgeItem.create(name='Synthetic lifecycle concept')
    models.TMACardKnowledgeItem.create(card_id=card_id, knowledge_item=knowledge)
    models.TMAKnowledgeAttempt.create(card_id=card_id, user_id=1, knowledge_item=knowledge,
                                      client_event_id=str(uuid4()), review_id=review.id)
    before = _card_state(models, card_id)
    config = {'origin': f'http://127.0.0.1:{port}', 'deck_id': deck.id, 'deck_name': deck.name,
              'access_token': authorization['Authorization'].split(' ', 1)[1],
              'editor_token': headers[2]['Authorization'].split(' ', 1)[1], 'lifecycle': cards}
    if not _run_offline_browser(config, 'deletes and restores V2'):
        return False
    after = _card_state(models, card_id)
    assert after['card'][0]['updated_at'] != before['card'][0]['updated_at']
    after['card'][0]['updated_at'] = before['card'][0]['updated_at']
    assert after == before
    assert models.TMA_Card.select().where(models.TMA_Card.deck == deck.id).count() == 2
    for action in ('batch-delete', 'restore'):
        assert models.TMAOfflineBatch.select().where(
            models.TMAOfflineBatch.key.startswith(f'cards-v2:{action}:1:')).count() == 2
    return True


def _run_offline_browser(config, scenario):
    root = Path(__file__).resolve().parents[2]
    env = {**os.environ, 'LERNE_OFFLINE_CREATE_FIXTURE': json.dumps(config)}
    result = subprocess.run(['node', 'node_modules/@playwright/test/cli.js', 'test',
                             'native-offline-create.spec.cjs', '--grep', scenario, '--project=extended', '--workers=1'],
                            cwd=root, env=env, timeout=210)
    return result.returncode == 0


def _run_cases(client, models, headers, load_answer_context):
    def envelope(text='V2 [[literal]] @match'):
        return {'schema_version': 2, 'card': {'type': 'quiz', 'data': {
            'prompt': text, 'options': [{'text': 'Ja', 'correct': True}, {'text': 'Doch', 'correct': True}]}}}

    class CardHTTP(unittest.TestCase):
        def setUp(self):
            self.source = models.TMA_Deck.create(user_id=1, name='Synthetic source')
            self.target = models.TMA_Deck.create(user_id=1, name='Synthetic target')
            self.other = models.TMA_Deck.create(user_id=2, name='Synthetic private')
            self.legacy = models.TMA_Card.create(deck=self.source, front_text='Legacy', back_text='Answer', position=1)

        def call(self, method, path, status=200, *, user=1, body=None, extra=None):
            response = client.request(method, path, json=body,
                headers={**headers.get(user, {}), **(extra or {})})
            self.assertEqual(response.status_code, status, response.text)
            return response.json()

        def create(self, *, deck=None, value=None, user=1, status=200, **fields):
            return self.call('POST', 'cards/save', status, user=user, body={
                'request_id': str(uuid4()), 'deck_id': deck or self.source.id,
                'content_v2': value or envelope(), **fields,
            })

        def test_native_pull_is_opt_in_and_account_scoped(self):
            payload = {'request_id': str(uuid4()), 'deck_id': self.source.id, 'content_v2': {
                'schema_version': 2, 'card': {'type': 'standard',
                'data': {'prompt': 'Native prompt', 'answer': 'Native answer'}}}}
            with ThreadPoolExecutor(2) as pool:
                created, replay = list(pool.map(
                    lambda _: self.call('POST', 'cards/save', body=payload), range(2)))
            self.assertEqual(created, replay)
            self.assertEqual(models.TMA_Card.select().where(models.TMA_Card.deck == self.source).count(), 2)
            self.call('GET', 'sync/v2/pull', 409)
            pulled = self.call('GET', 'sync/v2/pull?card_schema=2')
            self.assertEqual(pulled['card_schema'], 2)
            card = next(item for item in pulled['cards'] if item['id'] == created['id'])
            self.assertEqual(card['content_v2'], created['content_v2'])
            self.assertEqual(card['revision'], created['revision'])
            self.assertNotIn('front_text', card)
            self.assertNotIn(self.legacy.id, [item['id'] for item in pulled['cards']])
            other = self.call('GET', 'sync/v2/pull?card_schema=2', user=2)
            self.assertNotIn(created['id'], [item['id'] for item in other['cards']])

        def test_create_read_edit_retry_and_concurrent_stale_updates(self):
            self.call('POST', 'cards/save', 401, user=None, body={})
            self.create(user=2, status=403)
            self.create(user=3, status=403)
            self.call('POST', 'cards/save', 422, body={'deck_id': self.source.id, 'front': 'old'})
            payload = {'request_id': str(uuid4()), 'deck_id': self.source.id, 'content_v2': envelope()}
            created = self.call('POST', 'cards/save', body=payload)
            self.assertEqual(self.call('POST', 'cards/save', body=payload), created)
            self.call('POST', 'cards/save', 409, body={**payload, 'content_v2': envelope('changed')})
            card_id = created['id']
            row = models.TMA_Card.get_by_id(card_id)
            self.assertIsNone(row.front_text)
            self.assertIsNone(row.back_text)
            self.assertEqual(created['position'], 2)
            self.assertNotIn('front', created)
            self.assertNotIn('card_type', created)
            self.assertEqual(self.call('GET', f'cards/{card_id}')['content_v2'], created['content_v2'])
            self.call('GET', f'cards/{card_id}', 403, user=2)
            self.call('GET', f'cards/{self.legacy.id}', 409)
            self.call('PATCH', f'cards/{self.legacy.id}', 409, body={
                'request_id': str(uuid4()), 'revision': created['revision'], 'content_v2': envelope()})
            self.assertEqual(models.TMA_Card.get_by_id(self.legacy.id).front_text, 'Legacy')
            bodies = [{'request_id': str(uuid4()), 'revision': created['revision'], 'content_v2': envelope(prompt)}
                      for prompt in ('editor A', 'editor B')]
            def update(body):
                return client.patch(f'cards/{card_id}', json=body, headers=headers[1])
            with ThreadPoolExecutor(2) as pool:
                results = list(pool.map(update, bodies))
            self.assertEqual(sorted(result.status_code for result in results), [200, 409])
            success = next(i for i, result in enumerate(results) if result.status_code == 200)
            self.assertEqual(update(bodies[success]).json(), results[success].json())
            self.assertEqual(self.call('GET', f'cards/{card_id}')['revision'], results[success].json()['revision'])

        def test_batch_is_atomic_and_replays_after_success(self):
            before = models.TMA_Card.select().count()
            identifier = str(uuid4())
            cards = [{'deck_id': self.source.id, 'content_v2': envelope('first')},
                     {'deck_id': self.source.id, 'content_v2': envelope('second\x00')}]
            self.call('POST', 'cards/bulk-save', 422, body={'import_id': identifier, 'cards': cards})
            self.assertEqual(models.TMA_Card.select().count(), before)
            self.assertFalse(models.TMAOfflineBatch.select().where(
                models.TMAOfflineBatch.key == f'cards-v2:bulk-save:1:{identifier}').exists())
            cards[1]['content_v2'] = envelope('second')
            cards[1]['deck_id'] = self.other.id
            self.call('POST', 'cards/bulk-save', 403, body={'import_id': identifier, 'cards': cards})
            self.assertEqual(models.TMA_Card.select().count(), before)
            cards[1]['deck_id'] = self.source.id
            payload = {'import_id': identifier, 'placement': 'start', 'cards': cards}
            result = self.call('POST', 'cards/bulk-save', body=payload)
            self.assertEqual(self.call('POST', 'cards/bulk-save', body=payload), result)
            self.assertEqual([c['position'] for c in result['cards']], [-1, 0])
            self.assertEqual(models.TMA_Card.select().count(), before + 2)
            first, second = result['cards']
            change = {'import_id': str(uuid4()), 'cards': [
                {'card_id': first['id'], 'revision': first['revision'], 'content_v2': envelope('updated first')},
                {'card_id': second['id'], 'revision': first['revision'], 'content_v2': envelope('updated second')},
            ]}
            self.call('POST', 'cards/bulk-save', 409, body=change)
            self.assertEqual(self.call('GET', f'cards/{first["id"]}')['revision'], first['revision'])
            change['cards'][1]['revision'] = second['revision']
            self.assertEqual(self.call('POST', 'cards/bulk-save', body=change)['updated'], 2)

        def test_copy_move_reorder_delete_and_access(self):
            models.TMA_Collaborator.create(target_type='deck', target_id=self.source.id, user_id=2, role='viewer')
            item = self.create()
            card_id = item['id']
            models.TMA_Card.update(image_path='images/example.webp', history='["original"]').where(
                models.TMA_Card.id == card_id).execute()
            models.TMAProgress.create(card_id=card_id, user_id=1, flag=3, repetitions=5)
            models.TMACardNote.create(id=str(uuid4()), card=card_id, user_id=1, text='private')
            self.assertEqual(self.call('GET', f'cards/{card_id}', user=2)['flag'], 0)
            body = {'request_id': str(uuid4()), 'card_ids': [card_id],
                    'target_deck_id': self.other.id, 'on_duplicate': 'keep'}
            self.call('POST', 'cards/batch-move', 422, body=body)
            move = {**body, 'revisions': {str(card_id): item['revision']}}
            self.call('POST', 'cards/batch-move', 403, user=2, body=move)
            self.call('POST', 'cards/batch-move', 403, body=move)
            self.assertEqual(self.call('POST', 'cards/batch-copy', user=2, body=body)['created'], 1)
            self.assertEqual(self.call('POST', 'cards/batch-copy', user=2, body=body)['created'], 1)
            copied = models.TMA_Card.get(models.TMA_Card.deck == self.other.id)
            self.assertEqual(copied.content_v2, models.TMA_Card.get_by_id(card_id).content_v2)
            self.assertEqual(copied.image_path, 'images/example.webp')
            self.assertFalse(models.TMAProgress.select().where(models.TMAProgress.card_id == copied.id).exists())
            move['target_deck_id'] = self.target.id
            self.call('POST', 'cards/batch-move', 409, body={**move, 'card_ids': [card_id, self.legacy.id],
                'revisions': {**move['revisions'], str(self.legacy.id): item['revision']}})
            stale = self.call('POST', 'cards/batch-move', 409, body=move)
            self.assertEqual(stale['detail']['code'], 'card_revision_conflict')
            self.assertEqual(models.TMA_Card.get_by_id(card_id).deck_id, self.source.id)
            current = self.call('GET', f'cards/{card_id}')
            move['revisions'][str(card_id)] = current['revision']
            with ThreadPoolExecutor(2) as pool:
                receipt, replay = list(pool.map(lambda _: self.call('POST', 'cards/batch-move', body=move), range(2)))
            self.assertEqual(receipt['moved'], 1)
            self.assertEqual(replay, receipt)
            self.call('POST', 'cards/batch-move', 409, body={**move, 'on_duplicate': 'skip'})
            placed = self.call('GET', f'cards/{card_id}')
            self.assertEqual(receipt['placements'], [{field: placed[field]
                for field in ('id', 'deck_id', 'position', 'revision')}])
            self.assertEqual(placed['content_v2'], current['content_v2'])
            self.assertEqual(models.TMAProgress.get(models.TMAProgress.card_id == card_id).repetitions, 5)
            self.assertEqual(models.TMACardNote.get(models.TMACardNote.card == card_id).text, 'private')
            self.assertEqual(models.TMA_Card.get_by_id(card_id).history, '["original"]')
            second = self.create(deck=self.target.id)
            self.call('POST', 'cards/reorder', body={
                'request_id': str(uuid4()), 'card_ids': [second['id'], card_id]})
            listing = self.call('GET', f'decks/{self.target.id}/cards')
            self.assertEqual([c['id'] for c in listing], [second['id'], card_id])
            delete = {'request_id': str(uuid4()), 'card_ids': [second['id']],
                      'revisions': {str(second['id']): second['revision']}}
            self.call('POST', 'cards/batch-delete', 409, body=delete)
            delete['revisions'][str(second['id'])] = listing[0]['revision']
            self.assertEqual(self.call('POST', 'cards/batch-delete', body=delete)['count'], 1)
            self.assertEqual(self.call('POST', 'cards/batch-delete', body=delete)['count'], 1)
            self.call('DELETE', f'cards/{card_id}', extra={'If-Match': f'"{listing[1]["revision"]}"'})
            self.call('GET', f'cards/{card_id}', 404)

        def test_codex_import_writes_only_canonical_cards(self):
            path = 'decks/import-json'
            text = '# Deck: One\nFRONT:\nHaus\nBACK:\nHouse\n# Deck: Two\nFRONT:\n@edit\nIch gehen.'
            identifier = str(uuid4())
            deck_count = models.TMA_Deck.select().count()
            self.call('POST', path, 422, body={'import_id': identifier, 'codex': text})
            self.assertEqual(models.TMA_Deck.select().count(), deck_count)
            payload = {'import_id': identifier, 'codex': text + '\nBACK:\nIch gehe.'}
            imported = self.call('POST', path, body=payload)
            self.assertEqual(self.call('POST', path, body=payload), imported)
            one, two = imported['deck_ids']
            for deck_id, kind in ((one, 'standard'), (two, 'editable_text')):
                [card] = self.call('GET', f'decks/{deck_id}/cards')
                self.assertEqual(card['content_v2']['card']['type'], kind)
                self.assertIsNone(models.TMA_Card.get_by_id(card['id']).front_text)

        def test_editor_round_trip_all_types_and_preserves_extensions(self):
            fixtures = Path(__file__).resolve().parents[2] / 'tests/fixtures/structured_cards_v2'
            by_type = {card['type']: card for file in sorted(fixtures.glob('*.json'))
                       for card in json.loads(file.read_text(encoding='utf-8'))['cards']}
            by_type.setdefault('editable_text', {'type': 'editable_text',
                               'data': {'source_text': 'Ich gehen.', 'correct_text': 'Ich gehe.'}})
            self.assertEqual(len(by_type), 9)
            for kind, card in by_type.items():
                with self.subTest(kind=kind):
                    card['metadata'] = {**card.get('metadata', {}), 'extension': {'version': 7, 'items': [True, None]}}
                    item = self.create(value={'schema_version': 2, 'card': card})
                    current = self.call('GET', f'cards/{item["id"]}')
                    edited = current['content_v2']
                    edited['card']['explanation'] = 'New explanation'
                    result = self.call('PATCH', f'cards/{item["id"]}', body={'request_id': str(uuid4()),
                        'revision': current['revision'], 'content_v2': edited})
                    reopened = self.call('GET', f'cards/{item["id"]}')
                    self.assertEqual(reopened['content_v2'], edited)
                    self.assertEqual(result['revision'], reopened['revision'])
                    self.assertNotEqual(current['revision'], result['revision'])

        def test_library_import_uses_native_content_and_retains_progress_on_repeat(self):
            library = models.Deck.create(name='Native library fixture')
            value = envelope('Literal [[ ]]')
            value['card']['metadata'] = {'extension': [True, None]}
            models.Card.create(deck=library, content_v2=value, card_type=None, image_path='images/fixture.png')
            uri = f'decks/external/import/{library.id}'
            created = self.call('POST', uri)['deck_id']
            [first] = self.call('GET', f'decks/{created}/cards')
            models.TMAProgress.create(card_id=first['id'], user_id=1, repetitions=5)
            self.assertEqual(self.call('POST', uri + '?mode=replace')['deck_id'], created)
            [second] = self.call('GET', f'decks/{created}/cards')
            self.assertEqual(second['id'], first['id'])
            self.assertEqual(second['content_v2']['card']['metadata'], {'extension': [True, None]})
            self.assertEqual(models.TMAProgress.get(models.TMAProgress.card_id == first['id']).repetitions, 5)
            self.assertIsNone(models.TMA_Card.get_by_id(first['id']).front_text)
            self.assertEqual(models.TMA_Card.get_by_id(first['id']).image_path, 'images/fixture.png')
            old = models.Deck.get(models.Deck.name == 'Old library fixture')
            self.call('POST', f'decks/external/import/{old.id}', 409)
            self.assertFalse(models.TMA_Deck.select().where(models.TMA_Deck.name == old.name).exists())

        def test_editor_ai_and_import_preview_use_v2(self):
            draft = {'schema_version': 2, 'card': {'type': 'standard',
                     'data': {'prompt': 'Я учу немецкий', 'answer': ''},
                     'metadata': {'extension': ['keep']}}}
            generated = {'front': 'Ich lerne Deutsch', 'back': 'Я учу немецкий', 'level': 'A1'}
            with patch('api.ai_service.generate_card_fields', return_value=generated) as provider:
                result = self.call('POST', 'cards/ai-generate', body={'content_v2': draft})
                self.assertEqual(result['content_v2']['card']['data']['prompt'], generated['front'])
                self.assertEqual(result['content_v2']['card']['metadata'], {'extension': ['keep']})
                self.assertTrue(provider.await_args.kwargs['plain'])
            with patch('api.ai_service.generate_card_fields', return_value={'patch': {'data': {'answer': 'Новый ответ'}}}):
                revised = self.call('POST', 'cards/ai-generate', body={'content_v2': result['content_v2'],
                    'action_type': 'custom_directive', 'user_request': 'Change the answer'})
                self.assertEqual(revised['content_v2']['card']['data'],
                                 {'prompt': generated['front'], 'answer': 'Новый ответ'})
                self.assertEqual(revised['content_v2']['card']['metadata'], {'extension': ['keep']})
            with patch('api.ai_service.generate_batch_card_fields', return_value={'cards': [generated]}), \
                    patch('api.routers.ai._ai_batch_detect_level', return_value=False):
                batch = {'text': 'Я учу немецкий', 'deck_id': self.target.id, 'import_id': str(uuid4())}
                saved = self.call('POST', 'cards/ai-generate-batch', body=batch)
                self.assertEqual(self.call('POST', 'cards/ai-generate-batch', body=batch), saved)
                self.assertEqual(saved['saved_cards'][0]['content_v2']['card']['data']['answer'], generated['back'])
            with patch('api.services.reclassification.classify_sentence_fast',
                       return_value={'confidence': 1, 'level': 'B2'}):
                self.call('POST', 'cards/classify-batch', body={'deck_id': self.target.id, 'operation_id': str(uuid4())})
            [classified] = self.call('GET', f'decks/{self.target.id}/cards')
            self.assertEqual(classified['content_v2']['card']['level'], 'B2')
            codex = self.call('POST', 'cards/import-preview', body={'text': 'FRONT:\nHaus\nBACK:\nдом'})
            document = codex['documents'][0]
            self.assertEqual(self.call('POST', 'cards/import-preview', body={
                'text': json.dumps(document)})['documents'][0], document)

        def test_native_audio_uses_structured_source_and_rejects_stale_attachment(self):
            from api.utils.audio import _prepare_tts_text

            self.assertEqual(_prepare_tts_text('::task [[literal]]', structured=True), '::task [[literal]]')
            item = self.create(value={'schema_version': 2, 'card': {'type': 'trainer',
                'data': {'parts': [{'type': 'text', 'text': '@match is literal. '},
                                   {'type': 'input', 'answers': ['chosen|value', 'other']}]}}})
            body = {'card_id': item['id'], 'side': 'front', 'text': 'untrusted override', 'voice': 'test'}
            permanent = 'https://example.invalid/test.mp3'
            with patch('api.utils.audio.generate_audio', return_value=(permanent, None)) as generator:
                self.call('POST', 'media/generate-card-audio', 403, user=2, body=body)
                generator.assert_not_called()
                generated = self.call('POST', 'media/generate-card-audio', body=body)
                generator.assert_awaited_once_with('@match is literal. chosen|value', voice='test',
                                                 rate='+0%', force=True, structured=True)
            self.assertEqual(generated['path'], permanent)
            self.assertEqual(self.call('GET', f'cards/{item["id"]}')['revision'], generated['revision'])
            with patch('api.utils.audio.generate_audio', return_value=(permanent, [])) as generator:
                preview = self.call('POST', 'media/generate-audio', body={'text': '::task [[literal]]',
                    'voice': 'test', 'rate': '+0%', 'structured': True, 'with_boundaries': True})
                generator.assert_awaited_once_with('::task [[literal]]', voice='test', rate='+0%',
                                                 with_boundaries=True, structured=True)
                self.assertEqual(preview['url'], permanent)
            from api.db_workers import run_db
            from api.services.structured_card_storage import replace_v2_card

            async def stale_audio(*_args, **_kwargs):
                await run_db(replace_v2_card, item['id'], envelope('changed')['card'])
                return 'https://example.invalid/stale.mp3', None

            with patch('api.utils.audio.generate_audio', side_effect=stale_audio):
                self.call('POST', 'media/generate-card-audio', 409, body=body)
            self.assertEqual(models.TMA_Card.get_by_id(item['id']).audio_path, permanent)
            self.call('GET', f'decks/{self.target.id}/next')
            self.call('GET', f'decks/{self.source.id}/next')
            only_legacy = models.TMA_Deck.create(user_id=1, name='Synthetic legacy only')
            models.TMA_Card.create(deck=only_legacy, front_text='Old', back_text='Card')
            response = self.call('GET', f'decks/{only_legacy.id}/next', 409)
            self.assertEqual(response['detail']['code'], 'deck_requires_migration')

        def test_study_search_duplicates_and_document_import(self):
            item = self.create(value=envelope('Österreich Suchbegriff'))
            self.assertEqual(self.call('GET', f'decks/{self.source.id}/cards')[0]['id'], item['id'])
            self.assertEqual(self.call('GET', f'decks/{self.source.id}/next')['id'], item['id'])
            self.assertEqual(self.call('GET', f'study/card/{item["id"]}')['content_v2'], item['content_v2'])
            self.call('GET', f'study/card/{self.legacy.id}', 409)
            self.assertEqual(self.call('GET', 'cards/search?q=osterreich')['cards'][0]['id'], item['id'])
            self.assertEqual(self.call('GET', 'cards/search?q=osterreich', user=2)['cards'], [])
            other = self.create(value=envelope('Österreich Suchbegriff'))
            self.assertTrue({item['id'], other['id']} <= {card['id'] for card in self.call('GET', 'cards/duplicates')})
            self.call('POST', f'decks/{self.source.id}/copy', 409, body={'request_id': str(uuid4())})
            document = {'schema_version': 2, 'deck': {'name': 'Imported V2'}, 'cards': [
                {'type': 'editable_text', 'data': {'source_text': '@match falsch', 'correct_text': 'richtig',
                                                 'accepted_answers': ['Richtig!']},
                 'info': [{'type': 'source', 'text': 'Source'}]}]}
            payload = {'import_id': str(uuid4()), 'document': document}
            imported = self.call('POST', 'decks/import-json', body=payload)
            self.assertEqual(self.call('POST', 'decks/import-json', body=payload), imported)
            deck_id = imported['deck_id']
            [imported_card] = self.call('GET', f'decks/{deck_id}/cards')
            ctx, policy = load_answer_context(imported_card['id'], 1, 'de')
            self.assertEqual(ctx['expected_answers'], ['richtig', 'Richtig!'])
            self.assertIn('@match falsch', ctx['task'])
            self.assertEqual(policy.mode, 'controlled_text')
            evaluated = self.call('POST', 'ai/evaluate-answer', body={'card_id': imported_card['id'], 'answer': 'richtig'})
            self.assertEqual(evaluated['result']['verdict'], 'correct')
            self.call('POST', 'ai/evaluate-answer', 403, user=2,
                      body={'card_id': imported_card['id'], 'answer': 'richtig'})
            grade = {'action_id': str(uuid4()), 'card_id': imported_card['id'], 'deck_id': deck_id,
                     'grade': 2, 'return_next': False}
            self.call('POST', 'study/grade', body=grade)
            self.call('POST', 'study/grade', body=grade)
            self.assertEqual(models.TMAReviewHistory.select().where(
                models.TMAReviewHistory.card_id == imported_card['id']).count(), 1)
            self.call('GET', 'sync/v2/pull', 409)
            self.call('GET', 'sync/v2/pull', 200, user=3)
            copied = self.call('POST', f'decks/{deck_id}/copy', body={'request_id': str(uuid4())})
            [copied_card] = self.call('GET', f'decks/{copied["id"]}/cards')
            self.assertEqual(copied_card['content_v2'], imported_card['content_v2'])

    return unittest.TextTestRunner(verbosity=2).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(CardHTTP)).wasSuccessful()
