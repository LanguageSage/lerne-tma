import os
import sqlite3
import datetime
from pathlib import Path
from peewee import *
from playhouse.db_url import connect as db_connect
from dotenv import load_dotenv

load_dotenv()
LOCAL_DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")
SUPABASE_URL = os.environ.get("SUPABASE_DB_URL")
USER_ID = 7187932783

def push_to_cloud():
    print(f"--- Pushing Local Clean State -> Cloud (UPSERT mode) ---")
    
    local_conn = sqlite3.connect(LOCAL_DB_PATH)
    local_conn.row_factory = sqlite3.Row
    local_cursor = local_conn.cursor()
    
    cloud_db = db_connect(SUPABASE_URL)
    
    try:
        local_cursor.execute("SELECT * FROM tma_deck WHERE user_id = ?", (USER_ID,))
        local_decks = [dict(row) for row in local_cursor.fetchall()]
        deck_ids = [d['id'] for d in local_decks]
        
        if not deck_ids:
            print("No local decks found.")
            return

        placeholders_list = ",".join(["?"] * len(deck_ids))
        local_cursor.execute(f"SELECT * FROM tma_card WHERE deck_id IN ({placeholders_list})", deck_ids)
        local_cards = [dict(row) for row in local_cursor.fetchall()]

        with cloud_db.atomic():
            # Push Decks using UPSERT
            print(f"Upserting {len(local_decks)} decks...")
            cols = ["id", "name", "level", "topic", "is_deleted", "user_id", "created_at", "updated_at"]
            col_names = ",".join([f'"{c}"' for c in cols])
            placeholders = ",".join(["%s"] * len(cols))
            
            update_clause = ",".join([f'"{c}" = EXCLUDED."{c}"' for c in cols if c != 'id'])
            
            deck_upsert_query = f"""
                INSERT INTO "tma_deck" ({col_names}) VALUES ({placeholders})
                ON CONFLICT (id) DO UPDATE SET {update_clause}
            """
            
            for deck in local_decks:
                vals = [bool(deck.get(c)) if c == 'is_deleted' else deck.get(c) for c in cols]
                cloud_db.execute_sql(deck_upsert_query, vals)

            # Push Cards using UPSERT
            print(f"Upserting {len(local_cards)} cards...")
            columns_query = "SELECT column_name FROM information_schema.columns WHERE table_name = 'tma_card' ORDER BY ordinal_position"
            cloud_cols = [row[0] for row in cloud_db.execute_sql(columns_query).fetchall()]
            
            card_col_names = ",".join([f'"{c}"' for c in cloud_cols])
            card_placeholders = ",".join(["%s"] * len(cloud_cols))
            
            card_update_clause = ",".join([f'"{c}" = EXCLUDED."{c}"' for c in cloud_cols if c != 'id'])
            
            card_upsert_query = f"""
                INSERT INTO "tma_card" ({card_col_names}) VALUES ({card_placeholders})
                ON CONFLICT (id) DO UPDATE SET {card_update_clause}
            """
            
            for card in local_cards:
                vals = [bool(card.get(c)) if c == 'is_deleted' else card.get(c) for c in cloud_cols]
                cloud_db.execute_sql(card_upsert_query, vals)

            # Important: Mark decks in cloud NOT in our local list as deleted for this user
            print("Cleaning up orphan decks in cloud...")
            if deck_ids:
                cloud_db.execute_sql(f'UPDATE "tma_deck" SET is_deleted = true WHERE user_id = {USER_ID} AND id NOT IN ({",".join(map(str, deck_ids))})')

        print("\nSUCCESS: Cloud updated via UPSERT!")

    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"ERROR: {e}")
    finally:
        local_conn.close()
        cloud_db.close()

if __name__ == "__main__":
    push_to_cloud()
