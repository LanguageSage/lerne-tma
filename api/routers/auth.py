import logging
import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from api.models import TMAUser, TMALinkedSession
from api.dependencies.auth import get_user_id

router = APIRouter(tags=["auth"])
logger = logging.getLogger(__name__)

class UserSyncSchema(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    username: Optional[str] = None
    photo_url: Optional[str] = None
    phone: Optional[str] = None
    is_guest: bool = False

@router.post("/auth/sync")
def sync_user(data: UserSyncSchema, user_id: int = Depends(get_user_id)):
    """
    Silently registers or updates user info from Telegram or guest session.
    """
    try:
        user, created = TMAUser.get_or_create(user_id=user_id)
        
        # Update info if provided in request (usually from Telegram WebApp)
        if data.first_name: user.first_name = data.first_name
        if data.last_name: user.last_name = data.last_name
        if data.username: user.username = data.username
        if data.photo_url: user.photo_url = data.photo_url
        if data.phone: user.phone = data.phone
        
        # Logic: If we have a name (from this request or already in DB), it's NOT a guest.
        # This is crucial for "Open in Browser" redirect where frontend sends is_guest=True
        # but the backend already knows the user from the bot.
        has_identifying_info = user.first_name or user.username
        
        if has_identifying_info:
            user.is_guest = False
            logger.info(f"User {user_id} identified as REAL USER (is_guest=False)")
        else:
            user.is_guest = data.is_guest
            logger.info(f"User {user_id} remains GUEST (is_guest={user.is_guest})")
            
        user.updated_at = datetime.datetime.now()
        user.save()
        
        status = "created" if created else "updated"
        return {
            "status": "ok",
            "action": status,
            "user": {
                "user_id": user.user_id,
                "first_name": user.first_name,
                "last_name": user.last_name,
                "username": user.username,
                "photo_url": user.photo_url,
                "phone": user.phone,
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
        "phone": user.phone,
        "is_guest": user.is_guest
    }

@router.post("/auth/session")
def create_session(guest_id: int):
    """Creates a pending auth session for polling."""
    session, created = TMALinkedSession.get_or_create(guest_id=guest_id)
    session.is_confirmed = False
    session.telegram_id = None
    session.created_at = datetime.datetime.now()
    session.save()
    return {"status": "ok", "guest_id": guest_id}

@router.get("/auth/session/{guest_id}")
def check_session(guest_id: int):
    """Checks if the session was confirmed by the bot."""
    session = TMALinkedSession.get_or_none(TMALinkedSession.guest_id == guest_id)
    if not session:
        return {"status": "not_found"}
    
    if session.is_confirmed and session.telegram_id:
        # Fetch full user profile for the frontend
        user = TMAUser.get_or_none(TMAUser.user_id == session.telegram_id)
        return {
            "status": "completed", 
            "user_id": session.telegram_id,
            "user": {
                "user_id": user.user_id if user else session.telegram_id,
                "first_name": (user.first_name or user.username or "Пользователь") if user else "Пользователь",
                "last_name": user.last_name if user else None,
                "username": user.username if user else None,
                "photo_url": user.photo_url if user else None,
                "phone": user.phone if user else None,
                "is_guest": False
            }
        }
    
    return {"status": "pending"}
