import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGameServer, upstreamForPath } from '../scripts/serve.mjs';

async function openServer(t, options) {
  const server = createGameServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return server.address().port;
}

function get(port, path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

test('the local relay accepts only fixed nearby and callsign route upstreams', () => {
  assert.equal(upstreamForPath('/api/nearby/37.57/126.98/50'), 'https://api.adsb.lol/v2/point/37.57/126.98/50');
  assert.equal(upstreamForPath('/api/route/KAL744/37.3/127.1'), 'https://api.adsb.lol/api/0/route/KAL744/37.3/127.1');
  for (const path of ['/api/nearby/91/0/50', '/api/nearby/0/181/50', '/api/nearby/0/0/999', '/api/nearby/NaN/0/50', '/api/route/https://evil.example/0/0', '/api/route/ABC123%2Fextra/0/0', '/api/proxy?url=https://evil.example']) {
    assert.equal(upstreamForPath(path), null, path);
  }
});

test('static serving streams public files and keeps HEAD read-only', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'flightguesser-server-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const directory = join(temporary, 'public');
  await mkdir(directory);
  await writeFile(join(directory, 'index.html'), '<title>Flightguesser</title>');
  await writeFile(join(directory, '.env'), 'not public');
  await writeFile(join(temporary, 'private.txt'), 'outside public');
  await symlink(join(temporary, 'private.txt'), join(directory, 'linked.txt'));
  const port = await openServer(t, { directory });
  const page = await get(port, '/');
  assert.equal(page.status, 200);
  assert.equal(page.body, '<title>Flightguesser</title>');
  assert.match(page.headers['content-type'], /^text\/html/);
  const head = await get(port, '/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal(head.headers['content-length'], String(Buffer.byteLength(page.body)));
  assert.equal((await get(port, '/linked.txt')).status, 403);
  assert.equal((await get(port, '/..%2fprivate.txt')).status, 403);
  assert.equal((await get(port, '/missing')).status, 404);
  assert.equal((await get(port, '/.env')).status, 404);
  assert.equal((await get(port, '/', { method: 'POST' })).status, 405);
  assert.equal((await get(port, '/', { headers: { Host: `example.com:${port}` } })).status, 403);
  assert.deepEqual(JSON.parse((await get(port, '/api/config')).body), { relay: false });
  assert.deepEqual(JSON.parse((await get(port, '/config.json')).body), { relay: false });
  assert.equal((await get(port, '/api/nearby/0/0/50')).status, 404);
});

test('relay validates requests before provider access and briefly caches identical requests', async t => {
  const urls = [];
  const port = await openServer(t, { live: true, fetcher: async url => {
    urls.push(url);
    return new Response(JSON.stringify({ now: 123, ac: [] }));
  } });
  const path = '/api/nearby/0/0/50';
  const head = await get(port, path, { method: 'HEAD' });
  assert.equal(head.status, 405);
  assert.equal(head.body, '');
  assert.equal((await get(port, '/api/proxy')).status, 400);
  assert.equal((await get(port, path, { headers: { Origin: 'https://example.com' } })).status, 403);
  assert.equal((await get(port, path, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal(urls.length, 0);
  const first = await get(port, path);
  const cached = await get(port, path);
  assert.equal(first.status, 200);
  assert.equal(cached.body, first.body);
  assert.equal(urls.length, 1);
  assert.equal(urls[0], 'https://api.adsb.lol/v2/point/0/0/50');
});

test('provider pauses persist across relay requests but do not leak between servers', async t => {
  let requests = 0;
  const port = await openServer(t, { live: true, fetcher: async () => {
    requests++;
    return new Response('{}', { status: 429, headers: { 'Retry-After': '120' } });
  } });
  const first = await get(port, '/api/nearby/0/0/50');
  assert.equal(first.status, 429);
  assert.equal(first.headers['retry-after'], '120');
  assert.equal((await get(port, '/api/nearby/0/1/50')).status, 429);
  assert.equal(requests, 1);
  const independent = await openServer(t, { live: true, fetcher: async () => new Response('{}') });
  assert.equal((await get(independent, '/api/nearby/0/0/50')).status, 200);
});

test('relay rejects unreadable and oversized provider responses', async t => {
  let oversized = false;
  const port = await openServer(t, { live: true, fetcher: async () => {
    if (!oversized) return new Response('<html>Unavailable</html>');
    return new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < 6; i++) controller.enqueue(new Uint8Array(1_000_000));
      controller.close();
    } }));
  } });
  assert.equal((await get(port, '/api/nearby/0/0/50')).status, 502);
  oversized = true;
  assert.equal((await get(port, '/api/nearby/0/1/50')).status, 502);
});

test('relay evicts cached snapshots when their combined response bytes exceed the budget', async t => {
  const calls = [];
  const largeJson = JSON.stringify({ padding: 'x'.repeat(2_600_000) });
  const port = await openServer(t, { live: true, fetcher: async url => {
    calls.push(url);
    return new Response(largeJson);
  } });
  assert.equal((await get(port, '/api/nearby/0/0/50')).status, 200);
  assert.equal((await get(port, '/api/nearby/0/1/50')).status, 200);
  assert.equal((await get(port, '/api/nearby/0/0/50')).status, 200);
  assert.equal(calls.length, 3, 'the first snapshot cannot remain cached beyond the total byte budget');
});

test('concurrent requests for one snapshot do not count its cached bytes twice', async t => {
  let started = 0;
  let release;
  const bothStarted = new Promise(resolve => { release = resolve; });
  const port = await openServer(t, { live: true, fetcher: async url => {
    if (url.includes('/point/0/0/')) {
      if (++started === 2) release();
      await bothStarted;
      return new Response(JSON.stringify({ padding: 'x'.repeat(1_000_000) }));
    }
    return new Response(JSON.stringify({ padding: 'x'.repeat(4_200_000) }));
  } });
  const results = await Promise.all([get(port, '/api/nearby/0/0/50'), get(port, '/api/nearby/0/0/50')]);
  assert.deepEqual(results.map(result => result.status), [200, 200]);
  assert.equal((await get(port, '/api/nearby/0/1/50')).status, 200);
});


test('the local relay rejects redirects and unsupported query parameters', async t => {
  let calls = 0;
  const port = await openServer(t, { live: true, fetcher: async (_url, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    return new Response('', { status: 302, headers: { Location: 'https://other.example' } });
  } });
  assert.equal((await get(port, '/api/config?extra=true')).status, 400);
  assert.equal((await get(port, '/api/nearby/0/0/50?extra=true')).status, 400);
  assert.equal(calls, 0);
  assert.equal((await get(port, '/api/nearby/0/0/50')).status, 502);
  assert.equal(calls, 1);
});
