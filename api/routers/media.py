import io
import os
import re
import uuid
import hashlib
from fastapi import APIRouter, HTTPException, Depends, Body, Query, Response, UploadFile, File, Request
import logging
from PIL import Image, UnidentifiedImageError

import models
from api import models # Ensure we use the api.models package
from api.dependencies.auth import get_user_id
from api.utils.image import optimize_image # Импортируем наш оптимизатор

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/media",
    tags=["media"],
)

MAX_IMAGE_BYTES = 10 * 1024 * 1024 # Увеличим лимит, так как мы всё равно сожмем
SUPPORTED_IMAGE_FORMATS = {
    "JPEG": ("jpg", "image/jpeg"),
    "PNG": ("png", "image/png"),
    "WEBP": ("webp", "image/webp"),
    "GIF": ("gif", "image/gif"),
}

LANG_DEFAULT_VOICES = {
    "de": "de-DE-KatjaNeural",
    "ru": "ru-RU-SvetlanaNeural",
    "en": "en-US-AriaNeural",
}

RATE_RE = re.compile(r"^[+-]\d{1,3}%$")


def _normalize_tts_rate(value: str | None) -> str | None:
    if value is None:
        return None
    rate_value = str(value).strip()
    if not RATE_RE.match(rate_value):
        return None
    numeric = max(-100, min(100, int(rate_value[:-1])))
    return f"{numeric:+d}%"


def _clean_param(value, default=None):
    return value if isinstance(value, str) and value.strip() else default

@router.post("/upload-image")
async def upload_image(
    file: UploadFile = File(...),
    user_id: int = Depends(get_user_id)
):
    """Upload an image, optimize it to WebP and store it in TMAMedia."""
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Image file is empty")
    
    # Мы всё равно проверяем формат перед сжатием
    try:
        image = Image.open(io.BytesIO(content))
        image_format = image.format
    except (UnidentifiedImageError, OSError):
        raise HTTPException(status_code=400, detail="Unsupported image file")

    if image_format not in SUPPORTED_IMAGE_FORMATS:
        raise HTTPException(status_code=400, detail="Only JPG, PNG, WEBP and GIF images are supported")

    # --- ОПТИМИЗАЦИЯ ---
    # Вызываем наш оптимизатор. Он вернет сжатые байты и новый MIME-тип (image/webp)
    optimized_content, media_type = optimize_image(content)
    filename = f"upload_{user_id}_{uuid.uuid4().hex[:12]}.webp" # Всегда .webp

    try:
        models.TMAMedia.create(
            filename=filename,
            folder='images',
            content=optimized_content
        )
    except Exception as e:
        logger.error(f"Image upload save error: {e}")
        raise HTTPException(status_code=500, detail="Failed to save image")

    return {
        "path": f"images/{filename}",
        "url": f"/api/media/images/{filename}",
        "media_type": media_type,
        "original_size": len(content),
        "optimized_size": len(optimized_content)
    }

@router.post("/generate-audio")
async def generate_audio_endpoint(
    data: dict = Body(None), 
    text: str = Query(None),
    lang: str = Query("de"),
    voice: str = Query(None),
    rate: str = Query(None),
    user_id: int = Depends(get_user_id)
):
    """Генерация озвучки через Edge TTS и загрузка в облако."""
    if data:
        text = data.get('text') if data.get('text') is not None else text
        lang = data.get('lang') if data.get('lang') is not None else lang
        voice = data.get('voice') if data.get('voice') is not None else voice
        rate = data.get('rate') if data.get('rate') is not None else rate

    text = _clean_param(text)
    lang = _clean_param(lang, "de")
    voice = _clean_param(voice)
    rate = _clean_param(rate)
    
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")

    # 1. Пытаемся получить настройки из БД
    db_settings = {}
    try:
        for s in models.TMASetting.select():
            db_settings[s.key] = s.value
    except Exception as e:
        logger.error(f"Error fetching settings for audio: {e}")

    # 2. Определяем голос. Глобальная настройка TTS_VOICE относится к немецкой
    # озвучке; для русского перевода используем TTS_VOICE_RU или голос по умолчанию.
    if not voice:
        if lang == "de":
            voice = db_settings.get("TTS_VOICE") or LANG_DEFAULT_VOICES["de"]
        elif lang == "ru":
            voice = db_settings.get("TTS_VOICE_RU") or LANG_DEFAULT_VOICES["ru"]
        else:
            voice = LANG_DEFAULT_VOICES.get(lang, LANG_DEFAULT_VOICES["en"])
            
    # 3. Определяем скорость
    if not rate:
        if lang == "de":
            rate = db_settings.get("TTS_SPEED")
        elif lang == "ru":
            rate = db_settings.get("TTS_SPEED_RU") or db_settings.get("TTS_SPEED")
        else:
            rate = db_settings.get("TTS_SPEED")
    rate = _normalize_tts_rate(rate) or "+0%"
    
    logger.info(f"AUDIO GENERATION START: Text='{text[:30]}...', Voice={voice}, Rate={rate}")
            
    try:
        from api.utils import audio
        result = await audio.generate_audio(text, voice=voice, rate=rate)
        
        if not result:
            raise HTTPException(status_code=500, detail="Failed to generate audio")
            
        if result.startswith("http"):
            return {"path": result, "url": result}
        
        try:
            filename = os.path.basename(result)
            with open(result, "rb") as f:
                content = f.read()
            
            models.TMAMedia.get_or_create(
                filename=filename,
                folder='audio',
                defaults={'content': content}
            )
            
            try: os.remove(result)
            except: pass
            
            return {
                "path": filename,
                "url": f"/api/media/audio/{filename}"
            }
        except Exception as db_err:
            logger.error(f"DATABASE SAVE ERROR for audio: {db_err}")
            raise HTTPException(status_code=500, detail=f"Database Save Error: {str(db_err)}")
    except Exception as e:
        import traceback
        err_msg = traceback.format_exc()
        logger.error(f"TTS generation error: {e}\n{err_msg}")
        raise HTTPException(status_code=500, detail=f"TTS Error: {str(e)}")



@router.get("/audio/{filename}")
def get_audio(filename: str, request: Request):
    logger.debug(f"MEDIA: Requesting audio: {filename}")
    media = models.TMAMedia.get_or_none(
        models.TMAMedia.filename == filename, 
        models.TMAMedia.folder == 'audio'
    )
    if not media:
        raise HTTPException(status_code=404, detail="Audio not found in DB")
    
    content = bytes(media.content)
    etag = hashlib.md5(content).hexdigest()
    
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304)

    return Response(
        content=content, 
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "public, max-age=604800",
            "ETag": etag
        }
    )

@router.get("/images/{filename}")
def get_image(filename: str, request: Request):
    logger.debug(f"MEDIA: Requesting image: {filename}")
    media = models.TMAMedia.get_or_none(
        models.TMAMedia.filename == filename, 
        models.TMAMedia.folder == 'images'
    )
    if not media:
        raise HTTPException(status_code=404, detail="Image not found in DB")
    
    ext = filename.split('.')[-1].lower()
    media_type = f"image/{ext}" if ext != 'jpg' else "image/jpeg"
    if ext == 'webp': media_type = "image/webp"
    
    content = bytes(media.content)
    etag = hashlib.md5(content).hexdigest()
    
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304)
    
    return Response(
        content=content, 
        media_type=media_type,
        headers={
            "Cache-Control": "public, max-age=604800",
            "ETag": etag
        }
    )

@router.post("/upload-video")
async def upload_video(
    file: UploadFile = File(...),
    user_id: int = Depends(get_user_id)
):
    """Upload a video for a card."""
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Video file is empty")
    
    # 20MB max for now
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Video is too large. Maximum size is 20 MB")

    filename = f"vid_{user_id}_{uuid.uuid4().hex[:12]}.mp4"
    try:
        models.TMAMedia.create(
            filename=filename,
            folder='videos',
            content=content
        )
    except Exception as e:
        logger.error(f"Video upload error: {e}")
        raise HTTPException(status_code=500, detail="Failed to save video")

    return {
        "path": f"videos/{filename}",
        "url": f"/api/media/videos/{filename}"
    }

@router.post("/upload-background")
async def upload_background(
    file: UploadFile = File(...),
    user_id: int = Depends(get_user_id)
):
    """Upload a custom background video."""
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Background file is empty")
    
    filename = f"bg_{user_id}_{uuid.uuid4().hex[:12]}.mp4"
    try:
        models.TMAMedia.create(
            filename=filename,
            folder='backgrounds',
            content=content
        )
    except Exception as e:
        logger.error(f"Background upload error: {e}")
        raise HTTPException(status_code=500, detail="Failed to save background")

    return {
        "path": f"backgrounds/{filename}",
        "url": f"/api/media/backgrounds/{filename}"
    }

@router.get("/backgrounds")
def list_backgrounds(user_id: int = Depends(get_user_id)):
    """List all custom background videos."""
    query = models.TMAMedia.select(models.TMAMedia.filename).where(models.TMAMedia.folder == 'backgrounds')
    return [
        {"filename": m.filename, "url": f"/api/media/backgrounds/{m.filename}"}
        for m in query
    ]

@router.get("/videos/{filename}")
def get_video(filename: str, request: Request):
    media = models.TMAMedia.get_or_none(
        models.TMAMedia.filename == filename, 
        models.TMAMedia.folder == 'videos'
    )
    if not media:
        raise HTTPException(status_code=404, detail="Video not found")
    
    content = bytes(media.content)
    return Response(content=content, media_type="video/mp4")

@router.get("/backgrounds/{filename}")
def get_background_video(filename: str, request: Request):
    media = models.TMAMedia.get_or_none(
        models.TMAMedia.filename == filename, 
        models.TMAMedia.folder == 'backgrounds'
    )
    if not media:
        raise HTTPException(status_code=404, detail="Background not found")
    
    content = bytes(media.content)
    return Response(content=content, media_type="video/mp4")
