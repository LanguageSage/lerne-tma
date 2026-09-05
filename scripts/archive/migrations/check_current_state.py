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

def check_db_state():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Check for "Архив А1"
    cursor.execute("SELECT id, name, topic FROM deck WHERE name LIKE '%Архив%' OR name LIKE '%Archive%' OR topic LIKE '%Архив%'")
    archives = cursor.fetchall()
    print(f"Archive decks/topics found: {archives}")
    
    # Check for my "star" decks
    cursor.execute("SELECT id, name, topic FROM deck WHERE name LIKE '⭐%'")
    star_decks = cursor.fetchall()
    print(f"Star decks found: {len(star_decks)}")
    for d in star_decks:
        print(f"  ID: {d[0]}, Name: {d[1]}, Topic: {d[2]}")
    
    # Check for any other new decks created "in another window"
    cursor.execute("SELECT id, name, topic FROM deck ORDER BY id DESC LIMIT 10")
    print(f"Last 10 decks added:")
    for d in cursor.fetchall():
        print(f"  ID: {d[0]}, Name: {d[1]}, Topic: {d[2]}")
    
    conn.close()

if __name__ == "__main__":
    check_db_state()
