import sqlite3
from pathlib import Path

DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")

def check_db_state():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Check for "Архив А1"
    cursor.execute("SELECT id, name FROM deck WHERE name LIKE '%Архив%' OR name LIKE '%Archive%'")
    archives = cursor.fetchall()
    print(f"Archive decks found: {archives}")
    
    # Check for my "star" decks
    cursor.execute("SELECT id, name FROM deck WHERE name LIKE '⭐%'")
    star_decks = cursor.fetchall()
    print(f"Star decks found: {len(star_decks)}")
    
    # Check for any other new decks created "in another window"
    cursor.execute("SELECT id, name FROM deck ORDER BY id DESC LIMIT 10")
    print(f"Last 10 decks added: {cursor.fetchall()}")
    
    conn.close()

if __name__ == "__main__":
    check_db_state()
