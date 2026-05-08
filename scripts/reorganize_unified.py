import sqlite3
import json
import datetime
from pathlib import Path

DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")
MAPPING_PATH = Path("scratch/reorg_mapping.json")

def reorganize_unified():
    print(f"Reorganizing and unifying decks in {DB_PATH}...")
    
    with open(MAPPING_PATH, "r", encoding="utf-8") as f:
        mapping = {int(k): v for k, v in json.load(f).items()}
        
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    try:
        # Get all unique new deck names and their levels/topics
        new_deck_specs = {}
        for old_id, info in mapping.items():
            name = info['new_name']
            if name not in new_deck_specs:
                new_deck_specs[name] = {"level": info['level'], "topic": info['topic']}
        
        # 1. Create new decks in BOTH tables
        print(f"Creating {len(new_deck_specs)} unified categories...")
        name_to_id = {}
        
        # Find max ID across both tables to avoid collisions
        cursor.execute("SELECT MAX(id) FROM tma_deck")
        max_tma = cursor.fetchone()[0] or 0
        cursor.execute("SELECT MAX(id) FROM deck")
        max_legacy = cursor.fetchone()[0] or 0
        next_id = max(max_tma, max_legacy, 1000) + 1
        
        for name, spec in new_deck_specs.items():
            deck_id = next_id
            next_id += 1
            name_to_id[name] = deck_id
            
            # Insert into tma_deck
            # We assume user_id 1 for now or take it from any existing deck
            cursor.execute("SELECT user_id FROM tma_deck LIMIT 1")
            user_id = cursor.fetchone()[0] if cursor.rowcount > 0 else 0
            
            cursor.execute("""
                INSERT INTO tma_deck (id, name, level, topic, is_deleted, user_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, 0, ?, ?, ?)
            """, (deck_id, name, spec['level'], spec['topic'], user_id, now, now))
            
            # Insert into deck
            cursor.execute("""
                INSERT INTO deck (id, name, level, topic, is_deleted, created_at, updated_at)
                VALUES (?, ?, ?, ?, 0, ?, ?)
            """, (deck_id, name, spec['level'], spec['topic'], now, now))

        # 2. Move cards in BOTH tables
        print("Moving cards to new categories...")
        for old_id, info in mapping.items():
            new_id = name_to_id[info['new_name']]
            
            # Update tma_card
            cursor.execute("UPDATE tma_card SET deck_id = ? WHERE deck_id = ?", (new_id, old_id))
            # Update legacy card
            cursor.execute("UPDATE card SET deck_id = ? WHERE deck_id = ?", (new_id, old_id))
            
        # 3. Mark old decks as deleted
        print("Cleaning up old decks...")
        old_ids = list(mapping.keys())
        placeholders = ",".join(["?"] * len(old_ids))
        cursor.execute(f"UPDATE tma_deck SET is_deleted = 1 WHERE id IN ({placeholders})", old_ids)
        cursor.execute(f"UPDATE deck SET is_deleted = 1 WHERE id IN ({placeholders})", old_ids)
        
        # 4. Final Cleanup: Ensure no empty decks are visible
        # (Already handled by marking old ones as deleted, but just in case)
        
        conn.commit()
        print("SUCCESS! Local tables are unified and reorganized.")
        
    except Exception as e:
        conn.rollback()
        print(f"ERROR: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    reorganize_unified()
