import os
import sys
import psycopg2
import requests
from dotenv import load_dotenv

load_dotenv()
sys.stdout.reconfigure(encoding='utf-8')

SUPABASE_URL = os.environ.get('SUPABASE_URL', '').rstrip('/')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY', '')
SUPABASE_DB_URL = os.environ.get('SUPABASE_DB_URL')

RENAME_MAP = {
    'Без названия.jpeg': 'bez_nazvaniya.jpeg',
    'Без названия.png': 'bez_nazvaniya.png',
    'Создай изображение д.png': 'sozdai_izobrazhenie_d.png',
    'реалистичная зимняя .png': 'realistic_winter.png',
    'чвывы.png': 'chvyvy.png'
}

conn = psycopg2.connect(SUPABASE_DB_URL)
cur = conn.cursor()

for old_name, new_name in RENAME_MAP.items():
    cur.execute("SELECT id, content FROM tmamedia WHERE folder = 'images' AND filename = %s;", [old_name])
    row = cur.fetchone()
    if not row:
        print(f"Skipping {old_name}, not in tmamedia")
        continue
    
    media_id, raw_bytes = row
    content_type = "image/jpeg" if new_name.endswith('.jpeg') or new_name.endswith('.jpg') else "image/png"
    
    # Upload to Supabase Storage
    upload_url = f"{SUPABASE_URL}/storage/v1/object/images/{new_name}"
    headers = {
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'x-upsert': 'true',
        'Content-Type': content_type
    }
    
    resp = requests.post(upload_url, headers=headers, data=raw_bytes, timeout=15)
    if resp.status_code in (200, 201):
        print(f"Uploaded {new_name} successfully!")
        
        # Update TMAMedia
        cur.execute("UPDATE tmamedia SET filename = %s, content = NULL WHERE id = %s;", [new_name, media_id])
        
        # Update card table
        cur.execute("UPDATE card SET image_path = %s WHERE image_path = %s;", [new_name, old_name])
        cur.execute(f"UPDATE card SET front_text = replace(front_text, '{old_name}', '{new_name}') WHERE front_text LIKE '%{old_name}%';")
        
        # Update tma_card table just in case
        cur.execute("UPDATE tma_card SET image_path = %s WHERE image_path = %s;", [new_name, old_name])
        cur.execute(f"UPDATE tma_card SET front_text = replace(front_text, '{old_name}', '{new_name}') WHERE front_text LIKE '%{old_name}%';")
        
        conn.commit()
    else:
        print(f"Failed to upload {new_name}: {resp.status_code} {resp.text}")

# Check remaining with content
cur.execute("SELECT count(*) FROM tmamedia WHERE folder = 'images' AND content IS NOT NULL;")
remaining = cur.fetchone()[0]
print(f"Remaining images with content in TMAMedia: {remaining}")

conn.close()
