import sqlite3

db_path = 'c:\\121\\Lerne_projekt\\tma\\api\\data\\lerne.db'

def check_schema():
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [row[0] for row in cursor.fetchall()]
    print(f"Tables in lerne.db: {tables}")
    
    for table in tables:
        print(f"\n--- Schema for table: {table} ---")
        cursor.execute(f"PRAGMA table_info({table})")
        columns = cursor.fetchall()
        for col in columns:
            print(f"Col: {col[1]} ({col[2]})")
            
    conn.close()

if __name__ == "__main__":
    check_schema()
