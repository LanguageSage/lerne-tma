import sqlite3
import json
import datetime
from pathlib import Path

DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")
ROOT_DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\lerne.db")
MAPPING_PATH = Path("scratch/reorg_mapping.json")

def create_separate_sorted_section():
    print(f"Adding sorted section to {DB_PATH}...")
    
    with open(MAPPING_PATH, "r", encoding="utf-8") as f:
        mapping = {int(k): v for k, v in json.load(f).items()}

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    try:
        # 1. Restore everything first (to have all old decks back)
        # Wait, I already restored the backup in the previous step.
        
        # 2. Get unique new names
        new_names_specs = {}
        for old_id, info in mapping.items():
            name = f"⭐ {info['new_name']}" # Added a star to distinguish them
            if name not in new_names_specs:
                new_names_specs[name] = {"level": info['level'], "topic": info['topic']}

        # 3. Create these 26 decks with NEW IDs at the end
        cursor.execute("SELECT MAX(id) FROM deck")
        next_id = max(cursor.fetchone()[0] or 0, 500) + 1
        
        name_to_new_id = {}
        print(f"Creating {len(new_names_specs)} sorted decks starting from ID {next_id}...")
        
        for name, spec in new_names_specs.items():
            cursor.execute("""
                INSERT INTO deck (id, name, level, topic, is_deleted, created_at, updated_at)
                VALUES (?, ?, ?, ?, 0, ?, ?)
            """, (next_id, name, spec['level'], spec['topic'], now, now))
            
            cursor.execute("""
                INSERT INTO tma_deck (id, name, level, topic, is_deleted, user_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, 0, (SELECT user_id FROM tma_deck LIMIT 1), ?, ?)
            """, (next_id, name, spec['level'], spec['topic'], now, now))
            
            name_to_new_id[name] = next_id
            next_id += 1

        # 4. Move cards that belong to these new names
        print("Moving sorted cards into the new section...")
        moved_count = 0
        for old_id, info in mapping.items():
            new_name = f"⭐ {info['new_name']}"
            new_id = name_to_new_id[new_name]
            
            cursor.execute("UPDATE card SET deck_id = ? WHERE deck_id = ?", (new_id, old_id))
            cursor.execute("UPDATE tma_card SET deck_id = ? WHERE deck_id = ?", (new_id, old_id))
            moved_count += cursor.rowcount

        conn.commit()
        print(f"SUCCESS! Created 26 sorted decks and moved {moved_count} cards.")

        # Sync to root
        conn.close()
        import shutil
        shutil.copy(DB_PATH, ROOT_DB_PATH)
        print("Synced to root lerne.db")

    except Exception as e:
        if conn: conn.rollback()
        print(f"ERROR: {e}")
    finally:
        if conn: conn.close()

if __name__ == "__main__":
    create_separate_sorted_section()
