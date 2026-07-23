import os
import sys

# Add project root to sys.path
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(os.path.dirname(current_dir))
if project_root not in sys.path:
    sys.path.append(project_root)

# Force local DB for migration
os.environ["FORCE_LOCAL_DB"] = "true"

from api.models import initialize_database, create_all_tables, tma_db

print("Starting migration...")
initialize_database()
create_all_tables()
print("Migration completed successfully.")
