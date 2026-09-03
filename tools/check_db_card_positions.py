import sys
import os
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from api.database import initialize_database
initialize_database()
from api import models

folder = models.TMA_Folder.get_by_id(190)
decks = list(models.TMA_Deck.select().where(
    models.TMA_Deck.folder == folder,
    models.TMA_Deck.is_deleted == False
).order_by(models.TMA_Deck.position, models.TMA_Deck.name))

for d in decks[:3]:
    cards = list(models.TMA_Card.select().where(
        models.TMA_Card.deck == d,
        models.TMA_Card.is_deleted == False
    ).order_by(models.TMA_Card.position, models.TMA_Card.id))
    print(f"\nDeck '{d.name}' (ID: {d.id}): {len(cards)} cards")
    for i, c in enumerate(cards[:5]):
        print(f"  Pos {c.position} (id={c.id}): {c.front_text.splitlines()[0]}")
