import sqlite3
from pathlib import Path

DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")
ROOT_DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\lerne.db")

def sync_cards_to_legacy():
    print(f"Syncing missing cards from TMA to Legacy table in {DB_PATH}...")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        # Get all cards from the new 26 decks in TMA
        cursor.execute("SELECT * FROM tma_card WHERE deck_id BETWEEN 501 AND 526")
        tma_cards = cursor.fetchall()
        
        # Get existing IDs in Legacy card table
        cursor.execute("SELECT id FROM card")
        existing_legacy_ids = {row[0] for row in cursor.fetchall()}
        
        added_count = 0
        for tcard in tma_cards:
            if tcard['id'] not in existing_legacy_ids:
                # Insert missing card into legacy table
                # We need to map columns. Legacy card has more columns usually.
                cols = [
                    'id', 'deck_id', 'front_text', 'back_text', 'context', 
                    'audio_path', 'image_path', 'tags', 'topics', 'metadata', 
                    'created_at', 'updated_at', 'history', 'is_deleted', 'image_data',
                    'video_front_path', 'video_back_path', 'difficulty', 'card_type', 'source'
                ]
                
                # Filter columns that exist in tma_card
                tma_cols = tcard.keys()
                common_cols = [c for c in cols if c in tma_cols]
                
                placeholders = ",".join(["?"] * len(common_cols))
                col_names = ",".join(common_cols)
                
                query = f"INSERT INTO card ({col_names}) VALUES ({placeholders})"
                cursor.execute(query, [tcard[c] for c in common_cols])
                added_count += 1
                
        conn.commit()
        print(f"SUCCESS! Added {added_count} missing cards to the Mind Map.")
        print(f"Total cards in Legacy sorted section: {conn.execute('SELECT COUNT(*) FROM card WHERE deck_id BETWEEN 501 AND 526').fetchone()[0]}")

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
    sync_cards_to_legacy()
