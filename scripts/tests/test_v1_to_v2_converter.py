"""Automated tests for Stage 7.1 pure V1 -> JSON V2 card converter."""

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
    inspect_v1_card,
    main as cli_main,
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
                self.assertEqual(
                    converted_doc.model_dump(mode='json'),
                    doc.model_dump(mode='json'),
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
                self.assertEqual(
                    [c.model_dump(mode='json') for c in converted_doc.cards[1:]],
                    [c.model_dump(mode='json') for c in doc.cards[1:]],
                )
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
                res = inspect_v1_card(card, deck=deck)
                self.assertFalse(res['ok'], f'expected error {expected_code}, but card converted ok')
                codes = [d['code'] for d in res['diagnostics']]
                self.assertIn(expected_code, codes, f'expected {expected_code} in {codes}')
                with self.assertRaises(V1ConversionError) as ctx:
                    convert_v1_card(card, deck=deck)
                self.assertIn(expected_code, [d.code for d in ctx.exception.diagnostics])

    def test_free_text_policy_explicit_vs_fallback_mode(self):
        deck = {'level': 'B1', 'topic': 'Wohnen'}
        card = {
            'front_text': '@free\nBeschreiben Sie Ihr Zimmer.',
            'back_text': 'Mein Zimmer hat ein großes Fenster.',
        }
        # By default require_explicit_free_text_policy=True rejects missing policy.
        strict_res = inspect_v1_card(card, deck=deck)
        self.assertFalse(strict_res['ok'])
        self.assertEqual(strict_res['diagnostics'][0]['code'], 'ambiguous_free_text_policy')

        # When require_explicit_free_text_policy=False, fallback policy is applied with a warning.
        fallback_res = inspect_v1_card(
            card,
            deck=deck,
            require_explicit_free_text_policy=False,
            default_free_text_policy='controlled_text',
        )
        self.assertTrue(fallback_res['ok'])
        self.assertEqual(
            fallback_res['content_v2']['card']['data']['grading_policy']['mode'],
            'controlled_text',
        )
        self.assertEqual(fallback_res['warnings'][0]['code'], 'implicit_free_text_policy')

    def test_snapshot_conversion_on_lesson_qa_before_and_corrected_fixtures(self):
        before_raw = json.loads((FIXTURES / 'lesson-qa' / 'before.json').read_text(encoding='utf-8'))
        corrected_raw = json.loads((FIXTURES / 'lesson-qa' / 'corrected.json').read_text(encoding='utf-8'))

        before_report = convert_v1_snapshot(before_raw)
        self.assertFalse(before_report['ok'])
        self.assertEqual(before_report['checked'], {'decks': 14, 'cards': 678})
        # before.json has broken deck passports, 61 free_text cards without grading_policy,
        # 7 @puzzle cards with unmarked preamble inside ::exercise, 2 multi-exercise/info-after-exercise cards,
        # 1 broken quiz (10002), 1 empty-back standard card (10003), and 1 unconverted ___ blank (30391).
        self.assertIn('invalid_deck_passport', before_report['counts_by_code'])
        self.assertEqual(before_report['counts_by_code'].get('ambiguous_free_text_policy'), 61)
        self.assertEqual(before_report['counts_by_code'].get('unmarked_preamble_before_directive'), 7)
        self.assertEqual(before_report['counts_by_code'].get('info_after_exercise'), 2)
        self.assertEqual(before_report['counts_by_code'].get('unconverted_blank_placeholder'), 1)

        corrected_report = convert_v1_snapshot(corrected_raw)
        self.assertEqual(corrected_report['checked'], {'decks': 14, 'cards': 678})
        # All 14 decks in corrected.json have valid V2 passports:
        self.assertTrue(all(d['ok'] for d in corrected_report['decks']))
        # In corrected.json, 668 of 678 cards convert cleanly; the remaining 10 diagnostics are:
        # - 7 @puzzle cards with unmarked preamble before @puzzle inside ::exercise
        # - 2 trainer cards (11201, 11202) carrying leftover free_text grading_policy/accepted_answers in metadata
        # - 1 card (30391) with an unconverted ___ blank in a standard card.
        self.assertEqual(corrected_report['converted_count'], 668)
        self.assertEqual(corrected_report['failed_count'], 10)
        self.assertEqual(
            corrected_report['counts_by_code'],
            {
                'unmarked_preamble_before_directive': 7,
                'unexpected_answer_policy_metadata': 2,
                'unconverted_blank_placeholder': 1,
            },
        )

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
            self.assertEqual(parsed, doc.model_dump(mode='json'))

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
