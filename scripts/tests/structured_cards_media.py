"""Synthetic media only; run through the disposable PG/HTTP runner, never live DBs."""
from collections import Counter
from functools import partial
import io
import json
import math
import os
from pathlib import Path
import struct
import subprocess
import wave
from unittest.mock import patch
from uuid import uuid4


def verify_media(client, port, models, headers, app):
    from fastapi import Response
    from api.db_workers import run_db
    from api.utils.audio import generate_audio
    from structured_cards_http import _native_examples

    root = Path(__file__).resolve().parents[2]
    scratch = root / 'local/test-data' / ('native-media-' + uuid4().hex)
    scratch.mkdir(parents=True)
    models.TMAUser.update(native_language='ru', has_selected_language=True, first_name='Synthetic media').execute()
    # Existing provider contract, emulated entirely inside the disposable database.
    models.tma_db.execute_sql('CREATE SCHEMA storage')
    models.tma_db.execute_sql('CREATE TABLE storage.objects (bucket_id text, name text, PRIMARY KEY(bucket_id, name))')
    synthesized = Counter()
    payload = io.BytesIO()
    with wave.open(payload, 'wb') as audio:
        audio.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
        audio.writeframes(b''.join(struct.pack('<h', int(1200 * math.sin(i * .17))) for i in range(64000)))
    audio_bytes = payload.getvalue()

    class Communicate:
        def __init__(self, text, voice, rate):
            self.key = (text, voice, rate)

        async def save(self, path):
            synthesized[self.key] += 1
            Path(path).write_bytes(audio_bytes)

    async def upload(source, filename, *_args):
        content = bytes(source) if isinstance(source, bytes) else Path(source).read_bytes()

        def store():
            models.TMAMedia.insert(filename=filename, folder='audio', content=content).on_conflict(
                conflict_target=[models.TMAMedia.filename, models.TMAMedia.folder],
                update={models.TMAMedia.content: content}).execute()
            models.tma_db.execute_sql('INSERT INTO storage.objects VALUES (%s,%s) ON CONFLICT DO NOTHING', ('audio', filename))
        await run_db(store)
        return f'http://127.0.0.1:5199/storage/v1/object/public/audio/{filename}'

    @app.get('/storage/v1/object/public/audio/{filename}')
    async def provider_fixture(filename: str):
        def read():
            return bytes(models.TMAMedia.get(models.TMAMedia.filename == filename, models.TMAMedia.folder == 'audio').content)
        return Response(await run_db(read), media_type='audio/wav')

    deck = models.TMA_Deck.create(user_id=1, name='V2 media fixture', target_language='de')
    target = models.TMA_Deck.create(user_id=1, name='V2 media target', target_language='de')
    cards = []
    for content in _native_examples().values():
        response = client.post('cards/save', headers=headers[1], json={'deck_id': deck.id,
            'request_id': str(uuid4()), 'content_v2': content})
        assert response.status_code == 200, response.text
        cards.append(response.json())
    config = {'origin': f'http://127.0.0.1:{port}', 'cards': cards,
        'deck': {'id': deck.id, 'name': deck.name, 'user_id': 1, 'role': 'owner', 'target_language': 'de', 'stats': {'total': 9, 'new': 9, 'due': 0, 'learning': 0}},
        'target': {'id': target.id, 'name': target.name, 'user_id': 1, 'role': 'owner', 'target_language': 'de', 'stats': {'total': 0, 'new': 0, 'due': 0, 'learning': 0}},
        'token': headers[1]['Authorization'].split(' ', 1)[1]}
    with patch.dict(os.environ, {'SUPABASE_URL': 'http://127.0.0.1:5199', 'SUPABASE_KEY': 'synthetic'}), patch(
        'api.utils.audio.edge_tts.Communicate', Communicate), patch(
        'api.utils.audio._upload_to_supabase', side_effect=upload), patch(
        'api.utils.audio.generate_audio', side_effect=partial(generate_audio, output_dir=str(scratch))), patch(
        'api.routers.media.upload_image_to_supabase', return_value=None):
        from api.services.structured_card_api import authored_side_text
        for card in cards:
            body = {'card_id': card['id'], 'side': 'back', 'text': 'untrusted override'}
            assert client.post('media/generate-card-audio', headers=headers[2], json=body).status_code == 403
            expected = authored_side_text(card['content_v2'], 'back')
            first = client.post('media/generate-card-audio', headers=headers[1], json=body)
            assert first.status_code == (200 if expected.strip() else 400), first.text
            if expected.strip():
                second = client.post('media/generate-card-audio', headers=headers[1], json=body)
                assert first.json() == second.json()
        previous = models.TMA_Card.get_by_id(cards[0]['id']).audio_path
        with patch.object(Communicate, 'save', side_effect=RuntimeError('synthetic provider failure')):
            failure = client.post('media/generate-card-audio', headers=headers[1],
                json={'card_id': cards[0]['id'], 'voice': 'synthetic-failure'})
            assert failure.status_code == 500
            assert models.TMA_Card.get_by_id(cards[0]['id']).audio_path == previous
        result = subprocess.run(['node', 'node_modules/@playwright/test/cli.js', 'test',
            'native-media.spec.cjs', '--project=extended', '--workers=1',
            '--output', str(root / 'local/test-data/native-media-browser')], cwd=root,
            env={**os.environ, 'LERNE_NATIVE_MEDIA_FIXTURE': json.dumps(config)}, timeout=360)
    if result.returncode:
        return False
    assert len(synthesized) >= 9, synthesized
    assert all(count == 1 for count in synthesized.values()), synthesized
    assert models.TMAMedia.select().where(models.TMAMedia.folder == 'audio').count() == len(synthesized)
    for card in cards:
        original = models.TMA_Card.get_by_id(card['id'])
        assert original.deck_id == target.id and not original.is_deleted
        assert all(getattr(original, field) for field in
                   ('image_path', 'audio_path', 'audio_back_path', 'video_front_path', 'video_back_path'))
        copies = list(models.TMA_Card.select().where(models.TMA_Card.id != original.id,
            models.TMA_Card.content_v2 == original.content_v2))
        assert len(copies) == 1
        assert all(getattr(copies[0], field) == getattr(original, field) for field in
                   ('image_path', 'audio_path', 'audio_back_path', 'video_front_path', 'video_back_path'))
        assert original.front_text is None and original.back_text is None
    # Verify bytes still exist, not just their paths.
    for media in models.TMAMedia.select():
        assert media.content and len(media.content) > 0
    print('PASS: nine types; one synthesis/object per text+voice+rate; media/lifecycle bytes retained', flush=True)
    return True
