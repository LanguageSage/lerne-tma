import unittest
from unittest.mock import patch

from api import ai_service
from api.services.input_parser import (
    detect_ai_input_type,
    parse_exercise_content,
    preserve_exercise_marker,
    restore_exercise_content,
)
from api.services.prompt_builders import build_rule_explanation_prompt
from api.utils.audio import _prepare_tts_text


class _DisabledSetting:
    value = "false"


class _FakeAIClient:
    response = ""
    last_system_prompt = ""
    last_user_message = ""

    def __init__(self, **_kwargs):
        pass

    async def chat_completion(self, system_prompt, user_message, model):
        self.__class__.last_system_prompt = system_prompt
        self.__class__.last_user_message = user_message
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

    def test_tts_removes_standalone_parenthesized_hint_lines_only(self):
        self.assertEqual(
            _prepare_tts_text("Ich fahre mit dem Bus.\n(почему dem?)"),
            "Ich fahre mit dem Bus.",
        )
        self.assertEqual(
            _prepare_tts_text("Zeile (sein) eins\nHinweis: (kaufen)"),
            "Zeile (sein) einsHinweis: (kaufen)",
        )

    def test_tts_preserves_double_bracket_cloze_content(self):
        cases = {
            "Als ich in die Schule kam, [[hatte]] der Unterricht schon [[begonnen]].\n(beginnen)": (
                "Als ich in die Schule kam, hatte der Unterricht schon begonnen."
            ),
            "Ich [[habe]] das Buch [[gelesen]].": "Ich habe das Buch gelesen.",
            "Gestern {*sind/haben} wir nach Berlin [[gefahren]].": "Gestern sind wir nach Berlin gefahren.",
            "Sie [[hatte]] die Tickets [[gekauft]], bevor der Film ausverkauft war.\n(kaufen)": (
                "Sie hatte die Tickets gekauft, bevor der Film ausverkauft war."
            ),
        }

        for source, expected in cases.items():
            with self.subTest(source=source):
                self.assertEqual(_prepare_tts_text(source), expected)

    def test_parenthesized_final_line_does_not_change_input_type(self):
        self.assertEqual(detect_ai_input_type("Ein normales Wort\n(любой текст)"), "standard")

    def test_rule_prompt_requests_translation_and_both_cloze_syntaxes(self):
        prompt = build_rule_explanation_prompt("Er [[hatte]] angerufen.", "de", "uk")
        self.assertIn('"back"', prompt)
        self.assertIn('"context"', prompt)
        self.assertIn("[[...]]", prompt)

    def test_information_blocks_are_parsed_and_restored(self):
        source = (
            "::task\r\nWählen Sie das passende Wort.\r\n\r\n"
            "::options\r\nwas | dass | wie | ob\r\n\r\n"
            "Ich weiß, [[dass er kommt]].\r\n\r\n(er kommen)"
        )
        parsed = parse_exercise_content(source)
        self.assertEqual(parsed["task"], "Wählen Sie das passende Wort.")
        self.assertEqual(parsed["options"], ["was", "dass", "wie", "ob"])
        self.assertEqual(parsed["exercise"], "Ich weiß, [[dass er kommt]].\n\n(er kommen)")
        restored = restore_exercise_content(parsed, "Ich weiß, [[dass alles klappt]].")
        self.assertIn("::options\nwas | dass | wie | ob", restored)
        self.assertTrue(restored.endswith("Ich weiß, [[dass alles klappt]]."))

    def test_source_marker_populates_internal_context_and_legacy_context_is_not_recognized(self):
        source = (
            "::task\nErgänzen Sie das Verb.\n\n"
            "::source\nWiedersehen nach 20 Jahren.\n\n"
            "Er [[hatte]] sein Studium abgeschlossen."
        )
        parsed = parse_exercise_content(source)

        self.assertEqual(parsed["task"], "Ergänzen Sie das Verb.")
        self.assertEqual(parsed["context"], "Wiedersehen nach 20 Jahren.")
        self.assertEqual(parsed["exercise"], "Er [[hatte]] sein Studium abgeschlossen.")
        self.assertIn("::source", restore_exercise_content(parsed, parsed["exercise"]))

        legacy = parse_exercise_content("::context\nLegacy text.\n\nSatz [[Antwort]].")
        self.assertFalse(legacy["has_blocks"])
        self.assertEqual(legacy["context"], "")
        self.assertEqual(legacy["exercise"], "::context\nLegacy text.\n\nSatz [[Antwort]].")

    def test_source_with_explicit_exercise_marker_supports_multiparagraph_context(self):
        source = (
            "::task\nLesen Sie den Text und ergänzen Sie die richtige Form.\n\n"
            "::source\nWiedersehen nach 20 Jahren.\n\n"
            "Sie trafen sich zufällig in Berlin auf der Straße wieder.\n"
            "20 Jahre lang hatten sie sich nicht gesehen.\n\n"
            "::exercise\nEr war ein paar Jahre älter als sie.\n"
            "Er [[hatte]] sein Studium schon abgeschlossen."
        )
        parsed = parse_exercise_content(source)

        self.assertEqual(parsed["task"], "Lesen Sie den Text und ergänzen Sie die richtige Form.")
        self.assertIn("Wiedersehen nach 20 Jahren.\n\nSie trafen sich zufällig", parsed["context"])
        self.assertEqual(
            parsed["exercise"],
            "Er war ein paar Jahre älter als sie.\nEr [[hatte]] sein Studium schon abgeschlossen."
        )
        self.assertNotIn("::task", parsed["exercise"])
        self.assertNotIn("::source", parsed["exercise"])
        self.assertNotIn("::exercise", parsed["exercise"])

    def test_tts_excludes_all_visual_blocks_options_and_hint(self):
        source = (
            "::task\nWählen Sie das passende Wort und schreiben Sie damit den Satz zu Ende.\n\n"
            "::source\nPaul erzählt über sein Studium in Deutschland.\n\n"
            "::options\nwas | dass | wie | ob\n\n"
            "::example\nIch weiß jetzt, wie das funktioniert.\n\n"
            "Ich verstehe jetzt viel besser, [[wie das deutsche Hochschulsystem funktioniert]].\n\n"
            "(das deutsche Hochschulsystem funktionieren)"
        )
        self.assertEqual(
            _prepare_tts_text(source),
            "Ich verstehe jetzt viel besser, wie das deutsche Hochschulsystem funktioniert.",
        )

    def test_preamble_blocks_with_noise_syntax_do_not_leak_into_tts_or_ai_detection(self):
        source = (
            "::task\nErgänzen Sie das Verb [[falsch]].\n\n"
            "::source\nIm Text steht [[hatte]].\n@match\nA => B\n\n"
            "::example\nEr [[hatte]] Zeit.\n\n"
            "::exercise\nEr [[war]] zu Hause."
        )
        self.assertEqual(_prepare_tts_text(source), "Er war zu Hause.")
        self.assertEqual(detect_ai_input_type(source), "trainer")


class GenerateCardFieldsRegressionTests(unittest.IsolatedAsyncioTestCase):
    async def _generate(self, phrase, response, action_type="full_card", user_request=None):
        _FakeAIClient.response = response
        _FakeAIClient.last_system_prompt = ""
        _FakeAIClient.last_user_message = ""
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
                user_request=user_request,
            )

    async def test_parenthesized_final_line_is_sent_to_ai_unchanged(self):
        phrase = "Ein Satz.\n(упрости это предложение)"
        await self._generate(
            phrase,
            '{"front":"Ein Satz.","back":"Одне речення.","context":""}',
        )
        self.assertEqual(_FakeAIClient.last_user_message, phrase)
        self.assertIn(phrase, _FakeAIClient.last_system_prompt)

    async def test_full_card_user_request_is_added_separately(self):
        result = await self._generate(
            "Das ist bereits fertig.",
            '{"front":"Das ist schon fertig.","back":"Це вже готово.","context":"Новий контекст"}',
            user_request="Замени bereits на schon и исправь перевод",
        )
        self.assertIn("Замени bereits на schon", _FakeAIClient.last_system_prompt)
        self.assertEqual(result["front"], "Das ist schon fertig.")
        self.assertEqual(result["back"], "Це вже готово.")
        self.assertEqual(result["context"], "Новий контекст")

    async def test_custom_directive_uses_explicit_user_request(self):
        result = await self._generate(
            "Ich fahre mit dem Bus.",
            "Відповідь на запитання",
            action_type="custom_directive",
            user_request="Почему dem?",
        )
        self.assertIn('Вопрос или просьба: "Почему dem?"', _FakeAIClient.last_system_prompt)
        self.assertEqual(result["context"], "Відповідь на запитання")

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

    async def test_information_blocks_are_hidden_from_ai_and_restored_unchanged(self):
        phrase = (
            "::task\nWählen Sie das passende Wort.\n\n"
            "::options\nob | dass | wie\n\n"
            "Ich weiß, [[dass er kommt]]."
        )
        result = await self._generate(
            phrase,
            '{"front":"Ich weiß jetzt, [[dass er kommt]].","back":"Я знаю.","context":"Правило"}',
        )
        self.assertEqual(_FakeAIClient.last_user_message, "Ich weiß, [[dass er kommt]].")
        self.assertNotIn("::task", _FakeAIClient.last_system_prompt)
        self.assertTrue(result["front"].startswith("::task\nWählen Sie das passende Wort."))
        self.assertIn("::options\nob | dass | wie", result["front"])
        self.assertTrue(result["front"].endswith("Ich weiß jetzt, [[dass er kommt]]."))

    async def test_batch_ai_enrichment_preserves_information_blocks(self):
        phrase = (
            "::task\nWählen Sie das passende Wort.\n\n"
            "::options\nob | dass | wie\n\n"
            "Ich weiß, [[dass er kommt]]."
        )
        _FakeAIClient.response = (
            '[{"front":"Ich weiß jetzt, [[dass er kommt]].",'
            '"back":"Я знаю.","context":"Правило","level":"B1"}]'
        )
        _FakeAIClient.last_user_message = ""
        with (
            patch.object(ai_service, "get_ai_config", return_value=("ollama", "key", "test-model")),
            patch.object(ai_service, "AIService", _FakeAIClient),
        ):
            result = await ai_service.enrich_batch_quiz_fields(
                user_id=1,
                cards=[{"front": phrase, "front_text": phrase, "card_type": "trainer"}],
                target_language="de",
                native_language="uk",
            )

        enriched = result["cards"][0]["front"]
        self.assertNotIn("::task", _FakeAIClient.last_user_message)
        self.assertIn("Ich weiß, [[dass er kommt]].", _FakeAIClient.last_user_message)
        self.assertTrue(enriched.startswith("::task\nWählen Sie das passende Wort."))
        self.assertIn("::options\nob | dass | wie", enriched)
        self.assertTrue(enriched.endswith("Ich weiß jetzt, [[dass er kommt]]."))


if __name__ == "__main__":
    unittest.main()
