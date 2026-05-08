import sqlite3
from pathlib import Path

DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")

def check_special_decks():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Try to find common system names
    names = ['Trash', 'Корзина', 'Unsorted', 'Несортированные', 'Archive', 'Архив']
    results = []
    for name in names:
        cursor.execute("SELECT id, name FROM deck WHERE name LIKE ?", (f'%{name}%',))
        results.extend(cursor.fetchall())
        
    print(f"Special Decks: {results}")
    
    # Also check lowest IDs
    cursor.execute("SELECT id, name FROM deck ORDER BY id ASC LIMIT 10")
    # print(f"Lowest ID decks: {cursor.fetchall()}")
    for row in cursor.fetchall():
        print(f"ID: {row[0]}")
    
    conn.close()

if __name__ == "__main__":
    check_special_decks()
