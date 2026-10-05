import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCloudflareRelay } from '../server/cloudflare.js';
import { verifyRelay } from '../scripts/connect-relay.mjs';
import { findNearbyRound, enrichRouteAirline, runtimeConfig, normalizeRelayUrl } from '../public/api.js';

const origin = 'https://bttlbmb.github.io';
const relayUrl = 'https://flightguesser-relay.example.workers.dev';
const request = (path, options = {}) => new Request(relayUrl + path, {
  ...options, headers: { Origin: origin, 'Sec-Fetch-Site': 'cross-site', ...options.headers },
});
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });

test('connecting a relay requires real aircraft data as well as working configuration', async () => {
  const cors = { 'Access-Control-Allow-Origin': origin };
  const settings = { relay: true, telemetryProvider: 'adsb.fi', routeProvider: 'adsbdb' };
  await assert.rejects(verifyRelay(relayUrl, async url => url.endsWith('/api/config')
    ? json(settings, 200, cors) : json({ error: 'Unavailable' }, 502, cors)), /aircraft data failed.*502/);
  await assert.rejects(verifyRelay(relayUrl, async url => url.endsWith('/api/config')
    ? json(settings, 200, cors) : json({}, 200, cors)), /unexpected aircraft response/);
  assert.deepEqual(await verifyRelay(relayUrl, async url => url.endsWith('/api/config')
    ? json(settings, 200, cors) : json({ ac: [] }, 200, cors)), { ...settings, relayUrl });
});

test('GitHub browser configuration and a complete flight search use the external relay without cookies', async () => {
  const paths = [];
  const airport = (icao, lon) => ({ icao_code: icao, iata_code: icao.slice(1), name: icao + ' Airport', municipality: icao,
    country_iso_name: 'GB', latitude: 0, longitude: lon });
  const worker = createCloudflareRelay({ nearbyIntervalMs: 0, fetcher: async url => {
    paths.push(url);
    if (url.includes('/api/v3/lat/')) return json({ now: Date.now(), ac: [{ hex: 'abc123', flight: 'ABC123',
      lat: 0, lon: 5, alt_baro: 34000, gs: 420, track: 90, seen: 1, seen_pos: 2 }] });
    if (url.includes('/airline/')) return json({ response: [{ icao: 'ABC', name: 'Example Air' }] });
    return json({ response: { flightroute: { callsign_icao: 'ABC123', origin: airport('AAAA', 0), destination: airport('BBBB', 10) } } });
  } });
  const config = await (await worker.fetch(request('/api/config'))).json();
  const settings = await runtimeConfig({ fetcher: async () => json({ ...config, relayUrl: relayUrl + '/' }) });
  assert.equal(settings.relayUrl, relayUrl);
  const browserFetch = async (url, options) => {
    assert.ok(url.startsWith(relayUrl + '/api/'));
    assert.equal(options.credentials, 'omit');
    const response = await worker.fetch(request(new URL(url).pathname, { signal: options.signal }));
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    return response;
  };
  const round = await findNearbyRound({ lat: 0, lon: 5, name: 'Test city' }, { ...settings, fetcher: browserFetch });
  assert.equal(round.mode, 'live');
  assert.equal(round.provider, 'adsb.fi');
  assert.equal(round.route.provider, 'adsbdb');
  assert.equal(round.route.destination.id, 'BBBB');
  const enriched = await enrichRouteAirline({ ...round.route, airlineCode: 'ABC' }, { ...settings, fetcher: browserFetch });
  assert.equal(enriched.airline.name, 'Example Air');
  assert.ok(paths.some(url => url.includes('api.adsbdb.com/v0/callsign/ABC123')));
});

test('Cloudflare rejects other origins, arbitrary targets and unsupported methods before spending provider requests', async () => {
  let calls = 0;
  const worker = createCloudflareRelay({ fetcher: async () => { calls++; return json({}); } });
  for (const [path, options, expected] of [
    ['/api/nearby/0/0/50', { headers: { Origin: 'https://other.example' } }, 403],
    ['/api/nearby/0/0/50?url=https://other.example', {}, 400],
    ['/api/proxy', {}, 400],
    ['/api/nearby/91/0/50', {}, 400],
    ['/api/nearby/0/0/50', { method: 'POST' }, 405],
    ['/api/config', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST' } }, 403],
  ]) assert.equal((await worker.fetch(request(path, options))).status, expected);
  const blocked = await worker.fetch(request('/api/config', { headers: { Origin: 'https://other.example' } }));
  assert.equal(blocked.headers.get('access-control-allow-origin'), null);
  const preflight = await worker.fetch(request('/api/config', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'GET' } }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.equal(calls, 0);
});

test('Cloudflare CORS headers expose retry delays and remain on provider failures', async () => {
  const worker = createCloudflareRelay({ nearbyIntervalMs: 0, fetcher: async () => json({}, 429, { 'Retry-After': '9' }) });
  const response = await worker.fetch(request('/api/nearby/0/0/50'));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '9');
  assert.equal(response.headers.get('access-control-expose-headers'), 'Retry-After');
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  const unavailable = createCloudflareRelay({ fetcher: async () => { throw new Error('Offline'); } });
  const failure = await unavailable.fetch(request('/api/callsign/ABC123'));
  assert.equal(failure.status, 502);
  assert.equal(failure.headers.get('access-control-allow-origin'), origin);
});

test('relay configuration rejects credentials and insecure or non-root addresses', async () => {
  for (const url of ['http://worker.example', 'https://user:password@worker.example', 'https://worker.example/api/',
    'https://worker.example/?secret=value', 'https://worker.example/#fragment']) {
    assert.throws(() => normalizeRelayUrl(url));
    assert.deepEqual(await runtimeConfig({ fetcher: async () => json({ relay: true, relayUrl: url }) }), { relay: false });
  }
});

test('dashboard file matches the tested source and contains no unresolved imports', async () => {
  const core = await readFile(new URL('../server/worker.js', import.meta.url), 'utf8');
  const entry = (await readFile(new URL('../server/cloudflare.js', import.meta.url), 'utf8'))
    .replace("import { createHostedHandler, upstreamForPath } from './worker.js';\n", '');
  const bundle = await readFile(new URL('../cloudflare/worker.js', import.meta.url), 'utf8');
  assert.equal(bundle, '// Generated by npm run build:relay. Edit server/worker.js and server/cloudflare.js.\n' + core + '\n' + entry);
  assert.doesNotMatch(bundle, /^import /m);
});
