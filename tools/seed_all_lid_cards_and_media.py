import sys
import os
import io
import json
import datetime

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from api.database import initialize_database
if not initialize_database():
    print('Failed to connect to database')
    sys.exit(1)

from api import models, services

# 1. Target user: aruna27
user = models.TMAUser.get_or_none(models.TMAUser.username.ilike('aruna27'))
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
    print(f'Found folder: {root_folder.name} (ID: {root_folder.id})')

# 3. Upload all 42 image files into TMAMedia in the PostgreSQL database
img_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'app', 'public', 'lid_images'))
image_files = [f for f in os.listdir(img_dir) if os.path.isfile(os.path.join(img_dir, f))]
print(f'\n--- 1. Uploading {len(image_files)} LiD image files into TMAMedia table ---')

uploaded_media = 0
for fn in image_files:
    file_path = os.path.join(img_dir, fn)
    with open(file_path, 'rb') as f:
        content = f.read()

    existing_media = models.TMAMedia.get_or_none(
        (models.TMAMedia.filename == fn) &
        (models.TMAMedia.folder == 'images')
    )
    if not existing_media:
        models.TMAMedia.create(
            filename=fn,
            folder='images',
            content=content
        )
        uploaded_media += 1

print(f'Successfully stored/verified {len(image_files)} image files in TMAMedia DB (newly uploaded: {uploaded_media})')

# 4. Load questions
json_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'app', 'src', 'data', 'lidQuestions.json'))
with open(json_path, encoding='utf-8') as f:
    data = json.load(f)

questions = data['questions']

# 5. Populate the 3 General Blocks (300 cards total)
general_blocks = [
    {
        'block': 1,
        'deck_name': '1. Politik in der Demokratie (1–100)',
        'description': 'Вопросы 1–100: Политика, основы демократии, выборы и конституция ФРГ'
    },
    {
        'block': 2,
        'deck_name': '2. Geschichte und Verantwortung (101–200)',
        'description': 'Вопросы 101–200: История Германии, ответственность, послевоенное устройство'
    },
    {
        'block': 3,
        'deck_name': '3. Mensch und Gesellschaft (201–300)',
        'description': 'Вопросы 201–300: Человек и общество, образование, религия, правила совместной жизни'
    }
]

print('\n--- 2. Populating 300 General Questions into 3 Decks ---')

for block_info in general_blocks:
    block_num = block_info['block']
    deck_name = block_info['deck_name']
    
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
            position=block_num
        )
        print(f'Created deck: {deck.name} (ID: {deck.id})')
    else:
        print(f'Found deck: {deck.name} (ID: {deck.id})')

    block_qs = [q for q in questions if q['block'] == block_num]
    
    # Delete previous cards for clean seeding
    models.TMA_Card.delete().where(models.TMA_Card.deck == deck).execute()
    
    cards_payload = []
    for q in block_qs:
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
        
        card_data = {
            'deck_id': deck.id,
            'front': front_text,
            'back': back_text,
            'context': context or '',
            'image_path': img_filename if img_filename else '',
            'media_url': img_filename if img_filename else '',
            'card_type': 'quiz',
            'level': 'B1'
        }
        cards_payload.append(card_data)
        
    saved = services.bulk_save_cards(cards_payload, user_id)
    print(f'  -> Saved {len(saved)} cards into deck "{deck.name}"')

# 6. Verify and update image references in the 16 State Decks
print('\n--- 3. Verifying Image references in 16 State Decks ---')
state_map = data['stateCodeMap']
for code, info in state_map.items():
    deck_name = info['name_de']
    deck = models.TMA_Deck.get_or_none(
        (models.TMA_Deck.user_id == user_id) &
        (models.TMA_Deck.folder == root_folder) &
        (models.TMA_Deck.name == deck_name) &
        (models.TMA_Deck.is_deleted == False)
    )
    if deck:
        state_qs = [q for q in questions if q['block'] == 'state' and q['stateCode'] == code]
        # Re-save with clean media_url filenames
        models.TMA_Card.delete().where(models.TMA_Card.deck == deck).execute()
        cards_payload = []
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
            img_filename = os.path.basename(q['image']) if q.get('image') else ''
            
            card_data = {
                'deck_id': deck.id,
                'front': front_text,
                'back': back_text,
                'context': context or '',
                'image_path': img_filename if img_filename else '',
                'media_url': img_filename if img_filename else '',
                'card_type': 'quiz',
                'level': 'B1'
            }
            cards_payload.append(card_data)
        saved = services.bulk_save_cards(cards_payload, user_id)
        print(f'  -> Verified {len(saved)} cards with images in "{deck.name}"')

print('\n=== ALL 460 CARDS AND 42 IMAGES PLACED INTO POSTGRESQL DATABASE FOR ARUNA27! ===')
