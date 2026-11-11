"""Classic routes share the same verified session boundary as auth v2."""
from fastapi import Header, Request
from api.auth.dependencies import get_authenticated_user_id


def get_user_id(
    authorization: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
    request: Request = None,
) -> int:
    # Keep the argument for callers; a client-supplied ID is never proof.
    # Mini Apps obtain a session through the signed initData exchange in auth v2.
    user_id = get_authenticated_user_id(authorization)
    if request is not None and request.url.path != '/api/sync/v2/status':
        from api.services.sync_generation import require_generation
        require_generation(request.headers.get('X-Lerne-Generation'))
    return user_id
