import logging
import os
import traceback
from fastapi import APIRouter, Header
from api import models, services

router = APIRouter(prefix="/debug", tags=["debug"])
logger = logging.getLogger(__name__)

@router.get("/test-import/{deck_id}")
def debug_import(deck_id: int, x_user_id: int = Header(None)):
    if not x_user_id:
        return {"error": "X-User-ID missing"}
    
    logs = []
    def log(msg):
        logger.info(f"DEBUG: {msg}")
        logs.append(msg)
    
    log(f"Starting debug import for deck {deck_id}, user {x_user_id}")
    try:
        log(f"DB Connection: {models.tma_db.is_closed()}")
        
        ext_deck = models.Deck.get_or_none(models.Deck.id == deck_id)
        if not ext_deck:
            log(f"ERROR: Deck {deck_id} not found in library")
            return {"logs": logs}
        log(f"Found library deck: {ext_deck.name}")
        
        cards_list = list(models.Card.select().where(models.Card.deck == deck_id))
        log(f"Peewee found {len(cards_list)} cards")
        
        cursor = models.tma_db.execute_sql(f"SELECT count(*) FROM card WHERE deck_id = {deck_id}")
        raw_count = cursor.fetchone()[0]
        log(f"Raw SQL found {raw_count} cards")
        
        result = services.import_deck(deck_id, x_user_id)
        log(f"Import result: {'Success' if result else 'Failed'}")
        
        if result:
            count_after = models.TMA_Card.select().where(models.TMA_Card.deck_id == result.id).count()
            log(f"Cards in TMA deck after import: {count_after}")
            
        return {"logs": logs, "success": result is not None}
        
    except Exception as e:
        log(f"EXCEPTION: {str(e)}")
        log(traceback.format_exc())
        return {"logs": logs, "error": str(e)}

@router.get("/test-audio")
async def debug_audio(text: str = "Test", voice: str = "de-DE-KatjaNeural"):
    logs = []
    logs.append(f"Starting debug audio for text: '{text}', voice: '{voice}'")
    try:
        from api.utils import audio
        
        result = await audio.generate_audio(text, voice)
        logs.append(f"Result path/url: {result}")
        
        if result and not result.startswith("http"):
            exists = os.path.exists(result)
            size = os.path.getsize(result) if exists else 0
            logs.append(f"File exists: {exists}, Size: {size}")
            
            with open(result, "rb") as f:
                data = f.read(100)
            logs.append(f"Read success, first 100 bytes length: {len(data)}")
            
        return {"logs": logs, "success": result is not None}
    except Exception as e:
        err = traceback.format_exc()
        logs.append(f"CRITICAL ERROR: {err}")
        return {"logs": logs, "success": False, "error": str(e)}
