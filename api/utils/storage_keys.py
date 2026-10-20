"""Stable Storage keys; legacy names and card references remain unchanged."""
import hashlib
import re
from urllib.parse import quote


def storage_key(filename: str) -> str:
    if filename.isascii() and '..' not in filename.split('/'):
        return filename
    extension = filename.rsplit('.', 1)[-1].lower()
    suffix = '.' + extension if re.fullmatch(r'[a-z0-9]{1,10}', extension) else ''
    return 'legacy-' + hashlib.sha256(filename.encode('utf-8')).hexdigest() + suffix


def storage_object_path(filename: str) -> str:
    return quote(storage_key(filename), safe='/')
