import sys
import os
import json
import shutil
from datetime import datetime

# Set UTF-8 encoding for Windows console
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Set path so api module can be imported
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from api import models

def classify_card(front_text):
    if not front_text:
        return 'standard'
    
    # 1. Trainer / Cloze check: braces {...} ALWAYS mean trainer
    if '{' in front_text and '}' in front_text:
        return 'trainer'
    
    # 2. Quiz check: options with star * or checkbox [*]
    lines = [l.strip() for l in front_text.split('\n') if l.strip()]
    if len(lines) >= 2:
        # Check if any line (after question) starts with * or has [*]
        has_quiz_star = any(l.startswith('*') or '[*]' in l or ' * ' in l for l in lines)
        if has_quiz_star:
            return 'quiz'

    return 'standard'

def run():
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    print(f"=== BACKUP & CARD TYPE MIGRATION ({timestamp}) ===")

    # Initialize Database Connection
    models.initialize_database()

    # Step 1: File & DB Backup
    sqlite_db_path = os.path.join(os.path.dirname(__file__), '../data/tma.db')
    if os.path.exists(sqlite_db_path):
        backup_db_path = os.path.join(os.path.dirname(__file__), f'../data/tma_backup_{timestamp}.db')
        shutil.copy2(sqlite_db_path, backup_db_path)
        print(f"✅ SQLite database backup created: {os.path.basename(backup_db_path)}")

    cards_query = models.TMA_Card.select().where(models.TMA_Card.is_deleted == False)
    all_cards = list(cards_query)
    
    # Export full JSON backup
    cards_json = []
    for c in all_cards:
        cards_json.append({
            "id": c.id,
            "deck_id": c.deck_id,
            "card_type": getattr(c, 'card_type', 'standard'),
            "front_text": c.front_text,
            "back_text": c.back_text,
            "context": c.context,
            "tags": c.tags,
            "created_at": str(c.created_at) if getattr(c, 'created_at', None) else None
        })

    json_backup_path = os.path.join(os.path.dirname(__file__), f'../data/cards_backup_{timestamp}.json')
    with open(json_backup_path, 'w', encoding='utf-8') as f:
        json.dump(cards_json, f, ensure_ascii=False, indent=2)
    print(f"✅ JSON cards backup created: {os.path.basename(json_backup_path)} ({len(all_cards)} cards saved)")

    # Step 2: Classify and Update Card Types
    print("\n--- Classifying and Updating Cards (Optimized Batch) ---")
    trainer_cards = []
    quiz_cards = []
    standard_cards = []

    for card in all_cards:
        new_type = classify_card(card.front_text)
        if new_type == 'trainer':
            trainer_cards.append(card.id)
        elif new_type == 'quiz':
            quiz_cards.append(card.id)
        else:
            standard_cards.append(card.id)

    print(f"  Found {len(trainer_cards)} trainer cards, {len(quiz_cards)} quiz cards, {len(standard_cards)} standard cards.")

    with models.tma_db.atomic():
        if trainer_cards:
            models.TMA_Card.update(card_type='trainer').where(models.TMA_Card.id.in_(trainer_cards)).execute()
        if quiz_cards:
            models.TMA_Card.update(card_type='quiz').where(models.TMA_Card.id.in_(quiz_cards)).execute()
        if standard_cards:
            models.TMA_Card.update(card_type='standard').where(models.TMA_Card.id.in_(standard_cards)).execute()

    print("\n=== MIGRATION SUMMARY ===")
    print(f"Total cards processed: {len(all_cards)}")
    print(f"🏋️ Trainer cards (cloze braces): {len(trainer_cards)}")
    print(f"☑️ Quiz / Test cards (multiple choice): {len(quiz_cards)}")
    print(f"📖 Standard cards (vocab/phrases): {len(standard_cards)}")
    print("=== FINISHED SUCCESSFULLY ===")

if __name__ == '__main__':
    run()
