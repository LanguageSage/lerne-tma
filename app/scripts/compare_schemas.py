import sqlite3
import json
import os

backup_file = 'c:\\121\\Lerne_projekt\\tma\\api\\data\\supabase_schema_sample.json'
db_path = 'c:\\121\\Lerne_projekt\\tma\\api\\data\\lerne.db'

def compare_schemas():
    if not os.path.exists(backup_file):
        print("Backup file not found.")
        return

    with open(backup_file, 'r', encoding='utf-8') as f:
        data = json.load(f)

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    for table, rows in data.items():
        if not rows: 
            print(f"\nChecking table: {table} (NO DATA IN CLOUD)")
            continue
        
        print(f"\nChecking table: {table}")
        # Get columns from JSON
        json_cols = set(rows[0].keys())
        
        # Get columns from local SQLite
        try:
            cursor.execute(f"PRAGMA table_info({table})")
            local_cols = set([col[1] for col in cursor.fetchall()])
        except Exception as e:
            print(f"Table {table} does not exist locally! Error: {e}")
            continue
            
        missing = json_cols - local_cols
        extra = local_cols - json_cols
        if missing:
            print(f"Missing columns locally: {missing}")
        if extra:
            print(f"Extra columns locally (probably fine): {extra}")
        if not missing:
            print(f"All columns match.")
            
    conn.close()

if __name__ == "__main__":
    compare_schemas()
