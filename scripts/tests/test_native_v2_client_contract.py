"""Real card-core/browser parity and regeneration, with synthetic JSON only."""
import copy
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from pydantic import ValidationError

from api.card_core.lerne_card_core.structured_cards_v2 import ContentV2
from scripts.generate_native_v2_contract import ROOT, TARGET, schema_source

FIXTURES = ROOT / 'tests/fixtures'
GENERATOR = ROOT / 'scripts/generate_native_v2_contract.py'


def js_results(samples, **options):
    run = subprocess.run([
        'node', '--import', './scripts/tests/no-network.mjs', './scripts/tests/native_v2_contract_runner.mjs',
    ], cwd=ROOT, input=json.dumps(dict(samples=samples, **options)), capture_output=True,
        text=True, encoding='utf-8', check=True)
    return json.loads(run.stdout)


def envelope(card):
    return {'schema_version': 2, 'card': card}


def read_samples():
    samples = {}
    for path in sorted((FIXTURES / 'structured_cards_v2').glob('*.json')):
        for card in json.loads(path.read_text(encoding='utf-8'))['cards']:
            samples.setdefault(card['type'], card)
    samples['editable_text'] = {'type': 'editable_text',
                                'data': {'source_text': 'Ich gehen.', 'correct_text': 'Ich gehe.'}}
    return samples


class NativeV2ClientContractTests(unittest.TestCase):
    def test_generated_schema_is_current(self):
        self.assertEqual(TARGET.read_text(encoding='utf-8'), schema_source())

    def test_acceptance_and_normalized_values_match(self):
        cards = read_samples()
        self.assertEqual(len(cards), 9)
        cases = [(kind, envelope(card), True) for kind, card in cards.items()]
        for kind, card in cards.items():
            with_extra = {**card, 'data': {**card['data'], 'unsupported': None}}
            cases.append((f'{kind} additional data field', envelope(with_extra), False))
            missing_data = {key: value for key, value in card.items() if key != 'data'}
            cases.append((f'{kind} missing data', envelope(missing_data), False))

        for fixture in json.loads((FIXTURES / 'standalone_native_v2_validation.json').read_text(encoding='utf-8')):
            card = fixture['card']
            if repeat := fixture.get('repeat'):
                owner = card
                for key in repeat['path'][:-1]:
                    owner = owner[key]
                owner[repeat['path'][-1]] = repeat['value'] * repeat['count']
            cases.append((fixture['name'], envelope(card), fixture['valid']))

        for kind in ('free_text', 'editable_text'):
            base = copy.deepcopy(cards[kind])
            base['data'].pop('grading_policy', None)
            cases.append((f'{kind} omitted policy', envelope(base), True))
            for policy, valid in (({}, True), ({'max_retries': 10}, True), ({'max_retries': 11}, False),
                                  ({'semantic_equivalence': 'true'}, False), ({'extra': False}, False)):
                card = {**base, 'data': {**base['data'], 'grading_policy': policy}}
                cases.append((f'{kind} policy {policy}', envelope(card), valid))
            for count in (20, 21):
                card = {**base, 'data': {**base['data'], 'accepted_answers': ['Grüße'] * count}}
                cases.append((f'{kind} {count} answers', envelope(card), count == 20))

        standard = {'type': 'standard', 'data': {'prompt': 'Grüße 🐱'}}
        quiz = {'type': 'quiz', 'data': {'prompt': '', 'options': [
            {'text': 'A', 'correct': True}, {'text': 'B'},
        ]}, 'info': [{'type': 'task', 'text': 'Wähle'}]}
        cases.extend([
            ('metadata arbitrary JSON', envelope({**standard, 'metadata': {'nested': [True, 1e-6, None, {}]}}), True),
            ('metadata shadow content', envelope({**standard, 'metadata': {'prompt': 'A'}}), False),
            ('info additional field', envelope({**standard, 'info': [{'type': 'text', 'text': 'A', 'extra': True}]}), False),
            ('info blank', envelope({**standard, 'info': [{'type': 'options', 'items': ['\u00a0']}]}), False),
            ('layout nullable', envelope({**standard, 'layout': None}), True),
            ('author media layout', envelope({**standard, 'layout': [
                {'id': 'exercise', 'type': 'exercise'},
                {'id': 'image', 'type': 'image', 'path': 'images/a..b.png'},
            ]}), True),
            ('archive token forbidden in canonical layout', envelope({**standard, 'layout': [
                {'id': 'exercise', 'type': 'exercise'},
                {'id': 'image', 'type': 'image', 'path': 'archive://' + 'a' * 64},
            ]}), False),
            ('visible quiz task', envelope(quiz), True),
            ('hidden quiz task', envelope({**quiz, 'layout': [
                {'id': 'e', 'type': 'exercise'},
                {'id': 't', 'type': 'info', 'index': 0, 'visibility': 'after_answer'},
            ]}), False),
            ('duplicate option labels', envelope({**quiz, 'data': {'prompt': 'A?', 'options': [
                {'text': 'A', 'correct': True}, {'text': 'A'},
            ]}}), False),
            ('incorrect word bank reference', envelope({'type': 'word_bank',
                'data': {'options': ['A'], 'parts': [{'type': 'gap', 'option': 1}]}}), False),
            ('additional envelope field', {**envelope(standard), 'extra': True}, False),
            ('missing envelope version', {'card': standard}, False),
        ])
        for (name, sample, valid), actual in zip(cases, js_results([sample for _, sample, _ in cases]), strict=True):
            with self.subTest(name=name):
                try:
                    expected = {'valid': True, 'normalized': ContentV2.model_validate(sample).model_dump(mode='json')}
                except ValidationError:
                    expected = {'valid': False}
                self.assertEqual(expected['valid'], valid)
                self.assertEqual(actual, expected)

    def test_changing_one_semantic_rule_changes_regenerated_js(self):
        card = envelope({'type': 'trainer', 'data': {'parts': [{'type': 'input', 'answers': ['A']}]}})
        self.assertTrue(js_results([card])[0]['valid'])
        scratch = ROOT / 'local/test-data'
        scratch.mkdir(parents=True, exist_ok=True)
        package_path = Path('api/card_core/lerne_card_core')
        define = "min=1, message='Trainer requires an input or choice part'"
        with tempfile.TemporaryDirectory(prefix='native-v2-generation-', dir=scratch) as workspace:
            project = Path(workspace)
            (project / package_path).mkdir(parents=True)
            for name in ('structured_cards_v2.py', 'native_v2_rules.py', 'answer_contract.py', 'deck_passport.py'):
                shutil.copyfile(ROOT / package_path / name, project / package_path / name)
            models = project / package_path / 'structured_cards_v2.py'
            source = models.read_text(encoding='utf-8')
            self.assertEqual(source.count(define), 1)
            models.write_text(source.replace(define, define.replace('min=1', 'min=2')), encoding='utf-8')
            (project / 'scripts').mkdir()
            script = project / 'scripts' / GENERATOR.name
            shutil.copyfile(GENERATOR, script)
            generated = project / TARGET.relative_to(ROOT)
            generated.parent.mkdir(parents=True)
            subprocess.run([sys.executable, '-B', str(script)], cwd=project, check=True)
            contract = json.loads(generated.read_text(encoding='utf-8').split('export default ', 1)[1].rstrip().rstrip(';'))
            self.assertEqual(js_results([card], contract=contract), [{'valid': False}])
            check = ('from api.card_core.lerne_card_core.structured_cards_v2 import ContentV2;'
                     'import json, sys; ContentV2.model_validate(json.load(sys.stdin))')
            rejected = subprocess.run([sys.executable, '-B', '-c', check], cwd=project,
                                      input=json.dumps(card), text=True, capture_output=True)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn('Trainer requires an input or choice part', rejected.stderr)
