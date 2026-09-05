import sqlite3
from pathlib import Path

DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")
ROOT_DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\lerne.db")

def unify_structure_step1():
    print(f"UNIFYING STRUCTURE (Step 1) in {DB_PATH}...")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        # 1. Add missing 'user_id' to legacy 'deck' table
        print("Adding 'user_id' to 'deck' table...")
        cursor.execute("PRAGMA table_info(deck)")
        deck_cols = [row[1] for row in cursor.fetchall()]
        if 'user_id' not in deck_cols:
            cursor.execute("ALTER TABLE deck ADD COLUMN user_id INTEGER")
        
        # 2. Add missing 'cloud_id' to 'tma_deck' (if missing, though we'll turn it into a view)
        cursor.execute("PRAGMA table_info(tma_deck)")
        tma_deck_cols = [row[1] for row in cursor.fetchall()]
        if 'cloud_id' not in tma_deck_cols:
            cursor.execute("ALTER TABLE tma_deck ADD COLUMN cloud_id INTEGER")

        # 3. Migrate data from tma_deck to deck before turning it into a view
        # We need to preserve all decks from both sides.
        print("Merging data into unified 'deck' table...")
        # Get all IDs already in 'deck'
        cursor.execute("SELECT id FROM deck")
        existing_ids = {row[0] for row in cursor.fetchall()}
        
        cursor.execute("SELECT * FROM tma_deck")
        tma_decks = cursor.fetchall()
        # Get column names for tma_deck
        cursor.execute("PRAGMA table_info(tma_deck)")
        col_names = [row[1] for row in cursor.fetchall()]
        
        for tdeck in tma_decks:
            tdeck_dict = dict(zip(col_names, tdeck))
            if tdeck_dict['id'] not in existing_ids:
                # Insert missing deck from TMA to Legacy
                placeholders = ",".join(["?"] * len(col_names))
                cols_str = ",".join(col_names)
                cursor.execute(f"INSERT INTO deck ({cols_str}) VALUES ({placeholders})", [tdeck_dict[c] for c in col_names])
            else:
                # Update existing deck with TMA-specific info (like user_id)
                cursor.execute("UPDATE deck SET user_id = ? WHERE id = ?", (tdeck_dict['user_id'], tdeck_dict['id']))

        # 4. Same for cards (they are already identical in structure, just sync IDs)
        print("Ensuring all cards are in 'card' table...")
        cursor.execute("SELECT id FROM card")
        existing_card_ids = {row[0] for row in cursor.fetchall()}
        cursor.execute("SELECT * FROM tma_card")
        tma_cards = cursor.fetchall()
        cursor.execute("PRAGMA table_info(tma_card)")
        card_cols = [row[1] for row in cursor.fetchall()]
        
        for tcard in tma_cards:
            tcard_dict = dict(zip(card_cols, tcard))
            if tcard_dict['id'] not in existing_card_ids:
                placeholders = ",".join(["?"] * len(card_cols))
                cols_str = ",".join(card_cols)
                cursor.execute(f"INSERT INTO card ({cols_str}) VALUES ({placeholders})", [tcard_dict[c] for c in card_cols])

        # 5. Transform tma_deck and tma_card into VIEWS
        print("Transforming tma_ tables into Views...")
        
        # Rename original tables to backups
        cursor.execute("DROP TABLE IF EXISTS tma_deck_old")
        cursor.execute("ALTER TABLE tma_deck RENAME TO tma_deck_old")
        cursor.execute("DROP TABLE IF EXISTS tma_card_old")
        cursor.execute("ALTER TABLE tma_card RENAME TO tma_card_old")
        
        # Create Views
        cursor.execute("CREATE VIEW tma_deck AS SELECT * FROM deck")
        cursor.execute("CREATE VIEW tma_card AS SELECT * FROM card")
        
        # 6. Add INSTEAD OF triggers so TMA app can still WRITE to these views
        print("Adding triggers for write capability...")
        
        # Trigger for tma_deck INSERT
        cursor.execute("""
            CREATE TRIGGER tma_deck_insert INSTEAD OF INSERT ON tma_deck
            BEGIN
                INSERT INTO deck (id, name, level, topic, is_deleted, created_at, updated_at, user_id, cloud_id)
                VALUES (NEW.id, NEW.name, NEW.level, NEW.topic, NEW.is_deleted, NEW.created_at, NEW.updated_at, NEW.user_id, NEW.cloud_id);
            END;
        """)
        
        # Trigger for tma_card INSERT
        # (Generating columns dynamically would be safer but let's list the main ones)
        # We need to handle all columns for the TMA app to work.
        cursor.execute("PRAGMA table_info(card)")
        all_card_cols = [row[1] for row in cursor.fetchall()]
        cols_list = ",".join(all_card_cols)
        new_cols_list = ",".join([f"NEW.{c}" for c in all_card_cols])
        
        cursor.execute(f"""
            CREATE TRIGGER tma_card_insert INSTEAD OF INSERT ON tma_card
            BEGIN
                INSERT INTO card ({cols_list}) VALUES ({new_cols_list});
            END;
        """)

        conn.commit()
        print("SUCCESS! Structure is unified. tma_ tables are now views of legacy tables.")

        # Sync to root
        conn.close()
        import shutil
        shutil.copy(DB_PATH, ROOT_DB_PATH)
        print("Synced to root lerne.db")

    except Exception as e:
        if conn: conn.rollback()
        import traceback
        traceback.print_exc()
        print(f"ERROR: {e}")
    finally:
        if conn: conn.close()

if __name__ == "__main__":
    unify_structure_step1()
