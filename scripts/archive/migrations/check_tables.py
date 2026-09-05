import sqlite3
import os

# Проверяем оба возможных места хранения
databases = [
    ('TMA Progress', 'api/data/tma.db'),
    ('Lerne Library', r'C:\121\Lerne_projekt\Lerne\db\lerne.db')
]

for name, db_path in databases:
    print(f"\nChecking {name} at {db_path}...")
    if not os.path.exists(db_path):
        print(f"  FAILED: File not found.")
        continue
        
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Получаем список таблиц
        tables = [r[0] for r in cursor.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        print(f"  Tables: {tables}")
        
        # Проверяем наличие колод
        deck_table = 'tma_deck' if 'tma_deck' in tables else ('deck' if 'deck' in tables else None)
        if deck_table:
            decks = cursor.execute(f"SELECT id, name FROM {deck_table}").fetchall()
            print(f"  Found {len(decks)} decks in {deck_table}: {decks}")
        else:
            print(f"  No deck table found.")
            
        conn.close()
    except Exception as e:
        print(f"  ERROR: {e}")
