"""Automated tests for Stage 7.1 & 7.2 pure V1 -> JSON V2 card converter and dry-run diagnostics."""

from __future__ import annotations

import copy
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.update(VERCEL='1', RUN_MIGRATIONS='false', FORCE_LOCAL_DB='false')

from api.card_core.lerne_card_core.answer_contract import GradingPolicy
from api.services.answer_rules import evaluate_deterministic
from api.card_core.lerne_card_core.structured_cards_import import (
    import_documents,
)
from api.card_core.lerne_card_core.structured_cards_legacy import (
    to_legacy_card,
    to_legacy_document,
)
from api.card_core.lerne_card_core.structured_cards_v2 import (
    Deck,
    load_document,
)
from api.v1_to_v2_converter import (
    V1ConversionError,
    convert_v1_card,
    convert_v1_document,
    convert_v1_snapshot,
    decode_v2_content,
    format_dry_run_summary,
    inspect_v1_card,
    main as cli_main,
    run_v1_migration_dry_run,
)

FIXTURES = ROOT / 'tests' / 'fixtures'
V2_FIXTURES = FIXTURES / 'structured_cards_v2'


def _forbid_db(*_args, **_kwargs):
    raise AssertionError('V1 -> V2 converter must not connect to or query the database')


class V1ToV2ConverterTests(unittest.TestCase):
    def setUp(self):
        self.db_patches = [
            patch('peewee.Database.connect', side_effect=_forbid_db),
            patch('peewee.Database.execute_sql', side_effect=_forbid_db),
            patch('peewee.Database.cursor', side_effect=_forbid_db),
        ]
        for p in self.db_patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.db_patches):
            p.stop()

    def test_round_trip_all_nine_types_and_v2_fixtures(self):
        seen_types: set[str] = set()
        for name in ('basics.json', 'match.json', 'puzzle_quiz.json', 'word_bank_free_text.json'):
            doc = import_documents((V2_FIXTURES / name).read_text(encoding='utf-8'), json_input=True)[0]
            legacy_doc = to_legacy_document(doc)
            legacy_snapshot = copy.deepcopy(legacy_doc)

            converted_doc = convert_v1_document(legacy_doc)
            self.assertEqual(legacy_doc, legacy_snapshot, 'convert_v1_document must not mutate input')
            if name != 'word_bank_free_text.json':
                conv_dump = converted_doc.model_dump(mode='json')
                doc_dump = doc.model_dump(mode='json')
                for orig_c, conv_c in zip(doc_dump['cards'], conv_dump['cards']):
                    if orig_c.get('layout') is None and conv_c.get('layout') is not None:
                        orig_c['layout'] = conv_c['layout']
                self.assertEqual(
                    conv_dump,
                    doc_dump,
                    f'round-trip mismatch for fixture {name}',
                )
            else:
                # word_bank_free_text.json has duplicate "habe" at indices 0 and 2 referenced
                # as 2 then 0 in the fixture; V1 projection stores text answers and re-consumes
                # duplicate options in canonical order 0 then 2 while preserving the exact gap words.
                orig_wb = doc.cards[0].data
                conv_wb = converted_doc.cards[0].data
                self.assertEqual(conv_wb.options, orig_wb.options)
                self.assertEqual(
                    [conv_wb.options[p.option] for p in conv_wb.parts if p.type == 'gap'],
                    [orig_wb.options[p.option] for p in orig_wb.parts if p.type == 'gap'],
                )
                conv_rest = [c.model_dump(mode='json') for c in converted_doc.cards[1:]]
                doc_rest = [c.model_dump(mode='json') for c in doc.cards[1:]]
                for orig_c, conv_c in zip(doc_rest, conv_rest):
                    if orig_c.get('layout') is None and conv_c.get('layout') is not None:
                        orig_c['layout'] = conv_c['layout']
                self.assertEqual(conv_rest, doc_rest)
                self.assertEqual(
                    convert_v1_document(to_legacy_document(converted_doc)).model_dump(mode='json'),
                    converted_doc.model_dump(mode='json'),
                )
            for card in converted_doc.cards:
                seen_types.add(card.type)

        # 9th type: editable_text fixture
        editable_raw = json.loads((FIXTURES / 'editable-cards.json').read_text(encoding='utf-8'))
        for idx, item in enumerate(editable_raw):
            front_str = item.get('front', item.get('front_text', ''))
            back_str = item.get('back', item.get('back_text', ''))
            v1_card = {
                'id': item['id'],
                'front_text': front_str,
                'back_text': back_str,
                'context': item.get('context', ''),
                'card_type': item.get('card_type'),
                'level': 'B1',
                'topics': ['Schreiben'],
                'metadata': item.get('metadata', {}),
            }
            before = copy.deepcopy(v1_card)
            content_v2 = convert_v1_card(v1_card)
            self.assertEqual(v1_card, before)
            decoded = decode_v2_content(content_v2)
            self.assertEqual(decoded.type, 'editable_text')
            self.assertEqual(decoded.data.correct_text, back_str)
            seen_types.add(decoded.type)

            # Round-trip editable_text via to_legacy_card -> convert_v1_card
            legacy_editable = to_legacy_card(decoded, Deck(name='editable'), idx)
            reconverted = convert_v1_card(legacy_editable)
            self.assertEqual(reconverted, content_v2)

        self.assertEqual(
            seen_types,
            {
                'theory',
                'standard',
                'trainer',
                'quiz',
                'match',
                'puzzle',
                'word_bank',
                'free_text',
                'editable_text',
            },
        )

    def test_complex_cards_preserve_info_answers_explanations_and_metadata(self):
        # Complex trainer with all 4 info blocks, mixed input/choice gaps, back_note, explanation,
        # CEFR metadata, custom tags, comma-containing structured_topics, source_id, and image_ref.
        v1_card = {
            'id': 501,
            'deck_id': 77,
            'source_id': 'trainer-complex-1',
            'image_ref': 'media/wohnung.png',
            'front_text': (
                '::task\nErgänzen Sie den Satz.\n\n'
                '::source\nAus einem Gespräch.\n\n'
                '::example\nAls ich ankam, war er schon da.\n\n'
                '::options\nAls | Wenn | hatte | habe\n\n'
                '::exercise\n{*Als|Wenn} ich nach Hause [[kam|ankam]], [[hatte]] er schon gekocht.'
            ),
            'back_text': 'Когда я пришёл домой, он уже приготовил еду.',
            'context': '::level B1\nPlusquamperfekt zeigt Vorzeitigkeit.',
            'tags': 'B1, grammar, past-tense',
            'topics': 'Zeiten, Plusquamperfekt, Alltag',
            'metadata': json.dumps({
                'structured_topics': ['Zeiten, Plusquamperfekt', 'Alltag'],
                'cefr': {'level': 'B1', 'confidence': 0.92, 'source': 'author'},
                'author_note': 'keep-me',
            }),
            'audio_path': 'audio/501.mp3',
        }
        snapshot_copy = copy.deepcopy(v1_card)
        content_v2 = convert_v1_card(v1_card)
        self.assertEqual(v1_card, snapshot_copy, 'source card must not be mutated')

        card = decode_v2_content(content_v2)
        self.assertEqual(card.id, 'trainer-complex-1')
        self.assertEqual(card.type, 'trainer')
        self.assertEqual(card.level, 'B1')
        self.assertEqual(card.topics, ['Zeiten, Plusquamperfekt', 'Alltag'])
        self.assertEqual(card.image, 'media/wohnung.png')
        self.assertEqual([b.type for b in card.info], ['task', 'source', 'example', 'options'])
        self.assertEqual(card.info[3].items, ['Als', 'Wenn', 'hatte', 'habe'])
        self.assertEqual(card.data.back_note, 'Когда я пришёл домой, он уже приготовил еду.')
        self.assertEqual(card.explanation, 'Plusquamperfekt zeigt Vorzeitigkeit.')
        self.assertEqual(card.metadata['cefr']['level'], 'B1')
        self.assertEqual(card.metadata['cefr']['confidence'], 0.92)
        self.assertEqual(card.metadata['tags'], ['grammar', 'past-tense'])
        self.assertEqual(card.metadata['author_note'], 'keep-me')
        self.assertNotIn('structured_topics', card.metadata)

    def test_word_bank_consumable_duplicates_and_match_arrows(self):
        wb_card = {
            'front_text': (
                '::task\nWählen Sie die passenden Wörter.\n\n'
                '::exercise\n@wordbank\nIch sage <<g1>> und du sagst <<g2>>.\n'
                '@options\nja | ja | nein'
            ),
            'back_text': 'g1=ja\ng2=ja',
            'context': '::level A1\n::topic Dialog\nBeide Lücken brauchen "ja".',
        }
        wb_v2 = decode_v2_content(convert_v1_card(wb_card))
        self.assertEqual(wb_v2.type, 'word_bank')
        self.assertEqual(wb_v2.data.options, ['ja', 'ja', 'nein'])
        self.assertEqual(wb_v2.explanation, 'Beide Lücken brauchen "ja".')

        match_card = {
            'front_text': (
                '@match\n'
                'Apfel => apple => fruit\n'
                'kommen => sein\n'
                'gehen => sein'
            ),
            'back_text': 'Примечание к парам',
            'context': '::level A2\n::topic Verben\nHilfsverben und Nomen.',
        }
        match_v2 = decode_v2_content(convert_v1_card(match_card))
        self.assertEqual(match_v2.type, 'match')
        self.assertEqual(len(match_v2.data.pairs), 3)
        self.assertEqual(match_v2.data.pairs[0].right, 'apple => fruit')
        self.assertEqual(match_v2.data.back_note, 'Примечание к парам')
        self.assertEqual(match_v2.explanation, 'Hilfsverben und Nomen.')

    def test_quiz_boundaries_and_compact_labels_fixtures(self):
        boundaries = json.loads((FIXTURES / 'quiz_boundaries.json').read_text(encoding='utf-8'))
        deck_defaults = {'level': 'A2', 'topic': 'Grammatik'}
        formats = {
            'checkboxes': lambda text, i, correct: f"{'[*]' if i == correct else '[ ]'} {text}",
            'letters': lambda text, i, correct: f"{chr(65 + i)}){'*' if i == correct else ''}{text}",
            'numbers': lambda text, i, correct: f"{i + 1}. {'*' if i == correct else ''}{text}",
            'numberedParentheses': lambda text, i, correct: f"{'*' if i == correct else ''}{i + 1}){text}",
            'dottedLetters': lambda text, i, correct: f"{'*' if i == correct else ''}{chr(65 + i)}. {text}",
            'bullets': lambda text, i, correct: f"- {'*' if i == correct else ''}{text}",
            'circles': lambda text, i, correct: f"○ {'*' if i == correct else ''}{text}",
            'dots': lambda text, i, correct: f"• {'*' if i == correct else ''}{text}",
            'star': lambda text, i, correct: f"{'*' if i == correct else ''}{text}",
        }

        for fixture in boundaries['examples']:
            for fmt_name, render in formats.items():
                options_text = '\n'.join(
                    render(text, i, fixture['correct']) for i, text in enumerate(fixture['answers'])
                )
                front = fixture['preamble'] + fixture['question'] + fixture['gap'] + options_text
                with self.subTest(example=fixture['name'], format=fmt_name):
                    res = inspect_v1_card(
                        {'front_text': front, 'back_text': 'Пояснение к ответу'},
                        deck=deck_defaults,
                    )
                    self.assertTrue(res['ok'], f"expected valid quiz for {fixture['name']}/{fmt_name}: {res['diagnostics']}")
                    self.assertEqual(res['content_v2']['card']['type'], 'quiz')
                    self.assertEqual(
                        [o['text'] for o in res['content_v2']['card']['data']['options']],
                        fixture['answers'],
                    )

        for front in boundaries['ambiguous']:
            with self.subTest(ambiguous_front=front):
                res = inspect_v1_card(
                    {'front_text': front, 'back_text': 'Ответ', 'card_type': 'quiz'},
                    deck=deck_defaults,
                )
                self.assertFalse(res['ok'], f"expected diagnostic for ambiguous quiz: {front!r}")

        compact = json.loads((FIXTURES / 'quiz_compact_labels.json').read_text(encoding='utf-8'))
        for fmt_name in ('letters', 'numberedParentheses'):
            render = formats[fmt_name]
            options_text = '\n'.join(
                render(text, i, compact['correct']) for i, text in enumerate(compact['answers'])
            )
            front = f"{compact['question']}\n\n{options_text}"
            res = inspect_v1_card(
                {'front_text': front, 'back_text': 'Ответ'},
                deck=deck_defaults,
            )
            self.assertTrue(res['ok'], res['diagnostics'])
            self.assertEqual(res['content_v2']['card']['type'], 'quiz')
            self.assertEqual(
                [o['text'] for o in res['content_v2']['card']['data']['options']],
                compact['answers'],
            )

    def test_exercise_detection_corpus_divergences_are_diagnosed(self):
        corpus = json.loads((FIXTURES / 'exercise_detection_corpus.json').read_text(encoding='utf-8'))
        deck_defaults = {'level': 'B1', 'topic': 'Grammatik'}

        for entry in corpus['cards']:
            with self.subTest(corpus_id=entry['source_card_id']):
                res = inspect_v1_card(
                    {
                        'id': entry['source_card_id'],
                        'front_text': entry['front'],
                        'back_text': entry.get('back') or 'Fallback back',
                        'context': entry.get('context') or '',
                    },
                    deck=deck_defaults,
                )
                if entry.get('known_divergence'):
                    has_diag_or_warn = (not res['ok']) or bool(res['warnings'])
                    self.assertTrue(
                        has_diag_or_warn,
                        f"expected divergence diagnostic/warning on corpus #{entry['source_card_id']}",
                    )

    def test_diagnostic_codes_for_ambiguous_and_invalid_inputs(self):
        deck = {'level': 'B1', 'topic': 'Alltag'}

        cases = [
            (
                'null_byte_in_content',
                {'front_text': 'Hallo\x00Welt', 'back_text': 'Привет'},
            ),
            (
                'mixed_v1_v2_storage',
                {
                    'front_text': 'Hallo',
                    'back_text': 'Привет',
                    'content_v2': {'schema_version': 2, 'card': {}},
                },
            ),
            (
                'invalid_existing_content_v2',
                {'content_v2': {'schema_version': 2, 'card': {'type': 'unknown'}}},
            ),
            (
                'empty_front',
                {'front_text': '   ', 'back_text': 'Привет'},
            ),
            (
                'empty_back',
                {'front_text': 'Guten Tag', 'back_text': '   '},
            ),
            (
                'invalid_metadata_json',
                {'front_text': 'Guten Tag', 'back_text': 'Добрый день', 'metadata': '{bad json'},
            ),
            (
                'invalid_metadata_json',
                {'front_text': 'Guten Tag', 'back_text': 'Добрый день', 'metadata': '{"a": 1, "a": 2}'},
            ),
            (
                'inline_front_directive',
                {'front_text': '::level B1\nGuten Tag', 'back_text': 'Добрый день'},
            ),
            (
                'unknown_block_marker',
                {'front_text': '::hint\nTip\n\n::exercise\nGuten Tag', 'back_text': 'Добрый день'},
            ),
            (
                'invalid_context_directive',
                {'front_text': 'Guten Tag', 'back_text': 'Добрый день', 'context': '::task\nNot allowed here'},
            ),
            (
                'info_after_exercise',
                {
                    'front_text': '::exercise\nGuten Tag\n\n::source\nNach dem Exercise',
                    'back_text': 'Добрый день',
                },
            ),
            (
                'unmarked_preamble_before_directive',
                {
                    'front_text': '::exercise\nSammeln Sie den Satz.\n\n@puzzle\nIch gehe heute nach Hause.',
                    'back_text': 'Я иду сегодня домой.',
                },
            ),
            (
                'multiple_exercise_blocks',
                {
                    'front_text': '::exercise\nErster Teil\n\n::exercise\nZweiter Teil',
                    'back_text': 'Ответ',
                },
            ),
            (
                'card_type_mismatch',
                {
                    'front_text': 'Guten Morgen',
                    'back_text': 'Доброе утро',
                    'card_type': 'quiz',
                },
            ),
            (
                'unconverted_blank_placeholder',
                {
                    'front_text': 'Ich ___ gestern im Kino.',
                    'back_text': 'war',
                },
            ),
            (
                'ambiguous_puzzle_delimiters',
                {
                    'front_text': '@puzzle\nIch / gehe / nach / Hause',
                    'back_text': 'Я иду домой',
                },
            ),
            (
                'ambiguous_quiz_or_mixed_markers',
                {
                    'front_text': 'Ich [[gehe]] nach Hause.\n\n*gehe\ngehst',
                    'back_text': 'gehe',
                },
            ),
            (
                'invalid_trainer_structure',
                {
                    'front_text': 'Ich {*war|War!} gestern dort.',
                    'back_text': 'war',
                },
            ),
            (
                'invalid_quiz_structure',
                {
                    'front_text': 'Was passt?\n\n*Option A\n*Option B\nOption C',
                    'back_text': 'Option A',
                },
            ),
            (
                'invalid_match_structure',
                {
                    'front_text': '@match\nNur eine Zeile => one line',
                    'back_text': '',
                },
            ),
            (
                'invalid_word_bank_structure',
                {
                    'front_text': '@wordbank\nIch sage <<a1>> und <<a2>>.\n@options\nja | nein',
                    'back_text': 'a1=ja\na2=ja',
                },
            ),
            (
                'ambiguous_free_text_policy',
                {
                    'front_text': '@free\nBeschreiben Sie Ihre Wohnung.',
                    'back_text': 'Meine Wohnung ist hell und ruhig.',
                    'metadata': '{}',
                },
            ),
            (
                'invalid_grading_policy',
                {
                    'front_text': '@edit\nIch gehen nach Hause.',
                    'back_text': 'Ich gehe nach Hause.',
                    'metadata': json.dumps({'grading_policy': {'mode': 'open_text'}}),
                },
            ),
            (
                'invalid_editable_text_structure',
                {
                    'front_text': '@edit\nIch gehe nach Hause.',
                    'back_text': 'Ich gehe nach Hause.',
                },
            ),
            (
                'unexpected_answer_policy_metadata',
                {
                    'front_text': 'Guten Tag',
                    'back_text': 'Добрый день',
                    'metadata': json.dumps({'grading_policy': {'mode': 'exact'}}),
                },
            ),
            (
                'conflicting_level_sources',
                {
                    'front_text': 'Guten Tag',
                    'back_text': 'Добрый день',
                    'context': '::level A1\nHinweis',
                    'tags': 'B2',
                },
            ),
            (
                'conflicting_level_sources',
                {
                    'front_text': 'Guten Tag',
                    'back_text': 'Добрый день',
                    'tags': 'A1, B2',
                },
            ),
            (
                'conflicting_topic_sources',
                {
                    'front_text': 'Guten Tag',
                    'back_text': 'Добрый день',
                    'topics': 'Reisen',
                    'metadata': json.dumps({'structured_topics': ['Arbeit']}),
                },
            ),
            (
                'ambiguous_comma_topics',
                {
                    'front_text': 'Guten Tag',
                    'back_text': 'Добрый день',
                    'topics': 'Reisen, Urlaub',
                },
            ),
            (
                'forbidden_metadata_key',
                {
                    'front_text': 'Guten Tag',
                    'back_text': 'Добрый день',
                    'metadata': json.dumps({'prompt': 'shadow'}),
                },
            ),
        ]

        for expected_code, card in cases:
            with self.subTest(expected_code=expected_code):
                strict_policy = expected_code == 'ambiguous_free_text_policy'
                res = inspect_v1_card(card, deck=deck, require_explicit_free_text_policy=strict_policy)
                self.assertFalse(res['ok'], f'expected error {expected_code}, but card converted ok')
                codes = [d['code'] for d in res['diagnostics']]
                self.assertIn(expected_code, codes, f'expected {expected_code} in {codes}')
                with self.assertRaises(V1ConversionError) as ctx:
                    convert_v1_card(card, deck=deck, require_explicit_free_text_policy=strict_policy)
                self.assertIn(expected_code, [d.code for d in ctx.exception.diagnostics])

    def test_free_text_policy_explicit_vs_fallback_mode(self):
        deck = {'level': 'B1', 'topic': 'Wohnen'}
        card = {
            'front_text': '@free\nBeschreiben Sie Ihr Zimmer.',
            'back_text': 'Mein Zimmer hat ein großes Fenster.',
        }
        # By default (require_explicit_free_text_policy=False), missing policy safely converts to controlled_text with a warning.
        fallback_res = inspect_v1_card(card, deck=deck)
        self.assertTrue(fallback_res['ok'])
        self.assertEqual(
            fallback_res['content_v2']['card']['data']['grading_policy']['mode'],
            'controlled_text',
        )
        self.assertEqual(fallback_res['warnings'][0]['code'], 'implicit_free_text_policy')

        # Strict mode (require_explicit_free_text_policy=True) blocks missing policy.
        strict_res = inspect_v1_card(card, deck=deck, require_explicit_free_text_policy=True)
        self.assertFalse(strict_res['ok'])
        self.assertEqual(strict_res['diagnostics'][0]['code'], 'ambiguous_free_text_policy')

    def test_free_text_controlled_text_policy_v1_equivalence(self):
        deck = {'level': 'A2', 'topic': 'Einkaufen'}
        v1_card = {
            'id': 501,
            'deck_id': 10,
            'front_text': '::task\nПереведите на немецкий язык.\n::exercise\n@free\nЯ покупаю хлеб и молоко.',
            'back_text': 'Ich kaufe Brot und Milch.',
            'metadata': {'accepted_answers': ['Ich kaufe Brot und Milch']},
        }
        res = inspect_v1_card(v1_card, deck=deck)
        self.assertTrue(res['ok'], res['diagnostics'])
        self.assertEqual(res['warnings'][0]['code'], 'implicit_free_text_policy')

        v1_default_policy = GradingPolicy()
        v2_card = decode_v2_content(res['content_v2'])
        v2_policy = v2_card.data.grading_policy
        self.assertEqual(v1_default_policy.model_dump(mode='json'), v2_policy.model_dump(mode='json'))

        expected_answers = [v2_card.data.sample_answer, *v2_card.data.accepted_answers]
        sample_user_inputs = [
            'Ich kaufe Brot und Milch.',
            'ich kaufe brot und milch',
            'Ich kaufe Brot und Milch!',
            'Ich kaufe Brod und Milch.',
            'Ich trinke Wasser.',
            '',
        ]
        for user_input in sample_user_inputs:
            v1_eval = evaluate_deterministic(user_input, expected_answers, v1_default_policy)
            v2_eval = evaluate_deterministic(user_input, expected_answers, v2_policy)
            self.assertEqual(
                v1_eval.model_dump(mode='json') if v1_eval is not None else None,
                v2_eval.model_dump(mode='json') if v2_eval is not None else None,
                f'V1 vs V2 deterministic evaluation diverged for input {user_input!r}',
            )

    def test_legacy_translation_card_type_normalized_safely(self):
        deck = {'level': 'A1', 'topic': 'Begrüßung'}
        v1_card = {
            'id': 701,
            'deck_id': 1,
            'card_type': 'translation',
            'front_text': 'Guten Tag',
            'back_text': 'Добрый день',
        }
        res = inspect_v1_card(v1_card, deck=deck)
        self.assertTrue(res['ok'], res['diagnostics'])
        self.assertEqual(res['content_v2']['card']['type'], 'standard')
        self.assertEqual(res['warnings'][0]['code'], 'legacy_translation_card_type_normalized')

        # Non-standard card_type on standard content must still be blocked:
        mismatch_card = dict(v1_card, card_type='quiz')
        bad_res = inspect_v1_card(mismatch_card, deck=deck)
        self.assertFalse(bad_res['ok'])
        self.assertEqual(bad_res['diagnostics'][0]['code'], 'card_type_mismatch')

    def test_snapshot_conversion_on_lesson_qa_before_and_corrected_fixtures(self):
        before_raw = json.loads((FIXTURES / 'lesson-qa' / 'before.json').read_text(encoding='utf-8'))
        corrected_raw = json.loads((FIXTURES / 'lesson-qa' / 'corrected.json').read_text(encoding='utf-8'))

        before_report = run_v1_migration_dry_run(before_raw)
        self.assertFalse(before_report['ok'])
        self.assertEqual(before_report['checked'], {'decks': 14, 'cards': 678})
        self.assertEqual(before_report['total_cards'], 678)
        # With safe V1-equivalent conversion of free_text without grading_policy -> controlled_text:
        # 667 of 678 cards convert cleanly (61 with implicit_free_text_policy warning, 2 with puzzle_solution_in_translation),
        # while 11 genuinely broken cards and 6 incomplete deck passports remain blocked.
        self.assertEqual(before_report['converted_count'], 667)
        self.assertEqual(before_report['blocked_count'], 11)
        self.assertEqual(before_report['warning_counts_by_code'].get('implicit_free_text_policy'), 61)
        self.assertEqual(before_report['warning_counts_by_code'].get('puzzle_solution_in_translation'), 2)
        self.assertEqual(before_report['counts_by_code'].get('invalid_deck_passport'), 6)
        self.assertEqual(before_report['counts_by_code'].get('unmarked_preamble_before_directive'), 7)
        self.assertEqual(before_report['counts_by_code'].get('info_after_exercise'), 2)
        self.assertEqual(before_report['counts_by_code'].get('unconverted_blank_placeholder'), 1)
        self.assertEqual(before_report['counts_by_code'].get('empty_back'), 1)
        self.assertTrue(all(before_report['invariants'].values()))

        corrected_report = run_v1_migration_dry_run(corrected_raw)
        self.assertEqual(corrected_report['checked'], {'decks': 14, 'cards': 678})
        # All 14 decks in corrected.json have valid V2 passports:
        self.assertTrue(all(d['ok'] for d in corrected_report['decks']))
        self.assertEqual(corrected_report['blocked_deck_ids'], [])
        # In corrected.json, 668 of 678 cards convert cleanly; the remaining 10 blocked cards are:
        # - 7 @puzzle cards (30094..30096, 30204..30207) with unmarked preamble before @puzzle inside ::exercise
        # - 2 trainer cards (11201, 11202) carrying leftover free_text grading_policy/accepted_answers in metadata
        # - 1 card (30391) with an unconverted ___ blank in a standard card.
        self.assertEqual(corrected_report['converted_count'], 668)
        self.assertEqual(corrected_report['blocked_count'], 10)
        self.assertEqual(
            corrected_report['blocked_ids'],
            [30094, 30095, 30096, 30204, 30205, 30206, 30207, 30391, 11201, 11202],
        )
        self.assertEqual(
            corrected_report['counts_by_code'],
            {
                'unmarked_preamble_before_directive': 7,
                'unexpected_answer_policy_metadata': 2,
                'unconverted_blank_placeholder': 1,
            },
        )
        self.assertTrue(all(corrected_report['invariants'].values()))
        summary_text = format_dry_run_summary(corrected_report)
        self.assertIn('Cards total:   678 | Converted: 668', summary_text)
        self.assertIn('unmarked_preamble_before_directive: 7', summary_text)

    def test_dry_run_on_large_dataset_repeatability_and_invariants(self):
        corrected_raw = json.loads((FIXTURES / 'lesson-qa' / 'corrected.json').read_text(encoding='utf-8'))
        decks = copy.deepcopy(corrected_raw['decks'])
        large_cards: list[dict] = []
        next_id = 100000
        for rep in range(3):
            for pos, src_card in enumerate(corrected_raw['cards'], start=1):
                c = copy.deepcopy(src_card)
                c['id'] = next_id
                c['position'] = rep * 1000 + pos
                c['source_id'] = f"card-{rep}-{src_card['id']}"
                c['image_path'] = f"/media/images/{next_id}.webp"
                c['audio_path'] = f"/media/audio/{next_id}_front.mp3"
                c['audio_back_path'] = f"/media/audio/{next_id}_back.mp3"
                c['video_front_path'] = None
                c['video_back_path'] = None
                raw_meta = c.get('metadata')
                if isinstance(raw_meta, str):
                    meta = json.loads(raw_meta) if raw_meta.strip() else {}
                elif isinstance(raw_meta, dict):
                    meta = copy.deepcopy(raw_meta)
                else:
                    meta = {}
                meta['custom_batch_tag'] = f'batch-{rep}'
                c['metadata'] = meta
                large_cards.append(c)
                next_id += 1

        large_snapshot = {'decks': decks, 'cards': large_cards}
        self.assertEqual(len(large_cards), 2034)

        report_1 = run_v1_migration_dry_run(large_snapshot, include_converted_payloads=True)
        report_2 = run_v1_migration_dry_run(large_snapshot, include_converted_payloads=True)

        # Deterministic repeatability across runs:
        self.assertEqual(report_1, report_2)
        self.assertEqual(report_1['total_cards'], 2034)
        self.assertEqual(report_1['converted_count'], 668 * 3)
        self.assertEqual(report_1['blocked_count'], 10 * 3)
        self.assertEqual(
            report_1['invariants'],
            {
                'source_unmodified': True,
                'id_uniqueness_ok': True,
                'order_preserved': True,
                'metadata_preserved': True,
                'media_links_preserved': True,
                'v2_valid': True,
            },
        )
        # Verify order and media links on every card entry:
        self.assertEqual([c['card_id'] for c in report_1['cards']], [c['id'] for c in large_cards])
        self.assertEqual([c['position'] for c in report_1['cards']], [c['position'] for c in large_cards])
        for src, rep_card in zip(large_cards, report_1['cards']):
            self.assertEqual(rep_card['media']['image_path'], src['image_path'])
            self.assertEqual(rep_card['media']['audio_path'], src['audio_path'])
            self.assertEqual(rep_card['media']['audio_back_path'], src['audio_back_path'])
            if rep_card['ok']:
                self.assertEqual(
                    rep_card['content_v2']['card']['metadata']['custom_batch_tag'],
                    src['metadata']['custom_batch_tag'],
                )
                self.assertEqual(rep_card['content_v2']['card']['id'], src['source_id'])

    def test_dry_run_partially_corrupted_snapshot_and_id_uniqueness(self):
        base_deck = {
            'id': 1,
            'name': 'Wohnen A2',
            'level': 'A2',
            'topic': 'Wohnen',
        }
        snapshot = {
            'decks': [
                base_deck,
                {'id': 1, 'name': 'Duplicate Deck 1'},
            ],
            'cards': [
                # 0: Valid standard card with media & legacy card_type='translation'
                {
                    'id': 10,
                    'deck_id': 1,
                    'position': 1,
                    'source_id': 'w-01',
                    'card_type': 'translation',
                    'front_text': 'der Tisch',
                    'back_text': 'стол',
                    'image_path': 'https://cdn.example/tisch.webp',
                    'metadata': {'author_note': 'noun'},
                },
                # 1: Valid free_text card without grading_policy (auto-converted to controlled_text)
                {
                    'id': 11,
                    'deck_id': 1,
                    'position': 2,
                    'source_id': 'w-02',
                    'front_text': '@free\nBeschreiben Sie Ihren Tisch.',
                    'back_text': 'Mein Tisch ist aus Holz.',
                },
                # 2: Duplicate card_id (10)
                {
                    'id': 10,
                    'deck_id': 1,
                    'position': 3,
                    'source_id': 'w-03',
                    'front_text': 'der Stuhl',
                    'back_text': 'стул',
                },
                # 3: Missing card_id
                {
                    'deck_id': 1,
                    'position': 4,
                    'front_text': 'die Lampe',
                    'back_text': 'лампа',
                },
                # 4: Duplicate author source_id ('w-01') within deck 1
                {
                    'id': 14,
                    'deck_id': 1,
                    'position': 5,
                    'source_id': 'w-01',
                    'front_text': 'das Bett',
                    'back_text': 'кровать',
                },
                # 5: Duplicate position (1) within deck 1
                {
                    'id': 15,
                    'deck_id': 1,
                    'position': 1,
                    'source_id': 'w-05',
                    'front_text': 'der Schrank',
                    'back_text': 'шкаф',
                },
                # 6: Orphan deck_id (999)
                {
                    'id': 16,
                    'deck_id': 999,
                    'position': 6,
                    'front_text': 'das Sofa',
                    'back_text': 'диван',
                },
                # 7: Corrupted metadata JSON + null byte in another card
                {
                    'id': 17,
                    'deck_id': 1,
                    'position': 7,
                    'front_text': 'der Teppich\x00',
                    'back_text': 'ковёр',
                },
            ],
        }
        report = run_v1_migration_dry_run(snapshot, include_converted_payloads=True)
        self.assertFalse(report['ok'])
        self.assertEqual(report['total_decks'], 2)
        self.assertEqual(report['total_cards'], 8)
        self.assertEqual(report['converted_count'], 2)
        self.assertEqual(report['blocked_count'], 6)
        self.assertEqual(report['converted_ids'], [10, 11])
        self.assertFalse(report['invariants']['id_uniqueness_ok'])
        self.assertFalse(report['invariants']['order_preserved'])
        self.assertTrue(report['invariants']['source_unmodified'])
        self.assertTrue(report['invariants']['media_links_preserved'])
        self.assertTrue(report['invariants']['metadata_preserved'])

        for expected_err in (
            'duplicate_deck_id',
            'duplicate_card_id',
            'missing_card_id',
            'duplicate_author_card_id',
            'duplicate_card_position',
            'orphan_card_deck_id',
            'null_byte_in_content',
        ):
            self.assertIn(expected_err, report['reasons'], f'expected {expected_err} in {report["reasons"]}')

    def test_cli_convert_v1_subcommand(self):
        doc = import_documents((V2_FIXTURES / 'basics.json').read_text(encoding='utf-8'), json_input=True)[0]
        legacy_doc = to_legacy_document(doc)

        with tempfile.TemporaryDirectory() as tmp:
            legacy_path = Path(tmp) / 'legacy_basics.json'
            legacy_path.write_text(json.dumps(legacy_doc, ensure_ascii=False), encoding='utf-8')

            out = io.StringIO()
            err = io.StringIO()
            with patch('sys.stdout', out), patch('sys.stderr', err):
                rc = cli_main([str(legacy_path)])
            self.assertEqual(rc, 0, err.getvalue())
            parsed = json.loads(out.getvalue())
            doc_dump = doc.model_dump(mode='json')
            for orig_c, conv_c in zip(doc_dump['cards'], parsed['cards']):
                if orig_c.get('layout') is None and conv_c.get('layout') is not None:
                    orig_c['layout'] = conv_c['layout']
            self.assertEqual(parsed, doc_dump)

            # Test --dry-run and --summary on corrected.json
            report_path = Path(tmp) / 'dry_run_report.json'
            out_dry = io.StringIO()
            err_dry = io.StringIO()
            with patch('sys.stdout', out_dry), patch('sys.stderr', err_dry):
                rc_dry = cli_main([
                    str(FIXTURES / 'lesson-qa' / 'corrected.json'),
                    '--dry-run',
                    '--summary',
                    '--report-out',
                    str(report_path),
                ])
            self.assertEqual(rc_dry, 0, err_dry.getvalue())
            self.assertIn('V1 -> V2 Migration Dry-Run Summary', out_dry.getvalue())
            saved_report = json.loads(report_path.read_text(encoding='utf-8'))
            self.assertEqual(saved_report['converted_count'], 668)
            self.assertEqual(saved_report['blocked_count'], 10)

    def test_composite_tags_normalized_safely(self):
        deck = {'level': 'A1', 'topic': 'Wohnen'}
        card = {
            'id': 101,
            'deck_id': 1,
            'front_text': 'das Haus',
            'back_text': 'дом',
            'tags': '["german", "local-ai", "youtube"],A1',
        }
        res = inspect_v1_card(card, deck=deck)
        self.assertTrue(res['ok'], res['diagnostics'])
        self.assertEqual(res['content_v2']['card']['level'], 'A1')
        self.assertEqual(
            res['content_v2']['card']['metadata']['tags'],
            ['german', 'local-ai', 'youtube'],
        )

        # Empty array with level
        card_empty_tags = {
            'id': 102,
            'deck_id': 1,
            'front_text': 'die Wohnung',
            'back_text': 'квартира',
            'tags': '[],B1',
        }
        res_empty = inspect_v1_card(card_empty_tags, deck=deck)
        self.assertTrue(res_empty['ok'], res_empty['diagnostics'])
        self.assertEqual(res_empty['content_v2']['card']['level'], 'B1')

    def test_card_errors_not_masked_by_successful_invariants(self):
        """Verify Requirement 6: card errors are NEVER hidden by successful batch/invariant checks."""
        snapshot = {
            'decks': [
                {
                    'id': 1,
                    'name': 'Alltag A1',
                    'level': 'A1',
                    'topic': 'Alltag',
                }
            ],
            'cards': [
                # Card 1: valid standard card
                {
                    'id': 1,
                    'deck_id': 1,
                    'position': 1,
                    'source_id': 'c-01',
                    'front_text': 'Guten Morgen',
                    'back_text': 'Доброе утро',
                    'image_path': '/media/1.webp',
                    'metadata': {'author': 'admin'},
                },
                # Card 2: broken card (empty_back)
                {
                    'id': 2,
                    'deck_id': 1,
                    'position': 2,
                    'source_id': 'c-02',
                    'front_text': 'Guten Abend',
                    'back_text': '',
                    'image_path': '/media/2.webp',
                    'metadata': {'author': 'admin'},
                },
                # Card 3: valid standard card
                {
                    'id': 3,
                    'deck_id': 1,
                    'position': 3,
                    'source_id': 'c-03',
                    'front_text': 'Gute Nacht',
                    'back_text': 'Спокойной ночи',
                    'image_path': '/media/3.webp',
                    'metadata': {'author': 'admin'},
                },
            ],
        }
        report = run_v1_migration_dry_run(snapshot, allow_shared_positions=False)

        # Invariants regarding the batch remain True:
        self.assertTrue(report['invariants']['source_unmodified'])
        self.assertTrue(report['invariants']['id_uniqueness_ok'])
        self.assertTrue(report['invariants']['order_preserved'])
        self.assertTrue(report['invariants']['metadata_preserved'])
        self.assertTrue(report['invariants']['media_links_preserved'])
        self.assertTrue(report['invariants']['v2_valid'])

        # BUT overall report MUST be False because Card 2 failed:
        self.assertFalse(report['ok'])
        self.assertEqual(report['converted_count'], 2)
        self.assertEqual(report['blocked_count'], 1)
        self.assertEqual(report['converted_ids'], [1, 3])
        self.assertEqual(report['blocked_ids'], [2])
        self.assertIn('empty_back', report['reasons'])
        self.assertEqual(report['reasons']['empty_back']['card_ids'], [2])
        self.assertFalse(report['cards'][1]['ok'])
        self.assertEqual(report['cards'][1]['diagnostics'][0]['code'], 'empty_back')

    def test_allow_shared_positions_mode(self):
        snapshot = {
            'decks': [{'id': 1, 'name': 'Deck 1'}],
            'cards': [
                {'id': 1, 'deck_id': 1, 'position': 0, 'front_text': 'A', 'back_text': '1'},
                {'id': 2, 'deck_id': 1, 'position': 0, 'front_text': 'B', 'back_text': '2'},
            ],
        }
        # Strict mode (default): duplicate position fails
        strict_report = run_v1_migration_dry_run(snapshot, allow_shared_positions=False)
        self.assertFalse(strict_report['ok'])
        self.assertEqual(strict_report['blocked_count'], 1)
        self.assertIn('duplicate_card_position', strict_report['reasons'])

        # Shared positions mode: duplicate position converts with a warning
        shared_report = run_v1_migration_dry_run(snapshot, allow_shared_positions=True)
        self.assertTrue(shared_report['ok'])
        self.assertEqual(shared_report['converted_count'], 2)
        self.assertEqual(shared_report['blocked_count'], 0)
        self.assertIn('shared_card_position', shared_report['warnings_by_code'])

    def test_empty_back_audio_shadowing_converts_to_standard(self):
        deck = {'level': 'A1', 'topic': 'Aussprache'}
        v1_card = {
            'id': 5001,
            'deck_id': 10,
            'front_text': 'Guten Morgen, wie geht es Ihnen?',
            'back_text': '',
            'audio_path': 'uploads/audio/5001.mp3',
        }
        res = inspect_v1_card(v1_card, deck=deck)
        self.assertTrue(res['ok'], res['diagnostics'])
        self.assertIsNotNone(res['content_v2'])
        v2_card = decode_v2_content(res['content_v2'])
        self.assertEqual(v2_card.type, 'standard')
        self.assertEqual(v2_card.data.prompt, 'Guten Morgen, wie geht es Ihnen?')
        self.assertEqual(v2_card.data.answer, 'Guten Morgen, wie geht es Ihnen?')
        warning_codes = [w['code'] for w in res['warnings']]
        self.assertIn('single_sided_audio_card', warning_codes)

    def test_empty_back_audio_in_metadata_converts_to_standard(self):
        deck = {'level': 'A2', 'topic': 'Hörverstehen'}
        v1_card = {
            'id': 5002,
            'deck_id': 10,
            'front_text': 'Ich fahre morgen nach Berlin.',
            'back_text': '',
            'metadata': {'audio_filename': 'berlin.mp3'},
        }
        res = inspect_v1_card(v1_card, deck=deck)
        self.assertTrue(res['ok'], res['diagnostics'])
        v2_card = decode_v2_content(res['content_v2'])
        self.assertEqual(v2_card.type, 'standard')
        self.assertEqual(v2_card.data.answer, 'Ich fahre morgen nach Berlin.')
        warning_codes = [w['code'] for w in res['warnings']]
        self.assertIn('single_sided_audio_card', warning_codes)

    def test_empty_back_german_reading_passage_converts_to_theory(self):
        deck = {'level': 'B1', 'topic': 'Lesen'}
        prompt = 'Eine echte Alternative zur Reeperbahn! Übrigens: Ganz in der Nähe vom Hasselbrack befindet sich der Park.'
        v1_card = {
            'id': 5003,
            'deck_id': 11,
            'front_text': prompt,
            'back_text': '',
        }
        res = inspect_v1_card(v1_card, deck=deck)
        self.assertTrue(res['ok'], res['diagnostics'])
        v2_card = decode_v2_content(res['content_v2'])
        self.assertEqual(v2_card.type, 'theory')
        self.assertEqual(v2_card.data.text, prompt)
        self.assertEqual(v2_card.data.summary, '')
        warning_codes = [w['code'] for w in res['warnings']]
        self.assertIn('empty_back_converted_to_theory', warning_codes)
        self.assertIn('empty_back_theory_detector_bypass', warning_codes)

    def test_empty_back_russian_grammar_rule_converts_to_theory(self):
        deck = {'level': 'A1', 'topic': 'Grammatik'}
        prompt = 'Многие глаголы требуют дополнения в падеже аккузатив.'
        v1_card = {
            'id': 5004,
            'deck_id': 12,
            'front_text': prompt,
            'back_text': '',
        }
        res = inspect_v1_card(v1_card, deck=deck)
        self.assertTrue(res['ok'], res['diagnostics'])
        v2_card = decode_v2_content(res['content_v2'])
        self.assertEqual(v2_card.type, 'theory')
        self.assertEqual(v2_card.data.text, prompt)
        warning_codes = [w['code'] for w in res['warnings']]
        self.assertIn('empty_back_converted_to_theory', warning_codes)

    def test_empty_back_theory_deck_context_converts_to_theory(self):
        deck = {'name': 'Урок 1: Теория и правила', 'level': 'A1', 'topic': 'Regeln'}
        v1_card = {
            'id': 5005,
            'deck_id': 13,
            'front_text': 'Kurze Notiz',
            'back_text': '',
        }
        res = inspect_v1_card(v1_card, deck=deck)
        self.assertTrue(res['ok'], res['diagnostics'])
        v2_card = decode_v2_content(res['content_v2'])
        self.assertEqual(v2_card.type, 'theory')
        self.assertEqual(v2_card.data.text, 'Kurze Notiz')

    def test_empty_back_isolated_word_remains_strictly_blocked(self):
        deck = {'level': 'A1', 'topic': 'Wortschatz'}
        v1_card = {
            'id': 5006,
            'deck_id': 14,
            'front_text': 'Kaffeesonne',
            'back_text': '',
        }
        res = inspect_v1_card(v1_card, deck=deck)
        self.assertFalse(res['ok'])
        diag_codes = [d['code'] for d in res['diagnostics']]
        self.assertIn('empty_back', diag_codes)

    def test_empty_back_russian_fragment_remains_strictly_blocked(self):
        deck = {'level': 'A1', 'topic': 'Wortschatz'}
        v1_card = {
            'id': 5007,
            'deck_id': 14,
            'front_text': 'задание',
            'back_text': '',
        }
        res = inspect_v1_card(v1_card, deck=deck)
        self.assertFalse(res['ok'])
        diag_codes = [d['code'] for d in res['diagnostics']]
        self.assertIn('empty_back', diag_codes)

    def test_empty_back_with_explicit_translation_card_type(self):
        deck = {'level': 'A2', 'topic': 'Lesen'}
        prompt = 'Das ist eine interessante Geschichte über Hamburg und die Elbe.'
        v1_card = {
            'id': 5008,
            'deck_id': 15,
            'card_type': 'translation',
            'front_text': prompt,
            'back_text': '',
        }
        res = inspect_v1_card(v1_card, deck=deck)
        self.assertTrue(res['ok'], res['diagnostics'])
        v2_card = decode_v2_content(res['content_v2'])
        self.assertEqual(v2_card.type, 'theory')
        warning_codes = [w['code'] for w in res['warnings']]
        self.assertIn('legacy_card_type_reclassified_to_theory', warning_codes)
        self.assertIn('empty_back_converted_to_theory', warning_codes)

    def test_strict_empty_back_mode_blocks_classification(self):
        deck = {'level': 'A1', 'topic': 'Aussprache'}
        v1_audio_card = {
            'id': 5009,
            'deck_id': 16,
            'front_text': 'Guten Morgen!',
            'back_text': '',
            'audio_path': 'audio.mp3',
        }
        # In default mode: converts safely
        res_default = inspect_v1_card(v1_audio_card, deck=deck, classify_empty_back=True)
        self.assertTrue(res_default['ok'])

        # In strict mode: blocked with empty_back
        res_strict = inspect_v1_card(v1_audio_card, deck=deck, classify_empty_back=False)
        self.assertFalse(res_strict['ok'])
        diag_codes = [d['code'] for d in res_strict['diagnostics']]
        self.assertIn('empty_back', diag_codes)

    def test_legacy_default_card_type_normalized_for_interactive_and_theory_cards(self):
        deck = {'level': 'A1', 'topic': 'Grammatik'}
        
        # 1. card_type='standard' on @theory content converts cleanly to theory with warning
        theory_card = {
            'id': 6001,
            'deck_id': 10,
            'card_type': 'standard',
            'front_text': '@theory\n# Präpositionen mit Dativ\naus, bei, mit, nach, seit, von, zu.',
            'back_text': 'Правило дательного падежа',
        }
        res_theory = inspect_v1_card(theory_card, deck=deck)
        self.assertTrue(res_theory['ok'], res_theory['diagnostics'])
        self.assertEqual(res_theory['content_v2']['card']['type'], 'theory')
        warn_codes = [w['code'] for w in res_theory['warnings']]
        self.assertIn('legacy_default_card_type_normalized', warn_codes)

        # 2. card_type='translation' on [[gap]] cloze content converts cleanly to trainer
        trainer_card = {
            'id': 6002,
            'deck_id': 10,
            'card_type': 'translation',
            'front_text': 'Er fährt mit dem [[Zug]].',
            'back_text': 'Поезд',
        }
        res_trainer = inspect_v1_card(trainer_card, deck=deck)
        self.assertTrue(res_trainer['ok'], res_trainer['diagnostics'])
        self.assertEqual(res_trainer['content_v2']['card']['type'], 'trainer')
        warn_codes = [w['code'] for w in res_trainer['warnings']]
        self.assertIn('legacy_default_card_type_normalized', warn_codes)

        # 3. Explicit card_type='quiz' on plain standard content is STILL blocked with card_type_mismatch
        mismatch_card = {
            'id': 6003,
            'deck_id': 10,
            'card_type': 'quiz',
            'front_text': 'Guten Morgen!',
            'back_text': 'Доброе утро!',
        }
        res_mismatch = inspect_v1_card(mismatch_card, deck=deck)
        self.assertFalse(res_mismatch['ok'])
        diag_codes = [d['code'] for d in res_mismatch['diagnostics']]
        self.assertIn('card_type_mismatch', diag_codes)

    def test_legacy_ai_detector_divergence_warning_for_standard_cards(self):
        deck = {'level': 'A1', 'topic': 'Grammatik'}

        # Card has task mentioning grammar comparison which causes detect_ai_input_type to guess 'trainer',
        # while runtime detect_card_type correctly returns 'standard'. Must convert cleanly with warning.
        divergent_card = {
            'id': 6004,
            'deck_id': 10,
            'card_type': 'standard',
            'front_text': '::task\nСравните две конструкции и их грамматику.\n\n::exercise\nDer Laptop ist neu.\nder neue Laptop\n\nЭто почти одно и то же по смыслу и грамматике?',
            'back_text': 'По смыслу — да, но грамматически устроены по-разному.',
        }
        res = inspect_v1_card(divergent_card, deck=deck)
        self.assertTrue(res['ok'], res['diagnostics'])
        self.assertEqual(res['content_v2']['card']['type'], 'standard')
        warn_codes = [w['code'] for w in res['warnings']]
        self.assertIn('legacy_ai_detector_divergence', warn_codes)

    def test_pure_module_does_not_import_database_models(self):
        import subprocess

        cmd = [
            sys.executable,
            '-c',
            (
                'import sys; '
                'import api.v1_to_v2_converter as conv; '
                'assert "api.models" not in sys.modules, "api.models must not be imported"; '
                'assert "peewee" not in sys.modules, "peewee must not be imported"; '
                'res = conv.convert_v1_card({"front_text": "Hallo", "back_text": "Привет", "level": "A1", "topics": ["Gruß"]}); '
                'assert res["schema_version"] == 2 and res["card"]["type"] == "standard"'
            ),
        ]
        proc = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, check=False)
        self.assertEqual(proc.returncode, 0, proc.stderr or proc.stdout)


if __name__ == '__main__':
    unittest.main()
