import sqlite3
from pathlib import Path

DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")

def hard_cleanup():
    print(f"HARD CLEANUP: Removing all deleted records from {DB_PATH}...")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        # Delete records where is_deleted = 1
        cursor.execute("DELETE FROM card WHERE is_deleted = 1")
        cards_deleted = cursor.rowcount
        
        cursor.execute("DELETE FROM deck WHERE is_deleted = 1")
        decks_deleted = cursor.rowcount

        cursor.execute("DELETE FROM tma_card WHERE is_deleted = 1")
        tma_cards_deleted = cursor.rowcount
        
        cursor.execute("DELETE FROM tma_deck WHERE is_deleted = 1")
        tma_decks_deleted = cursor.rowcount

        conn.commit()
        print(f"Removed {decks_deleted} old decks and {cards_deleted} old cards.")
        
        # Vacuum must be outside transaction
        cursor.execute("VACUUM")
        print("Database vacuumed.")

        print(f"Remaining in deck table: {conn.execute('SELECT COUNT(*) FROM deck').fetchone()[0]}")

    except Exception as e:
        print(f"ERROR: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    hard_cleanup()
