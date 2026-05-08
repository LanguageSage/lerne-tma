import sqlite3
from pathlib import Path

DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")

def find_archive_a1():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    # Search for exactly "Архив А1" or similar in name
    cursor.execute("SELECT id, name FROM deck WHERE name LIKE '%Архив%А1%' OR name LIKE '%Archive%A1%'")
    results = cursor.fetchall()
    if results:
        for row in results:
            print(f"Found Archive Deck: ID={row[0]}")
    else:
        print("Archive A1 deck not found in 'deck' table.")
    conn.close()

if __name__ == "__main__":
    find_archive_a1()
