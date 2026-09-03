import json
import os
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from api.database import initialize_database
initialize_database()

from api import models, services
from tools.fix_bb_he_data import bb_questions, he_questions

# 1. Update lidQuestions.json
json_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'app', 'src', 'data', 'lidQuestions.json'))
with open(json_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

# Replace BB and HE questions
filtered_qs = []
for q in data['questions']:
    if q.get('stateCode') == 'BB':
        continue
    if q.get('stateCode') == 'HE':
        continue
    filtered_qs.append(q)

# Add fixed BB and HE questions
filtered_qs.extend(bb_questions)
filtered_qs.extend(he_questions)

# Separate into general and states
general_qs = [q for q in filtered_qs if q.get('block') in [1, 2, 3]]
# Sort general by int(num)
general_qs.sort(key=lambda q: int(q['num']))

states_order = ['BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH']
ordered_state_qs = []
for st in states_order:
    st_qs = [q for q in filtered_qs if q.get('stateCode') == st]
    # sort by question number within state
    def get_st_num(q):
        try:
            return int(str(q['num']).split('-')[-1])
        except Exception:
            return 0
    st_qs.sort(key=get_st_num)
    ordered_state_qs.extend(st_qs)

all_ordered_qs = general_qs + ordered_state_qs
data['questions'] = all_ordered_qs
data['totalQuestions'] = len(all_ordered_qs)

with open(json_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"Updated {json_path} successfully. Total questions: {len(all_ordered_qs)}")

# 2. Reseed Database for user aruna27
user = models.TMAUser.get_or_none(models.TMAUser.username == 'Aruna27')
if not user:
    user = models.TMAUser.get_or_none(models.TMAUser.user_id == 642478257)

user_id = user.user_id
print(f"Target user: {user.username} (ID: {user_id})")

root_folder = models.TMA_Folder.get_by_id(190)
print(f"Folder: {root_folder.name} (ID: {root_folder.id})")

# General Decks
general_deck_configs = [
    (1, "1. Politik in der Demokratie (1–100)", 1),
    (2, "2. Geschichte und Verantwortung (101–200)", 2),
    (3, "3. Mensch und Gesellschaft (201–300)", 3)
]

for block_num, deck_name, pos in general_deck_configs:
    deck = models.TMA_Deck.get_or_none(
        (models.TMA_Deck.user_id == user_id) &
        (models.TMA_Deck.folder == root_folder) &
        (models.TMA_Deck.name == deck_name) &
        (models.TMA_Deck.is_deleted == False)
    )
    if not deck:
        deck = models.TMA_Deck.create(
            user_id=user_id,
            folder=root_folder,
            name=deck_name,
            target_language='de',
            level='B1',
            is_pinned=True,
            position=pos
        )
    else:
        deck.position = pos
        deck.is_pinned = True
        deck.save()

    block_qs = [q for q in general_qs if q['block'] == block_num]
    block_qs.sort(key=lambda q: int(q['num']))

    # Delete existing cards in deck
    models.TMA_Card.delete().where(models.TMA_Card.deck == deck).execute()

    for idx, q in enumerate(block_qs):
        q_num = q['num']
        opts_str = '\n'.join([
            ('*' + o['text'] if o['id'] == q['correctOption'] else o['text'])
            for o in q['options']
        ])
        front_text = f"{q['question']}\n\n{opts_str}"
        back_ru = q.get('translationRu', {}).get('question', '') if q.get('translationRu') else ''
        context = q.get('context', '')
        back_text = back_ru
        if context:
            back_text = f"{back_text}\n\n💡 {context}".strip()
            
        img_filename = os.path.basename(q['image']) if q.get('image') else ''

        import datetime
        now = datetime.datetime.now()
        models.TMA_Card.create(
            deck=deck,
            user_id=user_id,
            creator_id=user_id,
            front_text=front_text,
            back_text=back_text,
            context=context or '',
            image_path=img_filename if img_filename else '',
            card_type='quiz',
            source='bamf_lid',
            position=idx + 1,
            is_deleted=False,
            created_at=now,
            updated_at=now
        )
    print(f"  ✓ Deck '{deck_name}' populated with {len(block_qs)} cards (positions 1..{len(block_qs)})")

# State Decks
state_names_map = {
    'BW': 'Baden-Württemberg',
    'BY': 'Bayern',
    'BE': 'Berlin',
    'BB': 'Brandenburg',
    'HB': 'Bremen',
    'HH': 'Hamburg',
    'HE': 'Hessen',
    'MV': 'Mecklenburg-Vorpommern',
    'NI': 'Niedersachsen',
    'NW': 'Nordrhein-Westfalen',
    'RP': 'Rheinland-Pfalz',
    'SL': 'Saarland',
    'SN': 'Sachsen',
    'ST': 'Sachsen-Anhalt',
    'SH': 'Schleswig-Holstein',
    'TH': 'Thüringen'
}

# Sort states alphabetically by German name for clean deck positioning (4..19)
sorted_states = sorted(states_order, key=lambda code: state_names_map[code])

for pos_idx, st_code in enumerate(sorted_states, start=4):
    deck_name = state_names_map[st_code]
    deck = models.TMA_Deck.get_or_none(
        (models.TMA_Deck.user_id == user_id) &
        (models.TMA_Deck.folder == root_folder) &
        (models.TMA_Deck.name == deck_name) &
        (models.TMA_Deck.is_deleted == False)
    )
    if not deck:
        deck = models.TMA_Deck.create(
            user_id=user_id,
            folder=root_folder,
            name=deck_name,
            target_language='de',
            level='B1',
            is_pinned=False,
            position=pos_idx
        )
    else:
        deck.position = pos_idx
        deck.save()

    st_qs = [q for q in ordered_state_qs if q.get('stateCode') == st_code]
    st_qs.sort(key=lambda q: int(str(q['num']).split('-')[-1]))

    # Delete existing cards in state deck
    models.TMA_Card.delete().where(models.TMA_Card.deck == deck).execute()

    for idx, q in enumerate(st_qs):
        q_num = q['num']
        opts_str = '\n'.join([
            ('*' + o['text'] if o['id'] == q['correctOption'] else o['text'])
            for o in q['options']
        ])
        front_text = f"{q['question']}\n\n{opts_str}"
        back_ru = q.get('translationRu', {}).get('question', '') if q.get('translationRu') else ''
        context = q.get('context', '')
        back_text = back_ru
        if context:
            back_text = f"{back_text}\n\n💡 {context}".strip()
            
        img_filename = os.path.basename(q['image']) if q.get('image') else ''

        models.TMA_Card.create(
            deck=deck,
            user_id=user_id,
            creator_id=user_id,
            front_text=front_text,
            back_text=back_text,
            context=context or '',
            image_path=img_filename if img_filename else '',
            card_type='quiz',
            source='bamf_lid',
            position=idx + 1,
            is_deleted=False,
            created_at=now,
            updated_at=now
        )
    print(f"  ✓ State Deck '{deck_name}' populated with {len(st_qs)} cards (positions 1..{len(st_qs)})")

print("\n=== ALL 460 CARDS IN 19 DECKS HAVE BEEN RESEEDED IN EXACT BAMF 300 ORDER! ===")
