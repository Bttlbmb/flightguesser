import { upstreamForPath as hostedUpstreamForPath } from '../server/worker.js';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body) {
  if (res.destroyed) return;
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'geolocation=(self)',
  });
  res.end(res.req.method === 'HEAD' ? undefined : text);
}

export function upstreamForPath(pathname) { return hostedUpstreamForPath(pathname, 'adsb.lol'); }
export function createGameServer({ directory = resolve(projectRoot, 'public'), live = false, fetcher = fetch } = {}) {
  const root = resolve(directory);
  let canonicalRoot;
  // State belongs to this server, so separate previews cannot share stale data or pauses.
  const cache = new Map();
  let cacheBytes = 0;
  const dropCached = key => {
    cacheBytes -= cache.get(key).bytes;
    cache.delete(key);
  };
  const recentRequests = [];
  let upstreamInFlight = 0;
  let upstreamPauseUntil = 0;
  const contact = process.env.FLIGHTGUESSER_CONTACT;
  if (contact && (contact.length > 200 || /[\r\n]/.test(contact))) throw new Error('Invalid contact identifier');
  // The provider rejects Node's generic identifier; sustained use needs a real contact.
  const userAgent = `Flightguesser-local-MVP/0.1 (${contact || 'local-only technical spike'})`;

  async function relay(req, res, pathname) {
    // HEAD must not spend provider requests or cache a provider's empty response body.
    if (req.method !== 'GET') return send(res, 405, { error: 'Data requests require GET' });
    const upstream = upstreamForPath(pathname);
    if (!upstream) return send(res, 400, { error: 'Unsupported data request' });
    const origin = req.headers.origin;
    const fetchSite = req.headers['sec-fetch-site'];
    if ((origin && origin !== `http://${req.headers.host}`)
      || (fetchSite && !['same-origin', 'none'].includes(fetchSite))) {
      return send(res, 403, { error: 'Same-origin requests only' });
    }
    const now = Date.now();
    if (upstreamPauseUntil > now) {
      const seconds = Math.ceil((upstreamPauseUntil - now) / 1000);
      res.setHeader('Retry-After', String(seconds));
      return send(res, 429, { error: 'Provider requests are paused', retryAfter: seconds });
    }
    // Remove expired entries rather than keeping old responses until a wholesale clear.
    for (const [key, entry] of cache) if (now - entry.at >= 20000) dropCached(key);
    const cached = cache.get(upstream);
    if (cached) return send(res, 200, cached.text);
    while (recentRequests[0] < now - 60000) recentRequests.shift();
    if (recentRequests.length >= 40 || upstreamInFlight >= 3) {
      res.setHeader('Retry-After', '30');
      return send(res, 429, { error: 'Please wait before searching again', retryAfter: 30 });
    }
    recentRequests.push(now);
    upstreamInFlight++;
    const disconnected = new AbortController();
    const cancel = () => { if (!res.writableEnded) disconnected.abort(); };
    res.on('close', cancel);
    try {
      const response = await fetcher(upstream, {
        signal: AbortSignal.any([disconnected.signal, AbortSignal.timeout(10000)]),
        headers: { Accept: 'application/json', 'User-Agent': userAgent },
      });
      if (!response.ok) {
        if (response.status === 429) {
          const raw = response.headers.get('retry-after');
          const value = Number(raw);
          const seconds = /^\d+$/.test(raw ?? '') && Number.isSafeInteger(value) ? Math.max(1, value) : 60;
          upstreamPauseUntil = Math.max(upstreamPauseUntil, Date.now() + seconds * 1000);
          res.setHeader('Retry-After', String(seconds));
          return send(res, 429, { error: 'Aircraft provider unavailable', retryAfter: seconds });
        }
        return send(res, 502, { error: 'Aircraft provider unavailable' });
      }
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > 5_000_000) throw new Error('Response too large');
        chunks.push(chunk);
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes));
      JSON.parse(text);
      // Keep validated JSON once, with a total byte budget as well as an entry limit.
      // Large nearby snapshots must not multiply into hundreds of MB of cached objects.
      // A concurrent request may have filled this key while the provider was responding.
      if (cache.has(upstream)) dropCached(upstream);
      while (cache.size >= 80 || cacheBytes + bytes > 5_000_000) dropCached(cache.keys().next().value);
      cache.set(upstream, { at: Date.now(), text, bytes });
      cacheBytes += bytes;
      return send(res, 200, text);
    } catch {
      return send(res, 502, { error: 'Aircraft provider unavailable' });
    } finally {
      res.off('close', cancel);
      upstreamInFlight--;
    }
  }

  return createServer(async (req, res) => {
    const port = req.socket.localPort;
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) {
      return send(res, 403, { error: 'Localhost only' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Read-only server' });
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname === '/api/config') return send(res, 200, { relay: live });
      if (url.pathname.startsWith('/api/')) {
        if (!live) return send(res, 404, { error: 'Data relay is disabled' });
        return await relay(req, res, url.pathname);
      }
      const pathname = decodeURIComponent(url.pathname);
      const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(root + sep)) return send(res, 403, { error: 'Outside public files' });
      const realRoot = await (canonicalRoot ??= realpath(root));
      const realFile = await realpath(file);
      // A link placed among public assets must not expose a file outside that directory.
      if (!realFile.startsWith(realRoot + sep)) return send(res, 403, { error: 'Outside public files' });
      const info = await stat(realFile);
      if (!info.isFile()) return send(res, 404, { error: 'Not found' });
      res.writeHead(200, {
        'Content-Type': contentTypes[extname(realFile)] || 'application/octet-stream',
        'Content-Length': info.size, 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'geolocation=(self)', 'Cache-Control': 'no-cache',
      });
      if (req.method === 'HEAD') return res.end();
      // Stream assets rather than keeping another full data-file copy in server memory.
      await pipeline(createReadStream(realFile), res);
    } catch {
      if (res.headersSent) res.destroy();
      else send(res, 404, { error: 'Not found' });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const live = process.argv.includes('--live');
  const directory = resolve(projectRoot, process.argv.includes('--dist') ? 'dist' : 'public');
  const portArg = process.argv.find(value => value.startsWith('--port='));
  const port = portArg ? Number(portArg.slice('--port='.length)) : 5173;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use a valid localhost port');
  const server = createGameServer({ directory, live });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Flightguesser: http://localhost:${port}`);
    console.log(live ? 'Local-only live data relay enabled.' : 'Static mode. Live play requires provider browser access.');
  });
}
