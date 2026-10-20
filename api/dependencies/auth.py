"""Classic routes share the same verified session boundary as auth v2."""
from fastapi import Header
from api.auth.dependencies import get_authenticated_user_id


def get_user_id(
    authorization: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
) -> int:
    # Keep the argument for callers; a client-supplied ID is never proof.
    # Mini Apps obtain a session through the signed initData exchange in auth v2.
    return get_authenticated_user_id(authorization)
