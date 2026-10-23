"""Folder importer contracts on disposable SQLite; external I/O is always mocked.

Run through scripts.test_backend.isolated_suite to disable dotenv and networking.
"""
import io
import wave
import json
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

from fastapi.testclient import TestClient
from peewee import SqliteDatabase
from PIL import Image

from api import models
from scripts.tests.test_local_dev import SyntheticDirectory
from tools.admin import server
from tools.admin.services import deck_import_media

TABLES = [models.TMAUser, models.TMA_Folder, models.TMA_Deck, models.TMA_Card,
          models.TMA_Collaborator, models.TMAProgress, models.TMAReviewHistory,
          models.TMAOfflineBatch, models.TMAMedia, models.TMASetting]


def document(name, count=2, identifier=None):
    return (f'# Deck: {name}\n' + '\n<<<LERNE_CARD>>>\n'.join(
        (f'::card_id {identifier}\n' if identifier else '') + f'FRONT:\nWort {i}\nBACK:\nСлово {i}\nCONTEXT:\n'
        for i in range(1, count + 1))).encode()


def image():
    output = io.BytesIO()
    Image.new('RGB', (2000, 1000), 'red').save(output, 'PNG')
    return output.getvalue()


def audio(value=0):
    output = io.BytesIO()
    with wave.open(output, 'wb') as recording:
        recording.setparams((1, 1, 8000, 0, 'NONE', 'not compressed'))
        recording.writeframes(bytes([128 + value]) * 800)
    return output.getvalue()


class FolderImportTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict('os.environ', {'SUPABASE_URL': 'https://example.supabase.co', 'SUPABASE_KEY': 'fixture'})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        uploader = patch('requests.post', return_value=Mock(status_code=201))
        self.upload = uploader.start()
        self.addCleanup(uploader.stop)
        self.db = SqliteDatabase(':memory:', thread_safe=False, check_same_thread=False)
        models.tma_db.initialize(self.db)
        models.lerne_db.initialize(self.db)
        self.db.create_tables(TABLES)
        self.folder = models.TMA_Folder.create(name='Назначение', user_id=42)
        models.TMAUser.create(user_id=42, is_guest=False)
        models.TMAUser.create(user_id=99, is_guest=False)
        server.app.dependency_overrides[server.db_session_scope] = lambda: None
        self.client = TestClient(server.app, base_url='http://127.0.0.1:8050', client=('127.0.0.1', 30000),
                                 headers={'Origin': 'http://127.0.0.1:8050'})
        self.payload = {'selected': ['B/D01.txt'], 'target_folder_id': self.folder.id, 'user_id': 42}
        self.files = {'B/D01.txt': document('Основы')}

    def tearDown(self):
        self.client.close()
        server.app.dependency_overrides.clear()
        self.db.close()

    def post(self, action, payload=None, files=None):
        return self.client.post('/api/admin/author/folder-import/' + action,
                                data={'payload': json.dumps(payload or self.payload)},
                                files=[('files', (path, data)) for path, data in (files or self.files).items()])

    def preview(self, payload=None):
        response = self.post('preview', payload)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def apply(self, plan, payload=None, request_id=None):
        data = {**(payload or self.payload), 'confirmed': True, 'preview_token': plan['preview_token'],
                'request_id': request_id or str(uuid4())}
        return self.post('apply', data)

    def media(self, count=2):
        self.files['B/D01.txt'] = document('Основы', count)
        self.payload['manifests'] = ['B/D01_Медиа/media_manifest.json']
        self.files['B/D01_Медиа/media_manifest.json'] = json.dumps({
            'schema_version': 1, 'deck_file': '../D01.txt',
            'bindings': [{'card_number': i, 'image': 'images/shared.png', 'audio_front': 'audio/one.wav',
                          'audio_back': 'audio/one.wav'} for i in range(1, count + 1)],
            'study_audio': [{'file': 'audio/one.wav', 'title': 'Упражнение'}]}).encode()
        self.files['B/D01_Медиа/images/shared.png'] = image()
        self.files['B/D01_Медиа/audio/one.wav'] = audio()

    def existing(self, audio=None):
        deck = models.TMA_Deck.create(name='Основы', folder=self.folder, user_id=42, metadata='{"intro":{"title":"Keep"},"resources":[]}')
        card = models.TMA_Card.create(deck=deck, creator_id=99, front_text='Original', back_text='Ответ',
                                      context='@quiz preserve', history='["old"]', audio_path=audio, metadata='{"keep":true}')
        models.TMAProgress.create(card_id=card.id, user_id=99, repetitions=5, interval=77)
        models.TMAReviewHistory.create(card_id=card.id, user_id=99, rating=4)
        return deck, card

    def test_select_one_three_all_out_of_ten_and_no_preview_writes(self):
        for selected in ([1], [2, 5, 8], list(range(1, 11))):
            with self.subTest(selected=selected):
                folder = models.TMA_Folder.create(name=str(selected), user_id=42)
                self.payload['target_folder_id'] = folder.id
                self.files = {f'B/D{i}.txt': document(f'Колода {i}', 1) for i in selected}
                self.payload['selected'] = list(self.files)
                before = models.TMA_Card.select().count()
                receipts_before = models.TMAOfflineBatch.select().count()
                plan = self.preview()
                self.assertTrue(plan['can_apply'], plan['problems'])
                self.assertEqual(models.TMA_Card.select().count(), before)
                self.assertEqual(models.TMAOfflineBatch.select().count(), receipts_before)
                response = self.apply(plan)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(models.TMA_Card.select().count() - before, len(selected))
                self.assertEqual(models.TMA_Deck.select().where(models.TMA_Deck.folder == folder).count(), len(selected))

    def test_media_shared_webp_reimport_and_response_loss(self):
        self.media()
        plan = self.preview()
        self.assertEqual(models.TMAMedia.select().count(), 0)
        self.assertEqual(plan['created_cards'], 2)
        request_id = str(uuid4())
        result = self.apply(plan, request_id=request_id)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(models.TMAMedia.select().count(), 2)
        cards = list(models.TMA_Card.select())
        self.assertEqual(cards[0].image_path, cards[1].image_path)
        self.assertEqual(cards[0].audio_path, cards[1].audio_back_path)
        self.assertEqual(cards[0].creator_id, 42)
        content = next(call.kwargs['data'] for call in self.upload.call_args_list if '/images/' in call.args[0])
        with Image.open(io.BytesIO(content)) as prepared:
            self.assertEqual(prepared.format, 'WEBP')
            self.assertLessEqual(max(prepared.size), 1600)
        replay = self.apply(plan, request_id=request_id)
        self.assertEqual(replay.json(), result.json())
        again = self.preview()
        self.assertTrue(again['can_apply'], again['problems'])
        self.assertEqual(again['created_cards'], 0)
        self.assertEqual(self.apply(again).status_code, 200)
        self.assertEqual(models.TMA_Card.select().count(), 2)
        metadata = json.loads(models.TMA_Deck.get().metadata)
        self.assertEqual(len(metadata['resources']), 1)

    def test_media_only_manual_mapping_preserves_all_non_media_data(self):
        deck, card = self.existing()
        self.media(1)
        self.payload['mode'] = 'media'
        plan = self.preview()
        self.assertFalse(plan['can_apply'])
        self.assertEqual(plan['groups'][0]['rows'][0]['status'], 'conflict')
        self.payload['decisions'] = {'B/D01.txt#1': str(card.id)}
        before = dict(models.TMA_Card.get_by_id(card.id).__data__)
        progress = list(models.TMAProgress.select().dicts())
        reviews = list(models.TMAReviewHistory.select().dicts())
        plan = self.preview()
        self.assertTrue(plan['can_apply'], plan['problems'])
        response = self.apply(plan)
        self.assertEqual(response.status_code, 200, response.text)
        after = dict(models.TMA_Card.get_by_id(card.id).__data__)
        for key in before:
            if key not in ('image_path', 'audio_path', 'audio_back_path', 'updated_at'):
                self.assertEqual(after[key], before[key], key)
        self.assertEqual(models.TMA_Card.select().count(), 1)
        self.assertEqual(models.TMA_Deck.get_by_id(deck.id).user_id, 42)
        self.assertEqual(models.TMA_Folder.get().user_id, 42)
        self.assertEqual(progress, list(models.TMAProgress.select().dicts()))
        self.assertEqual(reviews, list(models.TMAReviewHistory.select().dicts()))

    def test_existing_card_id_reused_and_foreign_unknown_never_recreated(self):
        _, card = self.existing()
        self.files['B/D01.txt'] = document('Основы', 1, card.id)
        plan = self.preview()
        self.assertTrue(plan['can_apply'], plan['problems'])
        self.assertEqual(plan['existing_cards'], 1)
        self.assertEqual(self.apply(plan).status_code, 200)
        self.assertEqual(models.TMA_Card.get().front_text, 'Original')
        for identifier in (card.id + 100,):
            self.files['B/D01.txt'] = document('Основы', 1, identifier)
            bad = self.preview()
            self.assertFalse(bad['can_apply'])
            self.assertEqual(self.apply(bad).status_code, 422)
        other = models.TMA_Deck.create(name='Other', user_id=42, folder=self.folder)
        foreign = models.TMA_Card.create(deck=other, front_text='foreign', back_text='x')
        self.files['B/D01.txt'] = document('Основы', 1, foreign.id)
        self.assertFalse(self.preview()['can_apply'])
        self.assertEqual(models.TMA_Card.select().count(), 2)

    def test_replace_keep_skip_conflicts(self):
        _, card = self.existing(audio='https://old/audio.mp3')
        self.media(1)
        self.payload.update(mode='media', decisions={'B/D01.txt#1': str(card.id)})
        plan = self.preview()
        self.assertFalse(plan['can_apply'])
        for action in ('keep', 'skip', 'replace'):
            self.payload['media_choices'] = {'B/D01.txt#1:audio_front': action}
            plan = self.preview()
            self.assertTrue(plan['can_apply'], plan['problems'])
            response = self.apply(plan)
            self.assertEqual(response.status_code, 200, response.text)
            value = models.TMA_Card.get_by_id(card.id).audio_path
            if action in ('keep', 'skip'):
                self.assertEqual(value, 'https://old/audio.mp3')
            else:
                self.assertIn('import_', value)

    def test_missing_file_invalid_audio_and_manifest_version_block_everything(self):
        self.media()
        del self.files['B/D01_Медиа/audio/one.wav']
        plan = self.preview()
        self.assertFalse(plan['can_apply'])
        self.assertTrue(any('отсутствующий' in p for p in plan['problems']))
        self.assertEqual(self.apply(plan).status_code, 422)
        self.files['B/D01_Медиа/audio/one.wav'] = b'Not audio' * 100
        self.assertFalse(self.preview()['can_apply'])
        self.files['B/D01_Медиа/media_manifest.json'] = b'{"schema_version":999,"deck_file":"../D01.txt"}'
        self.assertEqual(self.post('preview').status_code, 400)
        self.assertEqual(models.TMA_Card.select().count(), 0)

    def test_no_confirmation_stale_media_and_changed_manifest_are_rejected(self):
        self.media()
        plan = self.preview()
        response = self.post('apply', {**self.payload, 'preview_token': plan['preview_token'], 'request_id': str(uuid4())})
        self.assertEqual(response.status_code, 400)
        self.files['B/D01_Медиа/audio/one.wav'] = audio(1)
        self.assertEqual(self.apply(plan).status_code, 409)
        self.assertEqual(models.TMAMedia.select().count(), 0)

    def test_permissions_checked_again_after_upload_and_failure_does_not_attach(self):
        self.media()
        plan = self.preview()
        with patch('tools.admin.services.deck_import.store_media', side_effect=RuntimeError('upload failed')):
            with self.assertRaisesRegex(RuntimeError, 'upload failed'):
                self.apply(plan)
        self.assertEqual(models.TMA_Card.select().count(), 0)
        def revoke(_asset):
            models.TMA_Folder.update(user_id=99).where(models.TMA_Folder.id == self.folder.id).execute()
        with patch('tools.admin.services.deck_import.store_media', side_effect=revoke):
            self.assertEqual(self.apply(plan).status_code, 403)
        self.assertEqual(models.TMA_Card.select().count(), 0)

    def test_outsider_viewer_and_guest_are_denied(self):
        self.payload['user_id'] = 99
        self.assertEqual(self.post('preview').status_code, 403)
        models.TMA_Collaborator.create(user_id=99, target_type='folder', target_id=self.folder.id, role='viewer', added_by=42)
        self.assertEqual(self.post('preview').status_code, 403)
        models.TMAUser.update(is_guest=True).where(models.TMAUser.user_id == 42).execute()
        self.payload['user_id'] = 42
        self.assertEqual(self.post('preview').status_code, 403)

    def test_extra_unselected_media_and_unsafe_paths_are_rejected(self):
        self.files['B/unselected.mp3'] = audio()
        self.assertEqual(self.post('preview').status_code, 400)
        del self.files['B/unselected.mp3']
        for path in ('../D01.txt', '/abs.txt', 'C:/evil.txt', 'B/../D01.txt'):
            payload = {**self.payload, 'selected': [path]}
            self.assertEqual(self.post('preview', payload, {path: document('x')}).status_code, 400)

    def test_cloud_immutable_upload_is_reused_without_blob_downloads(self):
        asset = deck_import_media.prepare_media('x.png', image(), 'image')
        response = Mock(status_code=201)
        with patch.dict('os.environ', {'SUPABASE_URL': 'https://example.supabase.co', 'SUPABASE_KEY': 'fake'}), \
                patch('requests.post', return_value=response) as upload:
            deck_import_media.store_media(asset)
            deck_import_media.store_media(asset)
            self.assertEqual(upload.call_count, 1)
            self.assertEqual(upload.call_args.kwargs['headers']['x-upsert'], 'false')
            self.assertIsNone(models.TMAMedia.get().content)

    def test_old_txt_md_json_parser_and_publication_remain_available(self):
        # Existing routes are deliberately unchanged; exercise their real parser.
        for ext in ('txt', 'md'):
            response = self.client.post('/api/admin/author/parse', files={'files': (f'one.{ext}', document('old', 1))})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['total_cards'], 1)
        response = self.client.post('/api/admin/author/publish', json={'cards': [{
            'front': 'Alt', 'back': 'Старый', 'deck_name': 'Legacy'}], 'target_folder_id': self.folder.id, 'user_id': 42})
        self.assertEqual(response.status_code, 200, response.text)

    def test_new_folder_retry_and_changed_selection_do_not_duplicate(self):
        self.payload.pop('target_folder_id')
        self.payload['new_folder_name'] = 'Новая папка'
        first = self.apply(self.preview())
        self.assertEqual(first.status_code, 200, first.text)
        again = self.preview()
        self.assertEqual(again['created_cards'], 0)
        self.assertEqual(self.apply(again).status_code, 200)
        self.assertEqual(models.TMA_Folder.select().where(models.TMA_Folder.name == 'Новая папка').count(), 1)
        self.assertEqual(models.TMA_Card.select().count(), 2)

    def test_partial_card_save_and_failure_after_upload_rollback_all_card_writes(self):
        self.media()
        plan = self.preview()
        from api import services
        original = services.bulk_save_cards
        def fail_after_save(*args, **kwargs):
            original(*args, **kwargs)
            return {'failed_count': 1}
        with patch.object(services, 'bulk_save_cards', side_effect=fail_after_save):
            self.assertEqual(self.apply(plan).status_code, 400)
        self.assertEqual(models.TMA_Card.select().count(), 0)
        self.assertEqual(models.TMA_Deck.select().count(), 0)
        self.assertEqual(models.TMAOfflineBatch.select().count(), 0)
        uploads = self.upload.call_count
        self.assertEqual(uploads, 2)
        self.assertEqual(self.apply(plan).status_code, 200)
        self.assertEqual(self.upload.call_count, uploads)

    def test_audio_grant_uses_existing_permission_without_allowing_images(self):
        deck, card = self.existing()
        self.files['B/D01.txt'] = document('Основы', 1, card.id)
        manifest_path = 'B/media_manifest.json'
        self.payload.update(mode='media', user_id=99, manifests=[manifest_path])
        self.files[manifest_path] = json.dumps({'schema_version': 1, 'deck_file': 'D01.txt',
                                               'bindings': [{'card_number': 1, 'audio_front': 'one.wav'}]}).encode()
        self.files['B/one.wav'] = audio()
        grant = models.TMA_Collaborator.create(user_id=99, target_type='deck', target_id=deck.id,
                                               role='viewer', can_edit_audio=False, added_by=42)
        self.assertEqual(self.post('preview').status_code, 403)
        grant.can_edit_audio = True
        grant.save()
        plan = self.preview()
        self.assertTrue(plan['can_apply'], plan['problems'])
        self.assertEqual(self.apply(plan).status_code, 200)
        self.files[manifest_path] = json.dumps({'schema_version': 1, 'deck_file': 'D01.txt',
                                               'bindings': [{'card_number': 1, 'image': 'one.png'}]}).encode()
        del self.files['B/one.wav']
        self.files['B/one.png'] = image()
        self.assertEqual(self.post('preview').status_code, 403)

    def test_unknown_manifest_card_preview_and_upload_size_limits(self):
        self.media(1)
        path = self.payload['manifests'][0]
        manifest = json.loads(self.files[path])
        manifest['bindings'][0]['card_number'] = 999
        self.files[path] = json.dumps(manifest).encode()
        plan = self.preview()
        self.assertFalse(plan['can_apply'])
        self.assertTrue(any('неизвестная карточка' in error for error in plan['problems']))
        response = self.client.post('/api/admin/author/folder-import/preview', content=b'x',
                                    headers={'Content-Length': str(103 * 1024 * 1024)})
        self.assertEqual(response.status_code, 413)
        with patch('tools.admin.services.deck_import_limits.MAX_TOTAL', 1):
            response = self.client.post('/api/admin/author/folder-import/preview',
                                        content=iter([b'x' * (3 * 1024 * 1024)]),
                                        headers={'Content-Type': 'multipart/form-data; boundary=fixture'})
            self.assertEqual(response.status_code, 413, response.text)

    def test_missing_cloud_configuration_is_reviewable_and_does_not_attach_audio(self):
        self.media()
        with patch.dict('os.environ', {'SUPABASE_URL': '', 'SUPABASE_KEY': ''}):
            plan = self.preview()
            self.assertFalse(plan['can_apply'])
            self.assertTrue(any('Supabase Storage' in p for p in plan['problems']))
            self.assertEqual(self.apply(plan).status_code, 422)
        self.assertEqual(self.upload.call_count, 0)

    def test_v2_json_uses_existing_projection(self):
        # Use the existing V2 corpus rather than inventing another JSON grammar.
        from pathlib import Path
        from api.services import author_service
        content = Path('project_docs/examples/structured_cards_v2/basics.json').read_bytes()
        expected = author_service.parse_uploaded_documents([('D01.json', content.decode())])
        self.assertFalse(expected['errors'])
        self.files = {'B/D01.json': content}
        self.payload['selected'] = ['B/D01.json']
        plan = self.preview()
        self.assertTrue(plan['can_apply'], plan['problems'])
        self.assertEqual(plan['created_cards'], len(expected['cards']))
        self.assertEqual(self.apply(plan).status_code, 200)
        saved = list(models.TMA_Card.select().order_by(models.TMA_Card.position))
        self.assertEqual([c.front_text for c in saved], [c['front'] for c in expected['cards']])

    def test_corrupt_image_is_a_preview_problem_and_identical_files_are_reused(self):
        self.media()
        image_path = 'B/D01_Медиа/images/shared.png'
        good = self.files[image_path]
        self.files[image_path] = good[:-15]
        plan = self.preview()
        self.assertFalse(plan['can_apply'])
        self.assertTrue(any('изображение' in p for p in plan['problems']))
        self.files[image_path] = good
        copy_path = 'B/D01_Медиа/images/copy.png'
        self.files[copy_path] = good
        manifest_path = self.payload['manifests'][0]
        manifest = json.loads(self.files[manifest_path])
        manifest['bindings'][1]['image'] = 'images/copy.png'
        self.files[manifest_path] = json.dumps(manifest).encode()
        plan = self.preview()
        images = [a for a in plan['assets'] if a['folder'] == 'images']
        self.assertEqual(len(images), 2)
        self.assertEqual(images[0]['sha256'], images[1]['sha256'])
        self.assertEqual(self.apply(plan).status_code, 200)
        self.assertEqual(self.upload.call_count, 2)  # One image, one shared audio.

    def test_stale_existing_media_and_edited_request_id_are_rejected(self):
        _, card = self.existing()
        self.media(1)
        self.payload.update(mode='media', decisions={'B/D01.txt#1': str(card.id)})
        plan = self.preview()
        models.TMA_Card.update(image_path='changed elsewhere').where(models.TMA_Card.id == card.id).execute()
        self.payload['media_choices'] = {'B/D01.txt#1:image': 'replace'}
        self.assertEqual(self.apply(plan).status_code, 409)
        plan = self.preview()
        request_id = str(uuid4())
        self.assertEqual(self.apply(plan, request_id=request_id).status_code, 200)
        self.files['B/D01_Медиа/audio/one.wav'] = audio(1)
        self.assertEqual(self.apply(plan, request_id=request_id).status_code, 409)

    def test_storage_failure_is_bounded_and_existing_links_are_unchanged(self):
        import requests
        _, card = self.existing()
        self.media(1)
        self.payload.update(mode='media', decisions={'B/D01.txt#1': str(card.id)})
        plan = self.preview()
        self.upload.side_effect = requests.ConnectionError('fixture outage')
        self.assertEqual(self.apply(plan).status_code, 502)
        self.assertEqual(self.upload.call_count, 1)
        self.assertIsNone(models.TMA_Card.get_by_id(card.id).image_path)
        self.assertEqual(models.TMAOfflineBatch.select().count(), 0)

    def test_existing_database_image_remains_available_after_storage_is_configured(self):
        asset = deck_import_media.prepare_media('image.png', image(), 'image')
        with patch.dict('os.environ', {'SUPABASE_URL': '', 'SUPABASE_KEY': ''}):
            deck_import_media.store_media(asset)
        self.assertTrue(deck_import_media.media_path(asset).startswith('/api/media/images/'))
        deck_import_media.store_media(asset)
        self.assertEqual(self.upload.call_count, 0)

    def test_local_import_stores_images_and_audio_in_local_media_root(self):
        from pathlib import Path
        with SyntheticDirectory() as directory, patch.dict('os.environ', {
                'LERNE_MODE': 'LOCAL', 'VERCEL': '', 'VERCEL_ENV': '',
                'ENVIRONMENT': '', 'NODE_ENV': ''}):
            for name, content, role, folder in (
                    ('image.png', image(), 'image', 'images'),
                    ('audio.wav', audio(), 'audio_front', 'audio')):
                with self.subTest(folder=folder):
                    asset = deck_import_media.prepare_media(name, content, role)
                    destination = Path(directory) / folder / asset['filename']
                    with patch('api.local_runtime.media_file', return_value=destination) as path:
                        self.assertTrue(deck_import_media.storage_configured())
                        self.assertEqual(deck_import_media.media_path(asset), f"/api/media/{folder}/{asset['filename']}")
                        deck_import_media.store_media(asset)
                        path.assert_called_once_with(folder, asset['filename'])
                        self.assertEqual(destination.read_bytes(), asset['data'])
            self.assertEqual(self.upload.call_count, 0)
