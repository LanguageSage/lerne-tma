"""Loopback-admin boundary for managed author material transfers."""
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import hashlib
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field, ConfigDict

from api import models
from api.local_runtime import is_local, local_config

router = APIRouter(prefix='/api/admin/transfer', tags=['material-transfer'])
_launch_lock = threading.Lock()
_active = set()
_catalog_lock = threading.Lock()
_catalog_cache = {}
_previews = {}
CATALOG_TTL = 300


def config_version():
    path = config_path()
    try:
        stat = path.stat()
        return str(path), stat.st_mtime_ns, stat.st_size
    except OSError:
        return str(path), None, None


class Selection(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['folder', 'deck', 'card']
    ids: list[int] = Field(min_length=1, max_length=200)


class Options(BaseModel):
    model_config = ConfigDict(extra='forbid')
    direction: Literal['download', 'publish']
    selection: Selection
    mode: Literal['missing', 'changed', 'force'] = 'changed'
    media_mode: Literal['missing', 'changed', 'force'] = 'changed'
    on_conflict: Literal['skip', 'replace', 'new'] = 'replace'
    decisions: dict[str, Literal['skip', 'replace', 'new']] = Field(default_factory=dict, max_length=2000)
    destination_folder_id: int | None = None
    accept_conflicts: bool = False
    public_original: bool = False


class Confirmation(BaseModel):
    model_config = ConfigDict(extra='forbid')
    token: str = Field(min_length=64, max_length=64)
    confirmation: str = Field(max_length=1024)
    confirmed: bool = False


def config_path():
    if not is_local():
        raise HTTPException(403, 'Перенос доступен только в LOCAL.')
    return local_config(create_dirs=False)['config_path'].parent / 'transfer.json'


def worker(request):
    path = config_path()
    runtime = local_config(create_dirs=False)
    safe_env = {k: v for k, v in os.environ.items() if k.upper() in
                {'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'PYTHONPATH'}}
    safe_env.update(PYTHON_DOTENV_DISABLED='1', LERNE_SKIP_SCHEMA_INIT='1', PYTHONIOENCODING='utf-8')
    try:
        result = subprocess.run([sys.executable, '-m', 'tools.admin.transfer_worker'],
            cwd=Path(__file__).resolve().parents[3], env=safe_env,
            input=json.dumps({**request, 'config_path': str(path), 'local_runtime':
                {'database_url': runtime['database_url'], 'media': str(runtime['media'])}}),
            encoding='utf-8', capture_output=True, timeout=1800,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        data = json.loads(result.stdout)
    except (subprocess.SubprocessError, ValueError, OSError):
        raise HTTPException(502, 'Процесс переноса прерван. Откройте сохранённую операцию и продолжите её.') from None
    if not data.get('ok'):
        raise HTTPException(data.get('status', 502), data.get('detail', 'Ошибка переноса.'))
    return data['result']


@router.get('/config')
def settings():
    path = config_path()
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {'enabled': False, 'allow_cloud_write': False,
                'message': 'Настройте внешний config/transfer.json по docs/MATERIAL_TRANSFER.md.'}
    return {'enabled': data.get('enabled') is True,
            'allow_cloud_write': data.get('allow_cloud_write') is True,
            'environment': data.get('environment'), 'project_ref': data.get('project_ref')}


@router.get('/catalog')
def catalog(direction: Literal['download', 'publish'], kind: Literal['folder', 'deck', 'card'],
            parent_id: int | None = None, page: int = 1, search: str = ''):
    if page < 1 or len(search) > 100:
        raise HTTPException(422, 'Неверная страница или поиск.')
    key = (config_version(), direction, kind, parent_id, page, search)
    # Coalesce requests from tabs as well as repeated clicks. A failed cloud
    # request also has a short cooldown instead of becoming a retry storm.
    with _catalog_lock:
        now = time.monotonic()
        cached = _catalog_cache.get(key)
        if cached and cached['expires'] > now:
            if 'error' in cached:
                raise HTTPException(*cached['error'])
            return {**cached['result'], 'cached': True, 'cache_seconds': int(cached['expires'] - now)}
        try:
            result = worker({'command': 'catalog', 'direction': direction, 'kind': kind,
                             'parent_id': parent_id, 'page': page, 'search': search})
        except HTTPException as exc:
            _catalog_cache[key] = {'error': (exc.status_code, exc.detail), 'expires': time.monotonic() + 10}
            raise
        if len(_catalog_cache) >= 128:
            _catalog_cache.pop(next(iter(_catalog_cache)))
        _catalog_cache[key] = {'result': result, 'expires': time.monotonic() + CATALOG_TTL}
        return {**result, 'cached': False, 'cache_seconds': CATALOG_TTL}


@router.post('/preview', status_code=202)
def preview(options: Options, tasks: BackgroundTasks):
    if any(identifier <= 0 for identifier in options.selection.ids) or len(set(options.selection.ids)) != len(options.selection.ids):
        raise HTTPException(422, 'Выберите уникальные положительные ID материалов.')
    from uuid import uuid4
    key = hashlib.sha256(json.dumps([config_version(), options.model_dump()], sort_keys=True).encode()).hexdigest()
    with _launch_lock:
        now = time.monotonic()
        for identifier, entry in list(_previews.items()):
            if entry['status'] != 'running' and now - entry['finished'] > CATALOG_TTL:
                del _previews[identifier]
        for identifier, entry in _previews.items():
            if entry['key'] == key and (entry['status'] != 'error' or now - entry['finished'] < 10):
                return {'id': identifier, 'status': entry['status']}
        if _active or any(e['status'] == 'running' for e in _previews.values()):
            raise HTTPException(409, 'Дождитесь завершения текущей проверки или копирования.')
        identifier = str(uuid4())
        _previews[identifier] = {'key': key, 'status': 'running', 'started': now}
    tasks.add_task(run_preview, identifier, options.model_dump())
    return {'id': identifier, 'status': 'running'}


def run_preview(identifier, options):
    try:
        result = worker({'command': 'preview', 'options': options})
        update = {'status': 'ready', 'job_id': result['id']}
    except HTTPException as exc:
        update = {'status': 'error', 'error': exc.detail}
    except Exception:
        update = {'status': 'error', 'error': 'Не удалось подготовить предпросмотр. Повторите проверку.'}
    with _launch_lock:
        _previews[identifier].update(update, finished=time.monotonic())


@router.get('/previews/{identifier}')
def preview_status(identifier: UUID):
    config_path()
    with _launch_lock:
        entry = _previews.get(str(identifier))
        if entry is None:
            raise HTTPException(404, 'Проверка не найдена. После перезапуска сервера запустите её снова.')
        return {k: v for k, v in entry.items() if k in ('status', 'job_id', 'error')} | {
            'elapsed': int(time.monotonic() - entry['started'])}


@router.get('/jobs')
def jobs():
    config_path()
    result = []
    for row in models.TMAOfflineBatch.select().where(models.TMAOfflineBatch.key.startswith('transfer-job:')).order_by(
            models.TMAOfflineBatch.created_at.desc()).limit(30):
        job = json.loads(row.response)
        result.append({k: job[k] for k in ('id', 'status', 'target', 'created_at')})
    return {'items': result}


@router.get('/jobs/{identifier}')
def status(identifier: UUID):
    config_path()
    row = models.TMAOfflineBatch.get_or_none(models.TMAOfflineBatch.key == f'transfer-job:{identifier}')
    if row is None:
        raise HTTPException(404, 'Операция не найдена.')
    from tools.admin.services.material_transfer import Transfer
    # Public serialization does not need a cloud connection or any credentials.
    serializer = object.__new__(Transfer)
    serializer.allow_cloud_write = settings()['allow_cloud_write']
    job = json.loads(row.response)
    with _launch_lock:
        if job['status'] == 'running' and str(identifier) not in _active:
            job.update(status='interrupted', error='Сервер перезапущен. Продолжите сохранённую операцию.')
    return serializer.public(job)


def run_apply(identifier, body):
    try:
        worker({'command': 'apply', 'id': identifier, **body})
        from tools.admin.services import diagnostics
        diagnostics.invalidate()
        with _catalog_lock:
            _catalog_cache.clear()
        with _launch_lock:
            _previews.clear()
    except HTTPException as exc:
        # The worker normally persists its domain errors. Preserve a sanitized
        # launcher failure as well so the browser can always offer explicit retry.
        with models.tma_db.connection_context():
            row = models.TMAOfflineBatch.get_or_none(models.TMAOfflineBatch.key == f'transfer-job:{identifier}')
            if row:
                job = json.loads(row.response)
                if job['status'] not in ('complete', 'stale'):
                    job.update(status='interrupted', error=exc.detail)
                    row.response = json.dumps(job, ensure_ascii=False)
                    row.save()
    finally:
        with _launch_lock:
            _active.discard(identifier)


@router.post('/jobs/{identifier}/apply', status_code=202)
def apply(identifier: UUID, body: Confirmation, tasks: BackgroundTasks):
    config_path()
    if not body.confirmed:
        raise HTTPException(422, 'Требуется явное подтверждение.')
    job = status(identifier)
    if body.token != job['token'] or body.confirmation != job['target']:
        raise HTTPException(409, 'Цель или предпросмотр не совпадают.')
    if not job['can_apply']:
        raise HTTPException(403, 'Запись отключена или есть неразрешённые конфликты.')
    with _launch_lock:
        if str(identifier) in _active:
            return {'id': str(identifier), 'status': 'running'}
        if _active:
            raise HTTPException(409, 'Дождитесь завершения текущего переноса.')
        if any(e['status'] == 'running' for e in _previews.values()):
            raise HTTPException(409, 'Дождитесь завершения проверки материалов.')
        _active.add(str(identifier))
    tasks.add_task(run_apply, str(identifier), body.model_dump(exclude={'confirmed'}))
    return {'id': str(identifier), 'status': 'running'}
