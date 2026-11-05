"""Socket HTTP tests against the real authenticated routes on disposable PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
import socket
from threading import Thread
import time
import unittest
from uuid import uuid4

import httpx
import uvicorn


def verify(db):
    from api import models
    from api.auth.service import _create_session, utcnow
    from api.migrations import run_structured_cards_v2_migration
    from api.main import app
    from api.services.answer_evaluation import load_answer_context

    models.tma_db.initialize(db)
    models.lerne_db.initialize(db)
    db.create_tables([
        models.TMA_Folder, models.TMA_Deck, models.TMA_Card, models.TMA_Collaborator,
        models.TMAUser, models.TMAProgress, models.TMAReviewHistory, models.TMAOfflineBatch,
        models.TMASetting, models.TMAMedia, models.TMACardNote, models.TMAKnowledgeItem,
        models.TMACardKnowledgeItem, models.LibraryCategory, models.Deck, models.Card,
        *models.AUTH_FOUNDATION_MODELS,
    ])
    run_structured_cards_v2_migration(db)
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
            return _run_cases(client, models, headers, load_answer_context)
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        listener.close()
        if thread.is_alive():
            raise RuntimeError('HTTP test server failed to stop')


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
            self.call('POST', 'cards/batch-move', 403, user=2, body=body)
            self.assertEqual(self.call('POST', 'cards/batch-copy', user=2, body=body)['created'], 1)
            self.assertEqual(self.call('POST', 'cards/batch-copy', user=2, body=body)['created'], 1)
            copied = models.TMA_Card.get(models.TMA_Card.deck == self.other.id)
            self.assertEqual(copied.content_v2, models.TMA_Card.get_by_id(card_id).content_v2)
            self.assertEqual(copied.image_path, 'images/example.webp')
            self.assertFalse(models.TMAProgress.select().where(models.TMAProgress.card_id == copied.id).exists())
            self.call('POST', 'cards/batch-move', 409, body={**body, 'card_ids': [card_id, self.legacy.id],
                                                         'target_deck_id': self.target.id})
            self.assertEqual(models.TMA_Card.get_by_id(card_id).deck_id, self.source.id)
            self.assertEqual(self.call('POST', 'cards/batch-move', body={**body,
                'target_deck_id': self.target.id})['moved'], 1)
            self.assertEqual(self.call('POST', 'cards/batch-move', body={**body,
                'target_deck_id': self.target.id})['moved'], 1)
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
