"""Bounded Storage backup; never replaces existing backups or logs response bodies."""
import argparse
import os
import time
from pathlib import Path
from urllib.parse import quote

import requests
from dotenv import load_dotenv


def backup_storage(max_records=100, max_bytes=64 * 1024 * 1024, max_seconds=300):
    if min(max_records, max_bytes, max_seconds) <= 0:
        raise ValueError('Limits must be positive')
    base = os.environ.get('SUPABASE_URL', '').rstrip('/')
    key = os.environ.get('SUPABASE_KEY', '')
    if not base or not key:
        raise ValueError('SUPABASE_URL and SUPABASE_KEY required')
    root = Path('backups/media_cloud').resolve()
    root.mkdir(parents=True, exist_ok=True)
    used, saved = 0, 0
    deadline = time.monotonic() + max_seconds
    with requests.Session() as session:
        with session.post(f'{base}/storage/v1/object/list/tma-audio',
            headers={'Authorization': f'Bearer {key}'}, json={'prefix': '', 'limit': min(max_records, 1000)},
            timeout=(10, 20)) as response:
            response.raise_for_status()
            files = response.json()
        for item in files[:max_records]:
            if time.monotonic() >= deadline or used >= max_bytes:
                break
            name = item.get('name', '')
            target = (root / name).resolve()
            if not name or target.parent != root or target.exists():
                continue
            # Exclusive partial files are safe to retry and never replace user data.
            part = target.with_suffix(target.suffix + '.part')
            if part.exists():
                continue
            try:
                with session.get(f'{base}/storage/v1/object/public/tma-audio/{quote(name, safe="")}',
                                 stream=True, timeout=(10, 20), allow_redirects=False) as response:
                    response.raise_for_status()
                    with part.open('xb') as output:
                        for chunk in response.iter_content(65536):
                            used += len(chunk)
                            if used > max_bytes or time.monotonic() >= deadline:
                                raise ValueError('Backup budget reached')
                            output.write(chunk)
                part.rename(target)
                saved += 1
            except (requests.RequestException, ValueError):
                # Keep the partial file; the next run will not silently overwrite it.
                print('Backup stopped; partial file retained')
                break
    print(f'Saved={saved} received_bytes={used}')
    return saved, used


if __name__ == '__main__':
    load_dotenv()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--max-records', type=int, default=100)
    parser.add_argument('--max-bytes', type=int, default=64 * 1024 * 1024)
    parser.add_argument('--max-seconds', type=int, default=300)
    args = parser.parse_args()
    backup_storage(**vars(args))
