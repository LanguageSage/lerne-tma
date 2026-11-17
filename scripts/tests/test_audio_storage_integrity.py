"""Real loopback HTTP Storage; synthetic audio, no cloud or TTS calls."""
import asyncio
import hashlib
import unittest
import sys
import os
from pathlib import Path
import shutil
from uuid import uuid4
from unittest.mock import patch

import aiohttp
from aiohttp import web
from api.utils import audio


class AudioIntegrityTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.objects = {}
        self.posts = 0
        self.post_bytes = 0
        self.get_bytes = 0
        self.failure = None
        async def post(request):
            self.assertEqual(request.headers['x-upsert'], 'false')
            self.posts += 1
            data = await request.read()
            self.post_bytes += len(data)
            if isinstance(self.failure, int):
                return web.Response(status=self.failure)
            key = request.match_info['name']
            if key in self.objects:
                return web.json_response({'error': 'Duplicate'}, status=409)
            self.objects[key] = data
            if self.failure == 'timeout':
                await asyncio.sleep(.15)
            if self.failure == 'lost_reply':
                request.transport.abort()
                return web.Response(status=201)
            return web.Response(status=201)
        async def get(request):
            value = self.objects.get(request.match_info['name'])
            if self.failure == 'missing' or value is None:
                return web.Response(status=404)
            if self.failure == 'corrupt': value = b'wrong bytes'
            self.get_bytes += len(value)
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
        for problem in ('missing', 'corrupt', 402, 403, 429, 500, 503):
            self.failure = problem
            with self.subTest(problem=problem):
                self.assertIsNone(await self.upload(b'ID3' + str(problem).encode()*32))

    async def test_lost_response_retries_in_new_process_without_shared_cache(self):
        payload=b'ID3'+b'restart-safe'*20
        self.failure='lost_reply'
        self.assertIsNone(await self.upload(payload))
        self.assertEqual(len(self.objects),1)
        self.failure=None
        code="""import asyncio,importlib,sys
async def main():
    audio=importlib.import_module(sys.argv[2])
    result=await audio._upload_to_supabase(b'ID3'+b'restart-safe'*20,'ignored.mp3',sys.argv[1],'test-only')
    print(result)
    if audio._supabase_http_session: await audio._supabase_http_session.close()
    assert result
asyncio.run(main())
"""
        child=await asyncio.create_subprocess_exec(sys.executable,'-c',code,self.base,audio.__name__,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
        stdout,stderr=await asyncio.wait_for(child.communicate(),15)
        self.assertEqual(child.returncode,0,stderr.decode())
        self.assertIn(hashlib.sha256(payload).hexdigest(),stdout.decode())
        self.assertEqual(self.posts,2)
        self.assertEqual(list(self.objects.values()),[payload])
        self.assertEqual(self.post_bytes,2*len(payload))
        self.assertEqual(self.get_bytes,len(payload))

    async def test_timeout_after_upload_requires_explicit_safe_retry(self):
        payload=b'ID3'+b'timeout'*30
        self.failure='timeout'
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=.04)) as short:
            with patch.object(audio,'_get_supabase_session',return_value=short):
                self.assertIsNone(await self.upload(payload))
        self.assertEqual(list(self.objects.values()),[payload])
        self.failure=None
        self.assertTrue(await self.upload(payload))
        self.assertEqual(self.posts,2)

    async def test_concurrent_force_generation_uses_distinct_staging_files(self):
        root=Path(__file__).resolve().parents[2]/'local/test-data'/('tts-parallel-'+uuid4().hex)
        root.mkdir(parents=True)
        paths=[]
        class Synth:
            def __init__(self,*args,**kwargs): pass
            async def save(self,path):
                paths.append(path); index=len(paths)
                await asyncio.sleep(.01*index)
                Path(path).write_bytes(b'ID3'+bytes([index])*128)
        replace = os.replace
        def competing_cache_writer(source, destination):
            replace(source, destination)
            # Another process may publish the shared text-cache file before
            # this coroutine starts uploading. Its bytes are not our synthesis.
            Path(destination).write_bytes(b'ID3'+b'cache-race'*32)
        try:
            with patch.object(audio.edge_tts,'Communicate',Synth), patch.object(audio.os,'replace',side_effect=competing_cache_writer), patch.dict(os.environ,{'SUPABASE_URL':self.base,'SUPABASE_KEY':'fixture'}):
                urls=await asyncio.gather(*(audio.generate_audio('Same phrase',output_dir=str(root),force=True) for _ in range(2)))
            self.assertEqual(len(set(paths)),2)
            self.assertNotEqual(urls[0][0],urls[1][0])
            self.assertEqual(set(self.objects.values()),{b'ID3'+b'\1'*128,b'ID3'+b'\2'*128})
            self.assertFalse(list(root.glob('*.partial')))
        finally:
            assert root.name.startswith('tts-parallel-')
            shutil.rmtree(root)


if __name__ == '__main__':
    unittest.main()
