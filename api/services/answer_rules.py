"""Pure conservative checks. None means ambiguous, never an incorrect answer."""
import re
import unicodedata
from difflib import SequenceMatcher

from api.services.answer_contract import AnswerEvaluation, GradingPolicy


# Small safety guard lists, not language dictionaries. Unknown languages use AI for typos.
PROTECTED_WORDS = {
    'de': set('der die das den dem des ein eine einen einem einer eines kein keine keinen keinem keiner keines '
              'ich du er sie es wir ihr man mich dich ihn uns euch mir dir ihm ihnen sich '
              'in an auf aus bei mit nach von zu vor für gegen ohne um über unter '
              'bin bist ist sind seid war waren wäre wären habe hast hat haben habt '
              'hatte hatten wird werden wurde wurden kann können muss müssen soll sollen '
              'nicht nie nein ja nur auch und oder aber dass isst schon schön hätte '
              'wurde würde hatte hätte viel fiel seit seid wen wenn denn dann als also '
              'lebe liebe wohnen wohne wohnt leben liebt hundert '
              'darf dürfen durfte könnte möchte möchten will wollen wollte '
              'bis durch seit trotz wegen während zwischen dieser diesen diesem welche '
              'eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf zwanzig tausend million'.split()),
    'en': set('a an the this that these those i you he she it we they me him her us them '
              'is am are was were be been have has had do does did can could will would '
              'no not never in on at to from for with of by and or but then than form '
              'one two three four five six seven eight nine ten eleven twelve hundred thousand'.split()),
}

# Common real-word transpositions must not become typo evidence. This is a safety
# guard, deliberately separate from protected grammatical/meaning-bearing tokens.
KNOWN_WORDS = {
    'de': set('hund hunde wein wien lied leid'.split()),
    'en': set('salt slat martial marital causal casual trial trail angel angle quiet quite united untied'.split()),
}


def normalize_answer(text: str, policy: GradingPolicy) -> str:
    value = unicodedata.normalize('NFC', text)
    value = ' '.join(value.split())
    # Ignore a sentence-final full stop only; internal punctuation, negation and numbers survive.
    if not policy.punctuation_sensitive and re.search(r'[^\W\d_]\.$', value, re.UNICODE):
        value = value[:-1].rstrip()
    return value if policy.case_sensitive else value.lower()


def answer_token_diff(answer: str, variants: list[str], policy: GradingPolicy) -> dict:
    """Describe edits to the closest reference, without deciding correctness."""
    actual = normalize_answer(answer, policy)
    candidates = [(variant, normalize_answer(variant, policy))
                  for variant in variants if variant.strip()]
    if not candidates:
        return {'nearest_expected_answer': None, 'token_differences': []}
    # Character similarity also distinguishes references with the same token mismatch count.
    variant, expected = max(candidates, key=lambda item: SequenceMatcher(
        None, actual, item[1]).ratio())
    actual_tokens, expected_tokens = actual.split(), expected.split()
    differences = [
        {'operation': operation, 'actual': ' '.join(actual_tokens[a:b]),
         'expected': ' '.join(expected_tokens[c:d]),
         'actual_start': a, 'actual_end': b, 'expected_start': c, 'expected_end': d}
        for operation, a, b, c, d in SequenceMatcher(
            None, actual_tokens, expected_tokens, autojunk=False).get_opcodes()
        if operation != 'equal'
    ]
    return {'nearest_expected_answer': variant, 'normalized_actual': actual,
            'normalized_expected': expected, 'token_differences': differences}


def safe_token_typo(actual: str, expected: str, language: str) -> bool:
    language = language.split('-')[0]
    protected = PROTECTED_WORDS.get(language)
    if protected is None or len(expected) < 4 or not actual.isalpha() or not expected.isalpha():
        return False
    if actual.lower() in protected or actual.lower() in KNOWN_WORDS.get(language, set()) or len(actual) < 4:
        return False
    if expected.lower() in protected:
        return False
    if not actual.isascii() or not expected.isascii():
        return False
    # One adjacent transposition, or one duplicated interior character. Substitutions and
    # arbitrary insertions/deletions can create a real word or inflection and are ambiguous.
    if len(actual) == len(expected):
        changed = [i for i, (a, b) in enumerate(zip(actual, expected)) if a != b]
        if len(changed) != 2 or changed[1] != changed[0] + 1:
            return False
        i, j = changed
        if expected[i:j + 1].lower() in ('en', 'er', 'es', 'em', 'st'):
            return False
        return actual[i] == expected[j] and actual[j] == expected[i]
    if len(actual) == len(expected) + 1:
        return any(actual[i] == actual[i - 1] and actual[:i] + actual[i + 1:] == expected
                   for i in range(1, len(actual) - 1))
    return False


def evaluate_deterministic(answer: str, variants: list[str], policy: GradingPolicy,
                           language: str = 'de') -> AnswerEvaluation | None:
    actual = normalize_answer(answer, policy)
    valid_variants = [v for v in variants if v.strip()]
    for variant in valid_variants:
        if actual and actual == normalize_answer(variant, policy):
            return AnswerEvaluation(verdict='correct', accepted=True, evaluator='exact')
    if policy.mode == 'exact':
        return AnswerEvaluation(verdict='incorrect', accepted=False, error_type='other',
                                error_code='exact.mismatch', severity='major', evaluator='rules')
    if not policy.typo_tolerance or policy.mode == 'open_text':
        return None
    tokens = actual.split()
    for variant in valid_variants:
        target_tokens = normalize_answer(variant, policy).split()
        if len(tokens) != len(target_tokens):
            continue
        differences = [(a, b) for a, b in zip(tokens, target_tokens) if a != b]
        if len(differences) == 1 and safe_token_typo(*differences[0], language):
            return AnswerEvaluation(verdict='accepted_minor', accepted=True, error_type='typo',
                                    error_code='typo.single_token', severity='minor',
                                    corrected_answer=variant, evaluator='rules', confidence=.98)
    return None
