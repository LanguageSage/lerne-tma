import sys
import os
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from api.database import initialize_database
initialize_database()

from api import models

folder = models.TMA_Folder.get_by_id(190)
decks = list(models.TMA_Deck.select().where(
    models.TMA_Deck.folder == folder,
    models.TMA_Deck.is_deleted == False
).order_by(models.TMA_Deck.position, models.TMA_Deck.name))

print(f'=== FOLDER: \"{folder.name}\" (ID: {folder.id}) ===')
total_cards = 0
total_with_images = 0

for d in decks:
    cards = list(models.TMA_Card.select().where(
        models.TMA_Card.deck == d,
        models.TMA_Card.is_deleted == False
    ))
    c_count = len(cards)
    imgs_count = len([c for c in cards if c.image_path])
    total_cards += c_count
    total_with_images += imgs_count
    img_str = f'({imgs_count} с картинками)' if imgs_count > 0 else ''
    print(f'  ✓ {d.name} -> {c_count} карточек {img_str}')

print(f'\nВсего колод в папке: {len(decks)}')
print(f'Всего карточек в БД: {total_cards}')
print(f'Всего карточек с прикрепленными изображениями: {total_with_images}')
