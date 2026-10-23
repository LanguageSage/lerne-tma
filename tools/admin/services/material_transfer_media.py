"""Finite media preparation; immutable existing importer assets and TMAMedia.

Only the configured Storage origin is fetched. Revisions and prepared assets are
cached in the LOCAL receipt table; retries never start an unbounded queue.
"""
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit

import requests
from fastapi import HTTPException
from peewee import fn

from api import models
from api.services.card_text_update import _digest
from tools.admin.services.deck_import_media import prepare_media, store_media, MAX_FILE, MAX_TOTAL, MAX_FILES
from api.utils.storage_keys import storage_object_path

MEDIA_FIELDS = {'image_path': 'image', 'audio_path': 'audio', 'audio_back_path': 'audio'}
REFERENCE = re.compile(r'(?:https?://[^\s\x22\x27<>()[\]{}]+|/api/media/(?:images|audio)/[^\s\x22\x27<>()[\]{}]+)')


def location(endpoint, value, role=None):
    url = urlsplit(value)
    if url.query or url.fragment:
        raise HTTPException(422, 'Ссылки медиа с query/fragment требуют постоянного пути Storage.')
    if url.scheme:
        base = urlsplit(endpoint.storage['url']) if endpoint.storage else None
        if not base or url.scheme != 'https' or url.netloc != base.netloc:
            raise HTTPException(422, 'Медиа вне настроенного Storage нельзя переносить автоматически.')
        prefix = '/storage/v1/object/public/'
    else:
        prefix = '/api/media/'
    if not url.path.startswith(prefix):
        if url.scheme or url.path.startswith('/') or role not in ('image', 'audio'):
            raise HTTPException(422, 'Неподдерживаемая ссылка медиа.')
        parts = unquote(url.path).split('/')
        if len(parts) == 1:
            parts.insert(0, 'images' if role == 'image' else 'audio')
    else:
        parts = unquote(url.path[len(prefix):]).split('/')
    if parts[0] == 'tma-audio':
        parts[0] = 'audio'
    if len(parts) != 2 or parts[0] not in ('images', 'audio') or not parts[1] or any(
            c in parts[1] for c in ('\\', '\x00', ':')) or parts[1] in ('.', '..'):
        raise HTTPException(422, 'Небезопасный или неподдерживаемый путь медиа.')
    return parts


def media_info(endpoint, value, role=None):
    folder, filename = location(endpoint, value, role)
    if endpoint.media_root:
        path = Path(endpoint.media_root) / folder / filename
        if path.is_file():
            if path.stat().st_size > MAX_FILE:
                raise HTTPException(413, 'Медиа больше 20 МБ.')
            return {'folder': folder, 'filename': filename,
                    'revision': hashlib.sha256(path.read_bytes()).hexdigest(), 'file': str(path)}
    with endpoint.scope():
        query = models.TMAMedia.select(fn.LENGTH(models.TMAMedia.content).alias('size'))
        if endpoint.database.for_update:
            query = query.select_extend(fn.encode(fn.sha256(models.TMAMedia.content), 'hex').alias('checksum'))
        else:
            query = query.select_extend(models.TMAMedia.content)
        media = query.where(models.TMAMedia.folder == folder, models.TMAMedia.filename == filename).first()
        if media and media.size:
            if media.size > MAX_FILE:
                raise HTTPException(413, 'Медиа больше 20 МБ.')
            return {'folder': folder, 'filename': filename,
                    'revision': media.checksum if endpoint.database.for_update else
                                hashlib.sha256(media.content).hexdigest(), 'blob': True}
    if endpoint.media_root or not endpoint.storage:
        raise HTTPException(422, f'Файл {folder}/{filename} отсутствует.')
    url = endpoint.storage['url'] + f'/storage/v1/object/public/{folder}/{storage_object_path(filename)}'
    response = requests.head(url, timeout=(5, 30), allow_redirects=False)
    if response.status_code != 200 or not response.headers.get('ETag'):
        raise HTTPException(502, 'Storage не вернул устойчивую версию медиа.')
    if int(response.headers.get('Content-Length', 0)) > MAX_FILE:
        raise HTTPException(413, 'Медиа больше 20 МБ.')
    return {'folder': folder, 'filename': filename, 'revision': response.headers['ETag'], 'url': url}


def read_media(endpoint, info):
    if info.get('file'):
        data = Path(info['file']).read_bytes()
    elif info.get('blob'):
        with endpoint.scope():
            data = models.TMAMedia.get(models.TMAMedia.folder == info['folder'],
                                       models.TMAMedia.filename == info['filename']).content
    else:
        with requests.get(info['url'], timeout=(5, 30), stream=True, allow_redirects=False,
                          headers={'If-Match': info['revision']}) as response:
            if response.status_code != 200 or response.headers.get('ETag') != info['revision']:
                raise HTTPException(409, 'Медиа изменилось при скачивании.')
            chunks, size = [], 0
            for chunk in response.iter_content(65536):
                size += len(chunk)
                if size > MAX_FILE:
                    raise HTTPException(413, 'Медиа больше 20 МБ.')
                chunks.append(chunk)
            data = b''.join(chunks)
    if len(data) > MAX_FILE or (not info.get('url') and hashlib.sha256(data).hexdigest() != info['revision']):
        raise HTTPException(409, 'Медиа изменилось при чтении.')
    return data


def prepare_transfer_media(transfer, job):
    source, target = transfer.endpoints(job['options']['direction'])
    mode = job['options']['media_mode']
    refs = {}
    for row in job['rows']:
        if row['action'] in ('skip', 'dependency', 'conflict') or row['after']['values']['is_deleted']:
            continue
        values = row['after']['values']
        if row['kind'] == 'card':
            if any(values.get(f) for f in ('video_front_path', 'video_back_path')):
                raise HTTPException(422, 'Перенос видео пока не поддержан. Выберите материалы без видео.')
            for field, role in MEDIA_FIELDS.items():
                if values.get(field):
                    if mode == 'missing' and row['before'] and row['before']['values'].get(field):
                        continue
                    refs.setdefault(values[field], role)
            # Legacy embedded image bytes are still content, never discarded.
            if not values.get('image_path'):
                checksum = row['after'].get('embedded_image_hash')
                if checksum:
                    uri = f'/api/media/images/embedded-{row["source_id"]}.png'
                    refs[uri] = ('embedded', row['source_id'], checksum)
                    values['image_path'] = uri
        for field in ('context', 'metadata', 'front_text', 'back_text'):
            for uri in REFERENCE.findall(values.get(field) or ''):
                if '/api/media/' in uri or '/storage/v1/object/public/' in uri:
                    refs.setdefault(uri, 'image' if '/images/' in uri else 'audio')
    if len(refs) > MAX_FILES:
        raise HTTPException(413, 'Больше 500 медиафайлов в одном переносе.')
    total, replacements = 0, {}
    for index, (uri, role) in enumerate(refs.items()):
        embedded = isinstance(role, tuple)
        info = ({'revision': role[2], 'filename': 'embedded.png'}
                if embedded else media_info(source, uri, role))
        key = 'transfer-media:' + _digest([transfer.namespace, source.identity, uri, info['revision']])
        with transfer.local.scope():
            receipt = models.TMAOfflineBatch.get_or_none(models.TMAOfflineBatch.key == key)
            cached = json.loads(receipt.response) if receipt else None
        cached_path = Path(transfer.local.media_root) / cached['folder'] / cached['filename'] if cached else None
        if cached and cached_path.is_file() and hashlib.sha256(cached_path.read_bytes()).hexdigest() == cached['sha256']:
            asset = cached
        else:
            if embedded:
                with source.scope():
                    data = models.TMA_Card.select(models.TMA_Card.image_data).where(models.TMA_Card.id == role[1]).scalar()
                if hashlib.sha256(data).hexdigest() != role[2]:
                    raise HTTPException(409, 'Встроенное изображение изменилось.')
            else:
                data = read_media(source, info)
            asset = prepare_media(info['filename'], data, 'image' if embedded else role)
            # Reuse the existing immutable local media store/catalog as the staging
            # cache. The target content transaction only attaches these assets.
            with transfer.local.scope():
                store_media(asset, local_root=transfer.local.media_root)
                asset = {k: v for k, v in asset.items() if k != 'data'}
                transfer.put(key, asset)
        total += asset['size']
        if total > MAX_TOTAL:
            raise HTTPException(413, 'Медиа пакета больше 100 МБ.')
        path = (f'/api/media/{asset["folder"]}/{asset["filename"]}' if target is transfer.local else
                target.storage['url'] + f'/storage/v1/object/public/{asset["folder"]}/{asset["filename"]}')
        with target.scope():
            exists = models.TMAMedia.select().where(models.TMAMedia.folder == asset['folder'],
                        models.TMAMedia.filename == asset['filename']).exists()
        if exists and target.storage:
            check = requests.head(path, timeout=(5, 30), allow_redirects=False)
            if check.status_code not in (200, 404):
                raise HTTPException(502, 'Не удалось проверить целевой медиафайл Storage.')
            exists = check.status_code == 200
        action = 'reuse' if exists else 'transfer'
        replacements[uri] = path
        job['media'].append({'source': uri, 'revision': info['revision'], 'embedded': embedded, 'role': None if embedded else role,
                             'asset': asset, 'path': path, 'action': action})
        transfer.progress('preview_media', index + 1, len(refs))
    for row in job['rows']:
        if row['action'] in ('skip', 'dependency', 'conflict'):
            continue
        values = row['after']['values']
        for field in (*MEDIA_FIELDS, 'context', 'metadata', 'front_text', 'back_text'):
            value = values.get(field)
            if not isinstance(value, str):
                continue
            # Missing-only keeps existing attachments, while new cards receive
            # their necessary assets. Replacement always uses a new immutable key.
            before = row['before']['values'].get(field) if row['before'] else None
            if mode == 'missing' and field in MEDIA_FIELDS and before:
                values[field] = before
            else:
                for uri in sorted(replacements, key=len, reverse=True):
                    value = value.replace(uri, replacements[uri])
                values[field] = value
        # Media changes can require an update even when text/URLs were unchanged.
        original = job['source'][row['kind']][str(row['source_id'])]['values']
        if row['action'] == 'unchanged' and any(original.get(field) != values.get(field)
                and row['before']['values'].get(field) != values.get(field)
                for field in (*MEDIA_FIELDS, 'context', 'metadata', 'front_text', 'back_text')):
            row['action'] = 'update'
    # Prepared assets that are no longer referenced (e.g. missing-only preserved
    # an existing attachment) never reach the remote upload loop.
    job['media'] = [item for item in job['media'] if any(item['path'] in str(row['after']['values'])
                    for row in job['rows'] if row['action'] in ('create', 'copy', 'update') or
                    (row['action'] == 'unchanged' and item['action'] == 'transfer'))]


def apply_transfer_media(transfer, job):
    source, target = transfer.endpoints(job['options']['direction'])
    for index, item in enumerate(job['media']):
        if not item['embedded'] and media_info(source, item['source'], item['role'])['revision'] != item['revision']:
            raise HTTPException(409, 'Медиа изменилось после предпросмотра.')
        asset = dict(item['asset'])
        data = (Path(transfer.local.media_root) / asset['folder'] / asset['filename']).read_bytes()
        if hashlib.sha256(data).hexdigest() != asset['sha256']:
            raise HTTPException(409, 'Подготовленный медиафайл повреждён.')
        asset['data'] = data
        with target.scope():
            store_media(asset, local_root=target.media_root, storage=target.storage)
        job['progress'] = index + 1
        transfer.save_job(job)
        transfer.progress('media', index + 1, len(job['media']))
