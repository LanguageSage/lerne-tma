import sqlite3
from pathlib import Path

DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")

def pure_purge():
    print(f"PURE PURGE: Keeping only the 26 new decks in {DB_PATH}...")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        # We know our new decks have IDs starting from 2001
        # Let's verify that.
        cursor.execute("SELECT id, name FROM deck WHERE id > 2000")
        new_decks = cursor.fetchall()
        print(f"Found {len(new_decks)} new decks.")

        if len(new_decks) == 0:
            print("ERROR: No new decks found! Aborting purge.")
            return

        # Delete all decks NOT in the new list
        cursor.execute("DELETE FROM deck WHERE id <= 2000")
        decks_deleted = cursor.rowcount
        
        # Delete all cards pointing to deleted decks
        # First, find cards that don't belong to new decks
        cursor.execute("DELETE FROM card WHERE deck_id <= 2000")
        cards_deleted = cursor.rowcount

        # Do the same for TMA tables to be 100% clean
        cursor.execute("DELETE FROM tma_deck WHERE id <= 2000")
        cursor.execute("DELETE FROM tma_card WHERE deck_id <= 2000")

        conn.commit()
        cursor.execute("VACUUM")
        
        print(f"SUCCESS! Deleted {decks_deleted} old messy decks and {cards_deleted} cards.")
        print(f"Final deck count: {conn.execute('SELECT COUNT(*) FROM deck').fetchone()[0]}")

    except Exception as e:
        conn.rollback()
        print(f"ERROR: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    pure_purge()
