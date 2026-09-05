import os
import sqlite3
import datetime
from pathlib import Path
from peewee import *
from playhouse.db_url import connect as db_connect
from dotenv import load_dotenv

# 1. Настройки
load_dotenv()
TMA_ROOT = Path(__file__).resolve().parent.parent
LOCAL_DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")
SUPABASE_URL = os.environ.get("SUPABASE_DB_URL")

if not SUPABASE_URL:
    print("ERROR: SUPABASE_DB_URL not found in .env")
    exit(1)

TABLES_TO_SYNC = [
    "deck", "card", "tma_deck", "tma_card", 
    "tmaprogress", "tmareviewhistory", "tmasetting", "tmauserprompt"
]

def sync_all():
    print(f"--- Global Sync: Cloud -> Local ---")
    print(f"Time: {datetime.datetime.now()}")
    
    # 2. Подключаемся к облаку
    print("Connecting to Supabase...")
    try:
        cloud_db = db_connect(SUPABASE_URL)
    except Exception as e:
        print(f"FAILED to connect to Cloud: {e}")
        return

    # 3. Подключаемся к локальной БД
    print(f"Connecting to Local SQLite ({LOCAL_DB_PATH})...")
    local_conn = sqlite3.connect(LOCAL_DB_PATH)
    local_conn.row_factory = sqlite3.Row
    local_cursor = local_conn.cursor()
    
    try:
        for table in TABLES_TO_SYNC:
            print(f"Syncing table: {table}...", end="", flush=True)
            
            # Получаем данные из облака
            try:
                # В Postgres названия таблиц в кавычках для безопасности
                cloud_data = cloud_db.execute_sql(f'SELECT * FROM "{table}"').fetchall()
                
                if not cloud_data:
                    print(" (empty in cloud)")
                    continue
                
                # Получаем имена колонок из облака (через описание курсора или запрос)
                # Peewee doesn't give easy access to column names from execute_sql easily, 
                # so we use a trick or just fetch one row if exists
                
                # Но лучше использовать системный запрос
                columns_query = f"SELECT column_name FROM information_schema.columns WHERE table_name = '{table}' ORDER BY ordinal_position"
                cols = [row[0] for row in cloud_db.execute_sql(columns_query).fetchall()]
                
                placeholders = ",".join(["?"] * len(cols))
                col_names = ",".join(cols)
                
                count = 0
                for row in cloud_data:
                    # SQLite UPSERT: INSERT OR REPLACE
                    query = f"INSERT OR REPLACE INTO {table} ({col_names}) VALUES ({placeholders})"
                    local_cursor.execute(query, row)
                    count += 1
                
                print(f" Done ({count} rows)")
                
            except Exception as e:
                print(f" ERROR: {e}")
        
        local_conn.commit()
        print("\nSUCCESS: All tables are synchronized!")
        
    except Exception as e:
        print(f"\nCRITICAL ERROR during sync: {e}")
        local_conn.rollback()
    finally:
        local_conn.close()
        cloud_db.close()

if __name__ == "__main__":
    sync_all()
