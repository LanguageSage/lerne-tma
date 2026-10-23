"""Mounted only in LOCAL. The Vite proxy supplies the private local credential."""
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from api.auth import service
from api.auth.errors import AuthError
from api.local_runtime import is_local, LOOPBACK
from api.routers.auth_v2 import _tokens_response
from api.dependencies.auth import get_user_id

router = APIRouter()


@router.get('/local/transfer-card/{card_id}')
def transfer_card(card_id: int, user_id: int = Depends(get_user_id)):
    if not is_local():
        raise HTTPException(404)
    from api import models
    from api.services.collaborative_service import _require_cards_access
    from api.local_runtime import LOCAL_USER_ID
    if user_id != LOCAL_USER_ID or card_id <= 0:
        raise HTTPException(403, 'Публикация доступна локальному автору.')
    _require_cards_access([card_id], user_id, write=True)
    card = models.TMA_Card.get_by_id(card_id)
    if card.is_deleted:
        raise HTTPException(404)
    return {'url': f'http://127.0.0.1:8050/?publish_card={card_id}'}


@router.post('/auth/local/login')
def login(request: Request, x_lerne_local_secret: str = Header(default='')):
    if not is_local():
        raise HTTPException(404)
    if (not request.client or request.client.host not in LOOPBACK
            or request.headers.get('origin') not in ('http://127.0.0.1:5173', 'http://localhost:5173')):
        raise HTTPException(403, detail='Local browser origin required')
    try:
        tokens = service.login_local_test(x_lerne_local_secret)
    except AuthError as exc:
        raise HTTPException(exc.status_code, detail=exc.code) from None
    from fastapi.responses import JSONResponse
    return JSONResponse(_tokens_response(tokens), headers={'Cache-Control': 'no-store'})
