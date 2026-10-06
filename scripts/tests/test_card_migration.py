import unittest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from scripts.migrate_lesson_cards import (
    transform_choice_card,
    transform_input_card,
    transform_wordbank_to_puzzle,
    process_card,
)

class TestCardMigration(unittest.TestCase):
    def test_1_choice_card(self):
        before = (
            "::task\n"
            "Что правильно?\n\n"
            "::exercise\n"
            "{*der schwarze Rock/der schwarz Rock}"
        )
        expected = (
            "::exercise\n"
            "Выбери правильное словосочетание.\n\n"
            "*der schwarze Rock\n"
            "der schwarz Rock"
        )
        transformed, cat, status = transform_choice_card(before)
        self.assertEqual(status, "OK")
        self.assertEqual(transformed, expected)

        # Idempotence: already transformed card should not be re-transformed
        re_transformed, _, re_status = transform_choice_card(expected)
        self.assertIsNone(re_transformed)

    def test_2_input_hint(self):
        before = (
            "::task\n"
            "Допиши форму.\n\n"
            "::exercise\n"
            "der [[bequeme]] Schuh"
        )
        back = (
            "der bequeme Schuh\n"
            "удобный ботинок / туфля\n\n"
            "bequem — удобный.\n"
        )
        expected = (
            "::task\n"
            "Допиши форму.\n\n"
            "::source\n"
            "удобный\n\n"
            "::exercise\n"
            "der [[bequeme]] Schuh"
        )
        transformed, cat, status = transform_input_card(before, back)
        self.assertEqual(status, "OK")
        self.assertEqual(transformed, expected)

        # Idempotence: already has ::source, should not add another
        re_transformed, _, re_status = transform_input_card(expected, back)
        self.assertIsNone(re_transformed)

    def test_3_wordbank_to_puzzle(self):
        before = (
            "::task\n"
            "Собери словосочетание.\n\n"
            "::exercise\n"
            "@wordbank\n"
            "der / bittere / Tee"
        )
        back = (
            "der bittere Tee\n"
            "горький чай\n"
        )
        expected = (
            "::task\n"
            "Собери словосочетание.\n\n"
            "::exercise\n"
            "@puzzle\n"
            "der bittere Tee"
        )
        transformed, cat, status = transform_wordbank_to_puzzle(before, back)
        self.assertEqual(status, "OK")
        self.assertEqual(transformed, expected)

        # Idempotence: card has @puzzle and no @wordbank, should not be transformed
        re_transformed, _, re_status = transform_wordbank_to_puzzle(expected, back)
        self.assertIsNone(re_transformed)

    def test_wordbank_scrambled_to_puzzle(self):
        before = (
            "::task\n"
            "Собери правильное предложение.\n\n"
            "::exercise\n"
            "@wordbank\n"
            "Werkzeug / praktisch / das / ist"
        )
        back = (
            "Das Werkzeug ist praktisch.\n"
            "Инструмент практичный.\n"
        )
        expected = (
            "::task\n"
            "Собери правильное предложение.\n\n"
            "::exercise\n"
            "@puzzle\n"
            "Das Werkzeug ist praktisch."
        )
        transformed, cat, status = transform_wordbank_to_puzzle(before, back)
        self.assertEqual(status, "OK")
        self.assertEqual(transformed, expected)

    def test_real_wordbank_ignored(self):
        real_wb = (
            "::task\n"
            "Ergänzen Sie.\n\n"
            "::exercise\n"
            "@wordbank\n"
            "Ich lerne <<1>>.\n"
            "@options\n"
            "Deutsch | Englisch"
        )
        transformed, cat, status = transform_wordbank_to_puzzle(real_wb, "")
        self.assertIsNone(transformed)

    def test_inline_cloze_choice_ignored(self):
        inline_cloze = (
            "::task\n"
            "Wählen Sie die Form.\n\n"
            "::exercise\n"
            "Der Zug ist {*schnell/schnelle}."
        )
        transformed, cat, status = transform_choice_card(inline_cloze)
        self.assertIsNone(transformed)

    def test_choice_with_three_options(self):
        before = (
            "::task\n"
            "Что правильно?\n\n"
            "::exercise\n"
            "{*Das Problem ist ernst./Das Problem ist ernste./Das Problem ernst ist.}"
        )
        expected = (
            "::exercise\n"
            "Выбери правильное предложение.\n\n"
            "*Das Problem ist ernst.\n"
            "Das Problem ist ernste.\n"
            "Das Problem ernst ist."
        )
        transformed, cat, status = transform_choice_card(before)
        self.assertEqual(status, "OK")
        self.assertEqual(transformed, expected)

    def test_input_copula_sentence(self):
        before = (
            "::task\n"
            "Введи правильную форму.\n\n"
            "::exercise\n"
            "Das Motorrad ist [[laut]]."
        )
        back = (
            "Das Motorrad ist laut.\n"
            "Мотоцикл громкий.\n\n"
            "laut стоит после ist.\n"
        )
        expected = (
            "::task\n"
            "Введи правильную форму.\n\n"
            "::source\n"
            "громкий\n\n"
            "::exercise\n"
            "Das Motorrad ist [[laut]]."
        )
        transformed, cat, status = transform_input_card(before, back)
        self.assertEqual(status, "OK")
        self.assertEqual(transformed, expected)

    def test_input_task_with_parenthesis_hint_cleaned(self):
        before = (
            "::task\n"
            "Напиши правильное слово. ( удобный )\n\n"
            "::exercise\n"
            "Der Sessel ist [[bequem]]."
        )
        expected = (
            "::task\n"
            "Напиши правильное слово.\n\n"
            "::source\n"
            "удобный\n\n"
            "::exercise\n"
            "Der Sessel ist [[bequem]]."
        )
        transformed, cat, status = transform_input_card(before, "")
        self.assertEqual(status, "OK")
        self.assertEqual(transformed, expected)

    def test_choice_preserves_specific_task(self):
        before = (
            "::task\n"
            "Выбери полное предложение со словосочетанием «новый велосипед».\n\n"
            "::exercise\n"
            "{das neue Fahrrad/*Das neue Fahrrad steht vor dem Haus./Das Fahrrad ist neu.}"
        )
        expected = (
            "::exercise\n"
            "Выбери полное предложение со словосочетанием «новый велосипед».\n\n"
            "das neue Fahrrad\n"
            "*Das neue Fahrrad steht vor dem Haus.\n"
            "Das Fahrrad ist neu."
        )
        transformed, cat, status = transform_choice_card(before)
        self.assertEqual(status, "OK")
        self.assertEqual(transformed, expected)

    def test_input_cyrillic_gap_ignored(self):
        rule_card = (
            "::task\n"
            "Закончи главное правило.\n\n"
            "::exercise\n"
            "Словосочетание «die schöne Blume» можно использовать внутри [[полного предложения]]."
        )
        transformed, cat, status = transform_input_card(rule_card, "")
        self.assertIsNone(transformed)

if __name__ == '__main__':
    unittest.main()

