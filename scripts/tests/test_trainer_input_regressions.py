import unittest
from unittest.mock import patch

from api import ai_service
from api.services.input_parser import (
    detect_ai_input_type,
    parse_user_input,
    preserve_exercise_marker,
)
from api.services.prompt_builders import build_rule_explanation_prompt
from api.utils.audio import _prepare_tts_text


class _DisabledSetting:
    value = "false"


class _FakeAIClient:
    response = ""
    last_system_prompt = ""

    def __init__(self, **_kwargs):
        pass

    async def chat_completion(self, system_prompt, user_message, model):
        self.__class__.last_system_prompt = system_prompt
        return self.__class__.response, True


class TrainerInputRegressionTests(unittest.TestCase):
    def test_existing_choice_cloze_remains_trainer(self):
        self.assertEqual(detect_ai_input_type("Ich fahre {*mit|nach|zu} dem Bus."), "trainer")

    def test_double_bracket_cloze_is_trainer(self):
        self.assertEqual(detect_ai_input_type("Er [[hatte]] gestern [[angerufen]]."), "trainer")

    def test_explicit_match_and_puzzle_markers_own_the_type(self):
        self.assertEqual(detect_ai_input_type("@match\nich => {hatte|hatten}"), "match")
        self.assertEqual(detect_ai_input_type("@puzzle\nEr [[hatte]] angerufen."), "puzzle")

    def test_explicit_markers_are_restored_without_duplication(self):
        self.assertEqual(preserve_exercise_marker("ich => hatte", "match"), "@match\nich => hatte")
        self.assertEqual(
            preserve_exercise_marker("@puzzle\nIch kaufe Brot.", "puzzle"),
            "@puzzle\nIch kaufe Brot.",
        )

    def test_only_standalone_final_parenthesized_line_is_a_directive(self):
        parsed = parse_user_input("Ich fahre mit dem Bus.\n(почему dem, а не den?)")
        self.assertTrue(parsed.has_directive)
        self.assertEqual(parsed.clean_phrase, "Ich fahre mit dem Bus.")
        self.assertEqual(parsed.directive, "почему dem, а не den?")

    def test_inline_verb_hints_are_not_directives(self):
        for phrase in (
            "Ich möchte Brot (kaufen).",
            "Er will Lehrer (sein).",
            "Wir werden Zeit (haben).",
            "Ich möchte (kaufen) Brot.",
        ):
            with self.subTest(phrase=phrase):
                parsed = parse_user_input(phrase)
                self.assertFalse(parsed.has_directive)
                self.assertEqual(parsed.clean_phrase, phrase)

    def test_multiline_parentheses_do_not_swallow_the_final_directive(self):
        parsed = parse_user_input("Zeile (sein) eins\nZeile zwei\n(nur diese просьба)")
        self.assertEqual(parsed.clean_phrase, "Zeile (sein) eins\nZeile zwei")
        self.assertEqual(parsed.directive, "nur diese просьба")

    def test_non_standalone_final_parentheses_are_not_a_directive(self):
        phrase = "Ich kaufe Brot.\nHinweis: (kaufen)"
        parsed = parse_user_input(phrase)
        self.assertFalse(parsed.has_directive)
        self.assertEqual(parsed.clean_phrase, phrase)

    def test_tts_uses_the_same_strict_directive_boundary(self):
        self.assertEqual(
            _prepare_tts_text("Ich fahre mit dem Bus.\n(почему dem?)"),
            "Ich fahre mit dem Bus.",
        )
        self.assertEqual(
            _prepare_tts_text("Zeile (sein) eins\nHinweis: (kaufen)"),
            "Zeile (sein) einsHinweis: (kaufen)",
        )

    def test_directive_words_do_not_change_the_clean_phrase_type(self):
        parsed = parse_user_input("Ein normales Wort\n(объясни грамматику)")
        self.assertEqual(detect_ai_input_type(parsed.clean_phrase), "standard")

    def test_rule_prompt_requests_translation_and_both_cloze_syntaxes(self):
        prompt = build_rule_explanation_prompt("Er [[hatte]] angerufen.", "de", "uk")
        self.assertIn('"back"', prompt)
        self.assertIn('"context"', prompt)
        self.assertIn("[[...]]", prompt)


class GenerateCardFieldsRegressionTests(unittest.IsolatedAsyncioTestCase):
    async def _generate(self, phrase, response, action_type="full_card"):
        _FakeAIClient.response = response
        _FakeAIClient.last_system_prompt = ""
        with (
            patch.object(ai_service, "get_ai_config", return_value=("ollama", "key", "test-model")),
            patch.object(ai_service, "AIService", _FakeAIClient),
            patch.object(ai_service.TMACustomPrompt, "get_or_none", return_value=None),
            patch.object(ai_service.TMASetting, "get_or_none", return_value=_DisabledSetting()),
        ):
            return await ai_service.generate_card_fields(
                user_id=1,
                phrase=phrase,
                target_language="de",
                native_language="uk",
                action_type=action_type,
            )

    async def test_double_brackets_select_the_existing_trainer_prompt(self):
        result = await self._generate(
            "Er [[hatte]] gestern angerufen.",
            '{"front":"Er [[hatte]] gestern angerufen.","back":"Він учора телефонував.","context":"Правило"}',
        )
        self.assertEqual(result["card_type"], "trainer")
        self.assertIn("карточку-тренажёр", _FakeAIClient.last_system_prompt)

    async def test_puzzle_marker_is_restored_after_ai_generation(self):
        result = await self._generate(
            "@puzzle\nIch kaufe Brot.",
            '{"front":"Ich kaufe Brot.","back":"Я купую хліб.","context":""}',
        )
        self.assertEqual(result["card_type"], "puzzle")
        self.assertTrue(result["front"].startswith("@puzzle\n"))

    async def test_rule_action_returns_translation_and_context(self):
        result = await self._generate(
            "Er [[hatte]] gestern angerufen.",
            '{"back":"Він учора телефонував.","context":"📖 **Правило:** Plusquamperfekt"}',
            action_type="explain_rule",
        )
        self.assertEqual(result["back"], "Він учора телефонував.")
        self.assertIn("Plusquamperfekt", result["context"])


if __name__ == "__main__":
    unittest.main()
