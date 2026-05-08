import sqlite3
from pathlib import Path

DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")

def list_tables():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [row[0] for row in cursor.fetchall()]
    print(f"Tables: {tables}")
    
    # Check for external/library decks
    possible_tables = ['external_deck', 'community_deck', 'tma_external_deck', 'library_deck']
    for t in possible_tables:
        if t in tables:
            cursor.execute(f"SELECT COUNT(*) FROM {t}")
            print(f"Table {t} has {cursor.fetchone()[0]} rows.")
            
    conn.close()

if __name__ == "__main__":
    list_tables()
