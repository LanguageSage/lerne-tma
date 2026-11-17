"""Real loopback HTTP Storage; synthetic audio, no cloud or TTS calls."""
import asyncio
import hashlib
import unittest
from unittest.mock import patch

import aiohttp
from aiohttp import web
from api.utils import audio


class AudioIntegrityTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.objects = {}
        self.posts = 0
        self.failure = None
        async def post(request):
            self.assertEqual(request.headers['x-upsert'], 'false')
            self.posts += 1
            data = await request.read()
            if isinstance(self.failure, int):
                return web.Response(status=self.failure)
            key = request.match_info['name']
            if key in self.objects:
                return web.json_response({'error': 'Duplicate'}, status=409)
            self.objects[key] = data
            return web.Response(status=201)
        async def get(request):
            value = self.objects.get(request.match_info['name'])
            if self.failure == 'missing' or value is None:
                return web.Response(status=404)
            if self.failure == 'corrupt': value = b'wrong bytes'
            return web.Response(body=value)
        app = web.Application()
        app.router.add_post('/storage/v1/object/audio/{name}', post)
        app.router.add_get('/storage/v1/object/public/audio/{name}', get)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, '127.0.0.1', 0)
        await site.start()
        self.base = 'http://127.0.0.1:' + str(site._server.sockets[0].getsockname()[1])
        self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=3))
        self.patcher = patch.object(audio, '_get_supabase_session', return_value=self.session)
        self.patcher.start()

    async def asyncTearDown(self):
        self.patcher.stop()
        await self.session.close()
        await self.runner.cleanup()

    async def upload(self, value):
        return await audio._upload_to_supabase(value, 'same-cache-name.mp3', self.base, 'test-only')

    async def test_parallel_retry_and_different_bytes_never_overwrite(self):
        a, b = b'ID3'+b'a'*128, b'ID3'+b'b'*128
        urls = await asyncio.gather(*(self.upload(x) for x in [a, a, b, a]))
        self.assertTrue(all(urls))
        self.assertEqual(urls[0], urls[1])
        self.assertNotEqual(urls[0], urls[2])
        self.assertEqual(len(self.objects), 2)
        for url, expected in zip(urls, [a, a, b, a]):
            async with self.session.get(url) as response:
                self.assertEqual(hashlib.sha256(await response.read()).digest(), hashlib.sha256(expected).digest())

    async def test_upload_success_without_matching_bytes_is_not_success(self):
        for problem in ('missing', 'corrupt', 402, 403, 429, 503):
            self.failure = problem
            with self.subTest(problem=problem):
                self.assertIsNone(await self.upload(b'ID3' + str(problem).encode()*32))


if __name__ == '__main__':
    unittest.main()
