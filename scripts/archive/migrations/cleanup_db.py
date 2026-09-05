import sqlite3
from pathlib import Path

DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")

def cleanup_with_image_priority():
    print(f"Cleaning up duplicates with IMAGE PRIORITY in {DB_PATH}...")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        # Cleanup tma_card with high priority for images
        print("Deduplicating tma_card (Priority: Image > Active > Newest)...")
        # Logic: 
        # 1. (image_path is not null) gives 0 if null, 1 if not null. We want 1 first -> DESC
        # 2. is_deleted: 0 is active, 1 is deleted. We want 0 first -> ASC
        # 3. updated_at: newer first -> DESC
        
        cursor.execute("""
            CREATE TABLE tma_card_temp AS 
            SELECT * FROM tma_card 
            GROUP BY id 
            ORDER BY 
                (CASE WHEN (image_path IS NOT NULL AND image_path != '') OR image_data IS NOT NULL THEN 1 ELSE 0 END) DESC,
                is_deleted ASC, 
                updated_at DESC
        """)
        
        cursor.execute("DELETE FROM tma_card")
        cursor.execute("INSERT INTO tma_card SELECT * FROM tma_card_temp")
        cursor.execute("DROP TABLE tma_card_temp")

        # Cleanup tma_deck (standard priority as decks don't have images)
        print("Deduplicating tma_deck...")
        cursor.execute("""
            CREATE TABLE tma_deck_temp AS 
            SELECT * FROM tma_deck 
            WHERE id IS NOT NULL 
            GROUP BY id 
            ORDER BY is_deleted ASC, updated_at DESC
        """)
        cursor.execute("INSERT INTO tma_deck_temp SELECT * FROM tma_deck WHERE id IS NULL")
        cursor.execute("DELETE FROM tma_deck")
        cursor.execute("INSERT INTO tma_deck SELECT * FROM tma_deck_temp")
        cursor.execute("DROP TABLE tma_deck_temp")

        conn.commit()
        print("Cleanup successful with image priority!")

    except Exception as e:
        conn.rollback()
        print(f"Error during cleanup: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    cleanup_with_image_priority()
