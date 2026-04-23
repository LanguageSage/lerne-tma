import os
import sys
import logging
from pathlib import Path

# ВАЖНО: Добавляем текущую папку в пути поиска модулей для Vercel
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.append(current_dir)

from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

# Прямые импорты соседних файлов
import models
import services
import srs
import ai_service

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Принудительная инициализация базы данных для облака
models.initialize_database()

app = FastAPI(title="Lerne TMA API")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Схемы данных ---
class PhraseRequest(BaseModel):
    phrase: str

class CardProgressUpdate(BaseModel):
    grade: int

# --- API Эндпоинты ---

@app.get("/api/health")
def health_check():
    db_ok = not models.tma_db.is_closed()
    return {
        "status": "ok",
        "database_connected": db_ok,
    }

# --- Колоды и изучение ---

@app.get("/api/decks")
def get_decks(x_user_id: str = Header(None)):
    logger.info(f"GET /api/decks - X-User-ID: {x_user_id}")
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-ID header missing")
    try:
        user_id = int(x_user_id)
        return services.get_active_decks(user_id)
    except ValueError:
        logger.error(f"Invalid X-User-ID format: {x_user_id}")
        raise HTTPException(status_code=400, detail=f"Invalid X-User-ID format: {x_user_id}")
    
@app.post("/api/decks")
def create_deck(data: dict, x_user_id: int = Header(None)):
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-ID header missing")
    deck = services.create_deck(data.get('name'), x_user_id)
    return {"status": "success", "id": deck.id}

@app.delete("/api/decks/{deck_id}")
def delete_deck(deck_id: int):
    if services.delete_deck(deck_id):
        return {"status": "success"}
    raise HTTPException(status_code=404, detail="Deck not found")

@app.get("/api/external/decks")
def get_external_decks():
    return services.get_external_decks()

@app.post("/api/external/import/{deck_id}")
def import_external_deck(deck_id: int, x_user_id: str = Header(None)):
    logger.info(f"POST /api/external/import/{deck_id} - X-User-ID: {x_user_id}")
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-ID header missing")
    try:
        user_id = int(x_user_id)
        result = services.import_deck(deck_id, user_id)
        if result:
            return {"status": "success", "deck_id": result.id}
        raise HTTPException(status_code=404, detail="External deck not found or import failed")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid X-User-ID")

@app.post("/api/decks/import-json")
def import_json_deck(data: dict, x_user_id: str = Header(None)):
    logger.info(f"POST /api/decks/import-json - X-User-ID: {x_user_id}")
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-ID header missing")
    try:
        user_id = int(x_user_id)
        result = services.import_deck_from_json(data, user_id)
        if result:
            return {"status": "success", "deck_id": result.id}
        raise HTTPException(status_code=400, detail="Import failed: invalid data or empty deck")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid X-User-ID")

@app.post("/api/decks/{deck_id}/reset")
def reset_deck(deck_id: int, x_user_id: int = Header(None)):
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-ID header missing")
    if services.reset_deck_progress(x_user_id, deck_id):
        return {"status": "success"}
    raise HTTPException(status_code=500, detail="Failed to reset progress")

@app.post("/api/decks/{deck_id}/sync")
def sync_deck(deck_id: int, x_user_id: int = Header(None)):
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-ID header missing")
    if services.sync_deck_with_library(x_user_id, deck_id):
        return {"status": "success"}
    raise HTTPException(status_code=500, detail="Failed to sync deck")

@app.get("/api/decks/{deck_id}/next")
def get_next_card(deck_id: int, exclude_ids: str = None, x_user_id: int = Header(None)):
    """Выбор следующей карты для изучения (SRS)."""
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-ID header missing")
    
    parsed_exclude = []
    if exclude_ids:
        try:
            parsed_exclude = [int(i) for i in exclude_ids.split(',') if i.strip()]
        except ValueError:
            pass

    card, progress = services.get_next_card(x_user_id, deck_id, exclude_ids=parsed_exclude)
    
    if isinstance(card, dict) and "error" in card:
        return card # Возвращаем ошибку для отладки
        
    if not card:
        logger.info(f"User {x_user_id} finished deck {deck_id}")
        return {"finished": True}
    
    resp = {
        "id": card.id,
        "front": card.front_text,
        "back": card.back_text,
        "context": card.context,
        "audio_url": services.resolve_media_url(card.audio_path, "audio"),
        "image_url": services.resolve_media_url(card.image_path, "images"),
        "intervals": srs.get_next_intervals(progress)
    }
    import json
    resp_json = json.dumps(resp, ensure_ascii=False)
    logger.info(f"FULL CARD JSON for user {x_user_id}: {resp_json}")
    return resp

@app.get("/api/decks/{deck_id}/cards")
def get_deck_cards(deck_id: int, x_user_id: int = Header(None)):
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-ID header missing")
    return services.get_cards_for_study(deck_id, x_user_id)

@app.post("/api/cards/save")
def save_card(data: dict, x_user_id: int = Header(None)):
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-ID header missing")
    card = services.save_card(data, x_user_id)
    if card:
        return {"status": "success", "id": card.id}
    raise HTTPException(status_code=400, detail="Failed to save card")

@app.delete("/api/cards/{card_id}")
def delete_card(card_id: int):
    if services.delete_card(card_id):
        return {"status": "success"}
    raise HTTPException(status_code=404, detail="Card not found")

@app.post("/api/study/grade")
def submit_grade(data: dict, x_user_id: int = Header(None)):
    if not x_user_id:
        logger.error("submit_grade: X-User-ID header missing")
        raise HTTPException(status_code=400, detail="X-User-ID header missing")
    
    try:
        logger.info(f"submit_grade: User {x_user_id}, Data: {data}")
        # Update progress
        services.update_card_progress(data['card_id'], x_user_id, data['grade'])
        logger.info("submit_grade: Progress updated successfully")
        
        # Return next card
        return get_next_card(deck_id=data['deck_id'], x_user_id=x_user_id)
    except Exception as e:
        logger.error(f"submit_grade ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- Настройки и промпты ---

@app.get("/api/user/prompts")
def get_user_prompts(x_user_id: int = Header(None)):
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-ID header missing")
    p = models.TMAUserPrompt.get_or_none(models.TMAUserPrompt.user_id == x_user_id)
    if not p:
        return {"translation_prompt": "", "context_prompt": ""}
    return {
        "translation_prompt": p.translation_prompt or "",
        "context_prompt": p.context_prompt or ""
    }

@app.post("/api/user/prompts")
def save_user_prompts(data: dict, x_user_id: int = Header(None)):
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-ID header missing")
    p, created = models.TMAUserPrompt.get_or_create(user_id=x_user_id)
    p.translation_prompt = data.get('translation_prompt')
    p.context_prompt = data.get('context_prompt')
    p.save()
    return {"status": "ok"}

@app.get("/api/admin/settings")
def get_admin_settings():
    settings = {}
    for s in models.TMASetting.select():
        settings[s.key] = s.value
    return settings

@app.post("/api/admin/settings")
def save_admin_settings(data: dict):
    for k, v in data.items():
        # Приводим к верхнему регистру для соответствия константам, если нужно
        key = k.upper()
        s, created = models.TMASetting.get_or_create(key=key)
        s.value = str(v)
        s.save()
    return {"status": "ok"}

@app.get("/api/admin/presets")
def get_admin_presets():
    # Для упрощения пока возвращаем пустой список или захардкоженные
    return []

@app.get("/api/admin/community/decks")
def get_community_decks(x_user_id: int = Header(None)):
    """Получение колод от пользователей для модерации."""
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-ID header missing")
    return services.get_community_content(x_user_id)

@app.post("/api/admin/community/promote/{deck_id}")
def promote_deck(deck_id: int):
    """Одобрение колоды и перенос ее в общую библиотеку."""
    result = services.promote_to_library(deck_id)
    if result:
        return {"status": "success", "new_library_id": result.id}
    raise HTTPException(status_code=500, detail="Failed to promote deck")

# --- AI ---

@app.post("/api/ai/generate")
@app.post("/api/cards/ai-generate")
async def generate_card(request: PhraseRequest, x_user_id: int = Header(None)):
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-ID header missing")
    return await ai_service.generate_card_fields(x_user_id, request.phrase)

# --- Медиа ---

@app.post("/api/media/generate-audio")
async def generate_audio_endpoint(text: str, lang: str = "de", voice: str = None, rate: str = None):
    """Генерация озвучки через Edge TTS и загрузка в облако (если настроено)."""
    
    # 1. Пытаемся получить настройки из БД, если они не переданы явно в запросе
    db_settings = {}
    try:
        for s in models.TMASetting.select():
            db_settings[s.key] = s.value
    except Exception as e:
        logger.error(f"Error fetching settings for audio: {e}")

    # 2. Определяем голос: приоритет у параметра запроса, затем БД, затем язык
    voice = voice or db_settings.get("TTS_VOICE")
    if not voice:
        if lang == "de":
            voice = "de-DE-KatjaNeural"
        elif lang == "ru":
            voice = "ru-RU-SvetlanaNeural"
        else:
            voice = "en-US-AriaNeural"
            
    # 3. Определяем скорость: приоритет у параметра, затем БД TTS_SPEED, затем дефолт
    rate = rate or db_settings.get("TTS_SPEED") or "+0%"
    
    logger.info(f"AUDIO GENERATION: Text='{text[:30]}...', Voice={voice}, Rate={rate}")
            
    try:
        from utils.audio import generate_audio
        result = await generate_audio(text, voice=voice, rate=rate)
        
        if not result:
            raise HTTPException(status_code=500, detail="Failed to generate audio")
            
        # result может быть либо облачной ссылкой (http...), либо локальным абсолютным путем
        if result.startswith("http"):
            return {"path": result, "url": result}
        else:
            # Локальный путь - возвращаем имя файла для базы и относительный URL для фронта
            filename = os.path.basename(result)
            return {
                "path": filename,
                "url": f"/api/media/audio/{filename}"
            }
    except Exception as e:
        logger.error(f"Audio generation endpoint error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/media/audio/{filename}")
def get_audio(filename: str):
    # 1. Сначала ищем в постоянном хранилище
    file_path = models.TMA_DATA_DIR / "media" / "audio" / filename
    if file_path.exists():
        return FileResponse(file_path)
    
    # 2. Ищем во временной папке (для Vercel это /tmp, для локала - user_files)
    if os.environ.get("VERCEL"):
        pending_path = Path("/tmp/pending_audio") / filename
    else:
        pending_path = models.TMA_ROOT / "user_files" / "pending_audio" / filename
        
    if pending_path.exists():
        return FileResponse(pending_path)
        
    raise HTTPException(status_code=404, detail=f"Audio file not found: {filename}")

@app.get("/api/media/images/{filename}")
def get_image(filename: str):
    file_path = models.TMA_DATA_DIR / "media" / "images" / filename
    if file_path.exists():
        return FileResponse(file_path)
    return {"error": "not found"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
