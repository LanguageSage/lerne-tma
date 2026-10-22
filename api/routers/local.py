"""Mounted only in LOCAL. The Vite proxy supplies the private local credential."""
from fastapi import APIRouter, Header, HTTPException, Request
from api.auth import service
from api.auth.errors import AuthError
from api.local_runtime import is_local, LOOPBACK
from api.routers.auth_v2 import _tokens_response

router = APIRouter()


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
