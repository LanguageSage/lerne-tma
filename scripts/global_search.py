import sqlite3
from pathlib import Path

DB_PATH = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")

def global_search(search_str):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [row[0] for row in cursor.fetchall()]
    
    found = False
    for table in tables:
        try:
            cursor.execute(f"PRAGMA table_info({table})")
            columns = [row[1] for row in cursor.fetchall()]
            
            for col in columns:
                query = f"SELECT * FROM {table} WHERE CAST({col} AS TEXT) LIKE ?"
                cursor.execute(query, (f'%{search_str}%',))
                results = cursor.fetchall()
                if results:
                    print(f"Found in table '{table}', column '{col}':")
                    # print(results) # Might be too much
                    print(f"  Count: {len(results)}")
                    found = True
        except:
            continue
            
    if not found:
        print(f"String '{search_str}' not found anywhere in the DB.")
    conn.close()

if __name__ == "__main__":
    global_search("Архив")
    global_search("Archive")
