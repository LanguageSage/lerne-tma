import sqlite3
from pathlib import Path

DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")

def check_topic_archive():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, topic FROM deck WHERE topic LIKE '%Архив%'")
    for row in cursor.fetchall():
        print(f"ID: {row[0]}, Name: {row[1]}, Topic: {row[2]}")
    conn.close()

if __name__ == "__main__":
    check_topic_archive()
