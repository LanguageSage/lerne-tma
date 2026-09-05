import sqlite3
import datetime
from pathlib import Path

DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")

def get_columns(cursor, table):
    cursor.execute(f"PRAGMA table_info({table})")
    return [row[1] for row in cursor.fetchall()]

def unify_tables():
    print(f"Unifying tables in {DB_PATH}...")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    try:
        # 1. Backup legacy tables
        print("Creating internal backup of legacy tables...")
        cursor.execute("DROP TABLE IF EXISTS deck_backup_pre_unify")
        cursor.execute("DROP TABLE IF EXISTS card_backup_pre_unify")
        cursor.execute("CREATE TABLE deck_backup_pre_unify AS SELECT * FROM deck")
        cursor.execute("CREATE TABLE card_backup_pre_unify AS SELECT * FROM card")

        # 2. Clear legacy tables
        print("Clearing legacy deck and card tables...")
        cursor.execute("DELETE FROM deck")
        cursor.execute("DELETE FROM card")

        # 3. Copy decks from tma_deck to deck
        tma_deck_cols = set(get_columns(cursor, "tma_deck"))
        deck_cols = set(get_columns(cursor, "deck"))
        common_deck_cols = list(tma_deck_cols.intersection(deck_cols))
        
        # Handle NOT NULL constraints
        select_cols = []
        for c in common_deck_cols:
            if c == 'updated_at':
                select_cols.append(f"COALESCE(updated_at, '{now}')")
            elif c == 'created_at':
                select_cols.append(f"COALESCE(created_at, '{now}')")
            else:
                select_cols.append(c)
        
        cols_str = ",".join(common_deck_cols)
        select_str = ",".join(select_cols)
        
        print(f"Copying decks...")
        cursor.execute(f"INSERT INTO deck ({cols_str}) SELECT {select_str} FROM tma_deck WHERE is_deleted = 0")
        decks_count = cursor.rowcount

        # 4. Copy cards from tma_card to card
        tma_card_cols = set(get_columns(cursor, "tma_card"))
        card_cols = set(get_columns(cursor, "card"))
        common_card_cols = list(tma_card_cols.intersection(card_cols))
        
        select_cols = []
        for c in common_card_cols:
            if c in ['updated_at', 'created_at', 'history']:
                 # Handle NOT NULL for these too
                 if c == 'history':
                     select_cols.append("COALESCE(history, '[]')")
                 else:
                     select_cols.append(f"COALESCE({c}, '{now}')")
            else:
                select_cols.append(c)
        
        cols_str = ",".join(common_card_cols)
        select_str = ",".join(select_cols)
        
        print(f"Copying cards...")
        cursor.execute(f"INSERT INTO card ({cols_str}) SELECT {select_str} FROM tma_card WHERE is_deleted = 0")
        cards_count = cursor.rowcount

        conn.commit()
        print(f"SUCCESS!")
        print(f"Unified: {decks_count} decks and {cards_count} cards.")
        print("Your Mind Map in Lerne should now show the new clean structure.")

    except Exception as e:
        conn.rollback()
        print(f"ERROR during unification: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    unify_tables()
