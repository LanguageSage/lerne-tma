import os
import sys
import logging

# Add the current directory to sys.path
sys.path.append(os.getcwd())

from api.models import tma_db, initialize_database

def apply_indexes():
    print("Connecting to database...")
    initialize_database()
    
    with tma_db.atomic():
        print("Creating index on tmaprogress(user_id, card_id)...")
        # PostgreSQL syntax for index
        tma_db.execute_sql("CREATE INDEX IF NOT EXISTS idx_tmaprogress_user_card ON tmaprogress (user_id, card_id);")
        
        print("Creating index on tmaprogress(next_review)...")
        tma_db.execute_sql("CREATE INDEX IF NOT EXISTS idx_tmaprogress_next_review ON tmaprogress (next_review);")
        
        print("Indexes applied successfully.")

if __name__ == "__main__":
    try:
        apply_indexes()
    except Exception as e:
        print(f"Error applying indexes: {e}")
        import traceback
        traceback.print_exc()
