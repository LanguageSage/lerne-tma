"""Run an explicitly selected cloud folder import outside the admin DB process."""
import json
import os
from pathlib import Path
import sys


def main(root):
    if os.environ.get('LERNE_MODE') or os.environ.get('SUPABASE_DB_URL'):
        raise RuntimeError('Use the isolated admin launcher')
    os.environ.update(PYTHON_DOTENV_DISABLED='1', LERNE_SKIP_SCHEMA_INIT='1', RUN_MIGRATIONS='false')
    from fastapi import HTTPException
    from api import models
    from api.services.collaborative_service import _require_can_mutate
    from tools.admin.transfer_worker import create_transfer
    from tools.admin.services import deck_import

    request = json.loads((root / 'request.json').read_text(encoding='utf-8'))
    transfer = create_transfer(request['config_path'])
    destination = request['target_db']
    if destination not in ('cloud', 'local'):
        raise HTTPException(400, 'Неверная цель импорта.')
    endpoint = transfer.cloud if destination == 'cloud' else transfer.local
    if destination == 'cloud':
        os.environ['SUPABASE_URL'] = endpoint.storage['url']
        os.environ['SUPABASE_KEY'] = endpoint.storage['key']
    else:
        config_path = Path(request['config_path']).resolve().parent / 'local.json'
        os.environ['LERNE_LOCAL_CONFIG'] = str(config_path)
        os.environ['LERNE_DATA_ROOT'] = str(config_path.parent.parent)
        os.environ['LERNE_MODE'] = 'LOCAL'
    with endpoint.scope():
        if request['action'] == 'folders':
            folders = []
            for folder in models.TMA_Folder.select(models.TMA_Folder.id, models.TMA_Folder.name,
                    models.TMA_Folder.parent_id).where(models.TMA_Folder.is_deleted == False):
                try:
                    _require_can_mutate(endpoint.user_id, 'folder', folder.id)
                except HTTPException:
                    continue
                folders.append({'id': folder.id, 'name': folder.name, 'parent_id': folder.parent_id})
            return folders
        payload = request['payload']
        if payload['target_db'] != destination:
            raise HTTPException(400, 'Неверная цель импорта.')
        if destination == 'cloud' and request['action'] == 'apply' and not transfer.allow_cloud_write:
            raise HTTPException(403, 'Запись в Supabase отключена в серверной конфигурации.')
        payload['user_id'] = endpoint.user_id
        contents = {item['path']: (root / item['file']).read_bytes() for item in request['files']}
        sources = deck_import.read_sources(payload, contents)
        if request['action'] == 'preview':
            return deck_import.build_plan(payload, sources)
        if request['action'] == 'apply':
            return deck_import.apply_import(payload, sources)
        raise HTTPException(400, 'Неизвестная операция импорта.')


if __name__ == '__main__':
    from fastapi import HTTPException
    try:
        result = main(Path(sys.argv[1]))
        print(json.dumps({'ok': True, 'result': result}, ensure_ascii=True))
    except HTTPException as exc:
        print(json.dumps({'ok': False, 'status': exc.status_code, 'detail': exc.detail}, ensure_ascii=True))
    except (ValueError, KeyError, FileNotFoundError):
        print(json.dumps({'ok': False, 'status': 503, 'detail':
            'Конфигурация облачного импорта отсутствует или неверна.'}))
    except Exception:
        print(json.dumps({'ok': False, 'status': 502, 'detail':
            'Облачная база или Storage недоступны. Проверьте подключение.'}))
