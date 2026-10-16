import os
import sys
import asyncio
import logging
import aiohttp
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger('image_migration')
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from api.database import initialize_database, tma_db
from api.models import TMAMedia

SUPABASE_URL = os.environ.get('SUPABASE_URL', '').rstrip('/')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY', '')
BUCKET = 'images'

if not SUPABASE_URL or not SUPABASE_KEY:
    logger.error("SUPABASE_URL or SUPABASE_KEY not set in environment.")
    sys.exit(1)

def guess_content_type(filename: str, raw_bytes: bytes) -> str:
    if raw_bytes.startswith(b'\xff\xd8\xff'):
        return "image/jpeg"
    elif raw_bytes.startswith(b'\x89PNG\r\n\x1a\n'):
        return "image/png"
    elif raw_bytes.startswith(b'RIFF') and b'WEBP' in raw_bytes[:16]:
        return "image/webp"
    elif raw_bytes.startswith(b'GIF8'):
        return "image/gif"
    ext = filename.split('.')[-1].lower() if '.' in filename else ''
    if ext in ('jpg', 'jpeg'):
        return "image/jpeg"
    elif ext == 'png':
        return "image/png"
    elif ext == 'webp':
        return "image/webp"
    elif ext == 'gif':
        return "image/gif"
    return "application/octet-stream"

async def upload_single(sem, session, item):
    raw_bytes = bytes(item.content or b'')
    if len(raw_bytes) == 0:
        return item.id, item.filename, True

    filename = item.filename
    content_type = guess_content_type(filename, raw_bytes)
    upload_url = f'{SUPABASE_URL}/storage/v1/object/{BUCKET}/{filename}'
    headers = {
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'x-upsert': 'true',
        'Content-Type': content_type
    }

    async with sem:
        for attempt in range(3):
            try:
                async with session.post(upload_url, headers=headers, data=raw_bytes, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                    if resp.status in (200, 201):
                        return item.id, filename, True
                    err = await resp.text()
                    logger.warning(f'Upload fail {filename} (status {resp.status}): {err[:100]}')
            except Exception as e:
                logger.warning(f'Upload exception {filename} attempt {attempt+1}: {e}')
                await asyncio.sleep(0.5)
    return item.id, filename, False

async def migrate(batch_size=50, concurrency=10):
    if not initialize_database():
        logger.error('Database connection failed')
        return

    # Check total images with content
    total_with_content = TMAMedia.select().where(
        (TMAMedia.folder == 'images') & (TMAMedia.content.is_null(False))
    ).count()

    logger.info(f'Starting image migration to Supabase Storage bucket "{BUCKET}". Total with content: {total_with_content}')
    sem = asyncio.Semaphore(concurrency)
    migrated_count = 0
    error_count = 0

    connector = aiohttp.TCPConnector(limit=concurrency + 5, force_close=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        while True:
            items = list(TMAMedia.select(
                TMAMedia.id, TMAMedia.filename, TMAMedia.content
            ).where(
                (TMAMedia.folder == 'images') & (TMAMedia.content.is_null(False))
            ).limit(batch_size))

            if not items:
                break

            tasks = [upload_single(sem, session, it) for it in items]
            results = await asyncio.gather(*tasks)

            successful_ids = [item_id for item_id, filename, success in results if success]
            failed_count = len(results) - len(successful_ids)
            error_count += failed_count

            if successful_ids:
                # Clear content in DB for migrated items
                TMAMedia.update(content=None).where(TMAMedia.id << successful_ids).execute()
                migrated_count += len(successful_ids)

            logger.info(f'Migrated: {migrated_count}/{total_with_content}, Errors: {error_count}')

    logger.info(f'Image migration complete! Total successfully migrated: {migrated_count}, Errors: {error_count}')

if __name__ == '__main__':
    asyncio.run(migrate(batch_size=50, concurrency=10))
