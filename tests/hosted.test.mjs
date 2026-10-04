import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostedHandler, upstreamForPath } from '../server/worker.js';
import { findNearbyRound, requestJson } from '../public/api.js';
const origin = 'https://flightguesser.example';
const req = (path, init) => new Request(origin + path, init);
const json = value => new Response(JSON.stringify(value));

test('hosted relay rejects other origins, unsupported endpoints, methods and redirects', async () => {
  let calls = 0;
  const worker = createHostedHandler({ fetcher: async (_url, options) => { calls++; assert.equal(options.redirect, 'error'); return json({ ac: [] }); } });
  for (const [path, init, status] of [
    ['/api/nearby/0/0/50', { method: 'HEAD' }, 405],
    ['/api/nearby/0/0/50', { headers: { Origin: 'https://other.example' } }, 403],
    ['/api/nearby/0/0/50', { headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403],
    ['/api/nearby/91/0/50', {}, 400],
    ['/api/nearby/0/0/50?url=https://other.example', {}, 400],
    ['/api/proxy', {}, 400],
  ]) assert.equal((await worker.fetch(req(path, init))).status, status);
  assert.equal(calls, 0);
  assert.equal((await worker.fetch(req('/api/nearby/0/0/50'))).status, 200);
  assert.equal(calls, 1);
  assert.equal(upstreamForPath('/api/callsign/ABC123'), 'https://api.adsbdb.com/v0/callsign/ABC123');
});

test('hosted snapshots expire, malformed responses are rejected, and provider pauses stop requests', async () => {
  let time = 100000, calls = 0, response = () => json({ ac: [] });
  const worker = createHostedHandler({ now: () => time, fetcher: async () => { calls++; return response(); } });
  const path = '/api/nearby/0/0/50';
  await worker.fetch(req(path)); await worker.fetch(req(path));
  assert.equal(calls, 1);
  time += 20000;
  await worker.fetch(req(path)); assert.equal(calls, 2);
  response = () => new Response('bad json');
  assert.equal((await worker.fetch(req('/api/nearby/1/0/50'))).status, 502);
  response = () => new Response('x'.repeat(5_000_001));
  assert.equal((await worker.fetch(req('/api/nearby/2/0/50'))).status, 502);
  response = () => new Response('{}', { status: 429, headers: { 'Retry-After': '7' } });
  const paused = await worker.fetch(req('/api/nearby/3/0/50'));
  assert.equal(paused.status, 429);
  const before = calls;
  assert.equal((await worker.fetch(req('/api/nearby/4/0/50'))).headers.get('retry-after'), '7');
  assert.equal(calls, before);
  time += 7000; response = () => json({ ac: [] });
  assert.equal((await worker.fetch(req('/api/nearby/4/0/50'))).status, 200);
});

test('hosted relay caps concurrent upstream requests', async () => {
  const releases = [];
  const worker = createHostedHandler({ fetcher: () => new Promise(resolve => releases.push(() => resolve(json({ ac: [] })))) });
  const pending = [0, 1, 2].map(lat => worker.fetch(req('/api/nearby/' + lat + '/0/50')));
  assert.equal((await worker.fetch(req('/api/nearby/3/0/50'))).status, 429);
  for (const release of releases) release();
  assert.deepEqual((await Promise.all(pending)).map(r => r.status), [200, 200, 200]);
});

test('same-origin browser requests keep Site authentication and external requests omit it', async () => {
  for (const [url, expected] of [['/api/nearby/0/0/50', 'same-origin'], ['https://api.adsb.lol/v2/point/0/0/50', 'omit']]) {
    await requestJson(url, { fetcher: async (_url, options) => { assert.equal(options.credentials, expected); return json({}); } });
  }
});

test('a browser search opens a live round through hosted telemetry and fallback routes', async () => {
  const paths = [];
  const airport = (icao, lon) => ({ icao_code: icao, iata_code: icao.slice(1), name: icao + ' Airport', municipality: icao, country_iso_name: 'GB', latitude: 0, longitude: lon });
  const worker = createHostedHandler({ fetcher: async url => {
    paths.push(url);
    if (url.includes('/v2/point/')) return json({ now: Date.now(), ac: [{ hex: 'abc123', flight: 'ABC123', lat: 0, lon: 5, alt_baro: 34000, gs: 420, track: 90, seen: 1, seen_pos: 2 }] });
    if (url.includes('/api/0/route/')) return new Response('{}', { status: 500 });
    return json({ response: { flightroute: { callsign_icao: 'ABC123', origin: airport('AAAA', 0), destination: airport('BBBB', 10) } } });
  } });
  const browserFetch = async (path, init) => worker.fetch(req(path, init));
  assert.deepEqual(await (await browserFetch('/api/config')).json(), { relay: true });
  const round = await findNearbyRound({ lat: 0, lon: 5, name: 'Test city' }, { relay: true, fetcher: browserFetch });
  assert.equal(round.mode, 'live');
  assert.equal(round.route.provider, 'adsbdb');
  assert.equal(round.route.destination.id, 'BBBB');
  assert.ok(paths.some(url => url.includes('api.adsbdb.com/v0/callsign/ABC123')));
});


test('hosted relay works when the runtime supplies no incoming Request.signal', async () => {
  const worker = createHostedHandler({ fetcher: async (_url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    return json({ ac: [] });
  } });
  const response = await worker.fetch({ url: origin + '/api/nearby/0/0/50', method: 'GET', headers: new Headers() });
  assert.equal(response.status, 200);
});
