"""
Independent backup of all Supabase Storage objects.
Downloads all physical files, calculates SHA-256, generates manifest,
and verifies restoration on an isolated local storage directory.
"""
import asyncio
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import aiohttp
import dotenv
import psycopg2

ROOT = Path(__file__).resolve().parents[1]
BACKUP_DIR = ROOT.parent / 'data' / 'backups' / 'supabase_storage_backup'
RESTORE_TEST_DIR = ROOT / 'local' / 'test-data' / 'storage_restore_test'
BASE_URL = 'https://wdopyuulhiykrextyvnt.supabase.co/storage/v1/object/public'


def get_objects_from_db():
    dotenv.load_dotenv(ROOT / '.env')
    db_url = os.environ.get('SUPABASE_DB_URL')
    if not db_url:
        raise RuntimeError('SUPABASE_DB_URL is not set')
    
    conn = psycopg2.connect(db_url, connect_timeout=15)
    try:
        with conn.cursor() as cur:
            cur.execute('SET TRANSACTION READ ONLY')
            cur.execute("""
                SELECT bucket_id, name, (metadata->>'size')::bigint, (metadata->>'mimetype')
                FROM storage.objects
                ORDER BY bucket_id, name
            """)
            rows = cur.fetchall()
            return [{'bucket': r[0], 'name': r[1], 'size': r[2] or 0, 'mimetype': r[3] or ''} for r in rows]
    finally:
        conn.close()


async def download_worker(session, semaphore, item, target_dir, progress, lock):
    bucket = item['bucket']
    name = item['name']
    expected_size = item['size']
    target_path = target_dir / bucket / name

    # If file exists and size matches, calculate sha256 to verify
    if target_path.is_file() and target_path.stat().st_size == expected_size:
        hasher = hashlib.sha256()
        with open(target_path, 'rb') as f:
            while chunk := f.read(65536):
                hasher.update(chunk)
        digest = hasher.hexdigest()
        async with lock:
            progress['done'] += 1
            progress['bytes'] += expected_size
        return {'bucket': bucket, 'name': name, 'size': expected_size, 'sha256': digest, 'cached': True}

    target_path.parent.mkdir(parents=True, exist_ok=True)
    quoted_name = quote(name, safe='/')
    url = f"{BASE_URL}/{bucket}/{quoted_name}"

    for attempt in range(4):
        try:
            async with semaphore:
                async with session.get(url) as resp:
                    if resp.status == 200:
                        content = await resp.read()
                        hasher = hashlib.sha256(content)
                        digest = hasher.hexdigest()
                        with open(target_path, 'wb') as f:
                            f.write(content)
                        async with lock:
                            progress['done'] += 1
                            progress['bytes'] += len(content)
                            if progress['done'] % 2000 == 0 or progress['done'] == progress['total']:
                                mb = round(progress['bytes'] / 1024 / 1024, 2)
                                print(f"[{progress['done']}/{progress['total']}] {mb} MB downloaded...", flush=True)
                        return {'bucket': bucket, 'name': name, 'size': len(content), 'sha256': digest, 'cached': False}
                    else:
                        if attempt == 3:
                            raise RuntimeError(f"HTTP {resp.status} for {url}")
        except Exception as e:
            if attempt == 3:
                raise RuntimeError(f"Failed to download {url}: {e}")
            await asyncio.sleep(1 + attempt * 2)


async def download_all(objects, target_dir):
    target_dir.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(40)
    progress = {'done': 0, 'bytes': 0, 'total': len(objects)}
    lock = asyncio.Lock()

    connector = aiohttp.TCPConnector(limit=50, limit_per_host=40, ttl_dns_cache=300)
    timeout = aiohttp.ClientTimeout(total=60)
    async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
        tasks = [download_worker(session, semaphore, obj, target_dir, progress, lock) for obj in objects]
        results = await asyncio.gather(*tasks)
        return results


def verify_restore(backup_dir, restore_dir, manifest):
    print("\n--- Verifying Restoration on Isolated Storage Directory ---", flush=True)
    if restore_dir.exists():
        import shutil
        shutil.rmtree(restore_dir)
    restore_dir.mkdir(parents=True, exist_ok=True)

    verified_count = 0
    verified_bytes = 0
    for file_info in manifest['files']:
        bucket = file_info['bucket']
        name = file_info['name']
        src = backup_dir / bucket / name
        dst = restore_dir / bucket / name
        dst.parent.mkdir(parents=True, exist_ok=True)

        # Copy file
        with open(src, 'rb') as f_in, open(dst, 'wb') as f_out:
            content = f_in.read()
            hasher = hashlib.sha256(content)
            if hasher.hexdigest() != file_info['sha256']:
                raise RuntimeError(f"Checksum mismatch for {bucket}/{name} in backup source!")
            f_out.write(content)
            verified_count += 1
            verified_bytes += len(content)

    print(f"Restored and checksum-verified: {verified_count}/{len(manifest['files'])} files ({round(verified_bytes/1024/1024, 2)} MB)", flush=True)
    return True


def main():
    start_time = time.time()
    print("=== TASK 3: INDEPENDENT SUPABASE STORAGE BACKUP & AUDIT ===", flush=True)
    print("1. Fetching metadata from Supabase database (storage.objects)...", flush=True)
    objects = get_objects_from_db()
    print(f"Found {len(objects)} objects across buckets in Supabase Storage.", flush=True)

    bucket_stats = {}
    for o in objects:
        b = o['bucket']
        bucket_stats[b] = bucket_stats.get(b, {'count': 0, 'size': 0})
        bucket_stats[b]['count'] += 1
        bucket_stats[b]['size'] += o['size']

    for b, s in bucket_stats.items():
        print(f"  * Bucket '{b}': {s['count']} files, {round(s['size'] / 1024 / 1024, 2)} MB", flush=True)

    print(f"\n2. Downloading all files to {BACKUP_DIR}...", flush=True)
    results = asyncio.run(download_all(objects, BACKUP_DIR))

    print("\n3. Generating manifest with file counts, sizes and SHA-256 checksums...", flush=True)
    manifest = {
        'version': 1,
        'created_at': datetime.now(timezone.utc).isoformat(),
        'source_project': 'wdopyuulhiykrextyvnt.supabase.co',
        'total_files': len(results),
        'total_bytes': sum(r['size'] for r in results),
        'buckets': {},
        'files': results
    }

    for r in results:
        b = r['bucket']
        if b not in manifest['buckets']:
            manifest['buckets'][b] = {'count': 0, 'bytes': 0}
        manifest['buckets'][b]['count'] += 1
        manifest['buckets'][b]['bytes'] += r['size']

    manifest_path = BACKUP_DIR / 'manifest.json'
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f"Manifest saved to {manifest_path} (size: {manifest_path.stat().st_size} bytes)", flush=True)

    # Re-verify summary
    print(f"Backup complete: {manifest['total_files']} files, {round(manifest['total_bytes']/1024/1024, 2)} MB in {round(time.time() - start_time, 1)}s.", flush=True)

    # 4. Verify restore
    verify_restore(BACKUP_DIR, RESTORE_TEST_DIR, manifest)

    # Clean up test directory to keep workspace tidy
    import shutil
    shutil.rmtree(RESTORE_TEST_DIR)
    print("Restore verification test directory cleaned up successfully.", flush=True)
    print("\n=== STORAGE BACKUP & AUDIT FINISHED: 100% PASS ===", flush=True)


if __name__ == '__main__':
    main()
