"""Bound folder multipart requests while receiving, including chunked uploads."""
from starlette.responses import JSONResponse
from starlette.exceptions import HTTPException

from tools.admin.services.deck_import_media import MAX_TOTAL


class ImportBodyTooLarge(HTTPException):
    def __init__(self):
        super().__init__(413, 'Пакет превышает 100 МБ. Выберите меньше колод.')


class ImportBodyLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or not scope['path'].startswith('/api/admin/author/folder-import/'):
            return await self.app(scope, receive, send)
        limit = MAX_TOTAL + 2 * 1024 * 1024  # Form metadata and multipart boundaries.
        response = JSONResponse({'detail': 'Пакет превышает 100 МБ. Выберите меньше колод.'}, status_code=413)
        for name, value in scope.get('headers', []):
            if name.lower() == b'content-length':
                try:
                    if int(value) > limit:
                        return await response(scope, receive, send)
                except ValueError:
                    return await JSONResponse({'detail': 'Некорректный Content-Length'}, status_code=400)(scope, receive, send)
        total = 0

        async def bounded_receive():
            nonlocal total
            message = await receive()
            if message['type'] == 'http.request':
                total += len(message.get('body', b''))
                if total > limit:
                    raise ImportBodyTooLarge()
            return message

        try:
            await self.app(scope, bounded_receive, send)
        except ImportBodyTooLarge:
            await response(scope, receive, send)
