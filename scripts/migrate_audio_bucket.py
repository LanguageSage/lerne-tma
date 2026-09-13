import os
import sys
import asyncio
import aiohttp
import time
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL or SUPABASE_KEY not set")
    sys.exit(1)

HEADERS = {
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}

async def list_all_files(bucket: str):
    print(f"Listing all files in bucket '{bucket}'...")
    all_files = set()
    offset = 0
    limit = 1000
    timeout = aiohttp.ClientTimeout(total=60)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        while True:
            payload = {
                "prefix": "",
                "limit": limit,
                "offset": offset,
                "sortBy": {"column": "name", "order": "asc"}
            }
            async with session.post(f"{SUPABASE_URL}/storage/v1/object/list/{bucket}", headers=HEADERS, json=payload) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    print(f"Failed to list {bucket} at offset {offset}: {resp.status} {text}")
                    break
                items = await resp.json()
                if not items:
                    break
                for item in items:
                    if "name" in item:
                        all_files.add(item["name"])
                if len(items) < limit:
                    break
                offset += limit
    print(f"Total files found in '{bucket}': {len(all_files)}")
    return all_files

async def copy_file(session, sem, filename: str, stats: dict):
    copy_url = f"{SUPABASE_URL}/storage/v1/object/copy"
    payload = {
        "bucketId": "tma-audio",
        "sourceKey": filename,
        "destinationBucket": "audio",
        "destinationKey": filename
    }
    async with sem:
        for attempt in range(3):
            try:
                async with session.post(copy_url, headers=HEADERS, json=payload) as resp:
                    if resp.status == 200:
                        stats["copied"] += 1
                        return True
                    else:
                        text = await resp.text()
                        if resp.status == 404:
                            stats["not_found"] += 1
                            return False
                        if attempt == 2:
                            stats["failed"] += 1
                            if stats["failed"] <= 10:
                                print(f"Copy failed for {filename}: {resp.status} {text}")
                            return False
            except Exception as e:
                if attempt == 2:
                    stats["failed"] += 1
                    if stats["failed"] <= 10:
                        print(f"Exception copying {filename}: {e}")
                    return False
                await asyncio.sleep(0.5 * (attempt + 1))
    return False

async def main():
    start_time = time.time()
    source_files = await list_all_files("tma-audio")
    existing_dest = await list_all_files("audio")

    to_copy = list(source_files - existing_dest)
    print(f"Files to copy: {len(to_copy)} (already exist in dest: {len(existing_dest)})")

    if not to_copy:
        print("All files already migrated!")
        return

    sem = asyncio.Semaphore(25)
    stats = {"copied": 0, "failed": 0, "not_found": 0}

    timeout = aiohttp.ClientTimeout(total=30)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        tasks = []
        for filename in to_copy:
            tasks.append(copy_file(session, sem, filename, stats))

        total = len(tasks)
        done_count = 0
        batch_size = 500
        for i in range(0, total, batch_size):
            chunk = tasks[i:i + batch_size]
            await asyncio.gather(*chunk)
            done_count += len(chunk)
            elapsed = time.time() - start_time
            rate = done_count / elapsed if elapsed > 0 else 0
            pct = (done_count / total) * 100
            print(f"Progress: {done_count}/{total} ({pct:.1f}%) - Copied: {stats['copied']}, Failed: {stats['failed']} - Speed: {rate:.1f} files/sec")

    elapsed = time.time() - start_time
    print(f"\nMigration finished in {elapsed:.2f}s!")
    print(f"Final stats: Copied: {stats['copied']}, Failed: {stats['failed']}, Not Found: {stats['not_found']}")

    final_dest = await list_all_files("audio")
    print(f"Final files in 'audio' bucket: {len(final_dest)}")

if __name__ == "__main__":
    asyncio.run(main())
