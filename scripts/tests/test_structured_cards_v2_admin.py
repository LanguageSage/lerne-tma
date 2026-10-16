"""Admin/CLI writers against disposable SQLite only; DB owner replaced before imports.

Run separately with STRUCTURED_CARDS_V2_SCHEMA_READY=false and true.
AI/TTS, backups and persistent checkpoints are replaced with test implementations.
"""
import asyncio
import importlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

from fastapi import BackgroundTasks, HTTPException
from scripts.tests import test_structured_cards_v2_guards as fixtures

models, database = fixtures.models, fixtures.database
from tools.admin import schemas
from tools.admin.services import deck_helpers as helpers, regen_worker as worker, task_manager, card_helpers
from tools.admin.routers import cards, decks, tasks, classification
from tools.admin.services import classification_worker as cefr
from tools.admin.services import backup_service
import api.utils.audio as audio

EXTRA_TABLES = [models.LibraryCategory, models.Deck, models.Card]


class AdminGuardTests(unittest.TestCase):
    make_native = fixtures.StructuredWriteGuardTests.make_native
    blocked = fixtures.StructuredWriteGuardTests.blocked

    def setUp(self):
        fixtures.StructuredWriteGuardTests.setUp(self)
        database.create_tables(EXTRA_TABLES)
        self.lib = models.Deck.create(name='Library')
        self.lib_card = models.Card.create(id=1000, deck=self.lib, front_text='Library front', back_text='Old')
        for router in (cards, decks, tasks, classification):
            self.client.app.include_router(router.router)
        self.patches = [patch.object(task_manager, 'save_task_checkpoint', return_value=True),
                        patch.object(task_manager, 'register_task'), patch.object(task_manager, 'update_task_progress'),
                        patch.object(task_manager, 'load_task_checkpoint', return_value=None),
                        patch.object(backup_service, 'load_admin_config', return_value={'auto_backup_enabled': False}),
                        patch.object(worker, '_create_full_db_backup')]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)
        worker.regen_tasks.clear()
        cefr.regen_tasks.clear()
        self.ai_calls, self.tts_calls = [], []
        async def ai(**kwargs):
            self.assertFalse(database.in_transaction(), 'AI called inside transaction')
            self.ai_calls.append(kwargs)
            return dict(front=kwargs['phrase'] + ' new', back='Generated', context='Context', level='B1')
        async def tts(*args, **kwargs):
            self.assertFalse(database.in_transaction(), 'TTS called inside transaction')
            self.tts_calls.append((args, kwargs))
            return 'https://example.invalid/audio.mp3'
        self.ai = patch.object(worker.ai_service, 'generate_card_fields', side_effect=ai)
        self.tts = patch.object(audio, 'generate_audio', side_effect=tts)
        self.ai.start(); self.tts.start()
        self.addCleanup(self.ai.stop); self.addCleanup(self.tts.stop)

    def tearDown(self):
        database.drop_tables(list(reversed(EXTRA_TABLES)))
        fixtures.StructuredWriteGuardTests.tearDown(self)

    def snapshot(self):
        return {m._meta.table_name: database.execute_sql(
            f'SELECT * FROM "{m._meta.table_name}" ORDER BY 1').fetchall()
            for m in [*fixtures.TABLES, *EXTRA_TABLES]}

    def no_dml_blocked(self, operation):
        statements = []
        database.connection().set_trace_callback(statements.append)
        try:
            self.blocked(operation)
        finally:
            database.connection().set_trace_callback(None)
        self.assertFalse([s for s in statements if re.match(r'\s*(INSERT|UPDATE|DELETE)\b', s, re.I)])

    def task(self, identifier):
        data = dict(task_id=identifier, logs=[], status='pending', control='run')
        worker.regen_tasks[identifier] = data
        return data

    def run_worker(self, kind, deck_ids=None, **kwargs):
        ids = deck_ids or [str(self.deck.id)]
        if kind.startswith('batch'):
            cls = schemas.BatchRegenerateAudioRequest if kind.endswith('audio') else schemas.BatchRegenerateDeckRequest
            req = cls(deck_ids=ids, delay=0, **kwargs)
            identifier = kind
        else:
            cls = schemas.RegenerateAudioRequest if kind.endswith('audio') else schemas.RegenerateDeckRequest
            req = cls(delay=0, **kwargs)
            identifier = ids[0]
        data = self.task(identifier)
        fn = {'ai': worker.run_ai_regeneration, 'audio': worker.run_audio_regeneration,
              'batch_ai': worker.run_batch_ai_regeneration, 'batch_audio': worker.run_batch_audio_regeneration}[kind]
        asyncio.run(fn(identifier, req))
        return data

    def matching_copy(self, native=True, front=None):
        models.TMA_Deck.update(name=self.deck.name).where(models.TMA_Deck.id == self.other.id).execute()
        self.other = models.TMA_Deck.get_by_id(self.other.id)
        models.TMA_Card.update(front_text=front or self.legacy.front_text).where(models.TMA_Card.id == self.native.id).execute()
        if not native:
            database.execute_sql('UPDATE tma_card SET content_version=1, content_v2=NULL WHERE id=?', (self.native.id,))

    def test_legacy_update_delete_and_single_create_preserve_related_data(self):
        before = self.snapshot()
        response = self.client.put(f'/api/admin/cards/{self.legacy.id}', json={'front_text':'Edited','tags':'B1'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(models.TMA_Card.get_by_id(self.legacy.id).front_text, 'Edited')
        self.assertEqual(self.client.delete(f'/api/admin/cards/{self.legacy.id}').status_code, 200)
        self.assertTrue(models.TMA_Card.get_by_id(self.legacy.id).is_deleted)
        response = self.client.post(f'/api/admin/decks/{self.other.id}/cards', json={'front_text':'New','back_text':'A'})
        self.assertEqual(response.status_code, 200)  # insert does not touch unrelated V2
        after = self.snapshot()
        for table in ('tmaprogress','tmareviewhistory','tmamedia',models.TMAOfflineBatch._meta.table_name):
            self.assertEqual(before[table], after[table])

    def test_native_unknown_update_delete_audio_refuse_without_dml_or_calls(self):
        for version in (2, 99):
            self.make_native(self.native.id, version)
            for method, suffix, payload in [('put','','{}'),('delete','',None),('post','/synthesize-audio',None)]:
                before = self.snapshot()
                response = self.client.request(method, f'/api/admin/cards/{self.native.id}{suffix}',
                                               **({'json': json.loads(payload)} if payload else {}))
                self.assertEqual(response.status_code, 409, response.text)
                self.assertEqual(response.json()['detail']['code'], 'legacy_card_write_blocked')
                self.assertEqual(self.snapshot(), before)
        self.assertFalse(self.ai_calls or self.tts_calls)

    def test_library_card_model_update_delete_and_regeneration(self):
        self.assertEqual(cards.update_card_endpoint(1000, schemas.UpdateCardRequest(back_text='Updated'))['type'], 'library')
        for kind in ('ai','audio','batch_ai','batch_audio'):
            state = self.run_worker(kind, [f'lib_{self.lib.id}'], sync_copies=False)
            self.assertEqual(state['status'], 'completed')
        self.assertEqual(models.Card.get_by_id(1000).back_text, 'Generated')
        cards.delete_card_endpoint(1000)
        self.assertTrue(models.Card.get_by_id(1000).is_deleted)

    def test_legacy_all_four_workers(self):
        for kind in ('ai','audio','batch_ai','batch_audio'):
            with self.subTest(kind=kind):
                state = self.run_worker(kind, sync_copies=False)
                self.assertEqual(state['status'], 'completed', state)
                self.assertEqual(models.TMA_Card.get_by_id(self.legacy.id).audio_path, 'https://example.invalid/audio.mp3')
        self.assertTrue(self.ai_calls and self.tts_calls)

    def test_initial_mixed_batch_refuses_before_processing_or_media(self):
        for kind in ('ai','audio','batch_ai','batch_audio'):
            for version in (2, 77):
                self.make_native(self.native.id, version)
                ids = [str(self.deck.id), str(self.other.id)] if kind.startswith('batch') else [str(self.other.id)]
                before = self.snapshot()
                state = self.run_worker(kind, ids, sync_copies=False)
                self.assertEqual(state['status'], 'failed')
                self.assertEqual(state['error']['code'], 'legacy_card_write_blocked')
                self.assertEqual(self.snapshot(), before)
        self.assertFalse(self.ai_calls or self.tts_calls)

    def test_all_enqueue_routes_preflight_before_checkpoint_and_scheduling(self):
        for endpoint in ('regenerate','regenerate-audio'):
            self.no_dml_blocked(lambda: (decks.start_regeneration if endpoint=='regenerate' else decks.start_audio_regeneration_endpoint)(
                str(self.other.id), schemas.RegenerateDeckRequest() if endpoint=='regenerate' else schemas.RegenerateAudioRequest(), BackgroundTasks()))
        for fn, cls in ((decks.start_batch_regeneration, schemas.BatchRegenerateDeckRequest),
                        (decks.start_batch_audio_regeneration, schemas.BatchRegenerateAudioRequest)):
            self.no_dml_blocked(lambda: fn(cls(deck_ids=[str(self.deck.id),str(self.other.id)]), BackgroundTasks()))
        task_manager.register_task.assert_not_called()

    def test_exclusions_limits_ranges_target_ids_and_resume_match_preflight(self):
        extra = models.TMA_Card.create(deck=self.deck, front_text='V2', back_text='A', position=2)
        self.make_native(extra.id)
        opts = schemas.RegenerateDeckRequest(target_card_ids=[self.legacy.id], delay=0, no_audio=True)
        plan = worker.preflight_regeneration([str(self.deck.id)], opts)
        self.assertEqual([c.id for _,_,cs,_ in plan for c in cs], [self.legacy.id])
        for kwargs in ({'exclude_card_ids':[extra.id]}, {'exclude_range_str':'2-3'}, {'limit':1}):
            state = self.run_worker('ai', no_audio=True, **kwargs)
            self.assertEqual(state['status'], 'completed')
        self.blocked(lambda: worker.preflight_regeneration([str(self.deck.id)], schemas.RegenerateDeckRequest(start_card_idx=2)))

    def test_matching_front_helpers_guard_all_targets_before_library_or_tma_dml(self):
        self.matching_copy()
        ld = models.Deck.create(name=self.deck.name)
        models.Card.create(deck=ld, front_text=self.legacy.front_text, back_text='Untouched')
        self.no_dml_blocked(lambda: helpers.sync_card_updates_to_matching_decks(self.deck, self.legacy.front_text,'New','B','C'))
        self.no_dml_blocked(lambda: helpers.sync_card_audio_to_matching_decks(self.deck,self.legacy.front_text,'new.mp3'))

    def test_matching_front_initial_regen_and_bulk_preflight(self):
        self.matching_copy()
        before = self.snapshot()
        state = self.run_worker('ai', sync_copies=True)
        self.assertEqual(state['status'], 'failed')
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(self.ai_calls)
        req = schemas.BulkCreateCardsRequest(deck_id=str(self.deck.id), phrases=[self.legacy.front_text], sync_copies=True)
        self.no_dml_blocked(lambda: cards.start_bulk_card_creation_endpoint(req, BackgroundTasks()))

    def test_library_source_with_same_numeric_id_does_not_exclude_tma_target(self):
        lib = models.Deck.get_by_id(self.lib.id)
        lib.name = self.deck.name
        lib.save()
        self.make_native(self.legacy.id)
        self.no_dml_blocked(lambda: helpers.sync_card_audio_to_matching_decks(lib,self.legacy.front_text,'new.mp3'))

    def test_successful_copy_propagation_level_and_audio(self):
        self.matching_copy(native=False)
        models.TMA_Card.update(tags='topic,A1').where(models.TMA_Card.id == self.native.id).execute()
        state = self.run_worker('ai', sync_copies=True)
        self.assertEqual(state['status'], 'completed')
        target = models.TMA_Card.get_by_id(self.native.id)
        self.assertEqual((target.back_text,target.tags,target.audio_path), ('Generated','topic,B1','https://example.invalid/audio.mp3'))

    def test_ai_changes_version_mid_batch_no_partial_writes(self):
        second = models.TMA_Card.create(deck=self.deck, front_text='Second', back_text='Old', position=2)
        after_race = []
        async def ai(**kwargs):
            self.assertFalse(database.in_transaction())
            if kwargs['phrase'] == 'Second':
                self.make_native(second.id)
                after_race.append(self.snapshot())
            return dict(front='Changed',back='Generated',context='New')
        with patch.object(worker.ai_service,'generate_card_fields', side_effect=ai):
            state = self.run_worker('batch_ai', no_audio=True)
        self.assertEqual(state['status'], 'failed')
        self.assertEqual(self.snapshot(), after_race[0])

    def test_tts_changes_version_before_single_audio_write(self):
        after_race=[]
        async def tts(*args,**kwargs):
            self.assertFalse(database.in_transaction())
            self.make_native(self.legacy.id, 99)
            after_race.append(self.snapshot())
            return 'https://example.invalid/stale.mp3'
        with patch.object(audio,'generate_audio',side_effect=tts):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(cards.synthesize_single_card_audio(self.legacy.id))
        self.assertEqual(error.exception.status_code,409)
        self.assertEqual(self.snapshot(),after_race[0])

    def test_tts_race_in_all_workers_preserves_every_table_and_media(self):
        for kind in ('ai','audio','batch_ai','batch_audio'):
            database.execute_sql('UPDATE tma_card SET content_version=1,content_v2=NULL WHERE id=?',(self.legacy.id,))
            after_race=[]
            async def tts(*args,**kwargs):
                self.assertFalse(database.in_transaction())
                self.make_native(self.legacy.id)
                after_race.append(self.snapshot())
                return self.media_file
            with tempfile.TemporaryDirectory() as temp:
                self.media_file=str(Path(temp)/'late.mp3')
                Path(self.media_file).write_bytes(b'audio')
                with patch.object(audio,'generate_audio',side_effect=tts):
                    state=self.run_worker(kind,sync_copies=False)
                self.assertEqual(state['status'],'failed')
                self.assertEqual(self.snapshot(),after_race[0])
                self.assertTrue(Path(self.media_file).exists())

    def test_new_ai_front_matching_native_rejects_source_and_all_copies(self):
        self.matching_copy(front='Generated front')
        before=self.snapshot()
        async def ai(**kwargs):
            return dict(front='Generated front',back='B',context='C')
        with patch.object(worker.ai_service,'generate_card_fields',side_effect=ai):
            state=self.run_worker('ai',sync_copies=True,no_audio=True)
        self.assertEqual(state['status'],'failed')
        self.assertEqual(self.snapshot(),before)

    def test_copy_changes_version_during_tts_rejects_source_and_media(self):
        self.matching_copy(native=False)
        after_race=[]
        async def tts(*args,**kwargs):
            self.make_native(self.native.id)
            after_race.append(self.snapshot())
            return 'https://example.invalid/late.mp3'
        with patch.object(audio,'generate_audio',side_effect=tts):
            state=self.run_worker('audio',sync_copies=True)
        self.assertEqual(state['status'],'failed')
        self.assertEqual(self.snapshot(),after_race[0])

    def test_audio_targeted_update_preserves_concurrent_legacy_content(self):
        async def tts(*args,**kwargs):
            models.TMA_Card.update(front_text='Concurrent',metadata='kept').where(models.TMA_Card.id == self.legacy.id).execute()
            return 'https://example.invalid/audio.mp3'
        with patch.object(audio,'generate_audio',side_effect=tts):
            asyncio.run(cards.synthesize_single_card_audio(self.legacy.id))
        current=models.TMA_Card.get_by_id(self.legacy.id)
        self.assertEqual((current.front_text,current.metadata),('Concurrent','kept'))

    def test_dry_run_commit_mixed_batch_and_matching_copy_preflight(self):
        identifier='dry'
        state=self.task(identifier)
        state.update(sync_copies=False,dry_run_results=[dict(deck_id=str(c.deck_id),card_id=c.id,front='New',back='B',context='C')
                                                      for c in (self.legacy,self.native)])
        self.no_dml_blocked(lambda: decks.control_batch_regeneration(identifier,schemas.BatchControlRequest(action='commit_dry_run')))
        self.assertNotIn('committed_dry_run_card_ids',state)
        self.matching_copy()
        state['sync_copies']=True
        state['dry_run_results']=state['dry_run_results'][:1]
        self.no_dml_blocked(lambda: decks.control_batch_regeneration(identifier,schemas.BatchControlRequest(action='commit_dry_run')))

    def test_dry_run_and_single_commit_legacy_regression(self):
        state=self.run_worker('ai',dry_run=True,sync_copies=False)
        self.assertEqual(models.TMA_Card.get_by_id(self.legacy.id).front_text,self.legacy.front_text)
        response=decks.control_regeneration(str(self.deck.id),schemas.ControlRegenRequest(action='commit_dry_run'))
        self.assertEqual(response['committed_count'],1)
        self.assertEqual(models.TMA_Card.get_by_id(self.legacy.id).back_text,'Generated')
        self.make_native(self.legacy.id)
        self.no_dml_blocked(lambda: decks.control_regeneration(str(self.deck.id),schemas.ControlRegenRequest(action='commit_dry_run')))

    def test_bulk_creation_existing_and_new_library_and_user_decks(self):
        for options in ({'deck_id':str(self.deck.id)}, {'new_deck_name':'New user'},
                        {'new_deck_name':'New library','is_library':True}, {'new_deck_name':'Default','is_default':True,'user_id':1}):
            req=schemas.BulkCreateCardsRequest(phrases=['One','Two'],delay=0,**options)
            state=self.task('bulk')
            before=models.TMA_Card.select().count()+models.Card.select().count()
            asyncio.run(worker.run_bulk_card_creation('bulk',req))
            self.assertEqual(state['status'],'completed',state)
            self.assertEqual(models.TMA_Card.select().count()+models.Card.select().count(),before+2)
            self.assertNotIn('None',req.deck_id)

    def test_bulk_ai_new_front_conflict_does_not_create_deck_or_cards(self):
        self.matching_copy(front='New front')
        before=self.snapshot()
        async def ai(**kwargs):
            return dict(front='New front',back='B',context='C')
        req=schemas.BulkCreateCardsRequest(new_deck_name=self.deck.name,phrases=['One','Two'],sync_copies=True,generate_audio=False,delay=0)
        state=self.task('bulk')
        with patch.object(worker.ai_service,'generate_card_fields',side_effect=ai):
            asyncio.run(worker.run_bulk_card_creation('bulk',req))
        self.assertEqual(state['status'],'failed')
        self.assertEqual(self.snapshot(),before)

    def test_bulk_initial_mixed_matching_fronts_refuses_all_before_calls(self):
        self.matching_copy()
        req=schemas.BulkCreateCardsRequest(deck_id=str(self.deck.id),phrases=['Other',self.legacy.front_text],sync_copies=True,delay=0)
        state=self.task('bulk');before=self.snapshot()
        asyncio.run(worker.run_bulk_card_creation('bulk',req))
        self.assertEqual(state['status'],'failed')
        self.assertFalse(self.ai_calls or self.tts_calls)
        self.assertEqual(self.snapshot(),before)

    def test_resume_and_retry_refuse_before_checkpoint_registration(self):
        checkpoint=dict(task_type='single_ai',deck_id=str(self.other.id),options={})
        with patch.object(task_manager,'load_task_checkpoint',return_value=checkpoint):
            self.no_dml_blocked(lambda: tasks.resume_task_endpoint(BackgroundTasks()))
        self.no_dml_blocked(lambda: tasks.retry_failed_cards_endpoint(
            schemas.RetryFailedCardsRequest(card_ids=[self.native.id],deck_ids=[str(self.other.id)]),BackgroundTasks()))
        task_manager.register_task.assert_not_called()

    def test_uncommitted_resume_uses_original_indices(self):
        checkpoint=dict(task_type='single_ai',deck_id=str(self.deck.id),options={'no_audio':True},
                        current_card_idx=9,commit_pending=True)
        background=BackgroundTasks()
        with patch.object(task_manager,'load_task_checkpoint',return_value=checkpoint):
            result=tasks.resume_task_endpoint(background)
        self.assertEqual(result['resumed_from_card'],1)
        self.assertEqual(background.tasks[0].args[1].start_card_idx,1)

    def test_deduplicate_native_unknown_and_legacy_regression(self):
        duplicate=models.TMA_Card.create(deck=self.deck,front_text=self.legacy.front_text,back_text='Dup',position=2)
        self.make_native(duplicate.id,99)
        self.no_dml_blocked(lambda: decks.deduplicate_deck_cards(str(self.deck.id)))
        database.execute_sql('UPDATE tma_card SET content_version=1,content_v2=NULL WHERE id=?',(duplicate.id,))
        self.assertEqual(decks.deduplicate_deck_cards(str(self.deck.id))['removed_duplicates'],1)
        self.assertTrue(models.TMA_Card.get_by_id(duplicate.id).is_deleted)

    def test_classification_mutation_preflight_but_audit_remains_readonly(self):
        self.no_dml_blocked(lambda: classification.start_classification(schemas.ClassificationRequest(mode='run'),BackgroundTasks()))
        self.no_dml_blocked(lambda: classification.start_classification(schemas.ClassificationRequest(mode='dry_run'),BackgroundTasks()))
        cefr.preflight_classification(schemas.ClassificationRequest(mode='audit'))
        state=self.task('cefr');cefr.regen_tasks['cefr']=state
        before=self.snapshot()
        asyncio.run(cefr.run_classification_task('cefr',schemas.ClassificationRequest(mode='run')))
        self.assertEqual(state['status'],'failed')
        self.assertEqual(state['error']['code'],'legacy_card_write_blocked')
        self.assertEqual(self.snapshot(),before)

    def test_operator_migration_scripts_refuse_mixed_scope_before_transform_or_save(self):
        for name in ('scripts.migrate_lesson_cards','scripts.fix_b1_quiz_db'):
            module=importlib.import_module(name)
            argv=['script','--apply']
            argv += ['--folder-id',str(self.folder.id)]
            with patch.object(module,'initialize_database',return_value=True),patch.object(sys,'argv',argv):
                self.no_dml_blocked(module.main)

    def test_operator_regeneration_preflight_and_unsafe_media_path_blocked(self):
        module=importlib.import_module('scripts.regenerate_deck_single')
        argv=['script','--deck-id',str(self.other.id),'--yes','--no-audio']
        with patch.object(sys,'argv',argv),patch.object(database,'obj',database,create=True):
            # main imports database initialization lazily; fixture initialization is harmless.
            self.no_dml_blocked(lambda: asyncio.run(module.main()))

    def test_old_database_without_optional_columns_legacy_admin_still_works(self):
        if 'content_version' in models.TMA_Card._meta.fields:
            self.skipTest('schema-ready model requires its prepared schema')
        database.execute_sql('ALTER TABLE tma_card DROP COLUMN content_version')
        database.execute_sql('ALTER TABLE tma_card DROP COLUMN content_v2')
        database.execute_sql('ALTER TABLE tma_card DROP COLUMN card_revision')
        cards.update_card_endpoint(self.legacy.id,schemas.UpdateCardRequest(back_text='Old schema'))
        self.assertEqual(self.run_worker('ai',no_audio=True,sync_copies=False)['status'],'completed')
        cards.delete_card_endpoint(self.legacy.id)


if __name__ == '__main__':
    unittest.main()
