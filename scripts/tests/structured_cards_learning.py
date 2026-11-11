"""Synthetic 6B.6 fixtures, executed only inside the disposable PG/HTTP runner."""
import json
import os
from pathlib import Path
import subprocess
from uuid import uuid4


def verify_learning(client, port, models, headers):
    models.TMAUser.update(native_language='ru', has_selected_language=True, first_name='Synthetic learner').execute()

    def request(method, path, body=None, user=1, status=200):
        response = client.request(method, path, headers=headers[user], json=body)
        assert response.status_code == status, (path, response.status_code, response.text)
        return response.json()

    contents = {
        'theory': {'text': 'Theory [[literal]] @quiz', 'summary': 'Theory summary'},
        'standard': {'prompt': 'Standard prompt', 'answer': 'Standard answer'},
        'trainer': {'parts': [{'type': 'text', 'text': 'Ich '}, {'type': 'input', 'answers': ['gehe']}]},
        'quiz': {'prompt': 'Quiz prompt', 'options': [{'text': 'Ja', 'correct': True}, {'text': 'Nein'}]},
        'match': {'pairs': [{'left': 'A', 'right': 'one'}, {'left': 'B', 'right': 'two'}]},
        'puzzle': {'tokens': ['Ich', 'gehe', 'heim.']},
        'word_bank': {'options': ['gehe', 'geht'], 'parts': [{'type': 'text', 'text': 'Ich '}, {'type': 'gap', 'option': 0}]},
        'free_text': {'prompt': 'Write Ich gehe.', 'sample_answer': 'Ich gehe.',
                      'accepted_answers': ['Ich gehe.'], 'grading_policy': {'mode': 'exact'}},
        'editable_text': {'source_text': 'Ich gehen.', 'correct_text': 'Ich gehe.',
                          'accepted_answers': ['Ich gehe.'], 'grading_policy': {'mode': 'exact'}},
    }
    deck = models.TMA_Deck.create(user_id=1, name='V2 learning fixture', target_language='de')
    target = models.TMA_Deck.create(user_id=1, name='V2 learning target', target_language='de')
    foreign = models.TMA_Deck.create(user_id=2, name='Private second account', target_language='de')
    models.TMA_Collaborator.create(target_type='deck', target_id=deck.id, user_id=2, role='viewer')
    models.TMA_Collaborator.create(target_type='deck', target_id=target.id, user_id=2, role='viewer')
    cards = []
    for kind, data in contents.items():
        card = request('POST', 'cards/save', {'deck_id': deck.id, 'request_id': str(uuid4()),
            'content_v2': {'schema_version': 2, 'card': {'type': kind, 'data': data}}})
        ki = models.TMAKnowledgeItem.create(name=f'Synthetic {kind}')
        secondary = models.TMAKnowledgeItem.create(name=f'Secondary {kind}')
        models.TMACardKnowledgeItem.create(card_id=card['id'], knowledge_item=ki, complexity=4, weight=.75)
        models.TMACardKnowledgeItem.create(card_id=card['id'], knowledge_item=secondary, role='secondary', complexity=2)
        cards.append({**card, 'ki': ki.id})

    config = {'origin': f'http://127.0.0.1:{port}', 'cards': cards,
        'deck': {'id': deck.id, 'user_id': 1, 'name': deck.name, 'target_language': 'de', 'role': 'owner',
                 'stats': {'total': 10, 'new': 9, 'due': 1, 'learning': 0}},
        'target': {'id': target.id, 'user_id': 1, 'name': target.name, 'target_language': 'de', 'role': 'owner',
                   'stats': {'total': 0, 'new': 0, 'due': 0, 'learning': 0}},
        'foreign': foreign.id,
        'tokens': {str(user): value['Authorization'].split(' ', 1)[1] for user, value in headers.items()}}
    probe = request('POST', 'cards/save', {'deck_id': deck.id, 'request_id': str(uuid4()),
        'content_v2': {'schema_version': 2, 'card': {'type': 'standard',
            'data': {'prompt': 'Flag concurrency probe', 'answer': 'Synthetic'}}}})
    models.TMAProgress.create(card_id=probe['id'], user_id=1, queue='review', interval=10, repetitions=5)
    config['probe'] = probe['id']
    root = Path(__file__).resolve().parents[2]
    result = subprocess.run(['node', 'node_modules/@playwright/test/cli.js', 'test',
        'native-learning.spec.cjs', '--project=extended', '--workers=1'], cwd=root,
        env={**os.environ, 'LERNE_NATIVE_LEARNING_FIXTURE': json.dumps(config)}, timeout=360)
    if result.returncode:
        return False

    # Inspect authoritative records after the browser, not just UI success responses.
    for card in cards:
        cid, ki = card['id'], card['ki']
        assert models.TMAReviewHistory.select().where(models.TMAReviewHistory.card_id == cid,
            models.TMAReviewHistory.user_id == 1).count() == 3
        assert models.TMAKnowledgeAttempt.select().where(models.TMAKnowledgeAttempt.card_id == cid,
            models.TMAKnowledgeAttempt.user_id == 1).count() == 3
        state = models.TMAUserKnowledgeState.get(models.TMAUserKnowledgeState.user_id == 1,
            models.TMAUserKnowledgeState.knowledge_item == ki)
        assert state.evidence_event_count == 3
        progress = models.TMAProgress.get(models.TMAProgress.card_id == cid, models.TMAProgress.user_id == 1)
        assert progress.repetitions == 3 and progress.queue == 'review' and progress.flag == 0
        attempts = list(models.TMAKnowledgeAttempt.select().where(models.TMAKnowledgeAttempt.card_id == cid,
            models.TMAKnowledgeAttempt.user_id == 1).order_by(models.TMAKnowledgeAttempt.id))
        evaluation = json.loads(attempts[0].evaluation_data)
        assert evaluation['card_type'] == card['content_v2']['card']['type']
        assert evaluation['evaluation_type'] == ('self_rating' if evaluation['card_type'] in ('standard', 'theory') else 'hybrid')
        assert models.TMACardNote.select().where(models.TMACardNote.card == cid,
            models.TMACardNote.user_id == 1).count() == 1
        assert models.TMACardNote.get(models.TMACardNote.card == cid,
            models.TMACardNote.user_id == 1).text == f'Private offline {cid}'
        assert models.TMA_Card.get_by_id(cid).flag == 0
        assert models.TMACardRating.get(models.TMACardRating.card == cid,
            models.TMACardRating.user_id == 1).rating == 1
    print('PASS: PostgreSQL confirms nine types, 27 unique reviews/attempts, mastery and private data', flush=True)
    _verify_lifecycle(request, cards, target.id, models)
    return True


def _verify_lifecycle(request, cards, target, models):
    from structured_cards_http import _card_state

    def links(card_id):
        return {name: rows for name, rows in _card_state(models, card_id).items() if name != 'card'}

    before = {card['id']: links(card['id']) for card in cards}
    states = list(models.TMAUserKnowledgeState.select().order_by(models.TMAUserKnowledgeState.id).dicts())
    for card in cards:
        cid = card['id']
        current = request('GET', f'cards/{cid}')
        edited = json.loads(json.dumps(current['content_v2']))
        edited['card']['explanation'] = 'Edited without losing personal data'
        request('PATCH', f'cards/{cid}', {'content_v2': edited, 'revision': current['revision'], 'request_id': str(uuid4())})
        assert links(cid) == before[cid]
    ids = [card['id'] for card in cards]
    revisions = {cid: request('GET', f'cards/{cid}')['revision'] for cid in ids}
    copy_request = {'card_ids': ids, 'target_deck_id': target, 'on_duplicate': 'keep',
                    'revisions': revisions, 'request_id': str(uuid4())}
    copied = request('POST', 'cards/batch-copy', copy_request)
    assert request('POST', 'cards/batch-copy', copy_request) == copied
    for copy in copied['copies']:
        related = links(copy['card']['id'])
        assert all(not related[name] for name in ('progress', 'reviews', 'notes', 'ratings', 'attempts'))
        semantic = lambda rows: [{k: v for k, v in row.items() if k not in ('id', 'card_id', 'created_at')} for row in rows]
        assert semantic(related['knowledge']) == semantic(before[copy['source_id']]['knowledge']), 'Copied V2 lost skill mappings'
    request('POST', 'cards/batch-move', {**copy_request, 'request_id': str(uuid4())})
    content_before = {cid: request('GET', f'cards/{cid}')['content_v2'] for cid in ids}
    request('POST', 'cards/reorder', {'card_ids': list(reversed(ids)), 'request_id': str(uuid4()),
        'revisions': {cid: request('GET', f'cards/{cid}')['revision'] for cid in ids}})
    ordered = list(models.TMA_Card.select().where(models.TMA_Card.id.in_(ids)).order_by(models.TMA_Card.position))
    assert [row.id for row in ordered] == list(reversed(ids))
    for row in ordered:
        assert row.content_v2 == content_before[row.id] and links(row.id) == before[row.id]
    revisions = {cid: request('GET', f'cards/{cid}')['revision'] for cid in ids}
    deleted = request('POST', 'cards/batch-delete', {'card_ids': ids, 'revisions': revisions, 'request_id': str(uuid4())})
    for card in deleted['cards']:
        cid = card['id']
        assert links(cid) == before[cid]
        request('PUT', f'card-ratings/{cid}', {'rating': 1}, status=404)
        request('POST', f'trash/card/{cid}/restore', {'revision': card['revision'], 'request_id': str(uuid4())})
        assert links(cid) == before[cid]
        assert models.TMA_Card.get_by_id(cid).deck_id == target
    assert list(models.TMAUserKnowledgeState.select().order_by(models.TMAUserKnowledgeState.id).dicts()) == states
    # A read-only learner owns their flags, notes, votes and attempts, never content.
    cid = ids[0]
    request('PATCH', f'cards/{cid}', {'content_v2': cards[0]['content_v2'],
        'revision': request('GET', f'cards/{cid}')['revision'], 'request_id': str(uuid4())}, user=2, status=403)
    request('GET', f'card-notes/{cid}', user=3, status=403)
    request('PUT', f'card-ratings/{cid}', {'rating': 1}, user=3, status=403)
    request('POST', f'cards/{cid}/flag', {'flag': 1}, user=3, status=403)
    print('PASS: nine-type edit/copy/replay/move/reorder/delete/restore preserve links and isolate personal data', flush=True)
