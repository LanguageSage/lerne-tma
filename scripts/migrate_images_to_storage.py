"""Bounded, resumable media migration. No network or DB work at import time."""
import argparse
import asyncio
import hashlib
import json
import logging
import os
import sys
import time
from pathlib import Path

import aiohttp
from dotenv import load_dotenv
from peewee import fn

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api.utils.storage_keys import storage_object_path, storage_key

logger = logging.getLogger(__name__)

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


class Budget:
    def __init__(self, maximum):
        self.maximum = maximum
        self.used = 0

    def reserve(self, size):
        if self.used + size > self.maximum:
            raise ValueError("byte_limit")
        self.used += size


async def upload_single(session, item, *, base_url, key, bucket, attempts, budget):
    raw = bytes(item.content or b'')
    if not raw:
        return "empty_content"
    # Legacy compressed images must be served as images, not zstd downloads.
    if raw.startswith(b'\x28\xb5\x2f\xfd'):
        try:
            import zstandard
            raw = zstandard.ZstdDecompressor().decompress(raw, max_output_size=25 * 1024 * 1024)
        except Exception:
            return "decompression_failed"
    if bucket != 'images' and storage_key(item.filename) != item.filename:
        return 'unsupported_audio_filename'
    path = storage_object_path(item.filename)
    url = f"{base_url}/storage/v1/object/{bucket}/{path}"
    public = f"{base_url}/storage/v1/object/public/{bucket}/{path}"
    headers = {'Authorization': f'Bearer {key}', 'x-upsert': 'false',
               'Content-Type': guess_content_type(item.filename, raw) if bucket == 'images' else 'audio/mpeg'}
    reason = "attempt_limit"
    for attempt in range(attempts):
        try:
            budget.reserve(len(raw))
            async with session.post(url, headers=headers, data=raw, allow_redirects=False) as response:
                status = response.status
                # Existing objects are verified too. Never overwrite a different object.
                if status not in (200, 201, 400, 409):
                    reason = f"upload_http_{status}"
                    if status != 429 and status < 500:
                        return reason
                    continue
            # Verify public availability and exact bytes before clearing the DB.
            budget.reserve(len(raw) + 1)
            async with session.get(public, allow_redirects=False) as response:
                if response.status != 200:
                    if status == 400:
                        return 'upload_http_400'
                    reason = f"verify_http_{response.status}"
                    continue
                digest = hashlib.sha256()
                size = 0
                while size <= len(raw):
                    chunk = await response.content.read(min(65536, len(raw) + 1 - size))
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > len(raw):
                        return "verify_size_mismatch"
                    digest.update(chunk)
                if size == len(raw) and digest.digest() == hashlib.sha256(raw).digest():
                    return None
                return "verify_checksum_mismatch"
        except ValueError:
            return "byte_limit"
        except (aiohttp.ClientError, asyncio.TimeoutError):
            reason = "network_error"
        if attempt + 1 < attempts:
            await asyncio.sleep(min(2 ** attempt, 4))
    return reason


async def migrate(*, max_records=100, max_bytes=64 * 1024 * 1024, attempts=3,
                  max_seconds=300, report_path='media-migration-report.json', folder='images',
                  bucket='images', initialize=True, after_id=0, clear_content=False):
    if not (1 <= max_records <= 10000 and 1 <= attempts <= 5 and max_bytes > 0 and max_seconds > 0 and after_id >= 0):
        raise ValueError('Invalid migration limits')
    # Imports occur only after CLI validation. Tests bind existing proxies in memory.
    os.environ.setdefault('PGCONNECT_TIMEOUT', '10')
    os.environ.setdefault('PGOPTIONS', '-c statement_timeout=30000 -c lock_timeout=5000')
    os.environ['LERNE_SKIP_SCHEMA_INIT'] = '1'
    from api.database import initialize_database, tma_db
    from api.models import TMAMedia
    if initialize and not initialize_database():
        raise RuntimeError('Database initialization failed')
    base_url = os.environ.get('SUPABASE_URL', '').rstrip('/')
    key = os.environ.get('SUPABASE_KEY', '')
    if not base_url or not key:
        raise ValueError('SUPABASE_URL and SUPABASE_KEY required')
    budget = Budget(max_bytes)
    report = {'processed': 0, 'migrated': 0, 'verified': 0, 'bytes_reserved': 0, 'failed': [], 'stop': 'complete'}
    last_id = after_id
    deadline = time.monotonic() + max_seconds
    timeout = aiohttp.ClientTimeout(total=30, connect=10, sock_read=15)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            for _ in range(max_records):
                if time.monotonic() >= deadline:
                    report['stop'] = 'time_limit'
                    break
                # Read sizes before blobs so an oversized row cannot exhaust the budget.
                row = (TMAMedia.select(TMAMedia.id, fn.LENGTH(TMAMedia.content).alias('size'))
                       .where((TMAMedia.folder == folder) & TMAMedia.content.is_null(False) & (TMAMedia.id > last_id))
                       .order_by(TMAMedia.id).first())
                if row is None:
                    break
                last_id = row.id  # Failed rows are never selected again during this run.
                report['processed'] += 1
                try:
                    budget.reserve(row.size or 0)
                except ValueError:
                    report['failed'].append({'id': row.id, 'reason': 'byte_limit'})
                    report['stop'] = 'byte_limit'
                    break
                item = TMAMedia.select(TMAMedia.id, TMAMedia.filename, TMAMedia.content).where(TMAMedia.id == row.id).get()
                # A concurrent change may increase the blob between size and content reads.
                if len(item.content or b'') > (row.size or 0):
                    report['failed'].append({'id': row.id, 'reason': 'concurrent_change'})
                    continue
                try:
                    reason = await asyncio.wait_for(upload_single(session, item, base_url=base_url, key=key,
                        bucket=bucket, attempts=attempts, budget=budget), max(0.001, deadline-time.monotonic()))
                except asyncio.TimeoutError:
                    reason = 'time_limit'
                if reason is None:
                    report['verified'] += 1
                if reason is None and clear_content:
                    # Compare-and-clear prevents clearing a concurrently replaced file.
                    try:
                        budget.reserve(len(item.content or b''))
                    except ValueError:
                        report['failed'].append({'id': item.id, 'reason': 'byte_limit'})
                        report['stop'] = 'byte_limit'
                        break
                    with tma_db.atomic():
                        changed = (TMAMedia.update(content=None).where((TMAMedia.id == item.id) &
                            (TMAMedia.filename == item.filename) & (TMAMedia.content == item.content)).execute())
                    report['migrated'] += changed
                    if not changed:
                        reason = 'concurrent_change'
                if reason:
                    report['failed'].append({'id': item.id, 'reason': reason})
                    if reason in ('byte_limit', 'time_limit'):
                        report['stop'] = reason
                        break
            else:
                report['stop'] = 'record_limit'
    except Exception:
        report['stop'] = 'interrupted'
        report['failed'].append({'id': last_id, 'reason': 'database_or_local_error'})
        raise
    finally:
        report['last_id'] = last_id
        report['bytes_reserved'] = budget.used
        target = Path(report_path)
        temporary = target.with_suffix(target.suffix + '.tmp')
        temporary.write_text(json.dumps(report, indent=2), encoding='utf-8')
        temporary.replace(target)
    logger.info('Migration processed=%s migrated=%s failed=%s stop=%s bytes_reserved=%s',
                report['processed'], report['migrated'], len(report['failed']), report['stop'], budget.used)
    return report


def main(folder='images', bucket='images'):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--max-records', type=int, default=100)
    parser.add_argument('--max-bytes', type=int, default=64 * 1024 * 1024)
    parser.add_argument('--clear-db-content', action='store_true', help='Clear verified blobs only after Storage-key readers are deployed')
    parser.add_argument('--after-id', type=int, default=0)
    parser.add_argument('--attempts', type=int, default=3)
    parser.add_argument('--max-seconds', type=int, default=300)
    parser.add_argument('--report', default=f'{folder}-migration-report.json')
    args = parser.parse_args()
    load_dotenv()
    logging.basicConfig(level=logging.INFO)
    report = asyncio.run(migrate(max_records=args.max_records, max_bytes=args.max_bytes,
        attempts=args.attempts, max_seconds=args.max_seconds, report_path=args.report, folder=folder, bucket=bucket, after_id=args.after_id, clear_content=args.clear_db_content))
    return 1 if report['failed'] else 0


if __name__ == '__main__':
    sys.exit(main())
