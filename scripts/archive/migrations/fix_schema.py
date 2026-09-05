import sqlite3
from pathlib import Path

def fix_schema():
    db_path = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    tables_to_fix = ['tma_card', 'card']
    columns_to_add = [
        ('video_front_path', 'TEXT'),
        ('video_back_path', 'TEXT'),
        ('image_data', 'BLOB'),
        ('tags', 'TEXT'),
        ('topics', 'TEXT'),
        ('source', 'TEXT'),
        ('card_type', 'TEXT'),
        ('difficulty', 'REAL'),
        ('metadata', 'TEXT'),
        ('history', 'TEXT'),
        ('is_deleted', 'BOOLEAN'),
        ('created_at', 'DATETIME'),
        ('updated_at', 'DATETIME')
    ]
    
    for table in tables_to_fix:
        print(f"Checking table: {table}")
        cursor.execute(f"PRAGMA table_info({table})")
        existing_cols = {row[1] for row in cursor.fetchall()}
        
        for col_name, col_type in columns_to_add:
            if col_name not in existing_cols:
                print(f"  Adding column {col_name} to {table}")
                try:
                    cursor.execute(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_type}")
                except Exception as e:
                    print(f"    Error adding {col_name}: {e}")
                    
    conn.commit()
    conn.close()
    print("Schema fix complete.")

if __name__ == "__main__":
    fix_schema()
