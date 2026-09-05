import sqlite3
from pathlib import Path
import sys

# Set encoding for Windows console
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass

DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")
ROOT_DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\lerne.db")

def move_to_archive_a1():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    archive_name = "Архив А1"
    print(f"Moving 26 star decks to topic '{archive_name}'...")
    
    # Check tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [row[0] for row in cursor.fetchall()]
    
    updated_legacy = 0
    if 'deck' in tables:
        cursor.execute("""
            UPDATE deck 
            SET topic = ? 
            WHERE name LIKE '⭐%' AND id >= 501 AND id <= 526
        """, (archive_name,))
        updated_legacy = cursor.rowcount
    
    updated_tma = 0
    if 'tma_deck' in tables:
        cursor.execute("""
            UPDATE tma_deck 
            SET topic = ? 
            WHERE name LIKE '⭐%' AND id >= 501 AND id <= 526
        """, (archive_name,))
        updated_tma = cursor.rowcount
    elif 'tma_deck_old' in tables:
        print("Found 'tma_deck_old' instead of 'tma_deck'. Updating it too...")
        cursor.execute("""
            UPDATE tma_deck_old 
            SET topic = ? 
            WHERE name LIKE '⭐%' AND id >= 501 AND id <= 526
        """, (archive_name,))
        updated_tma = cursor.rowcount

    conn.commit()
    conn.close()
    
    # Sync to root
    try:
        import shutil
        shutil.copy(DB_PATH, ROOT_DB_PATH)
        print(f"Synced {DB_PATH} to {ROOT_DB_PATH}")
    except Exception as e:
        print(f"Warning: Could not sync to root: {e}")
    
    print(f"SUCCESS! Updated {updated_legacy} decks in Legacy and {updated_tma} in TMA-related tables.")

if __name__ == "__main__":
    move_to_archive_a1()
