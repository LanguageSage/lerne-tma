"""Production-safe mode gate. Development implementations are loaded on demand."""
import os
LOOPBACK = {'127.0.0.1', 'localhost', '::1'}
LOCAL_USER_ID = 900000001

def is_local():
    mode = os.environ.get('LERNE_MODE', '').upper()
    if mode not in ('', 'LOCAL'):
        raise RuntimeError('Unknown LERNE_MODE; use LOCAL or leave it unset')
    if mode == 'LOCAL' and (os.environ.get('VERCEL') or os.environ.get('VERCEL_ENV')
            or os.environ.get('ENVIRONMENT', '').lower() == 'production'
            or os.environ.get('NODE_ENV', '').lower() == 'production'):
        raise RuntimeError('LOCAL cannot run on Vercel or in Production')
    return mode == 'LOCAL'

def configure_local():
    if is_local():
        from local.runtime import configure_local as configure
        configure()

def local_config(*, create_dirs=True):
    if not is_local():
        raise RuntimeError('LOCAL configuration is unavailable outside LOCAL')
    from local.runtime import local_config as config
    return config(create_dirs=create_dirs)

def validate_database_url(value):
    if not is_local():
        raise RuntimeError('LOCAL database is unavailable outside LOCAL')
    from local.runtime import validate_database_url as validate
    return validate(value)

def media_file(folder, filename):
    if not is_local():
        raise RuntimeError('LOCAL media is unavailable outside LOCAL')
    from local.runtime import media_file as resolve
    return resolve(folder, filename)
