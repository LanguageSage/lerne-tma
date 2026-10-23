"""Explicit, isolated LOCAL↔cloud bridge. No dotenv, startup migrations or server.

Invoked only by the loopback admin with a sanitized environment. Configuration
and credentials stay outside Git and never cross the browser boundary.
"""
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit, unquote


def configuration(path, local_override=None):
    from local.runtime import PROJECT_ROOT, external_path, validate_database_url
    config_path = external_path(path)
    config = json.loads(config_path.read_text(encoding='utf-8'))
    if config.get('enabled') is not True:
        raise ValueError('Перенос отключён. Настройте внешний config/transfer.json.')
    local_path = external_path(config_path.parent / 'local.json')
    local = local_override if local_override is not None else json.loads(local_path.read_text(encoding='utf-8'))
    local_url = validate_database_url(local['database_url'])
    cloud = urlsplit(config['database_url'])
    storage = urlsplit(config['storage_url'])
    ref = config['project_ref']
    import re
    if not re.fullmatch(r'[a-z0-9]{20}', ref):
        raise ValueError('Неверный project_ref.')
    if (cloud.scheme not in ('postgres', 'postgresql') or not cloud.username or not cloud.password
            or cloud.path != '/postgres' or cloud.fragment or cloud.query not in ('', 'sslmode=require')
            or not (cloud.hostname == f'db.{ref}.supabase.co' or
                    ((cloud.hostname or '').endswith('.pooler.supabase.com') and
                     unquote(cloud.username).endswith('.' + ref)))):
        raise ValueError('Требуется явный PostgreSQL URL выбранного проекта Supabase с TLS.')
    if storage.geturl() != f'https://{ref}.supabase.co':
        raise ValueError('Storage и PostgreSQL должны принадлежать одному project_ref.')
    if config.get('environment') not in ('staging', 'production'):
        raise ValueError('Укажите environment: staging или production.')
    if not isinstance(config.get('cloud_user_id'), int) or isinstance(config['cloud_user_id'], bool):
        raise ValueError('Требуется cloud_user_id авторизованного аккаунта Lerne.')
    media = external_path(local.get('media', str(config_path.parent.parent / 'media')))
    if PROJECT_ROOT == media or PROJECT_ROOT in media.parents:
        raise ValueError('Медиа должны находиться вне Git.')
    return config, local_url, cloud, media


def create_transfer(path, local_override=None, *, exclusive=False):
    config, local_url, cloud_url, media_root = configuration(path, local_override)
    from peewee import PostgresqlDatabase
    from api import models
    from api.local_runtime import LOCAL_USER_ID
    from tools.admin.services.material_transfer import Endpoint, Transfer
    def connect(url, local=False):
        return PostgresqlDatabase(url.path.lstrip('/'), user=unquote(url.username),
            password=unquote(url.password), host=url.hostname, port=url.port or 5432,
            sslmode='disable' if local else 'require', connect_timeout=5,
            options='-c statement_timeout=30000 -c lock_timeout=5000')
    local_db = connect(local_url, True)
    cloud_db = connect(cloud_url)
    local = Endpoint(local_db, 'LOCAL:' + str(Path(path).resolve().parent.parent),
                     LOCAL_USER_ID, media_root=media_root)
    cloud = Endpoint(cloud_db, 'Supabase:' + config['project_ref'], config['cloud_user_id'],
                     storage={'url': config['storage_url'], 'key': config.get('storage_key', '')})
    # Never initialize tables or schema. Only the existing, marked LOCAL database.
    with local.scope():
        marker = models.TMASetting.get_or_none(models.TMASetting.key == 'LOCAL_DATABASE_MARKER')
        if not marker or marker.value != 'lerne-local-v1':
            raise ValueError('Маркер LOCAL отсутствует. Перенос запрещён.')
        if exclusive and not local_db.execute_sql('SELECT pg_try_advisory_lock(734102022)').fetchone()[0]:
            from fastapi import HTTPException
            raise HTTPException(409, 'Другой перенос уже выполняется. Дождитесь его завершения.')
    # Use the existing platform-admin policy, never a browser/profile-supplied
    # administrator ID. The configured actor must pass the ordinary resolver.
    return Transfer(local, cloud, allow_cloud_write=config.get('allow_cloud_write') is True,
                    environment=config['environment'])


def execute(transfer, request):
    from api import models
    command = request['command']
    if command == 'catalog':
        source, _ = transfer.endpoints(request['direction'])
        return source.catalog(request['kind'], request.get('parent_id'), request.get('page', 1), request.get('search', ''))
    if command == 'preview':
        # Unresolved interrupted writes must be replayed before new work: their
        # destination may already have committed while the LOCAL mapping did not.
        with transfer.local.scope():
            for row in models.TMAOfflineBatch.select().where(models.TMAOfflineBatch.key.startswith('transfer-job:')):
                previous = json.loads(row.response)
                if previous['namespace'] == transfer.namespace and previous['status'] in ('running', 'interrupted'):
                    from fastapi import HTTPException
                    raise HTTPException(409, f'Сначала продолжите прерванный перенос {previous["id"]}.')
        return transfer.preview(request['options'])
    if command == 'apply':
        return transfer.apply(request['id'], request['token'], request['confirmation'])
    raise ValueError('Неизвестная операция переноса.')


def main():
    # A direct invocation also fails closed; inherited production settings are
    # never allowed to trigger api.models initialization or dotenv loading.
    if os.environ.get('LERNE_MODE') or os.environ.get('SUPABASE_DB_URL'):
        raise RuntimeError('Use the isolated admin launcher')
    os.environ.update(PYTHON_DOTENV_DISABLED='1', LERNE_SKIP_SCHEMA_INIT='1', RUN_MIGRATIONS='false')
    from fastapi import HTTPException
    try:
        raw = sys.stdin.read(262145)
        if len(raw) > 262144:
            raise HTTPException(413, 'Слишком большой запрос переноса.')
        request = json.loads(raw)
        transfer = create_transfer(request.pop('config_path'), request.pop('local_runtime', None),
                                   exclusive=request.get('command') in ('preview', 'apply'))
        result = execute(transfer, request)
        print(json.dumps({'ok': True, 'result': result}, ensure_ascii=True))
    except (ValueError, KeyError, FileNotFoundError):
        print(json.dumps({'ok': False, 'status': 503, 'detail':
              'Конфигурация переноса отсутствует или неверна. Проверьте внешний config/transfer.json.'}))
    except HTTPException as exc:
        print(json.dumps({'ok': False, 'status': exc.status_code, 'detail': exc.detail}, ensure_ascii=True))
    except Exception:
        # Driver/network errors can include credentials and raw SQL. Never return
        # or log them to the browser, subprocess stdout, or task state.
        print(json.dumps({'ok': False, 'status': 502, 'detail':
              'Цель или Storage недоступны. Данные не подтверждены; проверьте состояние переноса.'}))


if __name__ == '__main__':
    main()
