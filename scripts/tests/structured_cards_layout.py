"""Real HTTP/PG/layout browser checks; only synthetic bytes and disposable DBs."""
import io
import json
import os
from pathlib import Path
import subprocess
from unittest.mock import patch
from uuid import uuid4


def verify_layout(client, port, models, headers):
    from PIL import Image
    from structured_cards_http import _native_examples
    from api.card_core.lerne_card_core.structured_cards_import import import_documents
    models.TMAUser.update(native_language='ru', has_selected_language=True, first_name='Layout author').where(models.TMAUser.user_id == 1).execute()
    deck = models.TMA_Deck.create(user_id=1, name='Layout fixture', target_language='de')
    target = models.TMA_Deck.create(user_id=1, name='Layout copy', target_language='de')
    buffer = io.BytesIO()
    Image.new('RGB', (240, 120), '#548071').save(buffer, 'PNG')
    with patch('api.routers.media.upload_image_to_supabase', return_value=None):
        uploaded = client.post('media/upload-image', headers=headers[1], files={'file': ('synthetic.png', buffer.getvalue(), 'image/png')})
    assert uploaded.status_code == 200, uploaded.text
    image = uploaded.json()['path']
    cards = []
    for content in _native_examples().values():
        card = content['card']
        if card.get('topics') is None:
            card['topics'] = []  # Explicit author choice, not inherited passport defaults.
        card['info'] = [{'type': 'task', 'text': '**Vor der Aufgabe.**\nZweite Zeile.'},
                        {'type': 'example', 'text': 'Nur nach der Antwort.'}]
        card['layout'] = [{'id': 'intro', 'type': 'info', 'index': 0},
                          {'id': 'picture', 'type': 'image', 'path': image, 'alt': 'Haus im Garten', 'caption': 'Ein kleines Bild.'},
                          {'id': 'exercise', 'type': 'exercise'},
                          {'id': 'feedback', 'type': 'info', 'index': 1, 'visibility': 'after_answer'}]
        request = {'deck_id': deck.id, 'request_id': str(uuid4()), 'content_v2': content}
        denied = client.post('cards/save', headers=headers[2], json=request)
        assert denied.status_code == 403, denied.text
        response = client.post('cards/save', headers=headers[1], json=request)
        assert response.status_code == 200, response.text
        saved = response.json()
        assert saved['content_v2']['card']['data'] == card['data']
        assert models.TMA_Card.get_by_id(saved['id']).content_v2 == saved['content_v2']
        cards.append(saved)
    # New missing paths fail atomically. Unchanged old references survive text edits.
    broken = json.loads(json.dumps(cards[0]['content_v2']))
    broken['card']['layout'][1]['path'] = 'images/not-uploaded.webp'
    rejected = client.patch(f"cards/{cards[0]['id']}", headers=headers[1], json={
        'request_id': str(uuid4()), 'revision': cards[0]['revision'], 'content_v2': broken})
    assert rejected.status_code == 422, rejected.text
    assert models.TMA_Card.get_by_id(cards[0]['id']).content_v2 == cards[0]['content_v2']
    copied = client.post('cards/batch-copy', headers=headers[1], json={
        'request_id': str(uuid4()), 'card_ids': [card['id'] for card in cards],
        'target_deck_id': target.id, 'on_duplicate': 'keep'})
    assert copied.status_code == 200, copied.text
    assert [row.content_v2 for row in models.TMA_Card.select().where(models.TMA_Card.deck == target).order_by(models.TMA_Card.position)] == [card['content_v2'] for card in cards]
    document = {'schema_version': 2, 'deck': {'name': deck.name}, 'cards': [card['content_v2']['card'] for card in cards]}
    imported, = import_documents(json.dumps(document))
    assert imported.model_dump(mode='json')['cards'] == document['cards']
    root = Path(__file__).resolve().parents[2]
    fixture = {'origin': f'http://127.0.0.1:{port}', 'cards': cards, 'image': image,
               'deck': {'id': deck.id, 'name': deck.name, 'user_id': 1, 'role': 'owner', 'target_language': 'de', 'stats': {'total': 9}},
               'token': headers[1]['Authorization'].split(' ', 1)[1]}
    with patch('api.routers.media.upload_image_to_supabase', return_value=None):
        result = subprocess.run(['node', 'node_modules/@playwright/test/cli.js', 'test', 'native-layout.spec.cjs',
            '--project=extended', '--workers=1', '--output', str(root / 'local/test-data/layout-browser')], cwd=root,
            env={**os.environ, 'LERNE_LAYOUT_FIXTURE': json.dumps(fixture)}, timeout=360)
    return result.returncode == 0
