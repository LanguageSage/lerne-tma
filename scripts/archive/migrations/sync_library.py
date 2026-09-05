import os
import sqlite3
from pathlib import Path
from peewee import *
from playhouse.db_url import connect as db_connect
from dotenv import load_dotenv

# 1. Загрузка настроек
load_dotenv()
TMA_ROOT = Path(__file__).resolve().parent.parent
# Используем путь из ваших настроек
LOCAL_DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")
SUPABASE_URL = os.environ.get("SUPABASE_DB_URL")

if not SUPABASE_URL:
    print("ERROR: SUPABASE_DB_URL not found in .env")
    exit(1)

def sync_library():
    print(f"--- Library Sync: Cloud -> Local ---")
    
    # 2. Подключаемся к облаку
    print("Connecting to Supabase...")
    cloud_db = db_connect(SUPABASE_URL)
    
    # 3. Подключаемся к локальной БД через sqlite3 для простоты массовой вставки
    print(f"Connecting to Local SQLite ({LOCAL_DB_PATH})...")
    local_conn = sqlite3.connect(LOCAL_DB_PATH)
    local_cursor = local_conn.cursor()
    
    # Создаем таблицы если их нет (со всеми полями для десктопной версии)
    local_cursor.execute("CREATE TABLE IF NOT EXISTS deck (id INTEGER PRIMARY KEY, name TEXT, level TEXT, topic TEXT, is_deleted BOOLEAN DEFAULT 0, created_at DATETIME, updated_at DATETIME, cloud_id TEXT)")
    local_cursor.execute("CREATE TABLE IF NOT EXISTS card (id INTEGER PRIMARY KEY, deck_id INTEGER, front_text TEXT, back_text TEXT, context TEXT, audio_path TEXT, image_path TEXT, card_type TEXT, source TEXT, tags TEXT, topics TEXT, difficulty REAL, metadata TEXT, cloud_id TEXT, is_deleted BOOLEAN DEFAULT 0, created_at DATETIME, updated_at DATETIME)")
    
    try:
        now = "2024-01-01 00:00:00"
        
        # --- СИНХРОНИЗАЦИЯ КОЛОД (DECK) ---
        print("Fetching decks from Cloud...")
        # Добавляем cloud_id в запрос
        cloud_decks = cloud_db.execute_sql('SELECT id, name, level, topic, is_deleted, created_at, updated_at, cloud_id FROM deck WHERE is_deleted = false').fetchall()
        
        print(f"Syncing {len(cloud_decks)} decks...")
        for d in cloud_decks:
            local_cursor.execute(
                "INSERT OR REPLACE INTO deck (id, name, level, topic, is_deleted, created_at, updated_at, cloud_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (d[0], d[1], d[2], d[3], 1 if d[4] else 0, d[5] or now, d[6] or now, d[7])
            )
            
        # --- СИНХРОНИЗАЦИЯ КАРТОЧЕК (CARD) ---
        print("Fetching cards from Cloud (this may take a moment)...")
        cloud_cards = cloud_db.execute_sql('SELECT id, deck_id, front_text, back_text, context, audio_path, image_path, created_at, updated_at, metadata, cloud_id FROM card').fetchall()
        
        print(f"Syncing {len(cloud_cards)} cards...")
        for c in cloud_cards:
            local_cursor.execute(
                "INSERT OR REPLACE INTO card (id, deck_id, front_text, back_text, context, audio_path, image_path, created_at, updated_at, metadata, cloud_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7] or now, c[8] or now, c[9], c[10])
            )
            
        local_conn.commit()
        print("\nSUCCESS: Local Library is now in sync with Cloud!")
        
    except Exception as e:
        print(f"\nERROR during sync: {e}")
    finally:
        local_conn.close()
        cloud_db.close()

if __name__ == "__main__":
    sync_library()
