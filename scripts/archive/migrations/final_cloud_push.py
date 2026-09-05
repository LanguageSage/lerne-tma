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

def final_cloud_push():
    print(f"--- FINAL CLOUD PUSH (Total Wipe for User {USER_ID}) ---")
    
    local_conn = sqlite3.connect(LOCAL_DB_PATH)
    local_conn.row_factory = sqlite3.Row
    local_cursor = local_conn.cursor()
    
    cloud_db = db_connect(SUPABASE_URL)
    
    try:
        # 1. Get our 26 clean decks and their cards
        local_cursor.execute("SELECT * FROM tma_deck")
        local_decks = [dict(row) for row in local_cursor.fetchall()]
        deck_ids = [d['id'] for d in local_decks]
        
        local_cursor.execute("SELECT * FROM tma_card")
        local_cards = [dict(row) for row in local_cursor.fetchall()]

        with cloud_db.atomic():
            # 2. WIPE CLOUD for this user
            print("Wiping user data in cloud...")
            # We must be careful about foreign keys, so delete cards first
            # But wait, cards in cloud might belong to decks we are about to delete.
            # Best is to delete all cards belonging to ANY deck of this user.
            cloud_db.execute_sql(f'DELETE FROM "tma_card" WHERE deck_id IN (SELECT id FROM "tma_deck" WHERE user_id = {USER_ID})')
            cloud_db.execute_sql(f'DELETE FROM "tma_deck" WHERE user_id = {USER_ID}')

            # 3. PUSH Decks
            print(f"Pushing {len(local_decks)} decks...")
            cols = ["id", "name", "level", "topic", "is_deleted", "user_id", "created_at", "updated_at"]
            col_names = ",".join([f'"{c}"' for c in cols])
            placeholders = ",".join(["%s"] * len(cols))
            insert_query = f'INSERT INTO "tma_deck" ({col_names}) VALUES ({placeholders})'
            
            for deck in local_decks:
                vals = [bool(deck.get(c)) if c == 'is_deleted' else deck.get(c) for c in cols]
                cloud_db.execute_sql(insert_query, vals)

            # 4. PUSH Cards
            print(f"Pushing {len(local_cards)} cards...")
            columns_query = "SELECT column_name FROM information_schema.columns WHERE table_name = 'tma_card' ORDER BY ordinal_position"
            cloud_cols = [row[0] for row in cloud_db.execute_sql(columns_query).fetchall()]
            card_col_names = ",".join([f'"{c}"' for c in cloud_cols])
            card_placeholders = ",".join(["%s"] * len(cloud_cols))
            card_insert_query = f'INSERT INTO "tma_card" ({card_col_names}) VALUES ({card_placeholders})'
            
            for card in local_cards:
                vals = [bool(card.get(c)) if c == 'is_deleted' else card.get(c) for c in cloud_cols]
                cloud_db.execute_sql(card_insert_query, vals)

        print("\nSUCCESS: Cloud is now 100% clean and in sync!")

    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"ERROR: {e}")
    finally:
        local_conn.close()
        cloud_db.close()

if __name__ == "__main__":
    final_cloud_push()
