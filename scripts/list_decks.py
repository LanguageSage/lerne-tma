import sqlite3
import json
from pathlib import Path

def list_decks():
    db_path = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("SELECT id, name FROM tma_deck WHERE is_deleted = 0")
    decks = [dict(row) for row in cursor.fetchall()]
    
    output_path = Path("scratch/decks_list.json")
    os.makedirs(output_path.parent, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(decks, f, ensure_ascii=False, indent=2)
    
    print(f"Found {len(decks)} decks. List saved to {output_path}")
    conn.close()

if __name__ == "__main__":
    import os
    list_decks()
