import logging
from fastapi import Header, HTTPException

logger = logging.getLogger(__name__)

def get_user_id(x_user_id: str = Header(None)) -> int:
    """Dependency to extract and validate the user ID from headers."""
    if not x_user_id:
        logger.error("X-User-ID header missing")
        raise HTTPException(status_code=400, detail="X-User-ID header missing")
    try:
        return int(x_user_id)
    except ValueError:
        logger.error(f"Invalid X-User-ID format: {x_user_id}")
        raise HTTPException(status_code=400, detail=f"Invalid X-User-ID format: {x_user_id}")
