import sqlite3
from pathlib import Path

DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")
ROOT_DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\lerne.db")

def move_to_archive_a1():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # We update the 'topic' field to 'Архив А1' for our 26 decks (IDs 501-526)
    # This acts as a folder in many Mind Map apps.
    
    archive_name = "Архив А1"
    
    print(f"Moving 26 star decks to topic '{archive_name}'...")
    
    cursor.execute("""
        UPDATE deck 
        SET topic = ? 
        WHERE name LIKE '⭐%' AND id >= 501 AND id <= 526
    """, (archive_name,))
    
    updated_legacy = cursor.rowcount
    
    cursor.execute("""
        UPDATE tma_deck 
        SET topic = ? 
        WHERE name LIKE '⭐%' AND id >= 501 AND id <= 526
    """, (archive_name,))
    
    updated_tma = cursor.rowcount
    
    conn.commit()
    conn.close()
    
    # Sync to root
    import shutil
    shutil.copy(DB_PATH, ROOT_DB_PATH)
    
    print(f"SUCCESS! Updated {updated_legacy} decks in Legacy and {updated_tma} in TMA.")

if __name__ == "__main__":
    move_to_archive_a1()
