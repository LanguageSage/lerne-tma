"""Local Lerne servers using the configured cloud DB, without startup DDL."""
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parents[1]


def environment():
    from dotenv import dotenv_values
    allowed = {'PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP',
               'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES',
               'PROGRAMFILES(X86)'}
    base = {k: v for k, v in os.environ.items() if k.upper() in allowed}
    config = {k: v for k, v in dotenv_values(ROOT / '.env').items() if v is not None}
    config = {k: v for k, v in config.items() if not k.startswith(
        ('LERNE_LOCAL_', 'VITE_', 'VERCEL', 'FORCE_LOCAL_DB'))
        and k not in ('LERNE_MODE', 'LERNE_DATA_ROOT', 'LERNE_ISOLATED_CHECKS')}
    api = {**base, **config, 'PYTHON_DOTENV_DISABLED': '1', 'ENVIRONMENT': 'development'}
    if not api.get('SUPABASE_DB_URL'):
        raise RuntimeError('Configure SUPABASE_DB_URL in the project .env first.')
    frontend = {**base, 'VITE_API_URL': '/api',
                'VITE_DEV_API_TARGET': 'http://127.0.0.1:8001'}
    return api, frontend


def start():
    api_env, frontend_env = environment()
    vite = ROOT / 'app/node_modules/vite/bin/vite.js'
    if not vite.is_file():
        raise RuntimeError('Frontend dependencies missing. Run npm --prefix app ci.')
    for port in (8001, 5173):
        with socket.socket() as probe:
            try:
                probe.bind(('127.0.0.1', port))
            except OSError:
                raise RuntimeError(f'Port {port} is occupied. Stop the other Lerne window first.') from None
    processes = []
    flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    try:
        # lifespan=off prevents cloud schema preparation and migrations.
        processes.append(subprocess.Popen([sys.executable, '-m', 'uvicorn',
            'api.main:app', '--host', '127.0.0.1', '--port', '8001', '--lifespan', 'off'],
            cwd=ROOT, env=api_env, creationflags=flags))
        processes.append(subprocess.Popen(['node', str(vite), '--host', '127.0.0.1',
            '--port', '5173', '--strictPort'], cwd=ROOT / 'app', env=frontend_env,
            creationflags=flags))
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        for _ in range(100):
            if any(p.poll() is not None for p in processes):
                raise RuntimeError('A server stopped. Check the output above.')
            try:
                for url in ('http://127.0.0.1:8001/openapi.json', 'http://127.0.0.1:5173'):
                    with opener.open(url, timeout=.5):
                        pass
                break
            except OSError:
                time.sleep(.2)
        else:
            raise RuntimeError('Servers did not become ready.')
        print('Lerne: CLOUD DATABASE. Changes are saved to your cloud account.\n'
              'Startup migrations disabled. Ctrl+C stops these two servers.', flush=True)
        webbrowser.open('http://127.0.0.1:5173')
        while all(p.poll() is None for p in processes):
            time.sleep(.5)
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == '__main__':
    try:
        start()
    except KeyboardInterrupt:
        print('\nLerne servers stopped.')
    except Exception as exc:
        print(str(exc) if type(exc) is RuntimeError else
              f'Launcher failed: {type(exc).__name__} (credentials hidden).', file=sys.stderr)
        raise SystemExit(1)
