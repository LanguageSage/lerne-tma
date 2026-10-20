import test from 'node:test';
import assert from 'node:assert/strict';
import { Socket } from 'node:net';
import { createSocket } from 'node:dgram';

test('Node test workers cannot connect to backend services', async () => {
  const tcp = new Socket();
  assert.throws(() => tcp.connect(5432, '127.0.0.1'), /Network disabled/);
  tcp.destroy();
  const udp = createSocket('udp4');
  assert.throws(() => udp.send('test', 5432, '127.0.0.1'), /Network disabled/);
  udp.close();
  await assert.rejects(fetch('http://127.0.0.1:8001'), /Network disabled/);
});
