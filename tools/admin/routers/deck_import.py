"""Local admin folder import: preview is read-only; apply requires its fingerprint."""
from typing import Literal
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from tools.admin.services import deck_import
from tools.admin.services.deck_import_media import MAX_FILE, MAX_FILES, MAX_TOTAL, safe_path
from api.local_runtime import is_local

router = APIRouter(prefix='/api/admin/author/folder-import', tags=['author'])


class ImportPayload(BaseModel):
    model_config = ConfigDict(extra='forbid')
    mode: Literal['import', 'media'] = 'import'
    selected: list[str] = Field(min_length=1, max_length=100)
    manifests: list[str] = Field(default_factory=list, max_length=100)
    target_folder_id: int | None = Field(default=None, gt=0)
    new_folder_name: str | None = Field(default=None, max_length=200)
    user_id: int | None = Field(default=None, gt=0)
    decisions: dict[str, str] = Field(default_factory=dict)
    media_choices: dict[str, Literal['keep', 'replace', 'skip']] = Field(default_factory=dict)
    preview_token: str | None = Field(default=None, max_length=64)
    request_id: str | None = Field(default=None, max_length=64)
    confirmed: bool = False
    target_db: Literal['current', 'cloud', 'local'] = 'current'


def _read(payload, uploads):
    try:
        if len(uploads) > MAX_FILES or len(payload) > 1024 * 1024:
            raise HTTPException(413, 'В пакете больше 500 файлов или слишком большие параметры.')
        data = ImportPayload.model_validate_json(payload).model_dump()
        if data['target_folder_id'] and data['new_folder_name']:
            raise ValueError('Укажите существующую или новую папку.')
        contents, total = {}, 0
        for upload in uploads:
            path = safe_path(upload.filename)
            if path in contents:
                raise ValueError(f'{path}: повторяющийся путь файла.')
            content = upload.file.read(min(MAX_FILE, MAX_TOTAL - total) + 1)
            total += len(content)
            if len(content) > MAX_FILE or total > MAX_TOTAL:
                raise HTTPException(413, 'Лимит: 20 МБ на файл и 100 МБ на выбранный пакет.')
            contents[path] = content
        return data, contents
    except (ValueError, UnicodeError, ValidationError, RecursionError) as exc:
        raise HTTPException(400, f'Некорректный пакет: {exc}') from exc
    finally:
        for upload in uploads:
            upload.file.close()


def _alternate(request, contents=None):
    destination = request['target_db']
    if destination == 'cloud' and not is_local():
        raise HTTPException(403, 'Supabase уже выбран как текущая база.')
    if destination == 'local' and is_local():
        raise HTTPException(403, 'LOCAL уже выбран как текущая база.')
    from local.runtime import local_config as external_local_config
    try:
        config_path = external_local_config(create_dirs=False)['config_path'].parent / 'transfer.json'
    except (OSError, RuntimeError, ValueError):
        raise HTTPException(503, 'LOCAL не настроен. Проверьте внешнюю конфигурацию.') from None
    with tempfile.TemporaryDirectory(prefix='lerne-folder-import-') as temporary:
        root = Path(temporary)
        if contents is not None:
            request['files'] = []
            for index, (path, content) in enumerate(contents.items()):
                filename = str(index)
                (root / filename).write_bytes(content)
                request['files'].append({'path': path, 'file': filename})
        request['config_path'] = str(config_path)
        (root / 'request.json').write_text(json.dumps(request), encoding='utf-8')
        safe_env = {key: value for key, value in os.environ.items() if key.upper() in
                    {'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'PYTHONPATH'}}
        safe_env.update(PYTHON_DOTENV_DISABLED='1', LERNE_SKIP_SCHEMA_INIT='1',
                        RUN_MIGRATIONS='false', PYTHONIOENCODING='utf-8')
        try:
            result = subprocess.run([sys.executable, '-m', 'tools.admin.folder_import_worker', str(root)],
                cwd=Path(__file__).resolve().parents[3], env=safe_env, capture_output=True,
                text=True, encoding='utf-8', timeout=1800,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            answer = json.loads(result.stdout)
        except (OSError, subprocess.SubprocessError, ValueError):
            raise HTTPException(502, 'Выбранная база не ответила. Проверьте подключение и повторите проверку.') from None
    if not answer.get('ok'):
        raise HTTPException(answer.get('status', 502), answer.get('detail', 'Ошибка импорта в выбранную базу.'))
    return answer['result']


@router.get('/targets')
def targets():
    current_local = is_local()
    from local.runtime import local_config as external_local_config
    from tools.admin.transfer_worker import configuration
    try:
        path = external_local_config(create_dirs=False)['config_path'].parent / 'transfer.json'
        config = configuration(path)[0]
    except (OSError, RuntimeError, ValueError, KeyError):
        config = {}
    return {'current': 'LOCAL' if current_local else 'Supabase',
            'cloud': current_local and config.get('enabled') is True,
            'local': not current_local and config.get('enabled') is True,
            'cloud_label': f"Supabase · {config.get('project_ref', '')} ({config.get('environment', '')})" if config.get('enabled') else '',
            'cloud_write': config.get('allow_cloud_write') is True}


@router.get('/cloud-folders')
def cloud_folders():
    return _alternate({'action': 'folders', 'target_db': 'cloud'})


@router.get('/local-folders')
def local_folders():
    return _alternate({'action': 'folders', 'target_db': 'local'})


@router.post('/preview')
def preview(payload: str = Form(...), files: list[UploadFile] = File(...)):
    data, contents = _read(payload, files)
    try:
        if data['target_db'] != 'current':
            return _alternate({'action': 'preview', 'payload': data, 'target_db': data['target_db']}, contents)
        return deck_import.build_plan(data, deck_import.read_sources(data, contents))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post('/apply')
def apply(payload: str = Form(...), files: list[UploadFile] = File(...)):
    data, contents = _read(payload, files)
    try:
        if data['target_db'] != 'current':
            return _alternate({'action': 'apply', 'payload': data, 'target_db': data['target_db']}, contents)
        return deck_import.apply_import(data, deck_import.read_sources(data, contents))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
