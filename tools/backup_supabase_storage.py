"""Read-only export of audio/images bytes, with a private manifest and restore check.

Explicit configuration only. No Storage writes or implicit download retries.
"""
import argparse
import asyncio
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit
import re
import shutil
import sys

import aiohttp
from dotenv import dotenv_values
import psycopg2
from psycopg2 import sql

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
BUCKETS = ('audio', 'images')


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(65536), b''):
            result.update(chunk)
    return result.hexdigest()


def safe_path(root, bucket, name):
    # Also reject Windows aliases, ADS, separators and traversal on every OS.
    if bucket not in BUCKETS or not name or any(
            part in ('', '.', '..') or part.endswith((' ', '.')) or
            re.search(r'[\\:\x00-\x1f<>"|?*]', part) or
            part.split('.')[0].upper() in {'CON', 'PRN', 'AUX', 'NUL',
                *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}
            for part in name.split('/')):
        raise ValueError('Unsafe object path')
    target = (root / bucket / name).resolve()
    if not target.is_relative_to(root.resolve() / bucket):
        raise ValueError('Object escaped destination')
    return target


def get_objects_from_db(connection):
    with connection.cursor() as cur:
        cur.execute("""SELECT bucket_id,name,(metadata->>'size')::bigint,updated_at::text
            FROM storage.objects WHERE bucket_id=ANY(%s) ORDER BY bucket_id,name""", (list(BUCKETS),))
        return [dict(zip(('bucket', 'name', 'size', 'updated_at'), row)) for row in cur.fetchall()]


def media_references(connection, origin):
    """Walk entire rows, including nested V2/legacy resources, without editing links."""
    found, uncovered = [], []

    def walk(value, location, field='', media_kind=None):
        if isinstance(value, dict):
            kind = value.get('type')
            if kind in ('image', 'audio', 'video', 'background'):
                media_kind = {'image': 'images', 'audio': 'audio', 'video': 'videos', 'background': 'backgrounds'}[kind]
            for key, child in value.items():
                implied = ('images' if 'image' in key else 'audio' if 'audio' in key else
                           'videos' if 'video' in key else 'backgrounds' if 'background' in key else media_kind)
                walk(child, location + '.' + key, key, implied)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                walk(child, location + f'[{index}]', field, media_kind)
        elif isinstance(value, str):
            if field == 'image_data':
                return  # Embedded bytes belong to the SQL backup.
            if value.startswith(('{', '[')):
                try:
                    walk(json.loads(value), location, field, media_kind)
                    return
                except ValueError:
                    pass
            explicit = media_kind and (field in ('url', 'path', 'src', 'filename', 'image', 'audio') or
                                       field.endswith('_path') or field.startswith(('audio_', 'image_', 'video_')))
            if explicit and value and not value.startswith(('data:', 'blob:', '/static/')):
                path = value.lstrip('/')
                candidates = [value if value.startswith(('http://', 'https://', '/api/media/')) or
                              path.split('/')[0] in (*BUCKETS, 'videos', 'backgrounds', 'tma-audio') else media_kind + '/' + path]
            else:
                candidates = re.findall(r'https?://[^\s<>"\x27)\]]+|(?<![\w/])/?(?:api/media/)?(?:audio|images)/[^\s<>"\x27)\]]+', value)
            for candidate in candidates:
                parsed = urlsplit(candidate)
                path = unquote(parsed.path).lstrip('/')
                path = re.sub(r'^api/media/', '', path)
                if parsed.netloc:
                    if parsed.netloc != urlsplit(origin).netloc:
                        uncovered.append({'location': location, 'reason': 'external_origin'})
                        continue
                    path = re.sub(r'^storage/v1/object/(?:public|authenticated)/', '', path)
                bucket, _, name = path.partition('/')
                if bucket in BUCKETS and name:
                    found.append({'bucket': bucket, 'name': name, 'location': location})
                else:
                    uncovered.append({'location': location, 'reason': 'outside_audio_images'})
    with connection.cursor() as cur:
        cur.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=ANY(%s)",
                    (['tma_card', 'card', 'tma_deck', 'deck', 'tmamedia'],))
        for table, in cur.fetchall():
            cur.execute(sql.SQL('SELECT to_jsonb(t) FROM public.{} t').format(sql.Identifier(table)))
            for row, in cur.fetchall():
                walk(row, f'{table}:{row.get("id", "unknown")}')
    return found, uncovered


async def download_worker(session, semaphore, item, target_dir, origin):
    target = safe_path(target_dir, item['bucket'], item['name'])
    if item['size'] is None or item['size'] < 0:
        raise ValueError('Inventory has no valid byte size')
    if target.exists():
        raise ValueError('Destination already exists')
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_name(target.name + '.part')
    url = origin + '/storage/v1/object/authenticated/' + item['bucket'] + '/' + quote(item['name'], safe='/')
    async with semaphore, session.get(url, allow_redirects=False) as response:
        if response.status != 200:
            raise RuntimeError(f'HTTP {response.status}')
        hasher = hashlib.sha256()
        size = 0
        with part.open('xb') as stream:
            async for chunk in response.content.iter_chunked(65536):
                stream.write(chunk)
                hasher.update(chunk)
                size += len(chunk)
        if size != item['size'] or digest(part) != hasher.hexdigest():
            raise ValueError('Size/SHA-256 verification failed')
        part.rename(target)
    return {**item, 'sha256': hasher.hexdigest(), 'status': 'downloaded_verified'}


async def download_all(objects, target_dir, origin, key):
    semaphore = asyncio.Semaphore(8)
    async with aiohttp.ClientSession(
            headers={'Authorization': 'Bearer ' + key, 'apikey': key},
            timeout=aiohttp.ClientTimeout(total=120), auto_decompress=False) as session:
        results = await asyncio.gather(*(download_worker(session, semaphore, obj, target_dir, origin)
                                         for obj in objects), return_exceptions=True)
    return results


def verify_restore(backup_dir, restore_dir, manifest):
    if restore_dir.exists():
        raise ValueError('Restore check requires a new directory')
    restore_dir.mkdir(parents=True)
    for item in manifest['files']:
        src = safe_path(backup_dir, item['bucket'], item['name'])
        dst = safe_path(restore_dir, item['bucket'], item['name'])
        if src.stat().st_size != item['size'] or digest(src) != item['sha256']:
            raise ValueError('Backup source size/SHA-256 mismatch')
        dst.parent.mkdir(parents=True, exist_ok=True)
        with dst.open('xb') as output, src.open('rb') as source:
            shutil.copyfileobj(source, output)
        if dst.stat().st_size != item['size'] or digest(dst) != item['sha256']:
            raise ValueError('Restored bytes size/SHA-256 mismatch')
    return True


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-env-file', type=Path, required=True)
    parser.add_argument('--storage-url', required=True)
    parser.add_argument('--expected-host', required=True)
    parser.add_argument('--expected-database', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--restore-check', type=Path, required=True)
    args = parser.parse_args(argv)
    output, restore = args.output.resolve(), args.restore_check.resolve()
    if any(not p.is_relative_to(ROOT / 'local/test-data') or p.exists() for p in (output, restore)) or output == restore or output in restore.parents or restore in output.parents:
        parser.error('Use two distinct new private directories under local/test-data')
    origin = args.storage_url.rstrip('/')
    parsed_origin = urlsplit(origin)
    if (parsed_origin.scheme != 'https' or not parsed_origin.netloc or parsed_origin.path or
            parsed_origin.query or parsed_origin.fragment or parsed_origin.username):
        parser.error('--storage-url must be an HTTPS origin')
    output.mkdir(parents=True)
    manifest = {'created_at': datetime.now(timezone.utc).isoformat(), 'origin': origin,
                'buckets': list(BUCKETS), 'files': [], 'missing': [], 'failed': [], 'errors': [], 'ok': False}
    connection = None
    try:
        config = dotenv_values(args.source_env_file)
        url = config['SUPABASE_DB_URL']
        parsed = urlsplit(url)
        if (parsed.hostname, unquote(parsed.path.lstrip('/'))) != (args.expected_host, args.expected_database):
            raise ValueError('Database identity mismatch')
        if config.get('SUPABASE_URL', '').rstrip('/') != origin or not config.get('SUPABASE_KEY'):
            raise ValueError('Storage origin/key mismatch')
        connection = psycopg2.connect(url, connect_timeout=15, sslmode='require',
            options='-c default_transaction_read_only=on -c statement_timeout=120000')
        connection.set_session(readonly=True, isolation_level='REPEATABLE READ')
        objects = get_objects_from_db(connection)
        references, manifest['uncovered'] = media_references(connection, origin)
        manifest['inventory_before'] = objects
        listed = {(o['bucket'], o['name']) for o in objects}
        from api.utils.storage_keys import storage_key
        manifest['missing'] = [r for r in references if (r['bucket'], r['name']) not in listed
                               and (r['bucket'], storage_key(r['name'])) not in listed]
        results = asyncio.run(download_all(objects, output, origin, config['SUPABASE_KEY']))
        for obj, result in zip(objects, results):
            if isinstance(result, BaseException):
                # No response bodies, secrets or signed URLs in reports.
                manifest['failed'].append({**obj, 'error_type': type(result).__name__, 'error': str(result)})
            else:
                manifest['files'].append(result)
        connection.rollback()
        manifest['inventory_after'] = get_objects_from_db(connection)
        if manifest['inventory_after'] != objects:
            manifest['errors'].append('Storage inventory changed during export')
        manifest['restore_verified'] = verify_restore(output, restore, manifest)
        manifest['ok'] = not (manifest['failed'] or manifest['errors'] or
                              any(r['bucket'] == 'images' for r in manifest['missing']))
        manifest['missing_audio_accepted'] = sum(r['bucket'] == 'audio' for r in manifest['missing'])
    except Exception as exc:
        manifest['errors'].append({'error_type': type(exc).__name__})
    finally:
        if connection is not None:
            connection.close()
        manifest['downloaded_count'] = len(manifest['files'])
        manifest['downloaded_bytes'] = sum(f['size'] for f in manifest['files'])
        with (output / 'manifest.json').open('x', encoding='utf-8') as stream:
            json.dump(manifest, stream, ensure_ascii=False, indent=2)
    print(json.dumps({k: manifest[k] for k in ('ok', 'downloaded_count', 'downloaded_bytes')}))
    return 0 if manifest['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
