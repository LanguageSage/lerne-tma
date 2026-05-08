import sqlite3
from pathlib import Path

DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")
ROOT_DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\lerne.db")

def force_sync_card_locations():
    print(f"Force syncing card locations from TMA to Legacy in {DB_PATH}...")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        # Update deck_id in legacy 'card' table to match 'tma_card' table for all cards
        cursor.execute("""
            UPDATE card 
            SET deck_id = (SELECT tma_card.deck_id FROM tma_card WHERE tma_card.id = card.id)
            WHERE id IN (SELECT id FROM tma_card WHERE deck_id BETWEEN 501 AND 526)
        """)
        
        updated_count = cursor.rowcount
        conn.commit()
        
        print(f"SUCCESS! Re-aligned {updated_count} cards in the Mind Map.")
        
        # Verify final count
        cursor.execute("SELECT COUNT(*) FROM card WHERE deck_id BETWEEN 501 AND 526")
        print(f"Total cards in Legacy sorted section: {cursor.fetchone()[0]}")

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
    force_sync_card_locations()
