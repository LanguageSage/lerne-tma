import sqlite3
import json
import os

backup_file = 'c:\\121\\Lerne_projekt\\tma\\api\\data\\supabase_backup.json'
db_path = 'c:\\121\\Lerne_projekt\\tma\\api\\data\\lerne.db'

def sync_from_json():
    if not os.path.exists(backup_file):
        print("Backup file not found.")
        return

    with open(backup_file, 'r', encoding='utf-8') as f:
        data = json.load(f)

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Tables to sync
    tables = [
        'deck', 'card', 'tma_deck', 'tma_card', 
        'tmaprogress', 'tmareviewhistory', 'tmauserprompt', 
        'tmasetting', 'tmamedia'
    ]
    
    for table in tables:
        if table not in data:
            print(f"Table {table} not in backup. Skipping.")
            continue
            
        print(f"Syncing table: {table}...")
        rows = data[table]
        if not rows:
            print(f"No data for {table}.")
            continue
            
        # Wipe local table
        try:
            cursor.execute(f"DELETE FROM {table}")
        except Exception as e:
            print(f"Warning: Could not clear {table}: {e}")
            continue

        # Get columns from destination
        cursor.execute(f"PRAGMA table_info({table})")
        dest_cols = [col[1] for col in cursor.fetchall()]
        
        count = 0
        for row in rows:
            # Filter columns that exist locally
            filtered_row = {k: v for k, v in row.items() if k in dest_cols}
            
            # Handle special cases (e.g., binary data placeholder)
            for k, v in filtered_row.items():
                if v == "__binary_data__":
                    filtered_row[k] = None # We can't restore binary from this JSON
            
            placeholders = ', '.join(['?'] * len(filtered_row))
            columns = ', '.join(filtered_row.keys())
            sql = f"INSERT INTO {table} ({columns}) VALUES ({placeholders})"
            cursor.execute(sql, list(filtered_row.values()))
            count += 1
        
        print(f"Synced {count} rows for {table}.")
        
    conn.commit()
    conn.close()
    print("Full sync from Supabase completed successfully.")

if __name__ == "__main__":
    sync_from_json()
