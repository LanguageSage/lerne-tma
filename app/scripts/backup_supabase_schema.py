import os
import json
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

def backup_supabase():
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        print("Error: SUPABASE_DB_URL not found in .env")
        return

    tables = [
        'deck', 'card', 'tma_deck', 'tma_card', 
        'tmaprogress', 'tmareviewhistory', 'tmauserprompt', 
        'tmasetting', 'tmamedia'
    ]
    
    backup_data = {}
    
    try:
        print(f"Connecting to Supabase...")
        conn = psycopg2.connect(db_url)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        for table in tables:
            try:
                print(f"Backing up table: {table}...")
                cur.execute(f"SELECT * FROM {table} LIMIT 10") # Only need schema/sample
                rows = cur.fetchall()
                # Handle non-serializable types
                for row in rows:
                    for k, v in row.items():
                        if hasattr(v, 'isoformat'):
                            row[k] = v.isoformat()
                        elif isinstance(v, (bytes, memoryview)):
                            row[k] = "__binary_data__"
                backup_data[table] = rows
            except Exception as e:
                print(f"Warning: Could not backup table {table}: {e}")
                conn.rollback()
        
        output_file = 'c:\\121\\Lerne_projekt\\tma\\api\\data\\supabase_schema_sample.json'
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(backup_data, f, ensure_ascii=False, indent=2)
            
        print(f"Successfully backed up schema sample to {output_file}")
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Error connecting to Supabase: {e}")

if __name__ == "__main__":
    backup_supabase()
