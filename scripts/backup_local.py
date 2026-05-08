import shutil
import os
import datetime
from pathlib import Path

def backup_local_db():
    db_path = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")
    backup_dir = Path(r"c:\121\Lerne_projekt\tma\backups")
    
    if not db_path.exists():
        print(f"ERROR: Database not found at {db_path}")
        return
        
    os.makedirs(backup_dir, exist_ok=True)
    
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = backup_dir / f"lerne_backup_{timestamp}.db"
    
    shutil.copy2(db_path, backup_path)
    print(f"SUCCESS: Backup created at {backup_path}")

if __name__ == "__main__":
    backup_local_db()
