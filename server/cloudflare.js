import { createHostedHandler, upstreamForPath } from './worker.js';

const websiteOrigin = 'https://bttlbmb.github.io';

export function createCloudflareRelay(options = {}) {
  const handler = createHostedHandler({ ...options, allowedOrigin: websiteOrigin });
  return {
    async fetch(request) {
      const url = new URL(request.url);
      const origin = request.headers.get('origin');
      const cors = origin === websiteOrigin ? {
        'Access-Control-Allow-Origin': websiteOrigin,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Expose-Headers': 'Retry-After',
        'Access-Control-Max-Age': '3600',
      } : {};
      const reply = (status, body) => new Response(body ? JSON.stringify(body) : null, {
        status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin', ...cors },
      });
      if (origin && origin !== websiteOrigin) return reply(403, { error: 'Website origin is not allowed' });
      if (url.pathname === '/' && request.method === 'GET') return reply(200, {
        service: 'Flightguesser relay', website: websiteOrigin + '/flightguesser/',
      });
      if (url.search || (url.pathname !== '/api/config' && !upstreamForPath(url.pathname))) {
        return reply(400, { error: 'Unsupported data request' });
      }
      if (request.method === 'OPTIONS') {
        if (origin !== websiteOrigin || request.headers.get('access-control-request-method') !== 'GET'
          || request.headers.get('access-control-request-headers')) return reply(403, { error: 'Unsupported preflight request' });
        return reply(204);
      }
      const response = await handler.fetch(request);
      const headers = new Headers(response.headers);
      headers.set('Vary', 'Origin');
      for (const [name, value] of Object.entries(cors)) headers.set(name, value);
      return new Response(response.body, { status: response.status, headers });
    },
  };
}

export default createCloudflareRelay();
