import os
import sqlite3
import datetime
from pathlib import Path
from playhouse.db_url import connect as db_connect
from dotenv import load_dotenv

load_dotenv()
SUPABASE_URL = os.environ.get("SUPABASE_DB_URL")

def backup_cloud():
    if not SUPABASE_URL:
        print("ERROR: SUPABASE_DB_URL not found")
        return

    # Создаем папку для бекапов
    backup_dir = Path("backups")
    backup_dir.mkdir(exist_ok=True)
    
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = backup_dir / f"cloud_backup_{timestamp}.db"
    
    print(f"--- Cloud Backup: Supabase -> {backup_file} ---")
    
    try:
        cloud_db = db_connect(SUPABASE_URL)
        local_conn = sqlite3.connect(backup_file)
        local_cursor = local_conn.cursor()
        
        # Список всех таблиц для бекапа
        tables = [
            "deck", "card", 
            "tma_deck", "tma_card", "tmaprogress", 
            "tmareviewhistory", "tmasetting", "tmauserprompt"
        ]
        
        for table in tables:
            print(f"Backing up table: {table}...", end=" ", flush=True)
            try:
                # Получаем данные
                rows = cloud_db.execute_sql(f'SELECT * FROM "{table}"').fetchall()
                if not rows:
                    print("(empty)")
                    continue
                
                # Получаем структуру колонок
                cursor = cloud_db.execute_sql(f'SELECT column_name, data_type FROM information_schema.columns WHERE table_name = \'{table}\' ORDER BY ordinal_position')
                cols_info = cursor.fetchall()
                col_names = [c[0] for c in cols_info]
                
                # Создаем таблицу в SQLite (упрощенно, всё как TEXT/NUMERIC)
                cols_str = ", ".join([f'"{name}"' for name in col_names])
                local_cursor.execute(f'CREATE TABLE "{table}" ({cols_str})')
                
                # Вставляем данные
                placeholders = ", ".join(["?"] * len(col_names))
                local_cursor.executemany(f'INSERT INTO "{table}" VALUES ({placeholders})', rows)
                print(f"-> {len(rows)} rows")
                
            except Exception as e:
                print(f"FAILED: {e}")
        
        local_conn.commit()
        print(f"\nSUCCESS! Backup saved to: {backup_file}")
        
    except Exception as e:
        print(f"\nCRITICAL ERROR during backup: {e}")
    finally:
        if 'cloud_db' in locals(): cloud_db.close()
        if 'local_conn' in locals(): local_conn.close()

if __name__ == "__main__":
    backup_cloud()
