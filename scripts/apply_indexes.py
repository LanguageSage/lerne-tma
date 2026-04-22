import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load .env from root
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

# Add api to path
current_dir = Path(__file__).resolve().parent
sys.path.append(str(current_dir.parent))

from api.models import tma_db, TMAProgress, TMAReviewHistory, initialize_database

def apply_indexes():
    print("[*] Initializing database connection...")
    initialize_database()
    
    # Прямое выполнение SQL через соединение
    print("[*] Applying indexes to TMAProgress...")
    try:
        # card_id index
        tma_db.execute_sql('CREATE INDEX IF NOT EXISTS tmaprogress_card_id ON tmaprogress (card_id);')
        # user_id index
        tma_db.execute_sql('CREATE INDEX IF NOT EXISTS tmaprogress_user_id ON tmaprogress (user_id);')
        # Composite index
        tma_db.execute_sql('CREATE INDEX IF NOT EXISTS tmaprogress_srs_idx ON tmaprogress (user_id, queue, next_review);')
        print("[+] TMAProgress indexes applied.")
    except Exception as e:
        print(f"[!] Error applying indexes to TMAProgress: {e}")

    print("[*] Applying indexes to TMAReviewHistory...")
    try:
        # card_id index
        tma_db.execute_sql('CREATE INDEX IF NOT EXISTS tmareviewhistory_card_id ON tmareviewhistory (card_id);')
        # user_id index
        tma_db.execute_sql('CREATE INDEX IF NOT EXISTS tmareviewhistory_user_id ON tmareviewhistory (user_id);')
        print("[+] TMAReviewHistory indexes applied.")
    except Exception as e:
        print(f"[!] Error applying indexes to TMAReviewHistory: {e}")

    print("[DONE] Performance optimization complete.")

if __name__ == "__main__":
    apply_indexes()
