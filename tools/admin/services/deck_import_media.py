"""Bounded, content-addressed media preparation for the local folder importer."""
import hashlib
import io
import os
import warnings
import wave
from pathlib import PurePosixPath

from fastapi import HTTPException
from PIL import Image
from peewee import fn

from api.models import TMAMedia, tma_db
from api.utils.image import optimize_image

MAX_FILE = 20 * 1024 * 1024
MAX_TOTAL = 100 * 1024 * 1024
MAX_FILES = 500
DECK_EXTENSIONS = {'.json', '.txt', '.md', '.text'}


def safe_path(value):
    if not isinstance(value, str) or not value or len(value) > 1024:
        raise ValueError('Некорректный относительный путь.')
    path = PurePosixPath(value)
    if '\\' in value or ':' in value or '\x00' in value or path.is_absolute() or '..' in path.parts:
        raise ValueError(f'Недопустимый путь: {value}')
    if str(path) != value:
        raise ValueError(f'Неоднозначный путь: {value}')
    return value


def relative_path(manifest, value):
    """Allow ../ inside manifests, but never escape the selected directory root."""
    if not isinstance(value, str) or not value or value.startswith('/') or any(c in value for c in ('\\', ':', '\x00')):
        raise ValueError('Некорректная ссылка в манифесте.')
    parts = list(PurePosixPath(manifest).parent.parts)
    for part in value.split('/'):
        if part == '..':
            if not parts:
                raise ValueError('Ссылка выходит за пределы выбранной папки.')
            parts.pop()
        elif part not in ('', '.'):
            parts.append(part)
    return safe_path('/'.join(parts))


def prepare_media(path, data, role):
    if not data or len(data) > MAX_FILE:
        raise ValueError(f'{path}: пустой файл или размер больше 20 МБ.')
    source_hash = hashlib.sha256(data).hexdigest()
    ext = PurePosixPath(path).suffix.lower()
    if role == 'image':
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('error', Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(data)) as image:
                    if image.width * image.height > 25_000_000 or image.format not in {'PNG', 'JPEG', 'WEBP', 'GIF'}:
                        raise ValueError('изображение слишком большое или формат не поддерживается')
                    image.verify()
                data, mime = optimize_image(data, max_size=1600, quality=80)
            if mime != 'image/webp' or len(data) > 2 * 1024 * 1024:
                raise ValueError('не удалось подготовить WebP до 2 МБ')
        except (OSError, ValueError, SyntaxError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
            raise ValueError(f'{path}: неверное изображение: {exc}') from exc
        folder, ext = 'images', '.webp'
    else:
        # Check container signatures, not just the supplied extension/MIME.
        if ext == '.wav':
            try:
                with wave.open(io.BytesIO(data)) as audio:
                    expected = audio.getnframes() * audio.getnchannels() * audio.getsampwidth()
                    if not expected or expected > MAX_FILE or len(audio.readframes(audio.getnframes())) != expected:
                        raise ValueError('пустая или обрезанная WAV-запись')
            except (wave.Error, EOFError, ValueError) as exc:
                raise ValueError(f'{path}: неверная WAV-запись: {exc}') from exc
        valid = {
            '.mp3': (_mp3_header(data), 'audio/mpeg'),
            '.wav': (data.startswith(b'RIFF') and data[8:12] == b'WAVE', 'audio/wav'),
            '.ogg': (data.startswith(b'OggS'), 'audio/ogg'),
            '.flac': (data.startswith(b'fLaC'), 'audio/flac'),
            '.m4a': (data[4:8] == b'ftyp', 'audio/mp4'),
        }
        accepted, mime = valid.get(ext, (False, ''))
        if not accepted or len(data) < 128:
            raise ValueError(f'{path}: неверный аудиофайл; поддерживаются MP3, WAV, OGG, FLAC, M4A.')
        folder = 'audio'
    digest = hashlib.sha256(data).hexdigest()
    filename = f'import_{digest}{ext}'
    return {'source': path, 'source_sha256': source_hash, 'sha256': digest, 'folder': folder,
            'filename': filename, 'mime': mime, 'size': len(data), 'data': data}


def _mp3_header(data):
    offset = 0
    if data.startswith(b'ID3'):
        if len(data) < 10 or any(value & 0x80 for value in data[6:10]):
            return False
        offset = 10 + sum(value << shift for value, shift in zip(data[6:10], (21, 14, 7, 0)))
    prefix = data[offset:offset + 4096]
    return any(prefix[i] == 0xff and prefix[i + 1] & 0xe0 == 0xe0
               and prefix[i + 1] & 0x18 != 0x08 and prefix[i + 1] & 0x06 != 0
               and prefix[i + 2] >> 4 not in (0, 15) and prefix[i + 2] & 0x0c != 0x0c
               for i in range(len(prefix) - 3))


def media_path(asset):
    from api.local_runtime import is_local
    if is_local():
        return f"/api/media/{asset['folder']}/{asset['filename']}"
    # Cloud URLs are already supported by every existing audio/image consumer.
    base = os.environ.get('SUPABASE_URL', '').rstrip('/')
    stored = TMAMedia.select(fn.LENGTH(TMAMedia.content)).where(
        TMAMedia.filename == asset['filename'], TMAMedia.folder == asset['folder']).tuples().first()
    if base and os.environ.get('SUPABASE_KEY') and (not stored or stored[0] is None):
        return f"{base}/storage/v1/object/public/{asset['folder']}/{asset['filename']}"
    return f"/api/media/{asset['folder']}/{asset['filename']}"


def storage_configured():
    from api.local_runtime import is_local
    if is_local():
        return True
    return bool(os.environ.get('SUPABASE_URL') and os.environ.get('SUPABASE_KEY'))


def media_exists(asset):
    return TMAMedia.select(TMAMedia.id).where(
        TMAMedia.filename == asset['filename'], TMAMedia.folder == asset['folder']).exists()


def store_media(asset):
    """No blob reads, external GETs or retries. Immutable keys; never overwrite."""
    from api.local_runtime import is_local, media_file
    if is_local():
        destination = media_file(asset['folder'], asset['filename'])
        if not destination.is_file():
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_name(destination.name + '.partial')
            try:
                with temporary.open('xb') as output:
                    output.write(asset['data'])
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, destination)
            finally:
                temporary.unlink(missing_ok=True)
        with tma_db.atomic():
            TMAMedia.insert(filename=asset['filename'], folder=asset['folder'], content=None).on_conflict_ignore().execute()
        return
    if media_exists(asset):
        return
    if asset['folder'] == 'audio' and not storage_configured():
        raise HTTPException(503, 'Для аудио требуется настроенный Supabase Storage (SUPABASE_URL и SUPABASE_KEY).')
    base, key = os.environ.get('SUPABASE_URL', '').rstrip('/'), os.environ.get('SUPABASE_KEY')
    content = asset['data']
    if base and key:
        import requests
        try:
            response = requests.post(
                f"{base}/storage/v1/object/{asset['folder']}/{asset['filename']}",
                headers={'Authorization': f'Bearer {key}', 'Content-Type': asset['mime'], 'x-upsert': 'false'},
                data=content, timeout=30)
            duplicate = False
            if response.status_code in (400, 409):
                try:
                    duplicate = response.json().get('error') == 'Duplicate'
                except ValueError:
                    pass
            if response.status_code not in (200, 201) and not duplicate:
                raise HTTPException(502, 'Не удалось загрузить медиа в Storage. Привязки не изменены.')
        except requests.RequestException as exc:
            raise HTTPException(502, 'Storage недоступен. Повторите подтверждение; привязки не изменены.') from exc
        content = None
    # A durable catalog entry prevents re-upload after an interrupted card import.
    # Unreferenced entries can be managed by the existing media manager.
    with tma_db.atomic():
        TMAMedia.insert(filename=asset['filename'], folder=asset['folder'], content=content).on_conflict_ignore().execute()
