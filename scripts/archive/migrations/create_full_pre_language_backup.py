import os
import shutil
import sqlite3
import datetime
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

def run_pre_language_backup():
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir = Path(r"c:\121\Lerne_projekt\tma\backups") / f"pre_multilang_backup_{timestamp}"
    backup_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"==================================================")
    print(f"  CREATING FULL PRE-MULTILANGUAGE DATABASE BACKUP")
    print(f"  Target directory: {backup_dir}")
    print(f"==================================================\n")
    
    created_files = []
    
    # 1. Local SQLite Primary DB (Lerne/db/lerne.db)
    primary_db = Path(r"C:\121\Lerne_projekt\Lerne\db\lerne.db")
    if primary_db.exists():
        target_primary = backup_dir / "lerne_primary.db"
        shutil.copy2(primary_db, target_primary)
        size_mb = target_primary.stat().st_size / (1024 * 1024)
        created_files.append((target_primary.name, f"{size_mb:.2f} MB", "Local Primary SQLite DB"))
        print(f"[OK] Backup of Primary SQLite DB saved: {target_primary.name} ({size_mb:.2f} MB)")
    else:
        print(f"[WARN] Primary DB not found at: {primary_db}")
        
    # 2. Local SQLite Secondary DB (api/data/tma.db)
    secondary_db = Path(r"c:\121\Lerne_projekt\tma\api\data\tma.db")
    if secondary_db.exists():
        target_sec = backup_dir / "tma_api_data.db"
        shutil.copy2(secondary_db, target_sec)
        size_mb = target_sec.stat().st_size / (1024 * 1024)
        created_files.append((target_sec.name, f"{size_mb:.2f} MB", "API Data SQLite DB"))
        print(f"[OK] Backup of Secondary SQLite DB saved: {target_sec.name} ({size_mb:.2f} MB)")
        
    # 3. Cloud Supabase DB Backup
    supabase_url = os.environ.get("SUPABASE_DB_URL")
    if supabase_url:
        print("\nAttempting Supabase Cloud Database backup...")
        try:
            from playhouse.db_url import connect as db_connect
            cloud_db = db_connect(supabase_url)
            cloud_backup_file = backup_dir / "cloud_supabase_dump.db"
            local_conn = sqlite3.connect(cloud_backup_file)
            local_cursor = local_conn.cursor()
            
            tables = [
                "deck", "card", 
                "tma_deck", "tma_card", "tma_folder",
                "tmaprogress", "tmareviewhistory", "tmasetting", 
                "tmauserprompt", "tmacustomprompt", "librarycategory",
                "tmauser", "tmafeedback"
            ]
            
            table_count = 0
            total_rows = 0
            for table in tables:
                try:
                    cursor = cloud_db.execute_sql(f'SELECT column_name, data_type FROM information_schema.columns WHERE table_name = \'{table}\' ORDER BY ordinal_position')
                    cols_info = cursor.fetchall()
                    if not cols_info:
                        continue
                        
                    col_names = [c[0] for c in cols_info]
                    rows = cloud_db.execute_sql(f'SELECT * FROM "{table}"').fetchall()
                    
                    cols_str = ", ".join([f'"{name}"' for name in col_names])
                    local_cursor.execute(f'CREATE TABLE "{table}" ({cols_str})')
                    
                    if rows:
                        placeholders = ", ".join(["?"] * len(col_names))
                        local_cursor.executemany(f'INSERT INTO "{table}" VALUES ({placeholders})', rows)
                    
                    table_count += 1
                    total_rows += len(rows)
                    print(f"  - Table '{table}': {len(rows)} rows dumped")
                except Exception as te:
                    print(f"  - Table '{table}' skip/error: {te}")
                    
            local_conn.commit()
            local_conn.close()
            cloud_db.close()
            
            size_mb = cloud_backup_file.stat().st_size / (1024 * 1024)
            created_files.append((cloud_backup_file.name, f"{size_mb:.2f} MB", f"Cloud Dump ({table_count} tables, {total_rows} rows)"))
            print(f"[OK] Cloud Supabase Dump saved: {cloud_backup_file.name} ({size_mb:.2f} MB)")
        except Exception as ce:
            print(f"[WARN] Cloud backup failed or skipped: {ce}")
    else:
        print("[INFO] SUPABASE_DB_URL not set in env, skipping cloud backup.")
        
    print("\n==================================================")
    print("  PRE-MULTILANGUAGE BACKUP COMPLETE!")
    print(f"  Backup folder: {backup_dir.resolve()}")
    print("==================================================")
    
    # Save a text summary manifest in the backup folder
    manifest_file = backup_dir / "MANIFEST.txt"
    with open(manifest_file, "w", encoding="utf-8") as f:
        f.write(f"Backup Timestamp: {timestamp}\n")
        f.write(f"Files included:\n")
        for fn, sz, desc in created_files:
            f.write(f" - {fn} ({sz}) -> {desc}\n")
            
    return str(backup_dir)

if __name__ == "__main__":
    run_pre_language_backup()
