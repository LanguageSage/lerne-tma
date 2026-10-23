"""
API-роутер модуля «Автор уроков» (Author Content Router) для консоли администратора.

Предоставляет HTTP-эндпоинты для:
- Парсинга и анализа файлов разметки уроков (.txt / .md / .json);
- Предпросмотра и выполнения публикации уроков в папки/колоды;
- Экспорта колод и папок в канонический формат Lerne;
- Двухфазного безопасного обновления существующих карточек (preview -> apply без мутации SRS).

Разбор и публикация используют `api.services.author_service`; отдельный JSON V2
preview через `tools.admin.services.structured_preview` не записывает данные.
"""

import os
import re
import json
import io
from PIL import Image, UnidentifiedImageError
from api.utils.image import optimize_image
from urllib.parse import quote
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Query, Response, Request
from pydantic import BaseModel, Field

from api.models import TMA_Folder, TMA_Deck
from api.services import author_service
from tools.admin.services.structured_preview import preview_document

router = APIRouter(prefix="/api/admin/author", tags=["author"])

MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_EXTENSIONS = {'.txt', '.md', '.text', '.json'}
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.gif'}


# ============================================================================
# Pydantic-схемы запросов
# ============================================================================

class ParseRequest(BaseModel):
    text: str = Field(..., description="Текст карточек для разбора")
    default_deck_id: Optional[int] = None
    default_deck_name: Optional[str] = None


class PublishPreviewRequest(BaseModel):
    cards: Optional[List[Dict[str, Any]]] = None
    text: Optional[str] = None
    target_folder_id: Optional[int] = None
    new_folder_name: Optional[str] = None
    default_deck_name: Optional[str] = None
    passports: Optional[List[Dict[str, Any]]] = None
    user_id: Optional[int] = None
    passport_only: bool = False


class PublishApplyRequest(BaseModel):
    cards: Optional[List[Dict[str, Any]]] = None
    text: Optional[str] = None
    target_folder_id: Optional[int] = None
    new_folder_name: Optional[str] = None
    default_deck_name: Optional[str] = None
    force_new_deck: bool = False
    user_id: Optional[int] = None
    passports: Optional[List[Dict[str, Any]]] = None
    passport_only: bool = False
    image_links: Optional[List[Dict[str, Any]]] = None


class UpdatePreviewRequest(BaseModel):
    passports: Optional[List[Dict[str, Any]]] = None
    cards: Optional[List[Dict[str, Any]]] = None
    text: Optional[str] = None
    deck_id: Optional[int] = None
    folder_id: Optional[int] = None
    user_id: Optional[int] = None


class UpdateApplyRequest(BaseModel):
    passports: Optional[List[Dict[str, Any]]] = None
    cards: Optional[List[Dict[str, Any]]] = None
    text: Optional[str] = None
    preview_token: str
    request_id: Optional[str] = None
    deck_id: Optional[int] = None
    folder_id: Optional[int] = None
    user_id: Optional[int] = None
    include_new: bool = False


# ============================================================================
# Вспомогательные функции валидации файлов
# ============================================================================

async def _extract_text_from_upload(file: UploadFile) -> str:
    """Проверяет расширение, размер файла и декодирует UTF-8."""
    filename = file.filename or ""
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        await file.close()
        raise HTTPException(
            status_code=400,
            detail=f"Недопустимый формат файла '{ext}'. Поддерживаются .json (V2), .txt, .md и .text."
        )

    try:
        content = await file.read(MAX_FILE_SIZE_BYTES + 1)
    finally:
        await file.close()

    if len(content) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Размер файла превышает допустимый предел (10 МБ)."
        )

    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=400,
            detail=f"Файл '{filename}' не может быть прочитан как UTF-8. Пожалуйста, сохраните файл в кодировке UTF-8."
        )


# ============================================================================
# 1. PARSE: Загрузка и анализ файла/текста
# ============================================================================

@router.post('/v2-preview')
def preview_v2(file: UploadFile = File(...)):
    """Validate a JSON V2 file and derive previews; no publish/save path."""
    try:
        if os.path.splitext(file.filename or '')[1].lower() != '.json':
            raise HTTPException(400, 'Для V2-preview выберите файл .json.')
        content = file.file.read(MAX_FILE_SIZE_BYTES + 1)
        if len(content) > MAX_FILE_SIZE_BYTES:
            raise HTTPException(413, 'Размер файла превышает допустимый предел (10 МБ).')
        try:
            text = content.decode('utf-8-sig')
        except UnicodeDecodeError:
            raise HTTPException(400, 'Сохраните JSON-файл в кодировке UTF-8.')
        return preview_document(text)
    finally:
        file.file.close()


@router.post("/parse")
async def parse_content(request: Request):
    """
    Разбирает текст или один/несколько файлов с карточками (.txt / .md / .json).
    Возвращает список найденных колод, количество карточек, распределение типов,
    уровней CEFR и предупреждения о синтаксисе.
    """
    text = ""
    default_deck_id = None
    default_deck_name = None
    file_names: List[str] = []
    uploaded_documents = []
    image_names = []
    image_manifest = []

    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" in content_type or "application/x-www-form-urlencoded" in content_type:
        form = await request.form()
        uploaded_files = [
            f for f in (form.getlist("files") + form.getlist("file"))
            if hasattr(f, "read")
        ]
        if uploaded_files:
            try:
                for uploaded_file in uploaded_files:
                    f_name = getattr(uploaded_file, "filename", "") or ""
                    if os.path.splitext(f_name)[1].lower() in IMAGE_EXTENSIONS:
                        image_names.append(f_name)
                        await uploaded_file.close()
                        continue
                    f_text = await _extract_text_from_upload(uploaded_file)
                    if f_name.lower().endswith('.images.json'):
                        try:
                            manifest = json.loads(f_text)
                            entries = manifest['images']
                            if not isinstance(entries, list) or any(
                                not isinstance(e, dict) or not isinstance(e.get('deck'), str)
                                or not isinstance(e.get('card'), (str, int))
                                or not isinstance(e.get('file'), str) for e in entries):
                                raise ValueError()
                            image_manifest.extend(entries)
                        except (ValueError, KeyError, TypeError):
                            raise HTTPException(400, f'{f_name}: ожидается объект с массивом images (deck, card, file).')
                        file_names.append(f_name)
                        continue
                    if f_name:
                        file_names.append(f_name)
                    uploaded_documents.append((f_name, f_text))
            finally:
                await form.close()
        elif "text" in form:
            text = str(form["text"])
            default_deck_id = int(form["default_deck_id"]) if form.get("default_deck_id") else None
            default_deck_name = form.get("default_deck_name")
        else:
            raise HTTPException(status_code=400, detail="Передайте файл или текст для разбора.")
    else:
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Передайте файл или текст для разбора.")
        
        text = body.get("text", "")
        default_deck_id = body.get("default_deck_id")
        default_deck_name = body.get("default_deck_name")

    if default_deck_id is not None and default_deck_id <= 0:
        raise HTTPException(status_code=400, detail="Некорректный ID колоды.")

    if not uploaded_documents and not text.strip():
        raise HTTPException(status_code=400, detail="Переданный файл или текст пуст.")

    document = (author_service.parse_uploaded_documents(uploaded_documents) if uploaded_documents
                else author_service.parse_document(text, default_deck_id, default_deck_name))
    cards = document['cards']
    image_links = author_service.resolve_import_images(cards, image_names, image_manifest)
    if not cards and not document['passports'] and not document['errors']:
        raise HTTPException(status_code=400, detail="В файле не найдено ни одной карточки или паспорта.")
    # Invalid passports remain reviewable, but cannot be published.
    preview = author_service.preview_publish_content(cards, default_deck_name) if cards else {
        'total_cards': 0, 'decks_count': len(document['decks']), 'decks': document['decks'],
        'exercise_types': {}, 'syntax_issues': []}
    if not document['errors']:
        preview = author_service.preview_publish_content(cards, default_deck_name, document['passports'])
    levels = sorted({c['level'] for c in cards if c.get('level')} | {
        d.get('level') for d in preview['decks'] if d.get('level')})

    return {
        "status": "success",
        "total_cards": preview["total_cards"],
        "decks_count": preview["decks_count"],
        "decks": preview["decks"],
        "exercise_types": preview["exercise_types"],
        "levels": levels,
        "syntax_issues": preview["syntax_issues"],
        "files": file_names,
        "cards": cards,
        "image_links": image_links,
        "passports": document["passports"],
        "passport_errors": document["errors"],
        "document_errors": document["structure_errors"],
        "passport_warnings": document["warnings"]
    }


def _publish_document(payload):
    if payload.text:
        document = author_service.parse_document(payload.text, default_deck_name=payload.default_deck_name)
        if document['errors']:
            raise HTTPException(400, '\n'.join(document['errors']))
        return document['cards'], document['passports']
    return payload.cards or [], payload.passports or []


@router.post('/passport-validate')
def validate_passports(payload: PublishPreviewRequest):
    try:
        preview = author_service.preview_publish_content(payload.cards or [], payload.default_deck_name,
                                                         payload.passports)
        return {"errors": [], **preview}
    except ValueError as exc:
        return {"errors": [str(exc)]}


# ============================================================================
# 2. PUBLISH-PREVIEW: Предпросмотр публикации
# ============================================================================

@router.post("/publish-preview")
def preview_publish(payload: PublishPreviewRequest):
    """
    Предпросмотр публикации урока без записи в БД.
    Проверяет валидность целевой папки и карточек.
    """
    cards, passports = _publish_document(payload)

    if not cards and not passports:
        raise HTTPException(status_code=400, detail="Нет карточек или паспорта для предпросмотра.")

    folder_name = None
    if payload.target_folder_id is not None:
        if payload.target_folder_id <= 0:
            raise HTTPException(status_code=400, detail="Некорректный ID папки.")
        folder = TMA_Folder.get_or_none(TMA_Folder.id == payload.target_folder_id, TMA_Folder.is_deleted == False)
        if not folder:
            raise HTTPException(status_code=404, detail=f"Целевая папка ID {payload.target_folder_id} не найдена.")
        folder_name = folder.name
    elif payload.new_folder_name:
        folder_name = payload.new_folder_name.strip()
    else:
        raise HTTPException(status_code=400, detail="Укажите target_folder_id или new_folder_name.")

    try:
        preview = author_service.preview_publish_content(cards, default_deck_name=payload.default_deck_name,
                                                         passports=passports)
        passport_preview = author_service.preview_passports(passports, payload.target_folder_id, payload.user_id)
        if payload.passport_only and (not payload.target_folder_id or any(not x['target_deck_id'] for x in passport_preview)):
            raise ValueError('Только паспорт: все колоды должны существовать в выбранной папке.')
    except ValueError as e:
        msg = str(e)
        if "не найден" in msg.lower():
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=400, detail=msg)

    return {
        "status": "success",
        "target_folder_id": payload.target_folder_id,
        "target_folder_name": folder_name,
        "total_cards": preview["total_cards"],
        "decks_count": preview["decks_count"],
        "decks": preview["decks"],
        "exercise_types": preview["exercise_types"],
        "syntax_issues": preview["syntax_issues"],
        "passports": passport_preview
    }


# ============================================================================
# 3. PUBLISH: Создание папки, колод и сохранение карточек
# ============================================================================

@router.post("/publish")
def apply_publish(payload: PublishApplyRequest):
    return _apply_publish(payload)


@router.post('/publish-images')
async def apply_publish_images(request: Request):
    """Publish reviewed images and cards in one database transaction."""
    form = await request.form()
    try:
        try:
            payload = PublishApplyRequest.model_validate_json(str(form['payload']))
        except (KeyError, ValueError) as exc:
            raise HTTPException(400, f'Некорректные данные публикации: {exc}')
        files = [f for f in form.getlist('images') if hasattr(f, 'read')]
        names = [f.filename or '' for f in files]
        if len(names) != len(set(names)):
            raise HTTPException(400, 'Повторяются имена файлов изображений.')
        cards = payload.cards or []
        links = author_service.resolve_import_images(cards, names)
        if any(link['status'] != 'matched' for link in links):
            raise HTTPException(400, 'Есть отсутствующие или неоднозначные связи изображений.')
        if len(links) != len(payload.image_links or []) or any(
            (link['card_number'], link['file']) !=
            (review.get('card_number'), review.get('file'))
            for link, review in zip(links, payload.image_links or [])):
            raise HTTPException(400, 'Связи изображений изменились после предпросмотра.')
        image_data = {}
        for file in files:
            if file.filename not in {link['file'] for link in links}:
                continue
            if os.path.splitext(file.filename or '')[1].lower() not in IMAGE_EXTENSIONS:
                raise HTTPException(400, 'Недопустимый формат изображения.')
            content = await file.read(MAX_FILE_SIZE_BYTES + 1)
            if not content or len(content) > MAX_FILE_SIZE_BYTES:
                raise HTTPException(400, f'{file.filename}: изображение пусто или превышает 10 МБ.')
            try:
                with Image.open(io.BytesIO(content)) as image:
                    if image.format not in {'JPEG', 'PNG', 'WEBP', 'GIF'}:
                        raise ValueError()
                optimized = optimize_image(content)[0]
                with Image.open(io.BytesIO(optimized)) as image:
                    if image.format != 'WEBP':
                        raise ValueError()
                image_data[file.filename] = optimized
            except (UnidentifiedImageError, OSError, ValueError):
                raise HTTPException(400, f'{file.filename}: файл не является поддерживаемым изображением.')
        for link in links:
            cards[link['card_number'] - 1]['image_file'] = link['file']
        return _apply_publish(payload, image_data)
    finally:
        await form.close()


def _apply_publish(payload: PublishApplyRequest, image_data=None):
    """
    Публикует новый урок в базу данных:
    - Создает новую папку или использует существующую;
    - Создает колоды или переиспользует существующие с таким же именем;
    - Транзакционно сохраняет карточки.
    """
    cards, passports = _publish_document(payload)

    if image_data is None and author_service.resolve_import_images(cards, []):
        raise HTTPException(400, 'Для связанных изображений загрузите файлы и проверьте связи в предпросмотре.')

    if not cards and not payload.passport_only:
        raise HTTPException(status_code=400, detail="Нет карточек для публикации; для паспорта выберите passport_only.")

    if payload.target_folder_id is not None and payload.target_folder_id <= 0:
        raise HTTPException(status_code=400, detail="Некорректный ID папки.")

    if not payload.target_folder_id and not payload.new_folder_name:
        raise HTTPException(status_code=400, detail="Укажите target_folder_id или new_folder_name.")

    try:
        result = author_service.apply_publish_content(
            cards=cards,
            target_folder_id=payload.target_folder_id,
            new_folder_name=payload.new_folder_name,
            default_deck_name=payload.default_deck_name,
            force_new_deck=payload.force_new_deck,
            user_id=payload.user_id,
            passports=passports,
            passport_only=payload.passport_only,
            image_data=image_data
        )
        return {
            "status": "success",
            "folder_id": result["folder_id"],
            "folder_name": result["folder_name"],
            "published_decks": result["published_decks"],
            "total_saved_cards": result["total_saved_cards"],
            "passport_only": result.get("passport_only", False),
            "updated_passports": result.get("updated_passports", 0)
        }
    except ValueError as e:
        msg = str(e)
        if "не найден" in msg.lower():
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка публикации: {str(e)}")


# ============================================================================
# 4. EXPORT: Выгрузка колоды или папки
# ============================================================================

@router.get("/export")
def export_content(
    deck_id: Optional[int] = Query(None, description="ID колоды для экспорта"),
    folder_id: Optional[int] = Query(None, description="ID папки для экспорта"),
    user_id: Optional[int] = Query(None, description="ID пользователя (опционально)"),
    as_file: bool = Query(True, description="Вернуть как скачиваемый файл (attachment)")
):
    """
    Экспортирует колоду или папку в канонический текстовый формат Lerne Codex.
    """
    if deck_id is not None and folder_id is not None:
        raise HTTPException(status_code=400, detail="Укажите только deck_id или только folder_id, но не оба сразу.")

    if deck_id is None and folder_id is None:
        raise HTTPException(status_code=400, detail="Укажите параметр deck_id или folder_id для экспорта.")

    try:
        if deck_id is not None:
            if deck_id <= 0:
                raise HTTPException(status_code=400, detail="Некорректный ID колоды.")
            res = author_service.export_deck_content(deck_id, user_id=user_id)
            safe_name = re.sub(r'[\\/*?:"<>|]', "_", res['deck_name']).strip()
            filename = f"deck_{res['deck_id']}_{safe_name}.txt"
        else:
            if folder_id <= 0:
                raise HTTPException(status_code=400, detail="Некорректный ID папки.")
            res = author_service.export_folder_content(folder_id, user_id=user_id)
            safe_name = re.sub(r'[\\/*?:"<>|]', "_", res['folder_name']).strip()
            filename = f"folder_{res['folder_id']}_{safe_name}.txt"

        if as_file:
            headers = {
                "Content-Disposition": f"attachment; filename=lerne_export.txt; filename*=UTF-8''{quote(filename)}"
            }
            return Response(content=res['text'], media_type="text/plain; charset=utf-8", headers=headers)
        else:
            return {
                "status": "success",
                "filename": filename,
                **res
            }

    except ValueError as e:
        msg = str(e)
        if "не найден" in msg.lower():
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка экспорта: {str(e)}")


# ============================================================================
# 5. UPDATE-PREVIEW: Предпросмотр обновлений
# ============================================================================

@router.post("/update-preview")
def preview_update(payload: UpdatePreviewRequest):
    """
    Выполняет безопасный двухфазный расчет изменений карточек.
    Возвращает diff, измененные поля, токен preview_token и ошибки.
    """
    cards = payload.cards or []
    passports = payload.passports or []
    if payload.text:
        document = author_service.parse_document(payload.text, default_deck_id=payload.deck_id)
        if document['errors']:
            raise HTTPException(400, '\n'.join(document['errors']))
        cards, passports = document['cards'], document['passports']

    if not cards:
        raise HTTPException(status_code=400, detail="Нет карточек для предпросмотра обновления.")

    if payload.deck_id is not None and payload.deck_id <= 0:
        raise HTTPException(status_code=400, detail="Некорректный ID колоды.")
    if payload.folder_id is not None and payload.folder_id <= 0:
        raise HTTPException(status_code=400, detail="Некорректный ID папки.")

    try:
        preview = author_service.preview_update_content(
            cards=cards,
            deck_id=payload.deck_id,
            folder_id=payload.folder_id,
            user_id=payload.user_id,
            passports=passports
        )
        return {
            "status": "success",
            **preview
        }
    except ValueError as e:
        msg = str(e)
        if "не найден" in msg.lower():
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка предпросмотра обновления: {str(e)}")


# ============================================================================
# 6. UPDATE-APPLY: Безопасное применение обновлений
# ============================================================================

@router.post("/update-apply")
def apply_update(payload: UpdateApplyRequest):
    """
    Применяет подтвержденные изменения карточек в базе данных без мутации SRS.
    Требует токен preview_token, сгенерированный на шаге update-preview.
    """
    cards = payload.cards or []
    passports = payload.passports or []
    if payload.text:
        document = author_service.parse_document(payload.text, default_deck_id=payload.deck_id)
        if document['errors']:
            raise HTTPException(400, '\n'.join(document['errors']))
        cards, passports = document['cards'], document['passports']

    if not cards:
        raise HTTPException(status_code=400, detail="Нет карточек для обновления.")

    if not payload.preview_token:
        raise HTTPException(status_code=400, detail="Требуется preview_token.")

    if payload.deck_id is not None and payload.deck_id <= 0:
        raise HTTPException(status_code=400, detail="Некорректный ID колоды.")
    if payload.folder_id is not None and payload.folder_id <= 0:
        raise HTTPException(status_code=400, detail="Некорректный ID папки.")

    try:
        result = author_service.apply_update_content(
            cards=cards,
            preview_token=payload.preview_token,
            request_id=payload.request_id,
            deck_id=payload.deck_id,
            folder_id=payload.folder_id,
            user_id=payload.user_id,
            include_new=payload.include_new,
            passports=passports
        )
        return {
            "status": "success",
            "updated": result.get("updated", 0),
            "created": result.get("created", 0),
            "updated_passports": result.get("updated_passports", 0)
        }
    except ValueError as e:
        msg = str(e)
        if "не найден" in msg.lower():
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка применения обновлений: {str(e)}")
