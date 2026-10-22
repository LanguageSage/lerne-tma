"""Local admin folder import: preview is read-only; apply requires its fingerprint."""
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from tools.admin.services import deck_import
from tools.admin.services.deck_import_media import MAX_FILE, MAX_FILES, MAX_TOTAL, safe_path

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
        return data, deck_import.read_sources(data, contents)
    except (ValueError, UnicodeError, ValidationError, RecursionError) as exc:
        raise HTTPException(400, f'Некорректный пакет: {exc}') from exc
    finally:
        for upload in uploads:
            upload.file.close()


@router.post('/preview')
def preview(payload: str = Form(...), files: list[UploadFile] = File(...)):
    data, sources = _read(payload, files)
    try:
        return deck_import.build_plan(data, sources)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post('/apply')
def apply(payload: str = Form(...), files: list[UploadFile] = File(...)):
    data, sources = _read(payload, files)
    try:
        return deck_import.apply_import(data, sources)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
