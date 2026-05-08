import sqlite3
import json
import datetime
from pathlib import Path

DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")
ROOT_DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\lerne.db")
MAPPING_PATH = Path("scratch/reorg_mapping.json")

def gentle_reorganize():
    print(f"GENTLE REORGANIZATION: Preserving existing IDs in {DB_PATH}...")
    
    with open(MAPPING_PATH, "r", encoding="utf-8") as f:
        mapping = {int(k): v for k, v in json.load(f).items()}

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    try:
        # Group old IDs by their new target names
        new_names_to_old_ids = {}
        for old_id, info in mapping.items():
            new_name = info['new_name']
            if new_name not in new_names_to_old_ids:
                new_names_to_old_ids[new_name] = []
            new_names_to_old_ids[new_name].append(old_id)

        print(f"Mapping {len(mapping)} old decks to {len(new_names_to_old_ids)} new categories...")

        for new_name, old_ids in new_names_to_old_ids.items():
            # 1. Pick the SMALLEST old ID to be the "Master" for this category
            master_id = min(old_ids)
            info = mapping[master_id]
            
            # print(f"Updating deck {master_id} -> {new_name}")
            
            # Update Master Deck in both tables
            cursor.execute("""
                UPDATE deck SET name = ?, level = ?, topic = ?, is_deleted = 0, updated_at = ?
                WHERE id = ?
            """, (new_name, info['level'], info['topic'], now, master_id))
            
            cursor.execute("""
                UPDATE tma_deck SET name = ?, level = ?, topic = ?, is_deleted = 0, updated_at = ?
                WHERE id = ?
            """, (new_name, info['level'], info['topic'], now, master_id))

            # 2. Move cards from ALL other old IDs in this group to the Master ID
            other_ids = [i for i in old_ids if i != master_id]
            if other_ids:
                placeholders = ",".join(["?"] * len(other_ids))
                cursor.execute(f"UPDATE card SET deck_id = ? WHERE deck_id IN ({placeholders})", [master_id] + other_ids)
                cursor.execute(f"UPDATE tma_card SET deck_id = ? WHERE deck_id IN ({placeholders})", [master_id] + other_ids)
                
                # 3. Delete the "slave" decks as they are now empty and redundant
                cursor.execute(f"DELETE FROM deck WHERE id IN ({placeholders})", other_ids)
                cursor.execute(f"DELETE FROM tma_deck WHERE id IN ({placeholders})", other_ids)

        # 4. Handle decks NOT in mapping (optional cleanup)
        # We'll just mark them as deleted for now to avoid losing data if AI missed something
        all_mapped_ids = list(mapping.keys())
        # Actually, let's keep the master IDs
        master_ids = [min(ids) for ids in new_names_to_old_ids.values()]
        
        # Delete ANY deck that wasn't chosen as a master and was in the mapping
        # (Already done in step 3)
        
        # What about decks NOT in mapping at all?
        cursor.execute("SELECT id FROM deck WHERE id NOT IN (SELECT id FROM deck WHERE name LIKE '[%')") # Simple heuristic
        # Actually, let's not be too aggressive.
        
        conn.commit()
        print("SUCCESS! Local database reorganized with ID preservation.")

        # Sync back to root file
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
    gentle_reorganize()
