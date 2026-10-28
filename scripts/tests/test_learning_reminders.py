"""Personal learning/reminders over disposable SQLite; no network or real bot."""
import asyncio
import datetime
import json
import io
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
import textwrap
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import FastAPI, Header
from fastapi.testclient import TestClient
from peewee import SqliteDatabase

from api import models
from api.dependencies.auth import get_user_id
from api.routers import bot, decks, settings
from api.services import decks as deck_service, reminder_service as reminders


class LearningReminderTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[2] / 'local/test-data/reminders'
        root.mkdir(parents=True, exist_ok=True)
        self.path = root / f'{uuid4().hex}.sqlite3'
        self.db = SqliteDatabase(str(self.path), check_same_thread=False, thread_safe=False)
        self.previous = models.tma_db.obj, models.lerne_db.obj
        models.tma_db.initialize(self.db)
        models.lerne_db.initialize(self.db)
        self.db.create_tables([models.TMAUser, models.TMASetting, models.TMA_Folder,
            models.TMA_Deck, models.TMA_Card, models.TMAProgress, models.TMA_Collaborator,
            models.TMAAuthAccount, models.TMAAuthIdentity, models.Deck, models.Card,
            models.LibraryCategory])
        for uid in (101, 202, 303):
            models.TMAUser.create(user_id=uid, is_guest=False, default_decks_initialized=True)
            models.TMAAuthAccount.create(user=uid)
        self.folder = models.TMA_Folder.create(user_id=303, name='Published', access_scope='global_readonly')
        self.deck = models.TMA_Deck.create(user_id=303, folder=self.folder, name='Shared lesson',
            metadata=json.dumps({'intro': {'title': 'Preserved'}}))
        self.cards = [models.TMA_Card.create(deck=self.deck, front_text=str(i), back_text='Synthetic')
                      for i in range(4)]
        self.bot = SimpleNamespace(bot=SimpleNamespace(send_message=AsyncMock()))
        app = FastAPI()
        def fixture_user(x_test_user: int = Header(default=101)):
            return x_test_user
        app.dependency_overrides[get_user_id] = fixture_user
        for module in (decks, settings, bot):
            app.include_router(module.router, prefix='/api')
        self.client = TestClient(app)
        self.addCleanup(self.cleanup)

    def cleanup(self):
        self.client.close()
        self.db.close()
        models.tma_db.initialize(self.previous[0])
        models.lerne_db.initialize(self.previous[1])
        self.path.unlink(missing_ok=True)

    def toggle(self, uid, value=None):
        return self.client.post(f'/api/decks/{self.deck.id}/toggle-learning',
            headers={'X-Test-User': str(uid)}, json={} if value is None else {'is_learning': value})

    def link(self, uid=101):
        models.TMAAuthIdentity.create(account=uid, provider='telegram', subject=str(uid + 9000))

    def configure(self, **overrides):
        values = dict(enabled=True, timezone='UTC', frequency='custom', times=['08:00', '09:00'])
        values.update(overrides)
        self.assertTrue(reminders.save_user_reminder_settings(101, values))
        self.link()
        self.toggle(101, True)

    def cron(self):
        return asyncio.run(reminders.check_and_send_all_reminders(self.bot))

    def test_two_readers_persist_independently_without_content_or_progress_writes(self):
        before = models.TMA_Deck.get_by_id(self.deck.id).__data__.copy()
        card_before = [c.__data__.copy() for c in models.TMA_Card.select()]
        self.assertEqual(self.toggle(101).json()['is_learning'], True)
        self.assertEqual(self.toggle(202, True).json()['is_learning'], True)
        self.assertEqual(self.toggle(101).json()['is_learning'], False)
        # Same server source used by reload, re-login and a fresh device.
        with patch.object(deck_service, 'ensure_starter_decks'), \
                patch.object(deck_service, 'deduplicate_lid_folders'), \
                patch.object(deck_service, 'ensure_inbox_deck'):
            for uid, expected in ((101, False), (202, True)):
                response = self.client.get('/api/decks', headers={'X-Test-User': str(uid)})
                row = next(d for d in response.json() if d['id'] == self.deck.id)
                self.assertIs(row['is_learning'], expected)
                self.assertNotIn('is_learning', row['metadata'])
        self.assertEqual(models.TMA_Deck.get_by_id(self.deck.id).__data__, before)
        self.assertEqual([c.__data__ for c in models.TMA_Card.select()], card_before)
        self.assertEqual(models.TMAProgress.select().count(), 0)
        for uid in (101, 202):
            response = self.client.post(f'/api/decks/{self.deck.id}/metadata',
                headers={'X-Test-User': str(uid)}, json={'intro': 'forbidden'})
            self.assertEqual(response.status_code, 403)

    def test_shared_viewer_and_revoked_or_deleted_deck(self):
        self.folder.access_scope = 'private'
        self.folder.save()
        self.assertEqual(self.toggle(101, True).status_code, 404)
        grant = models.TMA_Collaborator.create(target_type='folder', target_id=self.folder.id,
            user_id=101, added_by=303, role='viewer')
        self.assertEqual(self.toggle(101, True).status_code, 200)
        self.assertEqual(reminders.get_user_due_summary(101)['total_active_decks'], 1)
        grant.delete_instance()
        self.assertEqual(reminders.get_user_due_summary(101)['total_active_decks'], 0)
        self.folder.access_scope = 'global_readonly'
        self.folder.save()
        self.deck.is_deleted = True
        self.deck.save()
        self.assertEqual(reminders.get_user_due_summary(101)['total_active_decks'], 0)

    def test_metadata_does_not_enable_owner_learning(self):
        self.deck.metadata = '{"is_learning":true}'
        self.deck.save()
        self.assertEqual(reminders.get_user_due_summary(303)['total_active_decks'], 0)
        with patch.object(deck_service, 'ensure_starter_decks'), \
                patch.object(deck_service, 'deduplicate_lid_folders'), \
                patch.object(deck_service, 'ensure_inbox_deck'):
            row = next(d for d in deck_service.get_active_decks(303) if d['id'] == self.deck.id)
            self.assertFalse(row['is_learning'])
            self.assertNotIn('is_learning', row['metadata'])
        self.assertTrue(self.toggle(303).json()['is_learning'])

    def test_metadata_updates_cannot_store_personal_learning(self):
        response = self.client.post(f'/api/decks/{self.deck.id}/metadata',
            headers={'X-Test-User': '303'}, json={'intro': {'title': 'Preserved'}, 'is_learning': True})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn('is_learning', json.loads(models.TMA_Deck.get_by_id(self.deck.id).metadata))
        self.assertFalse(models.TMASetting.select().where(models.TMASetting.key.startswith('DECK_LEARNING_')).exists())

    def test_summary_uses_only_current_users_srs_on_published_deck(self):
        self.toggle(101, True)
        self.toggle(202, True)
        now = datetime.datetime.now()
        for card, queue, when in ((self.cards[0], 'review', now - datetime.timedelta(days=1)),
                                  (self.cards[1], 'learning', now),
                                  (self.cards[2], 'review', now + datetime.timedelta(days=1))):
            models.TMAProgress.create(user_id=101, card_id=card.id, queue=queue, next_review=when)
        for card in self.cards:
            models.TMAProgress.create(user_id=202, card_id=card.id, queue='review', next_review=now)
        for uid, counts in ((101, (1, 1, 1)), (202, (4, 0, 0))):
            summary = reminders.get_user_due_summary(uid)
            self.assertEqual(tuple(summary[k] for k in ('total_due', 'total_learning', 'total_new')), counts)
            self.assertEqual(summary['deck_details'][0]['id'], self.deck.id)
        self.link()
        self.assertEqual(asyncio.run(reminders.send_reminder_to_user(self.bot, 101, force=True))['status'], 'success')
        message = self.bot.bot.send_message.call_args.kwargs['text']
        self.assertIn('🔴 1 повторить | 🟡 1 закрепить | 🔵 1 новых', message)
        self.toggle(101, False)
        self.assertEqual(reminders.get_user_due_summary(101)['total_active_decks'], 0)
        self.assertEqual(reminders.get_user_due_summary(202)['total_due'], 4)

    def test_settings_are_opt_in_and_existing_preferences_survive(self):
        self.assertFalse(reminders.get_user_reminder_settings(101)['enabled'])
        original = dict(enabled=True, frequency='hourly', times=['11:10'], hourly_start='10:00',
            hourly_end='18:00', quiet_enabled=True, quiet_start='22:30', quiet_end='07:15',
            timezone='Europe/Budapest', only_due=True)
        response = self.client.post('/api/user/reminder-settings', json=original)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(reminders.save_user_reminder_settings(101, {'times': ['12:10']}))
        actual = self.client.get('/api/user/reminder-settings').json()
        for key, value in {**original, 'times': ['12:10']}.items():
            self.assertEqual(actual[key], value)
        self.assertFalse(reminders.get_user_reminder_settings(202)['enabled'])
        self.assertTrue(reminders.save_user_reminder_settings(202, {'timezone_offset': 9, 'timezone': None}))
        self.assertEqual(reminders.get_user_reminder_settings(202)['timezone'], 'Asia/Tokyo')

    def test_verified_identity_required_even_for_test_and_positive_account_id(self):
        self.assertEqual(asyncio.run(reminders.send_reminder_to_user(self.bot, 101, force=True))['status'], 'skipped')
        self.assertFalse(reminders.get_user_reminder_diagnostics(101)['telegram_linked'])
        self.assertEqual(models.TMAAuthIdentity.select().count(), 0)
        self.bot.bot.send_message.assert_not_called()
        self.link()
        self.assertEqual(asyncio.run(reminders.send_reminder_to_user(self.bot, 101))['status'], 'skipped')
        self.assertEqual(asyncio.run(reminders.send_reminder_to_user(self.bot, 101, force=True))['status'], 'success')
        self.assertEqual(self.bot.bot.send_message.call_args.kwargs['chat_id'], 9101)
        self.assertFalse(reminders.get_user_reminder_settings(101)['enabled'])
        models.TMAAuthAccount.update(disabled_at=datetime.datetime.now()).where(models.TMAAuthAccount.user == 101).execute()
        self.assertEqual(asyncio.run(reminders.send_reminder_to_user(self.bot, 101, force=True))['status'], 'skipped')

    def test_cron_repeated_and_overlapping_runs_do_not_duplicate(self):
        self.configure(times=['09:00', '08:00', '09:00'])
        async def overlap(**_kwargs):
            result = await reminders.check_and_send_all_reminders(self.bot)
            self.assertEqual(result['results']['sent'], 0)
        self.bot.bot.send_message.side_effect = overlap
        self.assertEqual(self.cron()['results']['sent'], 1)
        self.assertEqual(self.cron()['results']['sent'], 0)
        self.assertEqual(self.bot.bot.send_message.await_count, 1)

    def test_uncertain_telegram_error_does_not_resend_same_slot(self):
        self.configure()
        self.bot.bot.send_message.side_effect = TimeoutError('synthetic uncertain delivery')
        self.assertEqual(self.cron()['results']['errors'], 1)
        self.assertEqual(self.cron()['results']['errors'], 0)
        self.assertEqual(self.bot.bot.send_message.await_count, 1)

    def test_quiet_hours_minutes_and_only_due_filter(self):
        self.configure(quiet_enabled=True, quiet_start='09:30', quiet_end='10:30')
        self.assertEqual(self.cron()['results']['sent'], 0)
        reminders.save_user_reminder_settings(101, {'quiet_enabled': False, 'only_due': True})
        self.assertEqual(self.cron()['results']['sent'], 0)
        self.bot.bot.send_message.assert_not_called()

    def test_timezone_hourly_and_next_slot_continue_to_work(self):
        self.configure(timezone='Europe/Budapest', frequency='hourly', hourly_start='10:00', hourly_end='12:00')
        self.assertEqual(self.cron()['results']['sent'], 1)  # 11:00 local, 10:00 UTC
        self.assertEqual(reminders.get_user_reminder_diagnostics(101)['next_reminder_slot'], 'Сегодня в 12:00')
        self.assertEqual(self.cron()['results']['sent'], 0)

    def test_cron_headers_fail_closed_without_dispatch(self):
        with patch.dict(os.environ, {'REMINDER_CRON_TOKEN': 'synthetic-cron', 'CRON_SECRET': ''}), \
                patch.object(bot, 'ptb_app', None), \
                patch.object(bot.services, 'check_and_send_all_reminders', new=AsyncMock()) as dispatch:
            for method in ('get', 'post'):
                request = getattr(self.client, method)
                self.assertEqual(request('/api/bot/cron-reminders').status_code, 403)
                self.assertEqual(request('/api/bot/cron-reminders', headers={'Authorization': 'Bearer wrong'}).status_code, 403)
                for headers in ({'Authorization': 'Bearer synthetic-cron'}, {'X-Internal-Cron-Token': 'synthetic-cron'}):
                    self.assertEqual(request('/api/bot/cron-reminders', headers=headers).json()['status'], 'skipped')
            dispatch.assert_not_called()

    def test_workflow_detects_json_errors_without_contacting_endpoint(self):
        workflow = (Path(__file__).resolve().parents[2] / '.github/workflows/reminder-cron.yml').read_text(encoding='utf-8')
        script = textwrap.dedent(workflow.split("python - <<'PY'\n", 1)[1].split('\n          PY', 1)[0])
        for payload, succeeds in (({'status': 'ok', 'results': {'sent': 1, 'errors': 0}}, True),
                                  ({'status': 'ok', 'results': {'errors': 1}}, False),
                                  ({'status': 'error'}, False), ({'status': 'skipped'}, False)):
            with self.subTest(payload=payload), \
                    patch('builtins.open', return_value=io.StringIO(json.dumps(payload))), \
                    patch('sys.stdout', new=io.StringIO()):
                if succeeds:
                    exec(script, {})
                else:
                    with self.assertRaises(SystemExit):
                        exec(script, {})


# Freeze only the service clock: deterministic UTC schedules, no real delivery.
_RealDateTime = datetime.datetime
class _Clock(_RealDateTime):
    @classmethod
    def now(cls, tz=None):
        value = _RealDateTime(2026, 10, 28, 10, 0, tzinfo=datetime.timezone.utc)
        return value.astimezone(tz) if tz else value.replace(tzinfo=None)


for _name in ('test_cron_repeated_and_overlapping_runs_do_not_duplicate',
              'test_uncertain_telegram_error_does_not_resend_same_slot',
              'test_quiet_hours_minutes_and_only_due_filter',
              'test_timezone_hourly_and_next_slot_continue_to_work'):
    setattr(LearningReminderTests, _name, patch.object(reminders.datetime, 'datetime', _Clock)(getattr(LearningReminderTests, _name)))
