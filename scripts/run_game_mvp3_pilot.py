"""Local text/API pilot. No api.main, dotenv, automatic migrations or live media/AI.

This runner does NOT authorize production rollout. Only use after the separate
PostgreSQL probe passes, against a disposable local copy with existing Auth v2
tables and one synthetic test account/session. Bind only 127.0.0.1:5210.
"""
import os
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.test_game_mvp3_postgres import disposable_database


def prepare_app(db, *, migrate=False):
    # api.models normally initializes a database on import. Suppress BOTH dotenv
    # and that initializer; only the explicitly validated test DB gets bound.
    with patch('dotenv.load_dotenv', return_value=False), patch.dict(os.environ, {
            'VERCEL': '1', 'RUN_MIGRATIONS': 'false', 'FORCE_LOCAL_DB': 'false'}):
        from api import database
        with patch.object(database, 'initialize_database', return_value=False):
            from api.models import tma_db
            from api.game_mvp3.models import MODELS
            from api.game_mvp3.migration import run_migration
            from api.game_mvp3.flags import enabled_for
            from api.routers.game import router as game_router
            from api.game_mvp3.router import router as foundation_router
    user = os.getenv('GAME_MVP3_TEST_USER_ID', '')
    if not user.isascii() or not user.isdecimal() or len(user) > 19 or not enabled_for(int(user)):
        raise ValueError('Require the isolated feature flag and exactly one positive test account ID.')
    tma_db.initialize(db)
    with db.connection_context():
        required = {'tma_game_attempt', 'tma_user', 'tma_auth_account', 'tma_auth_session', 'tma_auth_token'}
        if not required <= set(db.get_tables()):
            raise ValueError('Disposable DB needs Auth v2 and reviewed migration 88. No migration was run.')
        if migrate:
            # Explicit CLI option only, after validating DSN, flag and Auth/Game prerequisites.
            run_migration(db)
        required |= {'tma_migration_history', *(m._meta.table_name for m in MODELS)}
        if not required <= set(db.get_tables()):
            raise ValueError('Reviewed migration 88 is missing. No migration was run.')
        if not db.execute_sql('SELECT 1 FROM tma_migration_history WHERE migration_id=88').fetchone():
            raise ValueError('Reviewed migration 88 is missing. No migration was run.')
    os.environ['GAME_MODE_MOCK'] = '1'
    # Only Game/Foundation APIs: no Classic, auth provider, TTS or account routes.
    from fastapi import FastAPI
    app = FastAPI(title='Lerne isolated Game MVP 3 text pilot')
    app.include_router(game_router, prefix='/api')
    app.include_router(foundation_router, prefix='/api')
    @app.middleware('http')
    async def no_store(request, call_next):
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        return response
    return app


def main():
    db = None
    try:
        db = disposable_database(os.getenv('GAME_MVP3_TEST_DB_URL', ''))
        migrate = '--prepare-schema' in sys.argv[1:]
        app = prepare_app(db, migrate=migrate)
        if migrate:
            print('APPLIED: migration 88 in the explicitly selected local test DB. No server started.')
            return 0
        if '--check' in sys.argv[1:]:
            print('READY: isolated Game/Foundation API configuration. No server or migration started.')
            return 0
        import uvicorn
        uvicorn.run(app, host='127.0.0.1', port=5210, access_log=False)
        return 0
    except ValueError as exc:
        print(f'BLOCKED/REFUSED: {exc}')
        return 2
    except Exception as exc:
        print(f'FAILED/BLOCKED: isolated pilot ({type(exc).__name__}). No production DB used.')
        return 1
    finally:
        if db is not None:
            db.close()


if __name__ == '__main__':
    raise SystemExit(main())
