"""Two disposable databases, simulated Storage, no credentials/network/SRS writes."""
import io
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
import wave

from fastapi import HTTPException
from peewee import SqliteDatabase
from PIL import Image

from api import models
from tools.admin.services.material_transfer import Endpoint, Transfer
from scripts.tests.test_local_dev import SyntheticDirectory

TABLES = [models.TMAUser, models.TMA_Folder, models.TMA_Deck, models.TMA_Card,
          models.TMA_Collaborator, models.TMAProgress, models.TMAReviewHistory,
          models.TMAOfflineBatch, models.TMAMedia, models.TMASetting]


class TransferTests(unittest.TestCase):
    def setUp(self):
        self.temp = SyntheticDirectory()
        self.addCleanup(self.temp.cleanup)
        self.media = Path(self.temp.name)
        self.local_db = SqliteDatabase(':memory:')
        self.cloud_db = SqliteDatabase(':memory:')
        self.local = Endpoint(self.local_db, 'LOCAL:fixture', 42, media_root=self.media)
        self.cloud = Endpoint(self.cloud_db, 'Supabase:fixture', 84,
                              storage={'url': 'https://fixture.supabase.co', 'key': 'fake-key'})
        for db, actor in ((self.local_db, 42), (self.cloud_db, 84)):
            models.tma_db.initialize(db); models.lerne_db.initialize(db)
            db.create_tables(TABLES)
            models.TMAUser.create(user_id=actor, is_guest=False)
            # Deliberate unrelated, overlapping IDs.
            folder = models.TMA_Folder.create(user_id=actor, name='Unrelated')
            deck = models.TMA_Deck.create(user_id=actor, name='Unrelated', folder=folder)
            models.TMA_Card.create(deck=deck, front_text='Unrelated', back_text='Unrelated', creator_id=actor)
        self.addCleanup(self.local_db.close)
        self.addCleanup(self.cloud_db.close)
        self.transfer = Transfer(self.local, self.cloud, allow_cloud_write=True)
        self.upload = patch('requests.post', return_value=Mock(status_code=201)).start()
        patch('requests.head', return_value=Mock(status_code=200, headers={'ETag': 'synthetic', 'Content-Length': '0'})).start()
        self.addCleanup(patch.stopall)

    def content(self, endpoint=None, count=2, public=False):
        endpoint = endpoint or self.local
        with endpoint.scope():
            folder = models.TMA_Folder.create(user_id=endpoint.user_id, name='A1 · Авторский курс',
                                              access_scope='global_readonly' if public else 'private')
            nested = models.TMA_Folder.create(user_id=endpoint.user_id, name='Раздел 1', parent=folder)
            deck = models.TMA_Deck.create(user_id=endpoint.user_id, name='Урок', folder=nested,
                metadata=json.dumps({'intro': {'title': 'Паспорт'}, 'pedagogy': {'schema_version': 1}, 'resources': []}))
            cards = [models.TMA_Card.create(deck=deck, creator_id=endpoint.user_id,
                front_text=f'Guten Tag {i}', back_text=f'Добрый день {i}', position=i,
                context='::task Изучите пример', tags='A1', metadata='{"custom":{"answer":"ja"}}') for i in range(count)]
            return folder.id, deck.id, [c.id for c in cards]

    def preview(self, kind, ids, direction='publish', **kwargs):
        options = dict(direction=direction, selection={'kind': kind, 'ids': ids}, mode='changed',
                       media_mode='changed', on_conflict='replace', decisions={}, destination_folder_id=None,
                       accept_conflicts=False, public_original=False)
        options.update(kwargs)
        return self.transfer.preview(options)

    def apply(self, plan):
        return self.transfer.apply(plan['id'], plan['token'], plan['target'])

    def target_id(self, kind, source, side='cloud'):
        return next(m[side] for m in self.transfer.ledger().values() if m['kind'] == kind and
                    m['local' if side == 'cloud' else 'cloud'] == source)

    def test_folder_deck_card_both_directions_and_id_isolation(self):
        with self.cloud.scope():
            for i in range(3): models.TMA_Deck.create(user_id=84, name=f'Cloud only {i}')
        for direction, endpoint in (('publish', self.local), ('download', self.cloud)):
            for kind in ('folder', 'deck', 'card'):
                with self.subTest(direction=direction, kind=kind):
                    folder, deck, cards = self.content(endpoint)
                    ids = [folder] if kind == 'folder' else [deck] if kind == 'deck' else [cards[0]]
                    plan = self.preview(kind, ids, direction)
                    result = self.apply(plan)
                    self.assertEqual(result['status'], 'complete')
                    target = self.cloud if direction == 'publish' else self.local
                    with target.scope():
                        self.assertEqual(models.TMA_Card.get_by_id(1).front_text, 'Unrelated')
                    again = self.preview(kind, ids, direction)
                    self.assertFalse(any(r['action'] in ('create', 'update', 'conflict') for r in again['rows']), again)
                    self.assertEqual(self.apply(plan)['result'], result['result'])

    def test_one_card_preserves_other_content_passport_and_srs(self):
        folder, deck, cards = self.content()
        self.apply(self.preview('folder', [folder]))
        target = self.target_id('card', cards[0])
        target_deck = self.target_id('deck', deck)
        with self.cloud.scope():
            models.TMA_Deck.update(metadata='{"intro":{"title":"Облачная правка"}}').where(models.TMA_Deck.id == target_deck).execute()
            progress = models.TMAProgress.create(user_id=84, card_id=target, repetitions=9, interval=21)
            before = dict(models.TMAProgress.get_by_id(progress.id).__data__)
            before_cards = [dict(c.__data__) for c in models.TMA_Card.select().where(models.TMA_Card.id != target)]
        with self.local.scope():
            models.TMA_Card.update(back_text='Исправлено').where(models.TMA_Card.id == cards[0]).execute()
        plan = self.preview('card', [cards[0]])
        self.assertTrue(plan['can_apply'])
        self.apply(plan)
        with self.cloud.scope():
            self.assertEqual(models.TMA_Card.get_by_id(target).back_text, 'Исправлено')
            self.assertEqual(dict(models.TMAProgress.get_by_id(progress.id).__data__), before)
            self.assertEqual([dict(c.__data__) for c in models.TMA_Card.select().where(models.TMA_Card.id != target)], before_cards)
            self.assertIn('Облачная правка', models.TMA_Deck.get_by_id(target_deck).metadata)

    def test_skip_missing_replace_copy_and_conflict_warning(self):
        folder, deck, cards = self.content()
        self.apply(self.preview('folder', [folder]))
        target = self.target_id('card', cards[0])
        with self.local.scope():
            models.TMA_Card.update(front_text='LOCAL correction').where(models.TMA_Card.id == cards[0]).execute()
        with self.cloud.scope():
            models.TMA_Card.update(back_text='CLOUD correction').where(models.TMA_Card.id == target).execute()
        plan = self.preview('card', [cards[0]])
        self.assertFalse(plan['can_apply'])
        with self.assertRaises(HTTPException): self.apply(plan)
        for opts in ({'on_conflict': 'skip'}, {'mode': 'missing'}):
            plan = self.preview('card', [cards[0]], **opts)
            self.apply(plan)
            with self.cloud.scope():
                self.assertEqual(models.TMA_Card.get_by_id(target).back_text, 'CLOUD correction')
        plan = self.preview('card', [cards[0]], accept_conflicts=True)
        self.apply(plan)
        with self.cloud.scope():
            self.assertEqual(models.TMA_Card.get_by_id(target).front_text, 'LOCAL correction')
            before = models.TMA_Card.select().count()
        plan = self.preview('card', [cards[0]], mode='force', on_conflict='new')
        self.apply(plan); self.apply(plan)
        with self.cloud.scope(): self.assertEqual(models.TMA_Card.select().count(), before + 1)
        self.assertEqual(self.target_id('card', cards[0]), target)

    def test_stale_source_and_destination_block_all_writes(self):
        folder, deck, cards = self.content()
        self.apply(self.preview('folder', [folder]))
        target = self.target_id('card', cards[0])
        for endpoint, identifier in ((self.local, cards[0]), (self.cloud, target)):
            plan = self.preview('card', [cards[0]], mode='force')
            with endpoint.scope():
                models.TMA_Card.update(context='Concurrent ' + str(identifier)).where(models.TMA_Card.id == identifier).execute()
            with self.assertRaises(HTTPException) as exc: self.apply(plan)
            self.assertEqual(exc.exception.status_code, 409)
            self.assertEqual(self.transfer.job(plan['id'])['status'], 'stale')

    def test_soft_deletion_move_and_order_with_permissions(self):
        folder, deck, cards = self.content()
        self.apply(self.preview('folder', [folder]))
        with self.local.scope():
            new_deck = models.TMA_Deck.create(user_id=42, name='Новая колода', folder=folder)
            models.TMA_Card.update(deck=new_deck, position=20).where(models.TMA_Card.id == cards[0]).execute()
            models.TMA_Card.update(is_deleted=True).where(models.TMA_Card.id == cards[1]).execute()
        self.apply(self.preview('folder', [folder]))
        moved, deleted = [self.target_id('card', c) for c in cards]
        with self.cloud.scope():
            self.assertEqual(models.TMA_Card.get_by_id(moved).position, 20)
            self.assertEqual(models.TMA_Card.get_by_id(moved).deck_id, self.target_id('deck', new_deck.id))
            self.assertTrue(models.TMA_Card.get_by_id(deleted).is_deleted)

    def test_public_viewer_download_and_write_denied(self):
        # Existing resolver permits study/copy, but protects the original from viewers.
        with self.cloud.scope(): models.TMAUser.create(user_id=99, is_guest=False)
        author = Endpoint(self.cloud_db, self.cloud.identity, 99, storage=self.cloud.storage)
        folder, deck, cards = self.content(author, public=True)
        self.apply(self.preview('folder', [folder], 'download'))
        local_id = self.target_id('card', cards[0], 'local')
        with self.local.scope():
            models.TMA_Card.update(front_text='Own edit').where(models.TMA_Card.id == local_id).execute()
        with self.assertRaises(HTTPException) as exc: self.preview('card', [local_id])
        self.assertEqual(exc.exception.status_code, 403)
        # Revocation after preview is rechecked at apply, even for unchanged content.
        own_folder, _, own_cards = self.content()
        plan = self.preview('folder', [own_folder])
        with self.local.scope(): models.TMA_Folder.update(user_id=99).where(models.TMA_Folder.id == own_folder).execute()
        with self.assertRaises(HTTPException): self.apply(plan)

    def test_cloud_write_gate_target_confirmation_and_no_secret_export(self):
        _, _, cards = self.content()
        self.transfer.allow_cloud_write = False
        plan = self.preview('card', [cards[0]])
        self.assertFalse(plan['can_apply'])
        with self.assertRaises(HTTPException): self.apply(plan)
        self.transfer.allow_cloud_write = True
        with self.assertRaises(HTTPException): self.transfer.apply(plan['id'], plan['token'], 'wrong-project')
        with self.local.scope():
            models.TMA_Card.update(metadata='{"api_key":"secret"}').where(models.TMA_Card.id == cards[0]).execute()
        with self.assertRaises(HTTPException): self.preview('card', [cards[0]])

    def test_transaction_rollback_and_response_loss_before_local_mapping(self):
        folder, deck, cards = self.content()
        plan = self.preview('folder', [folder])
        original = self.transfer.write_rows
        def fail(*args):
            original(*args)
            raise RuntimeError('synthetic failure')
        with patch.object(self.transfer, 'write_rows', side_effect=fail):
            with self.assertRaises(RuntimeError): self.apply(plan)
        with self.cloud.scope(): self.assertEqual(models.TMA_Card.select().count(), 1)
        with patch.object(self.transfer, 'save_maps', side_effect=RuntimeError('lost acknowledgement')):
            with self.assertRaises(RuntimeError): self.apply(plan)
        with self.cloud.scope(): self.assertEqual(models.TMA_Card.select().count(), 3)
        self.apply(plan)
        self.assertEqual(len(self.transfer.ledger()), 5)
        with self.cloud.scope(): self.assertEqual(models.TMA_Card.select().count(), 3)

    def test_image_audio_resources_dedup_and_changed_revision(self):
        folder, deck, cards = self.content()
        image = io.BytesIO(); Image.new('RGB', (20, 20), 'red').save(image, 'PNG')
        audio = io.BytesIO()
        with wave.open(audio, 'wb') as out:
            out.setparams((1, 1, 8000, 0, 'NONE', 'not compressed')); out.writeframes(b'\x80' * 800)
        for name, data in (('images/a.png', image.getvalue()), ('audio/a.wav', audio.getvalue())):
            path = self.media / name; path.parent.mkdir(exist_ok=True); path.write_bytes(data)
        with self.local.scope():
            models.TMA_Card.update(image_path='/api/media/images/a.png', audio_path='/api/media/audio/a.wav',
                                   context='![test](/api/media/images/a.png)').where(models.TMA_Card.id.in_(cards)).execute()
            models.TMA_Deck.update(metadata='{"resources":[{"type":"audio","url":"/api/media/audio/a.wav"}]}').where(models.TMA_Deck.id == deck).execute()
        plan = self.preview('folder', [folder]); self.assertEqual(len(plan['media']), 2)
        self.apply(plan); self.assertEqual(self.upload.call_count, 2)
        self.apply(self.preview('folder', [folder])); self.assertEqual(self.upload.call_count, 2)
        image = io.BytesIO(); Image.new('RGB', (20, 20), 'blue').save(image, 'PNG')
        (self.media / 'images/a.png').write_bytes(image.getvalue())
        plan = self.preview('folder', [folder]); self.apply(plan)
        self.assertEqual(self.upload.call_count, 3)
        target = self.target_id('card', cards[0])
        with self.cloud.scope():
            card = models.TMA_Card.get_by_id(target)
            self.assertIn('/storage/v1/object/public/images/import_', card.image_path)
            self.assertIn(card.image_path, card.context)
        # Arbitrary remote URLs and traversal cannot become a privileged fetch.
        with self.local.scope(): models.TMA_Card.update(image_path='https://evil.invalid/image.png').where(models.TMA_Card.id == cards[0]).execute()
        with self.assertRaises(HTTPException): self.preview('card', [cards[0]])

    def test_cloud_media_download_once_change_stale_and_storage_failure_retry(self):
        folder, deck, cards = self.content(self.cloud)
        image = io.BytesIO(); Image.new('RGB', (20, 20), 'green').save(image, 'PNG')
        remote = image.getvalue()
        uri = self.cloud.storage['url'] + '/storage/v1/object/public/images/a.png'
        with self.cloud.scope():
            models.TMA_Card.update(image_path=uri).where(models.TMA_Card.id.in_(cards)).execute()
        response = Mock(status_code=200, headers={'ETag': 'rev1', 'Content-Length': str(len(remote))})
        response.iter_content.return_value = [remote]
        response.__enter__ = Mock(return_value=response); response.__exit__ = Mock(return_value=False)
        with patch('requests.head', return_value=response) as head, patch('requests.get', return_value=response) as get:
            plan = self.preview('folder', [folder], 'download'); self.apply(plan)
            self.assertEqual(get.call_count, 1)
            self.apply(self.preview('folder', [folder], 'download'))
            self.assertEqual(get.call_count, 1)
            self.assertGreater(head.call_count, 0)
            for media in plan['media']:
                self.assertTrue((self.media / media['path'].removeprefix('/api/media/')).is_file())
            plan = self.preview('card', [cards[0]], 'download', mode='force')
            response.headers['ETag'] = 'rev2'
            with self.assertRaises(HTTPException) as exc: self.apply(plan)
            self.assertEqual(exc.exception.status_code, 409)
        # An upload error leaves all target content untouched; explicit retry
        # succeeds without creating new materials from the previous attempt.
        local_folder, _, local_cards = self.content()
        path = self.media / 'images/local.png'; path.write_bytes(remote)
        with self.local.scope(): models.TMA_Card.update(image_path='/api/media/images/local.png').where(models.TMA_Card.id == local_cards[0]).execute()
        plan = self.preview('folder', [local_folder])
        with self.cloud.scope(): before = models.TMA_Card.select().count()
        with patch('requests.post', return_value=Mock(status_code=503)):
            with self.assertRaises(HTTPException): self.apply(plan)
        with self.cloud.scope(): self.assertEqual(models.TMA_Card.select().count(), before)
        self.apply(plan)
        with self.cloud.scope(): self.assertEqual(models.TMA_Card.select().count(), before + 2)

    def test_permissions_editor_viewer_outsider_and_revocation(self):
        with self.cloud.scope(): models.TMAUser.create(user_id=99, is_guest=False)
        author = Endpoint(self.cloud_db, self.cloud.identity, 99, storage=self.cloud.storage)
        folder, deck, cards = self.content(author)
        with self.assertRaises(HTTPException): self.preview('folder', [folder], 'download')
        with self.cloud.scope(): models.TMA_Collaborator.create(target_type='folder', target_id=folder, user_id=84, role='editor')
        self.apply(self.preview('folder', [folder], 'download'))
        local_card = self.target_id('card', cards[0], 'local')
        with self.local.scope(): models.TMA_Card.update(front_text='Авторская правка').where(models.TMA_Card.id == local_card).execute()
        plan = self.preview('card', [local_card])
        with self.cloud.scope(): models.TMA_Collaborator.update(role='viewer').execute()
        with self.assertRaises(HTTPException) as exc: self.apply(plan)
        self.assertEqual(exc.exception.status_code, 403)

    def test_missing_media_keep_existing_and_embedded_image_freshness(self):
        _, _, cards = self.content()
        image = io.BytesIO(); Image.new('RGB', (20, 20), 'red').save(image, 'PNG')
        with self.local.scope(): models.TMA_Card.update(image_data=image.getvalue()).where(models.TMA_Card.id == cards[0]).execute()
        plan = self.preview('card', [cards[0]])
        self.assertEqual(len(plan['media']), 1)
        image = io.BytesIO(); Image.new('RGB', (20, 20), 'blue').save(image, 'PNG')
        with self.local.scope(): models.TMA_Card.update(image_data=image.getvalue()).where(models.TMA_Card.id == cards[0]).execute()
        with self.assertRaises(HTTPException): self.apply(plan)
        self.apply(self.preview('card', [cards[0]]))
        target = self.target_id('card', cards[0])
        with self.cloud.scope(): original = models.TMA_Card.get_by_id(target).image_path
        image = io.BytesIO(); Image.new('RGB', (20, 20), 'green').save(image, 'PNG')
        with self.local.scope(): models.TMA_Card.update(image_data=image.getvalue(), front_text='New text').where(models.TMA_Card.id == cards[0]).execute()
        self.apply(self.preview('card', [cards[0]], media_mode='missing'))
        with self.cloud.scope():
            self.assertEqual(models.TMA_Card.get_by_id(target).image_path, original)
            self.assertEqual(models.TMA_Card.get_by_id(target).front_text, 'New text')

    def test_move_out_of_selected_deck_and_folder_is_followed(self):
        folder, deck, cards = self.content()
        self.apply(self.preview('folder', [folder]))
        with self.local.scope():
            elsewhere = models.TMA_Folder.create(user_id=42, name='Вне выбранной папки')
            destination = models.TMA_Deck.create(user_id=42, folder=elsewhere, name='Другая колода')
            models.TMA_Card.update(deck=destination, position=7).where(models.TMA_Card.id == cards[0]).execute()
        self.apply(self.preview('deck', [deck]))
        with self.cloud.scope():
            self.assertEqual(models.TMA_Card.get_by_id(self.target_id('card', cards[0])).deck_id,
                             self.target_id('deck', destination.id))
        with self.local.scope():
            models.TMA_Deck.update(folder=elsewhere).where(models.TMA_Deck.id == deck).execute()
        self.apply(self.preview('folder', [folder]))
        with self.cloud.scope():
            self.assertEqual(models.TMA_Deck.get_by_id(self.target_id('deck', deck)).folder_id,
                             self.target_id('folder', elsewhere.id))

    def test_blob_checksum_catalog_is_compact_and_hard_delete_is_not_recreated(self):
        _, deck, cards = self.content(self.cloud)
        image = io.BytesIO(); Image.new('RGB', (20, 20), 'green').save(image, 'PNG')
        with self.cloud.scope():
            models.TMAMedia.create(folder='images', filename='blob.png', content=image.getvalue())
            models.TMA_Card.update(image_path='/api/media/images/blob.png').where(models.TMA_Card.id == cards[0]).execute()
        with patch('requests.get') as download:
            self.apply(self.preview('deck', [deck], 'download'))
            self.apply(self.preview('deck', [deck], 'download'))
            download.assert_not_called()
        result = self.cloud.catalog('card', parent_id=deck)
        self.assertEqual(len(result['items']), 2)
        self.assertEqual(set(result['items'][0]), {'id', 'name'})
        local_card = self.target_id('card', cards[0], 'local')
        with self.local.scope(): models.TMA_Card.delete().where(models.TMA_Card.id == local_card).execute()
        with self.assertRaises(HTTPException): self.preview('deck', [deck], 'download')

    def test_cloud_change_during_media_io_aborts_content_transaction(self):
        _, _, cards = self.content()
        self.apply(self.preview('card', [cards[0]]))
        target = self.target_id('card', cards[0])
        plan = self.preview('card', [cards[0]], mode='force')
        def concurrent_edit(*_):
            with self.cloud.scope(): models.TMA_Card.update(back_text='Newer cloud').where(models.TMA_Card.id == target).execute()
        with patch('tools.admin.services.material_transfer_media.apply_transfer_media', side_effect=concurrent_edit):
            with self.assertRaises(HTTPException) as exc: self.apply(plan)
        self.assertEqual(exc.exception.status_code, 409)
        with self.cloud.scope(): self.assertEqual(models.TMA_Card.get_by_id(target).back_text, 'Newer cloud')

    def test_publication_scope_overlapping_selection_and_newer_target_warning(self):
        folder, deck, cards = self.content()
        with self.local.scope(): nested = models.TMA_Deck.get_by_id(deck).folder_id
        with self.assertRaises(HTTPException): self.preview('folder', [folder], public_original=True)
        self.apply(self.preview('folder', [folder, nested]))
        target = self.target_id('card', cards[0])
        with self.cloud.scope(): models.TMA_Card.update(back_text='Newer cloud').where(models.TMA_Card.id == target).execute()
        plan = self.preview('card', [cards[0]], mode='force')
        self.assertFalse(plan['can_apply'])
        self.assertTrue(next(r for r in plan['rows'] if r['kind'] == 'card')['conflict'])

    def test_batched_snapshot_queries_and_unchanged_cards_are_not_updated(self):
        _, deck, cards = self.content(count=1)
        with patch.object(self.local_db, 'execute_sql', wraps=self.local_db.execute_sql) as query:
            self.local.selection({'kind': 'deck', 'ids': [deck]})
            small = query.call_count
        with self.local.scope():
            for i in range(50): models.TMA_Card.create(deck=deck, front_text=f'Extra {i}', back_text='Extra', creator_id=42)
        with patch.object(self.local_db, 'execute_sql', wraps=self.local_db.execute_sql) as query:
            self.local.selection({'kind': 'deck', 'ids': [deck]})
            self.assertEqual(query.call_count, small)
        self.apply(self.preview('deck', [deck]))
        repeat = self.preview('deck', [deck])
        with patch.object(self.cloud_db, 'execute_sql', wraps=self.cloud_db.execute_sql) as query:
            self.apply(repeat)
            updates = [str(call.args[0]).lower() for call in query.call_args_list if
                       str(call.args[0]).lower().startswith('update')]
            self.assertFalse(any('"tma_card"' in sql or '"tmaprogress"' in sql for sql in updates))

    def test_admin_publishes_readonly_original_and_interrupted_job_must_resume(self):
        folder, _, _ = self.content()
        with self.cloud.scope(): models.TMAUser.create(user_id=642478257, is_guest=False)
        self.cloud.user_id = 642478257
        self.transfer = Transfer(self.local, self.cloud, allow_cloud_write=True)
        self.apply(self.preview('folder', [folder]))
        public = self.preview('folder', [folder], public_original=True)
        root = next(row for row in public['rows'] if row['kind'] == 'folder' and row['source_id'] == folder)
        self.assertEqual(root['action'], 'update')
        self.assertEqual(root['before']['access_scope'], 'private')
        self.assertEqual(root['after']['access_scope'], 'global_readonly')
        self.apply(public)
        target = self.target_id('folder', folder)
        with self.cloud.scope():
            from api.services.collaborative_service import get_effective_user_role, _require_can_mutate
            self.assertEqual(models.TMA_Folder.get_by_id(target).access_scope, 'global_readonly')
            self.assertEqual(get_effective_user_role(84, 'folder', target), 'viewer')
            with self.assertRaises(HTTPException): _require_can_mutate(84, 'folder', target)
        plan = self.preview('folder', [folder], mode='force')
        with patch.object(self.transfer, 'save_maps', side_effect=RuntimeError('response lost')):
            with self.assertRaises(RuntimeError): self.apply(plan)
        from tools.admin.transfer_worker import execute
        with self.assertRaises(HTTPException) as exc:
            execute(self.transfer, {'command': 'preview', 'options': self.transfer.job(plan['id'])['options']})
        self.assertEqual(exc.exception.status_code, 409)
        self.apply(plan)

    def test_missing_storage_object_and_corrupted_staging_cache_are_repaired(self):
        _, _, cards = self.content()
        image = io.BytesIO(); Image.new('RGB', (20, 20), 'red').save(image, 'PNG')
        path = self.media / 'images/x.png'; path.parent.mkdir(exist_ok=True); path.write_bytes(image.getvalue())
        with self.local.scope(): models.TMA_Card.update(image_path='x.png').where(models.TMA_Card.id == cards[0]).execute()
        first = self.preview('card', [cards[0]]); self.apply(first)
        with patch('requests.head', return_value=Mock(status_code=404)):
            plan = self.preview('card', [cards[0]])
            self.assertEqual(len(plan['media']), 1)
            self.assertEqual(plan['counts']['unchanged'], 1)
            self.apply(plan)
        self.assertEqual(self.upload.call_count, 2)
        # A stale .partial file cannot wedge an explicit retry; a corrupt cached
        # prepared asset is replaced from the still-valid original source.
        cached = self.transfer.job(first['id'])['media'][0]['asset']
        asset_path = self.media / cached['folder'] / cached['filename']
        asset_path.write_bytes(b'corrupt')
        asset_path.with_suffix(asset_path.suffix + '.partial').write_bytes(b'interrupted')
        self.apply(self.preview('card', [cards[0]], mode='force'))
        import hashlib
        self.assertEqual(hashlib.sha256(asset_path.read_bytes()).hexdigest(), cached['sha256'])

    def test_oversized_folder_is_rejected_before_card_snapshots(self):
        folder, _, _ = self.content(count=3)
        from tools.admin.services.material_transfer import LIMITS
        original = self.local.rows
        kinds = []
        def rows(kind, identifiers, **kwargs):
            kinds.append(kind)
            return original(kind, identifiers, **kwargs)
        with patch.dict(LIMITS, {'card': 2}), patch.object(self.local, 'rows', side_effect=rows):
            with self.assertRaises(HTTPException) as error:
                self.preview('folder', [folder])
            self.assertEqual(error.exception.status_code, 413)
            self.assertIn('колод', error.exception.detail)
            self.assertNotIn('card', kinds)

    def test_destination_clock_is_used_for_cards_and_parent_sync_timestamps(self):
        _, deck, cards = self.content()
        with self.cloud.scope():
            if self.cloud_db.for_update:
                self.cloud_db.execute_sql("SET TIME ZONE 'UTC'")
        self.apply(self.preview('card', [cards[0]]))
        with self.cloud.scope():
            card = models.TMA_Card.get_by_id(self.target_id('card', cards[0]))
            parent = models.TMA_Deck.get_by_id(self.target_id('deck', deck))
            now = self.cloud_db.execute_sql('SELECT LOCALTIMESTAMP' if self.cloud_db.for_update else
                                            'SELECT CURRENT_TIMESTAMP').fetchone()[0]
            if isinstance(now, str):
                import datetime
                now = datetime.datetime.fromisoformat(now)
            self.assertEqual(card.updated_at, parent.updated_at)
            self.assertLess(abs((now - card.updated_at).total_seconds()), 5)


if __name__ == '__main__': unittest.main()
