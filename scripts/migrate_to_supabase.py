import os
import sqlite3
from pathlib import Path
from peewee import *
from playhouse.db_url import connect as db_connect
from dotenv import load_dotenv

# Загружаем настройки из .env
load_dotenv()

# Пути к локальным базам
TMA_ROOT = Path(__file__).resolve().parent.parent.resolve()
LOCAL_TMA_DB = (TMA_ROOT / "api" / "data" / "tma.db").resolve()
# Для библиотеки используем проверенный абсолютный путь
LOCAL_LERNE_DB = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db").resolve()

print(f"--- Migration Environment ---", flush=True)
print(f"TMA DB: {LOCAL_TMA_DB} (Exists: {LOCAL_TMA_DB.exists()})", flush=True)
print(f"Lerne DB: {LOCAL_LERNE_DB} (Exists: {LOCAL_LERNE_DB.exists()})", flush=True)

SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL")

if not SUPABASE_DB_URL or "your_database_url_here" in SUPABASE_DB_URL:
    print("ERROR: SUPABASE_DB_URL not set in .env")
    exit(1)

print(f"Connecting to Cloud Postgres...", flush=True)
cloud_db = db_connect(SUPABASE_DB_URL)

def migrate_table(table_name, source_conn, target_db):
    """Универсальная миграция таблицы из SQLite в Postgres."""
    print(f"Migrating table: {table_name}...", flush=True)
    
    cursor = source_conn.cursor()
    try:
        cursor.execute(f"SELECT * FROM {table_name}")
    except sqlite3.OperationalError:
        print(f"  Table {table_name} not found in source, skipping.", flush=True)
        return

    rows = cursor.fetchall()
    if not rows:
        print(f"  Table {table_name} is empty, skipping.", flush=True)
        return

    # Получаем имена колонок
    columns = [description[0] for description in cursor.description]
    
    # Подготавливаем запрос вставку для Postgres
    placeholders = ", ".join(["%s"] * len(columns))
    col_names = ", ".join([f'"{c}"' for c in columns])
    insert_sql = f'INSERT INTO "{table_name}" ({col_names}) VALUES ({placeholders}) ON CONFLICT DO NOTHING'

    # Вставляем данные по одной строке для макс. надежности
    count = 0
    for row in rows:
        # Конвертируем 0/1 в True/False для булевых колонок в Postgres
        clean_row = []
        for idx, val in enumerate(row):
            col_name = columns[idx].lower()
            if col_name in ['is_deleted', 'is_active']:
                clean_row.append(bool(val))
            else:
                clean_row.append(val)
        
        try:
            with target_db.atomic():
                target_db.execute_sql(insert_sql, tuple(clean_row))
                count += 1
        except Exception as e:
            # Выводим ПОЛНУЮ ошибку для каждого сбоя
            try:
                msg = f"  FAILED to migrate row in {table_name}: {e}"
                print(msg.encode('ascii', 'replace').decode('ascii'), flush=True)
                data_msg = f"  Data: {row} -> {clean_row}"
                print(data_msg.encode('ascii', 'replace').decode('ascii'), flush=True)
            except:
                print(f"  FAILED to migrate row in {table_name} (encoding error in print)", flush=True)
    
    print(f"  Successfully migrated {count} rows to {table_name}", flush=True)

    # Важно для Postgres: обновляем счетчик ID (SERIAL), чтобы новые записи не конфликтовали
    try:
        target_db.execute_sql(f"SELECT setval(pg_get_serial_sequence('{table_name}', 'id'), coalesce(max(id), 1)) FROM {table_name};")
    except Exception as e:
        # Не у всех таблиц ID является серийным или называется 'id'
        pass

def run_migration():
    # 1. Миграция TMA данных (Прогресс, настройки, локальные колоды)
    if LOCAL_TMA_DB.exists():
        print(f"\n--- Migrating TMA Database ({LOCAL_TMA_DB.name}) ---")
        tma_conn = sqlite3.connect(LOCAL_TMA_DB)
        
        tma_tables = [
            "tma_deck", "tma_card", "tmaprogress", 
            "tmareviewhistory", "tmasetting", "tmauserprompt"
        ]
        
        for table in tma_tables:
            migrate_table(table, tma_conn, cloud_db)
        
        tma_conn.close()
    else:
        print(f"Warning: Local TMA DB not found at {LOCAL_TMA_DB}")

    # 2. Миграция основной библиотеки (Deck и Card)
    # Эти таблицы в облаке живут в той же базе, но без префикса tma_
    if LOCAL_LERNE_DB.exists():
        print(f"\n--- Migrating Lerne Library ({LOCAL_LERNE_DB.name}) ---")
        lerne_conn = sqlite3.connect(LOCAL_LERNE_DB)
        
        # В основной библиотеке таблицы называются просто deck и card
        library_tables = ["deck", "card"]
        for table in library_tables:
            migrate_table(table, lerne_conn, cloud_db)
            
        lerne_conn.close()
    else:
        print(f"Warning: Local Lerne DB not found at {LOCAL_LERNE_DB}")

    print("\n--- Migration Complete! ---")

if __name__ == "__main__":
    run_migration()
