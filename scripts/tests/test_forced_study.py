"""Study/SRS regression tests; only the shared in-memory SQLite fixture is used."""
import asyncio
import datetime
import importlib
import json
import subprocess
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from test_offline_sync import database, models, TABLES, ROOT, services
from api import srs

cards = importlib.import_module('api.services.cards')
study = importlib.import_module('api.services.study')
services.get_next_card = cards.get_next_card
services.update_card_progress = study.update_card_progress
router = importlib.import_module('api.routers.study')
NOW = datetime.datetime(2026, 10, 5, 12)


class ForcedStudyTests(unittest.TestCase):
    def setUp(self):
        database.create_tables(TABLES)
        models.TMAUser.create(user_id=1)
        self.deck = models.TMA_Deck.create(user_id=1, name='Study')
        self.cards = [models.TMA_Card.create(deck=self.deck, front_text=str(i), back_text='x', position=i) for i in range(3)]
        for card in self.cards:
            models.TMAProgress.create(card_id=card.id, user_id=1, queue='review', interval=10,
                last_reviewed=NOW - datetime.timedelta(days=2), next_review=datetime.datetime.now() + datetime.timedelta(days=8))

    def tearDown(self):
        database.drop_tables(TABLES)

    def test_forced_pass_visits_future_cards_once_and_finishes(self):
        self.assertIsNone(cards.get_next_card(1, self.deck.id)[0])
        seen = []
        for _ in self.cards:
            card, _ = cards.get_next_card(1, self.deck.id, exclude_ids=seen, review_context='forced')
            self.assertNotIn(card.id, seen)
            seen.append(card.id)
            study.update_card_progress(card.id, 1, 0 if len(seen) == 1 else 2, review_context='forced')
        self.assertIsNone(cards.get_next_card(1, self.deck.id, exclude_ids=seen, review_context='forced')[0])
        self.assertEqual(set(seen), {c.id for c in self.cards})
        failed = models.TMAProgress.get(models.TMAProgress.card_id == seen[0])
        self.assertEqual((failed.queue, failed.lapses), ('relearning', 1))
        self.assertEqual(models.TMAReviewHistory.select().count(), 3)
        # Exclusions belong to the traversal only; the normal SRS retains relearning.
        self.assertEqual(cards.get_next_card(1, self.deck.id)[0].id, seen[0])

    def test_grade_route_uses_context_and_session_exclusions(self):
        async def response(card, progress, user_id, review_context='scheduled'):
            return {'id': card.id, 'context': review_context}
        seen = [self.cards[0].id, self.cards[1].id]
        with patch.object(router, '_card_to_response', response):
            request = router.StudyGradeRequest(card_id=seen[-1], deck_id=self.deck.id, grade=2,
                review_context='forced', exclude_ids=seen)
            result = asyncio.run(router.submit_grade(request, user_id=1))
        self.assertEqual(result, {'id': self.cards[2].id, 'context': 'forced'})

    def test_forced_order_ignores_queue_and_due_date(self):
        positions = [20, 10, 10]
        queues = ['new', 'review', 'relearning']
        for card, position, queue in zip(self.cards, positions, queues):
            card.position = position
            card.save()
            models.TMAProgress.update(queue=queue).where(models.TMAProgress.card_id == card.id).execute()
        deleted = models.TMA_Card.create(deck=self.deck, front_text='deleted', back_text='x', position=0, is_deleted=True)
        other_deck = models.TMA_Deck.create(user_id=1, name='Other')
        models.TMA_Card.create(deck=other_deck, front_text='other', back_text='x', position=0)
        seen = []
        while True:
            card, _ = cards.get_next_card(1, self.deck.id, exclude_ids=seen, review_context='forced')
            if not card:
                break
            self.assertNotIn(card.id, seen)
            seen.append(card.id)
        self.assertEqual(seen, [self.cards[1].id, self.cards[2].id, self.cards[0].id])
        self.assertNotIn(deleted.id, seen)
        card, _ = cards.get_next_card(1, self.deck.id, exclude_ids=[self.cards[1].id], review_context='forced')
        self.assertEqual(card.id, self.cards[2].id)
        card, _ = cards.get_next_card(1, self.deck.id, learn_more=True)
        self.assertEqual(card.id, self.cards[1].id)

    def test_grade_route_rejects_other_users_and_cross_deck_cards(self):
        from fastapi import HTTPException
        request = router.StudyGradeRequest(card_id=self.cards[0].id, deck_id=self.deck.id, grade=2)
        with self.assertRaises(HTTPException):
            asyncio.run(router.submit_grade(request, user_id=2))
        other = models.TMA_Deck.create(user_id=1, name='Other')
        request.deck_id = other.id
        with self.assertRaises(HTTPException):
            asyncio.run(router.submit_grade(request, user_id=1))
        self.assertEqual(models.TMAReviewHistory.select().count(), 0)

    def test_history_failure_rolls_back_srs(self):
        before = models.TMAProgress.get(models.TMAProgress.card_id == self.cards[0].id)
        with patch.object(models.TMAReviewHistory, 'create', side_effect=RuntimeError('history failed')):
            with self.assertRaises(RuntimeError):
                study.update_card_progress(self.cards[0].id, 1, 0, review_context='forced')
        after = models.TMAProgress.get_by_id(before.id)
        self.assertEqual((after.queue, after.interval, after.lapses), (before.queue, before.interval, before.lapses))


class SrsParityTests(unittest.TestCase):
    def test_scheduled_formula_matches_the_original_python_engine(self):
        # Fixed pre-change outputs, without random fuzz.
        for interval, overdue, expected in [
            (1, 0, [5, 10, 1, 2, 3, 4, 5, 7]),
            (10, 0, [5, 6, 12, 18, 25, 29, 33, 48]),
            (10, 2, [5, 6, 12, 20, 28, 34, 39, 57]),
        ]:
            p = SimpleNamespace(queue='review', interval=interval, ease_factor=2.5, lapses=2,
                next_review=NOW - datetime.timedelta(days=overdue))
            self.assertEqual([s[1] for s in srs._get_review_8_states(p, NOW)], expected)

    def test_python_javascript_states_and_forced_updates_match(self):
        fixtures = []
        expected = []
        fields = ['queue', 'interval', 'step_index', 'ease_factor', 'lapses', 'repetitions', 'next_review', 'last_reviewed']
        for interval in [1, 3, 5, 10, 25, 50, 365]:
            for elapsed in [0, 0.25, 2, interval, interval + 8]:
                for ef in [1.3, 2.5, 3.0]:
                    data = dict(queue='review', interval=interval, ease_factor=ef, lapses=2, repetitions=4, step_index=None,
                        next_review=NOW + datetime.timedelta(days=interval - elapsed), last_reviewed=NOW - datetime.timedelta(days=elapsed))
                    p = SimpleNamespace(**data, save=lambda: None)
                    for context in ['scheduled', 'forced']:
                        states = srs._get_review_8_states(p, NOW, review_context=context)
                        fixtures.append({'progress': {k: v.isoformat() + 'Z' if isinstance(v, datetime.datetime) else v for k,v in data.items()}, 'context': context})
                        expected.append([list(state) for state in states])
        code = """
import { getReview8States, calculateCardReview } from './app/src/utils/srsEngine.js';
let raw = ''; for await (const chunk of process.stdin) raw += chunk;
const now = new Date('2026-10-05T12:00:00Z');
const states = JSON.parse(raw).map(f => getReview8States(f.progress, false, f.context, now).map(s =>
 [s.queue, s.interval, s.stepIndex, s.easeFactor, s.lapses, s.isDays]));
console.log(JSON.stringify(states));
"""
        result = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT,
            input=json.dumps(fixtures), text=True, capture_output=True, check=True)
        self.assertEqual(json.loads(result.stdout), expected)
        # Full updates for every grade, including new/learning/relearning repetitions.
        fixtures, expected = [], []
        for queue in ['new', 'learning', 'relearning', 'review']:
            for grade in range(8):
                data = dict(queue=queue, interval=10, ease_factor=2.5, lapses=2, repetitions=4, step_index=0,
                    next_review=NOW + datetime.timedelta(days=8), last_reviewed=NOW - datetime.timedelta(days=2))
                p = SimpleNamespace(**data, save=lambda: None)
                srs.review_card(p, grade, is_extended=True, review_context='forced', now=NOW)
                expected.append({k: getattr(p,k).isoformat() + 'Z' if isinstance(getattr(p,k), datetime.datetime) else getattr(p,k) for k in fields})
                fixtures.append({'progress': {k: v.isoformat() + 'Z' if isinstance(v, datetime.datetime) else v for k,v in data.items()}, 'grade': grade})
        code = """
import { calculateCardReview } from './app/src/utils/srsEngine.js';
let raw = ''; for await (const chunk of process.stdin) raw += chunk;
const fields = ['queue','interval','step_index','ease_factor','lapses','repetitions','next_review','last_reviewed'];
console.log(JSON.stringify(JSON.parse(raw).map(f => {
 const p = calculateCardReview(f.progress, f.grade, true, 'forced', new Date('2026-10-05T12:00:00Z'));
 return Object.fromEntries(fields.map(k => [k, typeof p[k] === 'string' ? p[k].replace('.000Z','Z') : p[k]]));
})));
"""
        result = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT,
            input=json.dumps(fixtures), text=True, capture_output=True, check=True)
        self.assertEqual(json.loads(result.stdout), expected)


if __name__ == '__main__':
    unittest.main()
