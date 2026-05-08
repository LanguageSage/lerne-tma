import sqlite3
from pathlib import Path

DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")

def fix_relationships():
    print(f"Fixing card-deck relationships in {DB_PATH}...")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        # We need a mapping from OLD rowid to NEW id for the decks.
        # But wait, I already lost the old rowids? 
        # No, I can use the deck name! 
        # Since I moved cards to decks with specific names, I can re-link them.
        
        # But wait, how do I know which card belonged to which deck name?
        # I should have done this BEFORE deleting the old decks.
        
        # Luckily, I have backups! 
        # deck_backup_pre_unify and card_backup_pre_unify
        
        print("Restoring from backup to fix relationships...")
        # I'll look at the backup tables to see the mapping.
        # Wait, the backup was made AFTER I messed up the IDs? 
        # No, unify_local_tables.py made the backup first.
        
        # Let's check the backup content.
        # cursor.execute("SELECT id, name FROM deck_backup_pre_unify LIMIT 5")
        # print(f"Backup sample: {cursor.fetchall()}")
        
        # If the backup has the '198' IDs and the names, I can link them.
        # Wait, deck_backup_pre_unify is a copy of the OLD 'deck' table.
        # But I was working on 'tma_deck'.
        
        # Did I backup tma_deck? No. 
        # But wait! I have scratch/reorg_mapping.json!
        
        print("Using scratch/reorg_mapping.json to restore links...")
        import json
        with open("scratch/reorg_mapping.json", "r", encoding="utf-8") as f:
            mapping = json.load(f)
            
        # mapping has: "old_deck_id" -> {"new_name": "...", "level": "...", ...}
        
        # I need: new_deck_id (from tma_deck) for each new_name.
        cursor.execute("SELECT id, name FROM tma_deck WHERE is_deleted = 0")
        name_to_new_id = {row[1]: row[0] for row in cursor.fetchall()}
        
        # Now I can map: old_deck_id -> new_deck_id
        old_to_new = {}
        for old_id_str, info in mapping.items():
            new_name = info['new_name']
            if new_name in name_to_new_id:
                old_to_new[int(old_id_str)] = name_to_new_id[new_name]
        
        print(f"Found {len(old_to_new)} ID mappings.")
        
        # Update tma_card and card
        count = 0
        for old_id, new_id in old_to_new.items():
            cursor.execute("UPDATE tma_card SET deck_id = ? WHERE deck_id = ?", (new_id, old_id))
            cursor.execute("UPDATE card SET deck_id = ? WHERE deck_id = ?", (new_id, old_id))
            count += cursor.rowcount
            
        conn.commit()
        print(f"Fixed {count} card links.")

    except Exception as e:
        conn.rollback()
        print(f"Error during fix: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    fix_relationships()
