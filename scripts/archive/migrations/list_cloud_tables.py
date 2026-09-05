import os
from peewee import *
from playhouse.db_url import connect as db_connect
from dotenv import load_dotenv

load_dotenv()
SUPABASE_URL = os.environ.get("SUPABASE_DB_URL")

def list_cloud_tables():
    db = db_connect(SUPABASE_URL)
    res = db.execute_sql("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'").fetchall()
    tables = [row[0] for row in res]
    print(f"Cloud Tables: {tables}")
    
    # Check for library/external tables
    for t in ['external_deck', 'tma_external_deck', 'library_deck', 'shared_deck']:
        if t in tables:
            count = db.execute_sql(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
            print(f"Cloud table {t} has {count} rows.")
            
    db.close()

if __name__ == "__main__":
    list_cloud_tables()
