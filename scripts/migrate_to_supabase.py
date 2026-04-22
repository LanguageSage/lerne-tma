import os
import sqlite3
from pathlib import Path
from peewee import *
from playhouse.db_url import connect as db_connect
from dotenv import load_dotenv
import datetime

# Загружаем настройки из .env
load_dotenv()

# Пути к локальным базам
TMA_ROOT = Path(__file__).resolve().parent.parent.resolve()
LOCAL_TMA_DB = (TMA_ROOT / "api" / "data" / "tma.db").resolve()
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

def migrate_table_minimal(table_name, source_conn, target_db):
    """Импорт данных с UPSERT (ON CONFLICT DO UPDATE)."""
    print(f"Migrating {table_name}...", end="", flush=True)
    cursor = source_conn.cursor()
    
    try:
        # 1. Получаем инфо о колонках в Postgres
        target_cols_info = target_db.get_columns(table_name)
        target_map = {c.name.lower(): c for c in target_cols_info}
        target_names = list(target_map.keys())
        
        # 2. Получаем данные из SQLite
        cursor.execute(f"SELECT * FROM {table_name}")
        sqlite_rows = cursor.fetchall()
        if not sqlite_rows:
            print(" (empty)")
            return
            
        source_cols = [description[0].lower() for description in cursor.description]
        
        # 3. Находим общие колонки
        common_cols = [c for c in source_cols if c in target_names]
        
        # 4. Проверяем обязательные колонки NOT NULL
        missing_required = [
            name for name, info in target_map.items() 
            if not info.null and name not in source_cols and name != 'id'
        ]
        
        all_target_cols = common_cols + missing_required
        placeholders = ", ".join(["%s"] * len(all_target_cols))
        col_names_str = ", ".join([f'"{c}"' for c in all_target_cols])
        
        # 5. Подготовка UPSERT (Для всех колонок кроме ID)
        update_cols = [c for c in all_target_cols if c != 'id']
        update_set = ", ".join([f'"{c}" = EXCLUDED."{c}"' for c in update_cols])
        
        insert_sql = f"""
            INSERT INTO "{table_name}" ({col_names_str}) 
            VALUES ({placeholders})
            ON CONFLICT (id) DO UPDATE SET {update_set}
        """

        count = 0
        now = datetime.datetime.now()

        for row in sqlite_rows:
            row_dict = dict(zip(source_cols, row))
            clean_row = []
            
            # --- Специальная логика ---
            
            # А) Пропускаем карты без колод (Foreign Key Protection)
            if table_name == 'card':
                deck_id = row_dict.get('deck_id')
                # Быстрая проверка существования колоды
                exists = target_db.execute_sql(f'SELECT 1 FROM deck WHERE id = {deck_id}').fetchone()
                if not exists: continue

            # Б) Заполняем данные
            for col in common_cols:
                val = row_dict[col]
                if col in ['is_deleted', 'is_active']:
                    clean_row.append(bool(val) if val is not None else False)
                elif val is None and not target_map[col].null:
                    if col in ['created_at', 'updated_at']: clean_row.append(now)
                    elif col == 'source': clean_row.append('imported')
                    elif 'text' in col or col in ['name', 'front_text', 'back_text']: clean_row.append('')
                    else: clean_row.append(0)
                else:
                    clean_row.append(val)
            
            # В) Добавляем недостающие обязательные поля
            for col in missing_required:
                if col in ['created_at', 'updated_at']: clean_row.append(now)
                elif col == 'source': clean_row.append('imported')
                elif col == 'card_type': clean_row.append('standard')
                else: clean_row.append(None)
            
            try:
                with target_db.atomic():
                    target_db.execute_sql(insert_sql, tuple(clean_row))
                    count += 1
            except Exception as e:
                if count < 1: 
                    # Логируем только первые ошибки и только если они фатальны
                    err = str(e).encode('ascii', 'replace').decode('ascii')
                    print(f"\n   ! Row Error ({table_name}): {err}")
        
        print(f" -> {count} rows")
        
        # Обновляем сиквенс Postgres
        try:
            target_db.execute_sql(f"SELECT setval(pg_get_serial_sequence('{table_name}', 'id'), coalesce(max(id), 1)) FROM {table_name};")
        except: pass
        
    except Exception as e:
        err = str(e).encode('ascii', 'replace').decode('ascii')
        print(f" ERROR: {err}")

def run_migration():
    if not LOCAL_TMA_DB.exists():
        print(f"ERROR: Local TMA DB not found at {LOCAL_TMA_DB}")
        return

    print(f"\n--- Starting Migration to Supabase (UPSERT Mode) ---")
    
    # Порядок очистки (важен для Foreign Keys)
    cleanup_order = [
        "tmareviewhistory", "tmaprogress", "tma_card", "tma_deck", 
        "card", "deck", 
        "tmasetting", "tmauserprompt"
    ]

    print("\n[1/3] Cleaning cloud tables...")
    for table in cleanup_order:
        try:
            cloud_db.execute_sql(f'DELETE FROM "{table}"')
            print(f"  Deleted all from {table}")
        except Exception as e:
            # Если не удалилось - не страшно, для этого у нас есть UPSERT
            msg = str(e).splitlines()[0][:60]
            print(f"  Note: table {table} cleanup skipped ({msg}...)")

    tma_conn = sqlite3.connect(LOCAL_TMA_DB)
    tma_conn.text_factory = str
    
    print("\n[2/3] Migrating TMA Data...")
    tma_order = ["tma_deck", "tma_card", "tmaprogress", "tmareviewhistory", "tmasetting", "tmauserprompt"]
    for table in tma_order:
        migrate_table_minimal(table, tma_conn, cloud_db)
    tma_conn.close()

    if LOCAL_LERNE_DB.exists():
        print("\n[3/3] Migrating Lerne Library...")
        lerne_conn = sqlite3.connect(LOCAL_LERNE_DB)
        lerne_conn.text_factory = str
        library_order = ["deck", "card"]
        for table in library_order:
            migrate_table_minimal(table, lerne_conn, cloud_db)
        lerne_conn.close()

    print("\n--- Migration Complete! ---")

if __name__ == "__main__":
    run_migration()
