import logging
import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from api.models import TMAUser
from api.dependencies.auth import get_user_id

router = APIRouter(tags=["auth"])
logger = logging.getLogger(__name__)

class UserSyncSchema(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    username: Optional[str] = None
    photo_url: Optional[str] = None
    is_guest: bool = False

@router.post("/auth/sync")
def sync_user(data: UserSyncSchema, user_id: int = Depends(get_user_id)):
    """
    Silently registers or updates user info from Telegram or guest session.
    """
    try:
        user, created = TMAUser.get_or_create(user_id=user_id)
        
        user.first_name = data.first_name
        user.last_name = data.last_name
        user.username = data.username
        user.photo_url = data.photo_url
        user.is_guest = data.is_guest
        user.updated_at = datetime.datetime.now()
        user.save()
        
        status = "created" if created else "updated"
        logger.info(f"User {user_id} {status} via sync.")
        
        return {
            "status": "ok",
            "action": status,
            "user": {
                "user_id": user.user_id,
                "first_name": user.first_name,
                "is_guest": user.is_guest
            }
        }
    except Exception as e:
        logger.error(f"Sync error for user {user_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error during sync")

@router.get("/auth/me")
def get_me(user_id: int = Depends(get_user_id)):
    """Returns current user info."""
    user = TMAUser.get_or_none(TMAUser.user_id == user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {
        "user_id": user.user_id,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "username": user.username,
        "photo_url": user.photo_url,
        "is_guest": user.is_guest
    }
