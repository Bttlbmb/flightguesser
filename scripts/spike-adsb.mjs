#!/usr/bin/env node
// Optional live research. Keep requests sequential and stop at the first rate limit.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aircraftCandidates, normalizeRoute, observationTime, SEARCH_RADII_NM } from '../public/flights.js';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/spike-adsb.mjs [--out=/new/output/directory]');
  console.log('Makes at most 12 sequential GET requests around Seoul and London. Stops on HTTP 429.');
  process.exit(0);
}
const args = process.argv.slice(2);
if (args.some(arg => !arg.startsWith('--out=')) || args.length > 1) throw new Error('Use --help for sampler options');
const startedAt = new Date().toISOString();
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(args[0]?.slice('--out='.length) || resolve(projectRoot, 'docs/evidence', `live-sample-${startedAt.replace(/[:.]/g, '-')}`));
const contact = process.env.FLIGHTGUESSER_CONTACT;
if (contact && (contact.length > 200 || /[\r\n]/.test(contact))) throw new Error('Invalid contact identifier');
await mkdir(dirname(output), { recursive: true });
// Refuse to overwrite a previous sample or the source records used for practice.
await mkdir(output);
const userAgent = `Flightguesser-local-MVP/0.1 (${contact || 'local-only technical spike'})`;
const cities = [
  { id: 'seoul', lat: 37.57, lon: 126.98 },
  { id: 'london', lat: 51.51, lon: -0.13 },
];
const requests = [];
const samples = [];
let transportFailures = 0;
let stopReason = null;
const maxRequests = 12;
const routeRequestsPerCity = 3;
const delay = () => new Promise(resolve => setTimeout(resolve, 750));

async function request(id, url) {
  if (requests.length >= maxRequests) throw new Error('Request budget exhausted');
  const before = performance.now();
  let response, rawBody = '', body = null, error = null;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: { Accept: 'application/json', 'User-Agent': userAgent, Origin: 'http://localhost:5173' },
    });
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 5_000_000) throw new Error('Response too large');
      chunks.push(chunk);
    }
    rawBody = Buffer.concat(chunks, bytes).toString('utf8');
    try { body = JSON.parse(rawBody); } catch { /* Preserve unreadable responses as evidence. */ }
  } catch (failure) { error = failure.message; }
  const observedAt = new Date().toISOString();
  const headers = response ? Object.fromEntries(response.headers) : {};
  const result = {
    id, url, observedAt, durationMs: Math.round(performance.now() - before),
    status: response?.status ?? 0, contentType: headers['content-type'] ?? null,
    allowOrigin: headers['access-control-allow-origin'] ?? null,
    retryAfter: headers['retry-after'] ?? null, responseBytes: Buffer.byteLength(rawBody), error,
  };
  requests.push(result);
  await writeFile(resolve(output, `${id}.body.txt`), rawBody);
  await writeFile(resolve(output, `${id}.headers.json`), JSON.stringify(headers, null, 2) + '\n');
  await saveSummary();
  transportFailures = error ? transportFailures + 1 : 0;
  if (result.status === 429) throw new Error('Rate limited; stopped without retrying');
  if (transportFailures >= 3) throw new Error('Three transport failures; stopped');
  await delay();
  return { ...result, body };
}

async function saveSummary() {
  await writeFile(resolve(output, 'summary.json'), JSON.stringify({
    startedAt, endedAt: stopReason ? new Date().toISOString() : null, stopReason,
    requestCount: requests.length, qualification: 'Application filters; a reported route remains standing data, not a confirmed flight plan.',
    samples, requests,
  }, null, 2) + '\n');
}

try {
  for (const city of cities) {
    let selected = [];
    for (const radiusNm of SEARCH_RADII_NM) {
      const result = await request(`${city.id}-${radiusNm}nm`, `https://api.adsb.lol/v2/point/${city.lat}/${city.lon}/${radiusNm}`);
      const candidates = result.status === 200
        ? aircraftCandidates(result.body, city, radiusNm, Date.parse(result.observedAt)) : [];
      const timestamp = observationTime(result.body);
      samples.push({
        city: city.id, radiusNm, status: result.status,
        total: Array.isArray(result.body?.ac) ? result.body.ac.length : null,
        eligible: result.status === 200 ? candidates.length : null,
        responseAgeSeconds: Number.isFinite(timestamp) ? (Date.parse(result.observedAt) - timestamp) / 1000 : null,
      });
      if (result.status === 200) selected = candidates.slice(0, routeRequestsPerCity);
    }
    for (const aircraft of selected) {
      const result = await request(`${city.id}-route-${aircraft.callsign}`, `https://api.adsb.lol/api/0/route/${aircraft.callsign}/${aircraft.lat}/${aircraft.lon}`);
      const route = result.status === 200 ? normalizeRoute(result.body, aircraft) : null;
      samples.push({
        city: city.id, callsign: aircraft.callsign, status: result.status,
        routeCodes: result.body?.airport_codes ?? null,
        airportCount: Array.isArray(result.body?._airports) ? result.body._airports.length : null,
        acceptedByApplication: !!route,
      });
    }
  }
  stopReason = 'Completed bounded sample';
} catch (error) {
  stopReason = error.message;
  process.exitCode = 1;
} finally {
  await saveSummary();
  console.log(`${stopReason}. Saved ${requests.length} requests in ${output}`);
}
