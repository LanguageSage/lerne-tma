import sqlite3
import json
import datetime
import os
from pathlib import Path
from peewee import *
from playhouse.db_url import connect as db_connect
from dotenv import load_dotenv

load_dotenv()
DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")
BACKUP_PATH = Path(r"c:\121\Lerne_projekt\tma\backups\lerne_backup_20260507_185250.db")
MAPPING_PATH = Path("scratch/reorg_mapping.json")
SUPABASE_URL = os.environ.get("SUPABASE_DB_URL")
USER_ID = 7187932783

def final_fix():
    print("--- STARTING FINAL UNIFICATION AND CLOUD PUSH ---")
    
    # 1. Restore from clean backup
    # import shutil
    # shutil.copy(BACKUP_PATH, DB_PATH)
    # print("Restored clean backup.")

    with open(MAPPING_PATH, "r", encoding="utf-8") as f:
        mapping = {int(k): v for k, v in json.load(f).items()}

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    try:
        # 2. Assign IDs and Create Decks
        cursor.execute("SELECT MAX(id) FROM tma_deck")
        next_id = max(cursor.fetchone()[0] or 0, 2000) + 1
        
        new_deck_specs = {}
        for old_id, info in mapping.items():
            name = info['new_name']
            if name not in new_deck_specs:
                new_deck_specs[name] = {"id": next_id, "level": info['level'], "topic": info['topic']}
                next_id += 1
        
        print(f"Creating {len(new_deck_specs)} new unified categories...")
        for name, spec in new_deck_specs.items():
            # TMA table
            cursor.execute("""
                INSERT INTO tma_deck (id, name, level, topic, is_deleted, user_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, 0, ?, ?, ?)
            """, (spec['id'], name, spec['level'], spec['topic'], USER_ID, now, now))
            # Legacy table
            cursor.execute("""
                INSERT INTO deck (id, name, level, topic, is_deleted, created_at, updated_at)
                VALUES (?, ?, ?, ?, 0, ?, ?)
            """, (spec['id'], name, spec['level'], spec['topic'], now, now))

        # 3. Move Cards
        print("Moving cards to new categories...")
        for old_id, info in mapping.items():
            new_id = new_deck_specs[info['new_name']]['id']
            cursor.execute("UPDATE tma_card SET deck_id = ? WHERE deck_id = ?", (new_id, old_id))
            cursor.execute("UPDATE card SET deck_id = ? WHERE deck_id = ?", (new_id, old_id))
        
        # 4. Cleanup old decks
        print("Deactivating old decks...")
        old_ids = list(mapping.keys())
        placeholders = ",".join(["?"] * len(old_ids))
        cursor.execute(f"UPDATE tma_deck SET is_deleted = 1 WHERE id IN ({placeholders})", old_ids)
        cursor.execute(f"UPDATE deck SET is_deleted = 1 WHERE id IN ({placeholders})", old_ids)
        
        conn.commit()
        print("Local DB is clean and unified!")

        # 5. Push to Cloud
        print("Pushing to Supabase...")
        cloud_db = db_connect(SUPABASE_URL)
        with cloud_db.atomic():
            # Get local data for push
            cursor.execute("SELECT * FROM tma_deck WHERE user_id = ? AND is_deleted = 0", (USER_ID,))
            active_decks = [dict(row) for row in cursor.fetchall()]
            active_deck_ids = [d['id'] for d in active_decks]
            
            placeholders_list = ",".join(["?"] * len(active_deck_ids))
            cursor.execute(f"SELECT * FROM tma_card WHERE deck_id IN ({placeholders_list})", active_deck_ids)
            active_cards = [dict(row) for row in cursor.fetchall()]

            # Push Decks (UPSERT)
            cols = ["id", "name", "level", "topic", "is_deleted", "user_id", "created_at", "updated_at"]
            col_names = ",".join([f'"{c}"' for c in cols])
            deck_upsert = f'INSERT INTO "tma_deck" ({col_names}) VALUES ({",".join(["%s"]*len(cols))}) ON CONFLICT (id) DO UPDATE SET {",".join([f'"{c}"=EXCLUDED."{c}"' for c in cols if c!="id"])}'
            for d in active_decks:
                cloud_db.execute_sql(deck_upsert, [bool(d.get(c)) if c=="is_deleted" else d.get(c) for c in cols])
            
            # Push Cards (UPSERT)
            columns_query = "SELECT column_name FROM information_schema.columns WHERE table_name = 'tma_card' ORDER BY ordinal_position"
            cloud_cols = [row[0] for row in cloud_db.execute_sql(columns_query).fetchall()]
            card_upsert = f'INSERT INTO "tma_card" ({",".join([f'"{c}"' for c in cloud_cols])}) VALUES ({",".join(["%s"]*len(cloud_cols))}) ON CONFLICT (id) DO UPDATE SET {",".join([f'"{c}"=EXCLUDED."{c}"' for c in cloud_cols if c!="id"])}'
            for card in active_cards:
                vals = []
                for col in cloud_cols:
                    v = card.get(col)
                    if col == "is_deleted":
                        v = bool(v)
                    vals.append(v)
                cloud_db.execute_sql(card_upsert, vals)

            # Delete old cards/decks in cloud that are now marked deleted locally
            print("Cleaning up cloud...")
            pg_placeholders = ",".join(["%s"] * len(old_ids))
            cloud_db.execute_sql(f'UPDATE "tma_deck" SET is_deleted = true WHERE user_id = {USER_ID} AND id IN ({pg_placeholders})', old_ids)

        print("\nSUCCESS! Everything is unified and pushed to cloud.")

    except Exception as e:
        conn.rollback()
        import traceback
        traceback.print_exc()
        print(f"CRITICAL ERROR: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    final_fix()
