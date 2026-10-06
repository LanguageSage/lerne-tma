"""
API-роутер модуля «Автор уроков» (Author Content Router) для консоли администратора.

Предоставляет HTTP-эндпоинты для:
- Парсинга и анализа файлов разметки уроков (.txt / .md);
- Предпросмотра и выполнения публикации уроков в папки/колоды;
- Экспорта колод и папок в канонический формат Lerne;
- Двухфазного безопасного обновления существующих карточек (preview -> apply без мутации SRS).

Использует исключительно единый сервисный слой `api.services.author_service`.
"""

import os
import re
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Query, Response, Request
from pydantic import BaseModel, Field

from api.models import TMA_Folder, TMA_Deck
from api.services import author_service

router = APIRouter(prefix="/api/admin/author", tags=["author"])

MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_EXTENSIONS = {'.txt', '.md', '.text'}


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


class PublishApplyRequest(BaseModel):
    cards: Optional[List[Dict[str, Any]]] = None
    text: Optional[str] = None
    target_folder_id: Optional[int] = None
    new_folder_name: Optional[str] = None
    default_deck_name: Optional[str] = None
    force_new_deck: bool = False
    user_id: Optional[int] = None


class UpdatePreviewRequest(BaseModel):
    cards: Optional[List[Dict[str, Any]]] = None
    text: Optional[str] = None
    deck_id: Optional[int] = None
    folder_id: Optional[int] = None
    user_id: Optional[int] = None


class UpdateApplyRequest(BaseModel):
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
        raise HTTPException(
            status_code=400,
            detail=f"Недопустимый формат файла '{ext}'. Поддерживаются только текстовые файлы (.txt, .md)."
        )

    content = await file.read()
    if len(content) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Размер файла превышает допустимый предел (10 МБ)."
        )

    try:
        return content.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return content.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise HTTPException(
                status_code=400,
                detail="Файл не может быть прочитан как UTF-8. Пожалуйста, сохраните файл в кодировке UTF-8."
            )


# ============================================================================
# 1. PARSE: Загрузка и анализ файла/текста
# ============================================================================

@router.post("/parse")
async def parse_content(request: Request):
    """
    Разбирает текстовый или загруженный файл с карточками (.txt / .md).
    Возвращает список найденных колод, количество карточек, распределение типов,
    уровней CEFR и предупреждения о синтаксисе.
    """
    text = ""
    default_deck_id = None
    default_deck_name = None

    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" in content_type or "application/x-www-form-urlencoded" in content_type:
        form = await request.form()
        uploaded_file = form.get("file")
        if uploaded_file and hasattr(uploaded_file, "read"):
            text = await _extract_text_from_upload(uploaded_file)
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

    if not text.strip():
        raise HTTPException(status_code=400, detail="Переданный файл или текст пуст.")

    cards = author_service.parse_cards_text(
        text,
        default_deck_id=default_deck_id,
        default_deck_name=default_deck_name
    )

    if not cards:
        raise HTTPException(
            status_code=400,
            detail="В файле не найдено ни одной карточки. Убедитесь в наличии блоков FRONT: и BACK:."
        )

    preview = author_service.preview_publish_content(cards, default_deck_name=default_deck_name)
    levels = sorted(list({c['level'] for c in cards if c.get('level')}))

    return {
        "status": "success",
        "total_cards": preview["total_cards"],
        "decks_count": preview["decks_count"],
        "decks": preview["decks"],
        "exercise_types": preview["exercise_types"],
        "levels": levels,
        "syntax_issues": preview["syntax_issues"],
        "cards": cards
    }


# ============================================================================
# 2. PUBLISH-PREVIEW: Предпросмотр публикации
# ============================================================================

@router.post("/publish-preview")
def preview_publish(payload: PublishPreviewRequest):
    """
    Предпросмотр публикации урока без записи в БД.
    Проверяет валидность целевой папки и карточек.
    """
    cards = payload.cards
    if not cards and payload.text:
        cards = author_service.parse_cards_text(payload.text, default_deck_name=payload.default_deck_name)

    if not cards:
        raise HTTPException(status_code=400, detail="Нет карточек для предпросмотра публикации.")

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
        preview = author_service.preview_publish_content(cards, default_deck_name=payload.default_deck_name)
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
        "syntax_issues": preview["syntax_issues"]
    }


# ============================================================================
# 3. PUBLISH: Создание папки, колод и сохранение карточек
# ============================================================================

@router.post("/publish")
def apply_publish(payload: PublishApplyRequest):
    """
    Публикует новый урок в базу данных:
    - Создает новую папку или использует существующую;
    - Создает колоды или переиспользует существующие с таким же именем;
    - Транзакционно сохраняет карточки.
    """
    cards = payload.cards
    if not cards and payload.text:
        cards = author_service.parse_cards_text(payload.text, default_deck_name=payload.default_deck_name)

    if not cards:
        raise HTTPException(status_code=400, detail="Нет карточек для публикации.")

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
            user_id=payload.user_id
        )
        return {
            "status": "success",
            "folder_id": result["folder_id"],
            "folder_name": result["folder_name"],
            "published_decks": result["published_decks"],
            "total_saved_cards": result["total_saved_cards"]
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
                "Content-Disposition": f'attachment; filename="{filename}"'
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
    cards = payload.cards
    if not cards and payload.text:
        cards = author_service.parse_cards_text(payload.text, default_deck_id=payload.deck_id)

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
            user_id=payload.user_id
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
    cards = payload.cards
    if not cards and payload.text:
        cards = author_service.parse_cards_text(payload.text, default_deck_id=payload.deck_id)

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
            include_new=payload.include_new
        )
        return {
            "status": "success",
            "updated": result.get("updated", 0),
            "created": result.get("created", 0)
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
