import sys
import os
import io
import json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from api.database import initialize_database
if not initialize_database():
    print('Failed to connect to database')
    sys.exit(1)

from api import models, services

# 1. Target user: aruna27
target_username = 'aruna27'
user = models.TMAUser.get_or_none(models.TMAUser.username.ilike(target_username))
if not user:
    user = models.TMAUser.get_or_none(models.TMAUser.user_id == 642478257)

if not user:
    print('User aruna27 not found!')
    sys.exit(1)

user_id = user.user_id
print(f'Target user: {user.username} (ID: {user_id})')

# 2. Find or create root folder 'Leben in Deutschland'
folder_name = 'Leben in Deutschland'
root_folder = models.TMA_Folder.get_or_none(
    (models.TMA_Folder.user_id == user_id) &
    (models.TMA_Folder.name == folder_name) &
    (models.TMA_Folder.is_deleted == False)
)

if not root_folder:
    root_folder = models.TMA_Folder.create(
        user_id=user_id,
        name=folder_name,
        color='#ffd043',
        target_language='de'
    )
    print(f'Created folder: {root_folder.name} (ID: {root_folder.id})')
else:
    print(f'Found existing folder: {root_folder.name} (ID: {root_folder.id})')

# 3. Load question dataset
json_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'app', 'src', 'data', 'lidQuestions.json'))
with open(json_path, encoding='utf-8') as f:
    data = json.load(f)

questions = data['questions']
state_map = data['stateCodeMap']

total_inserted = 0

# 4. Iterate over 16 Bundesländer
for code, info in state_map.items():
    deck_name = info['name_de']
    
    deck = models.TMA_Deck.get_or_none(
        (models.TMA_Deck.user_id == user_id) &
        (models.TMA_Deck.folder_id == root_folder.id) &
        (models.TMA_Deck.name == deck_name) &
        (models.TMA_Deck.is_deleted == False)
    )
    
    if not deck:
        deck = models.TMA_Deck.create(
            user_id=user_id,
            folder=root_folder,
            name=deck_name,
            target_language='de',
            level='B1'
        )
        print(f'Created deck: {deck.name} (ID: {deck.id})')
    else:
        print(f'Found existing deck: {deck.name} (ID: {deck.id})')

    # Check existing cards in deck
    existing_cards_count = models.TMA_Card.select().where(
        (models.TMA_Card.deck == deck) &
        (models.TMA_Card.is_deleted == False)
    ).count()

    state_qs = [q for q in questions if q['block'] == 'state' and q['stateCode'] == code]

    if existing_cards_count < 10:
        models.TMA_Card.delete().where(models.TMA_Card.deck == deck).execute()
        
        cards_to_insert = []
        for q in state_qs:
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
                
            card_payload = {
                'deck_id': deck.id,
                'front': front_text,
                'back': back_text,
                'context': context or '',
                'media_url': q.get('image') or '',
                'card_type': 'quiz',
                'level': 'B1'
            }
            cards_to_insert.append(card_payload)
            
        saved = services.bulk_save_cards(cards_to_insert, user_id)
        print(f'  -> Inserted {len(saved)} quiz cards into {deck.name}')
        total_inserted += len(saved)
    else:
        print(f'  -> Deck {deck.name} already has {existing_cards_count} cards.')

print(f'\nSUCCESS: All 16 Bundesland decks and {total_inserted} cards populated in database for {user.username}!')
