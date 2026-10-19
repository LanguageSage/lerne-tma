"""Local SSO browser fixture. Disposable SQLite only; no .env or remote DBs."""
import argparse
import os
from pathlib import Path
import socket
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--role', choices=['issuer', 'client'])
    parser.add_argument('--port', type=int)
    args = parser.parse_args()
    directory = args.directory.resolve()
    scratch = (Path(__file__).resolve().parents[3] / 'scratch').resolve()
    if not directory.is_relative_to(scratch):
        parser.error('Fixture directory must be inside repository scratch')
    directory.mkdir(parents=True, exist_ok=True)
    if args.prepare:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        key = Ed25519PrivateKey.generate()
        (directory / 'private.pem').write_bytes(key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        (directory / 'public.pem').write_bytes(key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
        return
    if not args.role or not args.port:
        parser.error('Server requires role and port')
    os.environ.update({'LERNE_SSO_ROLE': args.role, 'RUN_MIGRATIONS': 'false',
                       'LERNE_DEPLOYMENT': 'game-test' if args.role == 'client' else '',
                       'LERNE_SSO_ISSUER_ORIGIN': 'http://localhost:5199',
                       'LERNE_SSO_CLIENT_ORIGIN': 'http://127.0.0.1:5199',
                       'ENVIRONMENT': 'development', 'FORCE_LOCAL_DB': 'false'})
    for name in ('VERCEL', 'SUPABASE_DB_URL', 'SUPABASE_URL', 'SUPABASE_KEY', 'BOT_TOKEN',
                 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'):
        os.environ.pop(name, None)
    if args.role == 'issuer':
        os.environ['LERNE_SSO_PRIVATE_KEY'] = (directory / 'private.pem').read_text()
        os.environ.pop('LERNE_SSO_PUBLIC_KEY', None)
    else:
        os.environ['LERNE_SSO_PUBLIC_KEY'] = (directory / 'public.pem').read_text()
        os.environ.pop('LERNE_SSO_PRIVATE_KEY', None)
    # Permit loopback needed by the local server/asyncio, block every remote socket.
    connect = socket.socket.connect
    def local_connect(sock, address):
        if isinstance(address, tuple) and address[0] not in ('127.0.0.1', 'localhost', '::1'):
            raise RuntimeError('External network disabled in SSO fixture')
        return connect(sock, address)
    with patch('dotenv.load_dotenv', return_value=False), patch('socket.socket.connect', local_connect):
        from api import database
        with patch.object(database, 'initialize_database', return_value=False):
            from api import models
        from peewee import SqliteDatabase
        db = SqliteDatabase(str(directory / (args.role + '.sqlite')), pragmas={'foreign_keys': 1})
        models.tma_db.initialize(db)
        db.create_tables([models.TMAUser, *models.AUTH_MODELS])
        from api.auth import service
        if args.role == 'issuer' and not models.TMAAuthPassword.select().exists():
            tokens = service.register_email_password('existing@example.test', 'existing-main-password')
            models.TMAUser.update(first_name='Existing Lerne learner', native_language='ru',
                                  has_selected_language=True).where(models.TMAUser.user_id == tokens.account_id).execute()
        from fastapi import FastAPI, Depends
        from api.auth.dependencies import get_authenticated_user_id
        from api.routers.auth_v2 import router, get_authenticated_profile
        app = FastAPI()
        app.include_router(router, prefix='/api')
        @app.get('/fixture/health')
        def health():
            return {'role': args.role}
        @app.get('/fixture/stats')
        def stats():
            return {'accounts': models.TMAAuthAccount.select().count(),
                    'passwords': models.TMAAuthPassword.select().count(),
                    'sessions': models.TMAAuthSession.select().count()}
        @app.api_route('/api/{path:path}', methods=['GET', 'POST', 'PUT'])
        def fixture_api(path: str, user_id: int = Depends(get_authenticated_user_id)):
            profile = get_authenticated_profile(user_id)
            decks = [{'id': 1, 'name': 'Local SSO test progress', 'target_language': 'de',
                      'stats': {'total': 2, 'new': 2}}]
            if path == 'init':
                return {'decks': decks, 'folders': [], 'settings': {}, 'prompts': {},
                        'user_settings': {}, 'user_info': profile, 'is_admin': False}
            if path == 'decks':
                return decks
            if path == 'folders':
                return []
            if path == 'auth/sync':
                return {'status': 'ok', 'user': profile}
            return {}
        import uvicorn
        uvicorn.run(app, host='127.0.0.1', port=args.port, log_level='error', access_log=False)


if __name__ == '__main__':
    main()
