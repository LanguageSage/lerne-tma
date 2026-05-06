import sqlite3
import os

old_db = 'c:\\121\\Lerne_projekt\\tma\\api\\data\\tma.db'
new_db = 'c:\\121\\Lerne_projekt\\tma\\api\\data\\lerne.db'
DEFAULT_USER_ID = 642478257

def migrate_data():
    if not os.path.exists(old_db):
        print("Old database not found.")
        return

    conn_old = sqlite3.connect(old_db)
    conn_new = sqlite3.connect(new_db)
    
    conn_old.row_factory = sqlite3.Row
    cursor_old = conn_old.cursor()
    cursor_new = conn_new.cursor()
    
    table_map = {
        'tma_deck': 'tma_deck',
        'tma_card': 'tma_card',
        'tmaprogress': 'tmaprogress',
        'tmareviewhistory': 'tmareviewhistory',
        'tmasetting': 'tmasetting',
        'tmauserprompt': 'tmauserprompt'
    }
    
    # Wipe destination first
    for new_table in table_map.values():
        try:
            cursor_new.execute(f"DELETE FROM {new_table}")
        except: pass
    
    for old_table, new_table in table_map.items():
        print(f"Migrating table: {old_table} -> {new_table}...")
        try:
            cursor_old.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{old_table}'")
            if not cursor_old.fetchone(): continue

            cursor_old.execute(f"SELECT * FROM {old_table}")
            rows = cursor_old.fetchall()
            if not rows: continue
                
            cursor_new.execute(f"PRAGMA table_info({new_table})")
            dest_cols_info = {col[1]: col for col in cursor_new.fetchall()}
            dest_cols = list(dest_cols_info.keys())
            
            for row in rows:
                row_dict = dict(row)
                filtered_row = {}
                for col in dest_cols:
                    if col in row_dict:
                        val = row_dict[col]
                        if val is None:
                            if col == 'is_deleted': val = 0
                            if col in ['history', 'tags', 'topics']: val = '[]'
                        filtered_row[col] = val
                    else:
                        if col == 'user_id': filtered_row[col] = DEFAULT_USER_ID
                        elif col == 'is_deleted': filtered_row[col] = 0
                        elif col in ['created_at', 'updated_at']: filtered_row[col] = '2026-05-06 12:00:00'
                        elif col in ['history', 'tags', 'topics']: filtered_row[col] = '[]'
                        elif col == 'card_type': filtered_row[col] = 'translation'
                
                placeholders = ', '.join(['?'] * len(filtered_row))
                columns = ', '.join(filtered_row.keys())
                sql = f"INSERT INTO {new_table} ({columns}) VALUES ({placeholders})"
                cursor_new.execute(sql, list(filtered_row.values()))
            
            print(f"Migrated {len(rows)} rows for {new_table}.")
        except Exception as e:
            print(f"Error migrating {old_table}: {e}")
            
    conn_new.commit()
    conn_old.close()
    conn_new.close()
    print("Data migration completed successfully.")

if __name__ == "__main__":
    migrate_data()
