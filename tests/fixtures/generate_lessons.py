"""Deterministic fictional lesson fixtures. No imports from the app or local data.

The 14-deck/678-card size and 46+2 assessment are regression contracts.
Run this file to regenerate the adjacent JSON files; --check verifies them.
"""
import copy
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent / 'lesson-qa'


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def fixtures():
    competencies = ['comp_exam_' + name for name in (
        'nominative', 'accusative', 'dative', 'prepositions', 'word_order', 'production', 'genitive')]
    routes = [
        {'id': f'route_{i}', 'title': f'Review {i}', 'competency_ids': ids, 'deck_ids': [101 + i]}
        for i, ids in enumerate((competencies[:3], competencies[3:4], competencies[4:5],
                                 competencies[5:6], competencies[6:7]))]
    assessment = {'schema_version': 1, 'required_count': 46, 'bonus_count': 2,
                  'bands': [{'id': 'ready', 'title': 'Уверенное освоение', 'min': 41, 'max': 46},
                            {'id': 'review', 'title': 'Review', 'min': 34, 'max': 40},
                            {'id': 'practice', 'title': 'Practice', 'min': 25, 'max': 33},
                            {'id': 'base', 'title': 'Base', 'min': 0, 'max': 24}],
                  'review_routes': routes}
    cases = json.loads((ROOT / 'card-cases.json').read_text(encoding='utf-8'))
    before = {'decks': [], 'cards': []}
    for index in range(14):
        deck_id = 101 + index
        metadata = {'intro': {'title': f'Fixture lesson {index + 1}', 'level': 'B1'},
                    'pedagogy': {'lesson_type': 'assessment' if index == 13 else 'practice'},
                    'resources': ['synthetic-resource'], 'curriculum': {'fixture': True}, 'is_learning': False}
        # Six malformed passports exercise the canonical validator, independently
        # of the runtime-missing assessment diagnostic in deck 114.
        if index < 6:
            metadata['pedagogy']['lesson_type'] = 'production'
        before['decks'].append({'id': deck_id, 'name': f'Fixture lesson {index + 1}',
                                'target_language': 'de', 'metadata': dumps(metadata)})
        for row in cases:
            if row['deck_id'] == deck_id:
                before['cards'].append({'id': row['id'], 'deck_id': deck_id,
                    'position': row['position'], 'front_text': row['front'],
                    'back_text': row['back'], 'context': '', 'metadata': dumps(row['metadata'])})

    # Semantic regression examples are authored independently of the scrubbed
    # syntax corpus: equivalent variants, bad quiz key, context, long input and
    # the three declared support shapes. IDs are fictional fixture-local IDs.

    def change(snapshot, card_id, **fields):
        next(card for card in snapshot['cards'] if card['id'] == card_id).update(fields)

    change(before, 10001, front_text='::task\nOrdnen Sie.\n::exercise\n@puzzle\nHeute besucht der kleine Roboter ein ganz neues Museum.', back_text='')
    change(before, 10002, front_text='::exercise\nWelcher Satz?\n[*] Der Roboter, der ich sehe.\n[ ] Der Roboter, den ich sehe.', back_text='', card_type='quiz')
    change(before, 10003, front_text='::exercise\nTest', back_text='', card_type='standard')
    change(before, 10004, front_text='::task\nReagieren Sie in einem Gespräch.\nОтветьте, используя Relativsatz.\n::source\nWelches Museum suchst du?\n::exercise\n@free\nAntworten Sie.', back_text='Ich suche ein Museum, das heute offen ist.', card_type='free_text', metadata=dumps({'grading_policy': {'mode': 'controlled_text', 'max_retries': 3}}))
    change(before, 11201, front_text='::exercise\n[[Das ist das Museum, in dem mein Roboter arbeitet.]]', card_type='trainer')
    change(before, 11202, front_text='::exercise\n[[Ein Roboter, dem ich oft helfe, malt das Bild.]]', card_type='trainer')

    change(before, 20003, front_text='::task\nWortschatz: malen — paint\n::exercise\nDer Roboter {*malt|malen} ein Bild.')
    change(before, 20013, front_text='::task\nWortschatz: malen — paint\n::exercise\nDer Roboter [[malt]] ein Bild.')
    change(before, 20023, front_text='::task\nWortschatz: sprechen — speak\n::source\nEin Roboter im Museum.\n::exercise\nDer Roboter [[spricht]].')
    change(before, 20035, front_text='::exercise\nDer Roboter, [[der im Museum arbeitet]], malt.', back_text='Nominativ: der')
    change(before, 20040, front_text='::exercise\nDas ist das Museum, [[in dem mein Roboter arbeitet]].')
    change(before, 20043, front_text='::exercise\n[[Das ist der kleine Roboter, mit dem ich jeden Dienstag im Museum arbeite.]]')
    change(before, 20044, front_text='::exercise\n[[Ich suche ein Museum, das heute offen ist.]]')
    corrected = copy.deepcopy(before)
    by_id = {row['id']: row for row in cases}
    overrides = {10001, 10002, 10003, 10004, 11201, 11202, 20003, 20013, 20023, 20035, 20040, 20043, 20044}
    for card in corrected['cards']:
        row = by_id[card['id']]
        card['metadata'] = dumps(row['corrected_metadata'])
        if card['id'] not in overrides:
            card.update(front_text=row['corrected_front'], back_text=row['corrected_back'])
    proposals = []
    for i, deck in enumerate(corrected['decks']):
        meta = json.loads(deck['metadata'])
        original = copy.deepcopy(meta)
        if i < 6:
            meta['pedagogy']['lesson_type'] = 'practice'
            proposals.append({'deck_id': deck['id'], 'original': original, 'proposed': copy.deepcopy(meta)})
        if i == 13:
            meta['pedagogy'].update(assessment=assessment,
                competencies=[{'id': c, 'title': c} for c in competencies])
        deck['metadata'] = dumps(meta)
    change(corrected, 10002, front_text='::exercise\nWelcher Satz?\n[ ] Der Roboter, der ich sehe.\n[*] Der Roboter, den ich sehe.')
    change(corrected, 10003, front_text='::exercise\n[[fertig]]', card_type='trainer')
    for card in corrected['cards']:
        if card['deck_id'] != 114:
            continue
        ordinal = card['position'] // 10
        if 43 <= ordinal <= 46:
            card.update(front_text=f'@free\nBeschreiben Sie das erfundene Museum {ordinal}.',
                        back_text='Das Museum ist neu.', card_type='free_text')
        meta = json.loads(card['metadata'])
        meta.setdefault('assessment', {'competency_ids': [competencies[min((ordinal - 1) // 7, 6)]]})
        if 43 <= ordinal <= 46:
            meta['grading_policy'] = {'mode': 'open_text', 'max_retries': 1}
        card['metadata'] = dumps(meta)
    corrected['knowledge_seed'] = [{'rule_code': 'fixture.relative', 'name': 'Fictional rule',
                                    'language': 'de', 'category': 'grammar', 'cefr_level': 'B1', 'is_global': True}]
    corrected['knowledge_mappings'] = [{'card_id': c['id'], 'rule_code': 'fixture.relative',
                                       'role': 'primary', 'complexity': 3} for c in corrected['cards']]
    return {'before.json': before, 'corrected.json': corrected,
            'source-ids.json': {'cards': [{'id': c['id']} for c in before['cards']]},
            'passport-proposals.json': proposals}


if __name__ == '__main__':
    ROOT.mkdir(exist_ok=True)
    for name, value in fixtures().items():
        text = dumps(value) + '\n'
        path = ROOT / name
        if '--check' in sys.argv:
            assert path.read_text(encoding='utf-8') == text, f'Regenerate {path}'
        else:
            path.write_text(text, encoding='utf-8', newline='\n')
