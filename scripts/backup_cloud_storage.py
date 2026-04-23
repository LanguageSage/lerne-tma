import os
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
BUCKET_NAME = "tma-audio"

def backup_storage():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL or SUPABASE_KEY not found")
        return

    # Создаем папку для облачных медиа
    backup_dir = Path("backups/media_cloud")
    backup_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"--- Cloud Storage Backup: {BUCKET_NAME} -> {backup_dir} ---")
    
    # 1. Получаем список файлов в бакете
    # Supabase Storage API: POST /storage/v1/object/list/{bucketId}
    list_url = f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/list/{BUCKET_NAME}"
    headers = {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }
    
    try:
        resp = requests.post(list_url, headers=headers, json={"prefix": "", "limit": 1000})
        if resp.status_code != 200:
            print(f"ERROR listing files: {resp.status_code} - {resp.text}")
            return
            
        files = resp.json()
        print(f"Found {len(files)} files in storage.")
        
        # 2. Скачиваем каждый файл
        count = 0
        for file_info in files:
            name = file_info.get('name')
            if not name: continue
            
            # Ссылка для скачивания (публичная)
            download_url = f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/public/{BUCKET_NAME}/{name}"
            
            print(f"Downloading: {name}...", end=" ", flush=True)
            try:
                file_resp = requests.get(download_url)
                if file_resp.status_code == 200:
                    with open(backup_dir / name, "wb") as f:
                        f.write(file_resp.content)
                    print("DONE")
                    count += 1
                else:
                    print(f"FAILED ({file_resp.status_code})")
            except Exception as e:
                print(f"ERROR: {e}")
                
        print(f"\nSUCCESS! {count} files downloaded to {backup_dir}")
        
    except Exception as e:
        print(f"\nCRITICAL ERROR during storage backup: {e}")

if __name__ == "__main__":
    backup_storage()
