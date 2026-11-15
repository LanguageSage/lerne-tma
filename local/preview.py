"""Acceptance-only identity selection on a separately restored loopback cluster."""
import secrets
from pathlib import Path

from fastapi import HTTPException
from api.local_runtime import is_local, local_config


def require_preview():
    if not is_local():
        raise HTTPException(404)
    config = local_config(create_dirs=False)
    if config.get('purpose') != 'native-v2-preview':
        raise HTTPException(404)
    from api import models
    name, port, directory = models.tma_db.execute_sql(
        "SELECT current_database(),inet_server_port(),current_setting('data_directory')").fetchone()
    if (name != 'lerne_tma_local' or port != 55433
            or Path(directory).resolve() != (config['data_root'] / 'postgres').resolve()
            or config['data_root'].name != 'v2-preview'):
        raise HTTPException(403, 'Separate V2 preview cluster required')
    marker = models.TMASetting.get_or_none(models.TMASetting.key == 'V2_PREVIEW_COPY')
    if not marker or marker.value != 'native-v2-preview':
        raise HTTPException(403, 'Preview copy marker required')
    return config


def authorize_preview(request, secret):
    config = require_preview()
    if (not request.client or request.client.host != '127.0.0.1'
            or request.headers.get('origin') != 'http://127.0.0.1:5174'
            or not secrets.compare_digest(secret, config['login_secret'])):
        raise HTTPException(403, 'Local preview browser required')


def preview_users():
    from api import models
    rows = models.tma_db.execute_sql("""
        SELECT u.user_id,u.first_name,u.username,
               count(DISTINCT d.id),count(c.id)
        FROM tma_user u
        LEFT JOIN tma_deck d ON d.user_id=u.user_id AND d.scope='personal' AND NOT d.is_deleted
        LEFT JOIN tma_card c ON c.deck_id=d.id AND NOT c.is_deleted
        WHERE u.user_id>0
        GROUP BY u.user_id,u.first_name,u.username
        ORDER BY count(c.id) DESC,u.user_id
    """).fetchall()
    return [dict(zip(('user_id', 'first_name', 'username', 'decks', 'cards'), r)) for r in rows]


def preview_login(user_id):
    from api import models
    from api.auth import service
    if not models.TMAUser.get_or_none(models.TMAUser.user_id == user_id):
        raise HTTPException(404, 'User does not exist in this copy')
    with service.auth_transaction():
        account, _ = models.TMAAuthAccount.get_or_create(user=user_id)
        if account.disabled_at is not None:
            raise HTTPException(403, 'Account disabled')
        return service._create_session(account, service.utcnow(), authentication_method='local')
