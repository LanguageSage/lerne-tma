"""Pure parser regressions: no database, network or AI calls."""
import unittest

from api.services.input_parser import parse_exercise_content, detect_ai_input_type, restore_exercise_content


class InteractiveMarkerTests(unittest.TestCase):
    def test_standalone_blocks_ignore_exercise_marker_position(self):
        for marker, expected in (('puzzle', 'puzzle'), ('match', 'match'),
                                 ('wordbank', 'word_bank'), ('free', 'free_text')):
            body = f'@{marker}\nFirst line\n\nSecond line'
            for prefix, suffix in (('', ''), ('::exercise\n', ''), ('', '\n::exercise\nTail')):
                with self.subTest(marker=marker, prefix=prefix, suffix=suffix):
                    front = '::task\nInstructions\n\n' + prefix + body + suffix + '\n::example\nExample'
                    parsed = parse_exercise_content(front)
                    self.assertEqual(detect_ai_input_type(front), expected)
                    self.assertIn(body, parsed['exercise'])
                    self.assertNotIn('::exercise', parsed['exercise'])
                    self.assertNotIn('Example', parsed['exercise'])
                    self.assertEqual(parsed['examples'], ['Example'])
                    self.assertFalse(any(b['type'] == 'exercise' and not b['content'] for b in parsed['blocks']))

    def test_markers_inside_information_blocks_stay_literal(self):
        for info in ('task', 'source', 'example'):
            for marker in ('puzzle', 'match', 'wordbank', 'free'):
                for suffix in ('', '\n::exercise\nPlain text'):
                    with self.subTest(info=info, marker=marker, suffix=suffix):
                        front = f'::{info}\nQuoted marker:\n@{marker}\nLiteral text' + suffix
                        parsed = parse_exercise_content(front)
                        self.assertEqual(detect_ai_input_type(front), 'standard')
                        self.assertNotIn('@' + marker, parsed['exercise'])

    def test_marker_requires_a_complete_line(self):
        for marker in ('puzzle', 'match', 'wordbank', 'free'):
            for front in (f'Use @{marker} here', f'@{marker} is a literal mention', f'@{marker}_other\nText'):
                self.assertEqual(detect_ai_input_type(front), 'standard', front)
            self.assertNotEqual(detect_ai_input_type(f'  @{marker.upper()}  \r\nText'), 'standard')

    def test_multiple_directives_have_separate_bodies(self):
        parsed = parse_exercise_content('@puzzle\nOne\n\nTwo\n@match\nA => B\nC => D\n::source\nHint')
        exercises = [b['content'] for b in parsed['blocks'] if b['type'] == 'exercise']
        self.assertEqual(exercises, ['@puzzle\nOne\n\nTwo', '@match\nA => B\nC => D'])
        self.assertEqual(parsed['context'], 'Hint')

    def test_restore_keeps_information_before_and_after_exercise(self):
        front = '::task\nInstructions\n\n@free\nPrompt\n::example\nExample'
        restored = restore_exercise_content(parse_exercise_content(front), '@free\nNew prompt')
        parsed = parse_exercise_content(restored)
        self.assertEqual(parsed['task'], 'Instructions')
        self.assertEqual(parsed['examples'], ['Example'])
        self.assertEqual(parsed['exercise'], '@free\nNew prompt')


if __name__ == '__main__':
    unittest.main()
