// The private Site owns this relay; only fixed aircraft-provider paths are allowed.
export function upstreamForPath(path) {
  const nearby = path.match(/^\/api\/nearby\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(50|100|250)$/);
  const route = path.match(/^\/api\/route\/([A-Z]{3}\d[A-Z0-9]{0,6})\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/);
  const callsign = path.match(/^\/api\/callsign\/([A-Z]{3}\d[A-Z0-9]{0,6})$/);
  const airline = path.match(/^\/api\/airline\/([A-Z]{3})$/);
  if (callsign) return 'https://api.adsbdb.com/v0/callsign/' + callsign[1];
  if (airline) return 'https://api.adsbdb.com/v0/airline/' + airline[1];
  if (!nearby && !route) return null;
  const lat = Number(nearby ? nearby[1] : route[2]);
  const lon = Number(nearby ? nearby[2] : route[3]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return nearby
    ? 'https://api.adsb.lol/v2/point/' + lat + '/' + lon + '/' + nearby[3]
    : 'https://api.adsb.lol/api/0/route/' + route[1] + '/' + lat + '/' + lon;
}
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'geolocation=(self)',
};
const MAX_BYTES = 5_000_000;
function json(status, body, extra = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status, headers: { ...headers, ...extra },
  });
}
function retrySeconds(raw) {
  const n = Number(raw);
  return /^\d+$/.test(raw ?? '') && Number.isSafeInteger(n) ? Math.max(1, n) : 60;
}
async function readJson(response) {
  if (!response.body) throw new Error('Missing response');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('Response too large');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  JSON.parse(text);
  return { text, size };
}
export function createHostedHandler({ assets = {}, fetcher = fetch, now = Date.now } = {}) {
  const cache = new Map();
  const recent = [];
  let bytes = 0, inFlight = 0, pauseUntil = 0;
  const drop = key => { bytes -= cache.get(key).size; cache.delete(key); };
  return {
    async fetch(request) {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(request.method)) return json(405, { error: 'Read-only site' });
        const assetPath = url.pathname === '/' ? '/index.html' : url.pathname;
        const asset = Object.hasOwn(assets, assetPath) ? assets[assetPath] : null;
        if (!asset) return new Response('Not found', { status: 404 });
        return new Response(request.method === 'HEAD' ? null : asset.body, {
          headers: { ...headers, 'Content-Type': asset.type, 'Cache-Control': 'no-cache' },
        });
      }
      if (request.method !== 'GET') return json(405, { error: 'Data requests require GET' });
      const origin = request.headers.get('origin');
      const fetchSite = request.headers.get('sec-fetch-site');
      if ((origin && origin !== url.origin) || (fetchSite && !['same-origin', 'none'].includes(fetchSite))) {
        return json(403, { error: 'Same-origin requests only' });
      }
      if (url.search) return json(400, { error: 'Unsupported data request' });
      if (url.pathname === '/api/config') return json(200, { relay: true });
      const upstream = upstreamForPath(url.pathname);
      if (!upstream) return json(400, { error: 'Unsupported data request' });
      const timestamp = now();
      if (pauseUntil > timestamp) return json(429, { error: 'Provider requests are paused' }, { 'Retry-After': String(Math.ceil((pauseUntil - timestamp) / 1000)) });
      for (const [key, entry] of cache) if (timestamp - entry.at >= 20000) drop(key);
      if (cache.has(upstream)) return json(200, cache.get(upstream).text);
      while (recent.length && recent[0] <= timestamp - 60000) recent.shift();
      if (recent.length >= 40 || inFlight >= 3) return json(429, { error: 'Please wait before searching again' }, { 'Retry-After': '30' });
      recent.push(timestamp);
      inFlight++;
      // Incoming Request.signal is optional in the hosted Worker runtime.
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), 10000);
      const incoming = request.signal;
      const cancel = () => timeout.abort();
      if (incoming?.aborted) cancel();
      else incoming?.addEventListener?.('abort', cancel, { once: true });
      try {
        const response = await fetcher(upstream, {
          signal: timeout.signal,
          redirect: 'error',
          headers: { Accept: 'application/json', 'User-Agent': 'Flightguesser/0.1 (+https://flightguesser.cocoa-robin-0598.chatgpt.site)' },
        });
        if (response.status === 429) {
          const seconds = retrySeconds(response.headers.get('retry-after'));
          pauseUntil = Math.max(pauseUntil, now() + seconds * 1000);
          return json(429, { error: 'Flight data service needs a pause' }, { 'Retry-After': String(seconds) });
        }
        if (!response.ok) {
          console.warn('Flight provider response', new URL(upstream).hostname, response.status);
          return json(502, { error: 'Live flight data is unavailable' });
        }
        const entry = await readJson(response);
        // Bound cached bytes across nearby snapshots, not just the number of entries.
        if (cache.has(upstream)) drop(upstream);
        while (cache.size && (cache.size >= 80 || bytes + entry.size > MAX_BYTES)) drop(cache.keys().next().value);
        cache.set(upstream, { ...entry, at: now() });
        bytes += entry.size;
        return json(200, entry.text);
      } catch (error) {
        console.warn('Flight relay failure', error.name);
        return json(502, { error: 'Live flight data is unavailable' });
      } finally {
        clearTimeout(timer);
        incoming?.removeEventListener?.('abort', cancel);
        inFlight--;
      }
    },
  };
}
