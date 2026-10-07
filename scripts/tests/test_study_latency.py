"""Study latency contracts using the existing in-memory database fixture."""
import asyncio
import datetime
import importlib
import unittest
from unittest.mock import AsyncMock, patch

from test_offline_sync import database, models, TABLES, services
from test_forced_study import cards, study, router

media = importlib.import_module('api.services.media')


class StudyLatencyTests(unittest.TestCase):
    def setUp(self):
        database.create_tables([*TABLES, models.TMAMedia])
        models.TMAUser.create(user_id=1)
        self.deck = models.TMA_Deck.create(user_id=1, name='Latency')
        self.cards = [models.TMA_Card.create(deck=self.deck, front_text=f'Word {i}', back_text='Translation', position=i)
                      for i in range(3)]
        for card in self.cards:
            models.TMAProgress.create(card_id=card.id, user_id=1, queue='new', next_review=datetime.datetime.now())

    def tearDown(self):
        database.drop_tables([*TABLES, models.TMAMedia])

    def test_study_routes_return_missing_audio_without_waiting_for_tts(self):
        async def slow_audio(*_args):
            await asyncio.sleep(60)

        for endpoint in ['card', 'next', 'grade']:
            with self.subTest(endpoint=endpoint), patch.object(services, 'ensure_card_audio',
                    AsyncMock(side_effect=slow_audio), create=True) as tts, patch.object(
                    services, 'resolve_media_url', media.resolve_media_url, create=True), patch.object(
                    services, 'get_deck_stats_counts', return_value={}, create=True):
                if endpoint == 'card':
                    request = router.get_study_card(self.cards[0].id, user_id=1)
                elif endpoint == 'next':
                    request = router.get_next_card(self.deck.id, user_id=1)
                else:
                    request = router.submit_grade(router.StudyGradeRequest(
                        card_id=self.cards[0].id, deck_id=self.deck.id, grade=2), user_id=1)

                async def run():
                    return await asyncio.wait_for(request, timeout=2)

                result = asyncio.run(run())
                self.assertIn(result['id'], [card.id for card in self.cards])
                self.assertIsNone(result['audio_url'])
                tts.assert_not_awaited()
        self.assertEqual(models.TMAReviewHistory.select().count(), 1)
        progress = models.TMAProgress.get(models.TMAProgress.card_id == self.cards[0].id)
        self.assertIsNotNone(progress.last_reviewed)

    def test_grade_returns_exact_server_selection_after_saving_progress(self):
        selected = self.cards[2]
        progress = models.TMAProgress.get(models.TMAProgress.card_id == selected.id)
        with patch.object(services, 'get_next_card', return_value=(selected, progress)), patch.object(
                services, 'resolve_media_url', media.resolve_media_url, create=True), patch.object(
                services, 'get_deck_stats_counts', return_value={}, create=True):
            result = asyncio.run(router.submit_grade(router.StudyGradeRequest(
                card_id=self.cards[0].id, deck_id=self.deck.id, grade=2), user_id=1))
        self.assertEqual(result['id'], selected.id)
        self.assertEqual(models.TMAReviewHistory.select().count(), 1)

    def test_grade_save_only_commits_srs_without_selection_or_serialization(self):
        for duplicate in [False, True]:
            with self.subTest(duplicate=duplicate), patch.object(services, 'get_next_card') as select, patch.object(
                    services, 'get_next_duplicate_card', create=True) as select_duplicate, patch.object(
                    router, '_card_to_response', AsyncMock()) as serialize:
                payload = dict(card_id=self.cards[0].id, deck_id=self.deck.id, grade=2, return_next=False)
                if duplicate:
                    result = asyncio.run(router.submit_duplicate_grade(payload, user_id=1))
                else:
                    result = asyncio.run(router.submit_grade(router.StudyGradeRequest(**payload), user_id=1))
                self.assertEqual(result, {'status': 'success'})
                select.assert_not_called()
                select_duplicate.assert_not_called()
                serialize.assert_not_awaited()
        self.assertEqual(models.TMAReviewHistory.select().count(), 2)
        progress = models.TMAProgress.get(models.TMAProgress.card_id == self.cards[0].id)
        self.assertIsNotNone(progress.last_reviewed)

    def test_save_only_failure_rolls_back_and_access_checks_still_apply(self):
        from fastapi import HTTPException
        request = router.StudyGradeRequest(card_id=self.cards[0].id, deck_id=self.deck.id, grade=2, return_next=False)
        with self.assertRaises(HTTPException):
            asyncio.run(router.submit_grade(request, user_id=2))
        with patch.object(models.TMAReviewHistory, 'create', side_effect=RuntimeError('history failed')):
            with self.assertRaises(HTTPException):
                asyncio.run(router.submit_grade(request, user_id=1))
        self.assertEqual(models.TMAReviewHistory.select().count(), 0)
        progress = models.TMAProgress.get(models.TMAProgress.card_id == self.cards[0].id)
        self.assertIsNone(progress.last_reviewed)

    def test_card_list_batches_media_checks_and_preserves_missing_media(self):
        for card in self.cards:
            card.image_path = f'image-{card.id}.png'
            card.save()
        models.TMAMedia.create(filename=self.cards[0].image_path, folder='images', content=b'image')
        with patch.object(media, '_check_media_exists', side_effect=AssertionError('Per-card media query')), patch.object(
                database, 'execute_sql', wraps=database.execute_sql) as query:
            result = cards.get_cards_for_study(self.deck.id, 1)
        self.assertEqual(result[0]['image_url'], f'/api/media/images/{self.cards[0].image_path}')
        self.assertIsNone(result[1]['image_url'])
        media_queries = [call for call in query.call_args_list if 'FROM "tmamedia"' in call.args[0]]
        self.assertEqual(len(media_queries), 1)

    def test_card_list_exposes_topics_for_text_export_in_card_order(self):
        self.cards[0].topics = 'Adjektive'
        self.cards[0].save()
        self.cards[1].topics = 'Konjunktionen'
        self.cards[1].save()
        result = cards.get_cards_for_study(self.deck.id, 1)
        self.assertEqual([card['id'] for card in result], [card.id for card in self.cards])
        self.assertEqual([card['topics'] for card in result], ['Adjektive', 'Konjunktionen', None])


if __name__ == '__main__':
    unittest.main()
