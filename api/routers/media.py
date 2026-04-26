import os
from fastapi import APIRouter, HTTPException, Depends, Body, Query, Response
import logging

import models
from api.dependencies.auth import get_user_id

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/media",
    tags=["media"],
)

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
        text = text or data.get('text')
        lang = lang or data.get('lang', 'de')
        voice = voice or data.get('voice')
        rate = rate or data.get('rate')
    
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")

    # 1. Пытаемся получить настройки из БД
    db_settings = {}
    try:
        for s in models.TMASetting.select():
            db_settings[s.key] = s.value
    except Exception as e:
        logger.error(f"Error fetching settings for audio: {e}")

    # 2. Определяем голос
    voice = voice or db_settings.get("TTS_VOICE")
    if not voice:
        if lang == "de":
            voice = "de-DE-KatjaNeural"
        elif lang == "ru":
            voice = "ru-RU-SvetlanaNeural"
        else:
            voice = "en-US-AriaNeural"
            
    # 3. Определяем скорость
    rate = rate or db_settings.get("TTS_SPEED") or "+0%"
    
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
def get_audio(filename: str):
    logger.info(f"MEDIA: Requesting audio: {filename}")
    media = models.TMAMedia.get_or_none(
        models.TMAMedia.filename == filename, 
        models.TMAMedia.folder == 'audio'
    )
    if not media:
        raise HTTPException(status_code=404, detail="Audio not found in DB")
    return Response(content=bytes(media.content), media_type="audio/mpeg")

@router.get("/images/{filename}")
def get_image(filename: str):
    logger.info(f"MEDIA: Requesting image: {filename}")
    media = models.TMAMedia.get_or_none(
        models.TMAMedia.filename == filename, 
        models.TMAMedia.folder == 'images'
    )
    if not media:
        raise HTTPException(status_code=404, detail="Image not found in DB")
    
    ext = filename.split('.')[-1].lower()
    media_type = f"image/{ext}" if ext != 'jpg' else "image/jpeg"
    if ext == 'webp': media_type = "image/webp"
    
    return Response(content=bytes(media.content), media_type=media_type)
