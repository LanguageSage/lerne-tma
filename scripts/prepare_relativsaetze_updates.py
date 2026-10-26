"""Prepare reviewed content updates offline. Does not connect to any database."""
import copy
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'local/test-data/lesson-qa'


def prepare():
    original = json.loads((OUT / 'pre-change-backup.json').read_text(encoding='utf-8'))
    corrected = copy.deepcopy(original)
    cards = {c['id']: c for c in corrected['cards']}
    decks = {d['id']: d for d in corrected['decks']}
    fields = {'front': 'front_text', 'back': 'back_text', 'context': 'context', 'metadata': 'metadata'}
    for proposal in json.loads((OUT / 'content-proposals.json').read_text(encoding='utf-8'))['proposals']:
        card = cards[proposal['card_id']]
        for key, field in fields.items():
            if card.get(field) != proposal['original'].get(key):
                raise ValueError(f'Card {card["id"]}: original {field} changed since review')
            if key in proposal['proposed']:
                card[field] = proposal['proposed'][key]
    for proposal in json.loads((OUT / 'passport-proposals.json').read_text(encoding='utf-8')):
        deck = decks[proposal['deck_id']]
        if json.loads(deck['metadata']) != proposal['original']:
            raise ValueError(f'Deck {deck["id"]}: metadata changed since review')
        deck['metadata'] = json.dumps(proposal['proposed'], ensure_ascii=False)

    # Retain both repeated cards as explicit entry/final checks, preserving IDs.
    cards[348812]['front_text'] = cards[348812]['front_text'].replace('Letzte Kontrolle:', 'Einstieg:')
    cards[349238]['front_text'] = 'Wiederholung: ' + cards[349238]['front_text']

    names = {'case': 'Падеж внутри Relativsatz', 'nominative': 'Nominativ в Relativsatz',
        'accusative': 'Akkusativ в Relativsatz', 'dative': 'Dativ в Relativsatz',
        'prepositions': 'Предложное управление', 'word_order': 'Порядок слов в Relativsatz',
        'production': 'Самостоятельное построение Relativsatz', 'genitive': 'Genitiv: dessen и deren'}
    d14_cases = {358373: 'nominative', 358374: 'accusative', 358387: 'dative',
                 358388: 'nominative', 358389: 'dative', 358394: 'nominative'}
    mappings = []
    for card in corrected['cards']:
        metadata = json.loads(card['metadata'] or '{}') if isinstance(card['metadata'], str) else card['metadata'] or {}
        task = card['front_text'].split('::exercise')[0]
        key = ('genitive' if card['deck_id'] == 6990 else 'production' if card['deck_id'] in (6994, 6995, 7138)
            else 'prepositions' if card['deck_id'] in (7140, 7141, 7142) else 'dative' if card['deck_id'] == 6986 else 'case')
        if card['deck_id'] == 7139:
            key = d14_cases.get(card['id'], 'production')
            for word, kind in [('Nominativ', 'nominative'), ('Akkusativ', 'accusative'), ('Dativ', 'dative'),
                ('предлоги', 'prepositions'), ('порядок слов', 'word_order'), ('БОНУС', 'genitive')]:
                if word in task:
                    key = kind
            if card['id'] in (358409, 358410):
                key = 'genitive'
            metadata['assessment'] = {'competency_ids': [f'comp_exam_{key}']}
        mappings.append({'card_id': card['id'], 'rule_code': f'de.relativsaetze.{key}', 'role': 'primary', 'complexity': 3})

        # Full-sentence production must allow semantic equivalents rather than
        # rejecting them merely for word-for-word mismatch. Keep reference + variants.
        match = re.search(r'::exercise\s*\n\[\[([^\]]+)\]\]\s*$', card['front_text'])
        if match and card['deck_id'] in (7138, 7139) and len(match[1].split('|')[0]) > 35:
            variants = match[1].split('|')
            card['front_text'] = card['front_text'][:match.start()] + '::exercise\n@free\nСформулируйте полный немецкий ответ с Relativsatz. Сохраните смысл исходного задания.'
            card['back_text'] = variants[0] + '\n\n' + card['back_text']
            metadata['accepted_answers'] = variants
        if '@free' in card['front_text']:
            metadata['grading_policy'] = {'mode': 'open_text', 'semantic_equivalence': True,
                'grammar_requires_retry': True, 'max_retries': 1 if card['deck_id'] == 7139 else 3}
        if metadata:
            card['metadata'] = json.dumps(metadata, ensure_ascii=False)
        if card['id'] == 358559:
            card['card_type'] = 'standard'
        elif '@free' in card['front_text']:
            card['card_type'] = 'free_text'
        if card['front_text'] != next(c['front_text'] for c in original['cards'] if c['id'] == card['id']):
            card['audio_path'] = None
        if card['back_text'] != next(c['back_text'] for c in original['cards'] if c['id'] == card['id']):
            card['audio_back_path'] = None

    deck = decks[7139]
    metadata = json.loads(deck['metadata'])
    routes = metadata['pedagogy']['review_recommendations']
    route_decks = [[6985, 6993, 6986], [7140, 7141], [6994], [6995, 7138], [6990]]
    metadata['pedagogy']['assessment'] = {'schema_version': 1, 'required_count': 46, 'bonus_count': 2,
        'bands': [{'id': identifier, 'title': title, 'min': lo, 'max': hi} for identifier, title, lo, hi in
            [('ready', 'Уверенное освоение', 41, 46), ('review', 'Точечное повторение', 34, 40),
             ('practice', 'Адресная практика', 25, 33), ('base', 'Повторение базы', 0, 24)]],
        'review_routes': [{**r, 'deck_ids': ids} for r, ids in zip(routes, route_decks)],
        'competency_titles': {f'comp_exam_{key}': title for key, title in names.items()}}
    deck['metadata'] = json.dumps(metadata, ensure_ascii=False)
    for deck_id in (6969, 6970):
        meta = json.loads(decks[deck_id]['metadata'])
        meta['intro']['recommendations'] += ' D01 и D02 — альтернативные объяснения: выберите подходящий вариант, затем переходите к практике.'
        decks[deck_id]['metadata'] = json.dumps(meta, ensure_ascii=False)
    meta = json.loads(decks[6990]['metadata'])
    meta['intro']['recommendations'] = 'Факультативный блок B1+. Можно перейти к D12 и вернуться сюда позже. ' + meta['intro'].get('recommendations', '')
    decks[6990]['metadata'] = json.dumps(meta, ensure_ascii=False)
    corrected['knowledge_seed'] = [{'rule_code': f'de.relativsaetze.{key}', 'name': title,
        'language': 'de', 'category': 'grammar', 'cefr_level': 'B1', 'is_global': True, 'author_id': None,
        'description': 'Относительные предложения: ' + title + '. Проверяйте грамматику и смысл задания; допустимы эквивалентные формулировки.'} for key, title in names.items()]
    corrected['knowledge_mappings'] = mappings
    (OUT / 'corrected.snapshot.json').write_text(json.dumps(corrected, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    changes = {}
    for entity, editable in [('decks', ['metadata']), ('cards', ['front_text', 'back_text', 'context', 'metadata', 'card_type', 'audio_path', 'audio_back_path'])]:
        before = {row['id']: row for row in original[entity]}
        changes[entity] = []
        if {row['id'] for row in corrected[entity]} != set(before):
            raise ValueError(f'{entity}: ID preservation failed')
        for row in corrected[entity]:
            old = before[row['id']]
            if entity == 'cards' and (row['deck_id'], row['position']) != (old['deck_id'], old['position']):
                raise ValueError(f'Card {row["id"]}: ownership/order changed')
            changed = [key for key in editable if row.get(key) != old.get(key)]
            if changed:
                changes[entity].append({'id': row['id'], 'fields': changed,
                    'original': {key: old.get(key) for key in editable},
                    'proposed': {key: row.get(key) for key in editable}})
    plan = {'applied': False, 'requires_author_review': True,
        'source_sha256': hashlib.sha256((OUT / 'pre-change-backup.json').read_bytes()).hexdigest(),
        'folder_id': 285, 'excluded_folder_id': 343,
        'policy': 'Apply only after explicit approval, fresh source comparison and transactional backup. Never update IDs, order, SRS, learner progress, answer/error history or archived content.',
        'changes': changes, 'knowledge_seed': corrected['knowledge_seed'], 'knowledge_mappings': mappings}
    (OUT / 'update-plan.json').write_text(json.dumps(plan, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'decks': len(decks), 'cards': len(cards), 'knowledge_mappings': len(mappings)}))


if __name__ == '__main__':
    prepare()
