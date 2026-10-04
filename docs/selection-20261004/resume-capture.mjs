import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { aircraftCandidates, observationTime, normalizeRoute } from '../../public/flights.js';
import { orderAircraftCandidates, selectionProfile } from '../../public/selection.js';
const output = new URL('./live-capture/', import.meta.url);
const payload = JSON.parse(await readFile(new URL('nearby.json', output), 'utf8'));
const requests = JSON.parse(await readFile(new URL('requests.json', output), 'utf8'));
const place = { name: 'Seoul', kind: 'city', lat: 37.5665, lon: 126.978 };
const recordedAt = observationTime(payload);
const all = aircraftCandidates(payload, place, 250, recordedAt);
let seed = 486;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const chosen = [];
const failedCallsign = requests.find(r => r.id.startsWith('route-'))?.id.slice(6);
if (failedCallsign) chosen.push(all.find(a => a.callsign === failedCallsign));
for (const [radius, count] of [[50, 3], [100, 3], [250, 3]]) {
  chosen.push(...orderAircraftCandidates(all.filter(a => a.distanceFromPlaceKm <= radius * 1.852
    && !chosen.some(old => old?.hex === a.hex)), random).slice(0, count));
}
const routes = {}, outcomes = [];
let stopReason = 'Completed the original twelve-request budget, including the initial unsaved point probe.';
try {
  for (const aircraft of chosen.filter(Boolean)) {
    if (requests.length + 1 >= 12) break;
    const id = 'db-' + aircraft.callsign;
    const url = 'https://api.adsbdb.com/v0/callsign/' + aircraft.callsign;
    const at = new Date().toISOString();
    const raw = execFileSync('curl', ['-sS', '--max-time', '15', '-w', '\n%{http_code}', url], { encoding: 'utf8', maxBuffer: 6000000 });
    const split = raw.lastIndexOf('\n'), status = Number(raw.slice(split + 1)), body = raw.slice(0, split);
    requests.push({ id, url, at, status });
    await writeFile(new URL(id + '.json', output), body);
    await writeFile(new URL('requests.json', output), JSON.stringify(requests, null, 2) + '\n');
    if (status === 429) { stopReason = 'Provider rate limit; stopped without retrying.'; break; }
    let data = null;
    try { data = JSON.parse(body); } catch { /* Preserve raw evidence. */ }
    if (status === 200 && data) {
      routes[aircraft.callsign] = { provider: 'adsbdb', raw: data };
      const route = normalizeRoute(data, aircraft, 'adsbdb');
      const profile = route ? selectionProfile({ aircraft, route }, place) : null;
      outcomes.push({ callsign: aircraft.callsign, status, usableRoute: !!route,
        destination: route?.destination.city, airport: route?.destination.code, profile });
    } else outcomes.push({ callsign: aircraft.callsign, status });
    await new Promise(resolve => setTimeout(resolve, 850));
  }
} catch (error) { stopReason = error.message; }
await writeFile(new URL('sample.json', output), JSON.stringify({
  capturedAt: new Date().toISOString(), place, recordedAt, eligibleObservations: all.length,
  sampled: chosen.filter(Boolean).map(a => ({ callsign: a.callsign, hex: a.hex, distanceFromPlaceKm: a.distanceFromPlaceKm })),
  qualification: 'A single captured real sky snapshot. Route associations were fetched afterward; replay runs use the original clock and are not new live observations.',
  transport: 'adsb.lol route lookup returned HTTP500. Captured explicit adsbdb fallback associations; no destinations inferred.',
  requestCountIncludingUnsavedProbe: requests.length + 1, stopReason, payload, routes, outcomes,
}, null, 2) + '\n');
console.log(JSON.stringify({ requestsIncludingProbe: requests.length + 1, stopReason, outcomes }));
