import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { aircraftCandidates, normalizeRoute } from '../../public/flights.js';
import { orderAircraftCandidates, selectionProfile } from '../../public/selection.js';
const sample = JSON.parse(await readFile(new URL('./live-capture/sample.json', import.meta.url), 'utf8'));
const output = new URL('./extended-routes/', import.meta.url);
await mkdir(output);
const all = aircraftCandidates(sample.payload, sample.place, 250, sample.recordedAt);
const previouslyQueried = new Set(Object.keys(sample.routes).concat('CXA871'));
let seed = 86513;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const chosen = [];
for (const [minimum, maximum, count] of [[0, 50, 6], [50, 100, 6], [100, 250, 12]]) {
  chosen.push(...orderAircraftCandidates(all.filter(a => !previouslyQueried.has(a.callsign)
    && a.distanceFromPlaceKm >= minimum * 1.852 && a.distanceFromPlaceKm < maximum * 1.852), random).slice(0, count));
}
const routes = { ...sample.routes }, outcomes = [...sample.outcomes], requests = [];
let transportFailures = 0, stopReason = 'Completed a bounded sample of at most24 additional callsign associations.';
try {
  for (const aircraft of chosen.slice(0, 24)) {
    const url = 'https://api.adsbdb.com/v0/callsign/' + aircraft.callsign;
    const at = new Date().toISOString();
    let raw;
    try {
      raw = execFileSync('curl', ['-sS', '--max-time', '12', '-w', '\n%{http_code}', url], { encoding: 'utf8', maxBuffer: 6000000 });
    } catch (error) {
      requests.push({ callsign: aircraft.callsign, url, at, status: 0, error: error.message });
      if (++transportFailures >= 3) { stopReason = 'Three transport failures; stopped.'; break; }
      continue;
    }
    transportFailures = 0;
    const split = raw.lastIndexOf('\n'), status = Number(raw.slice(split + 1)), body = raw.slice(0, split);
    requests.push({ callsign: aircraft.callsign, url, at, status });
    await writeFile(new URL(aircraft.callsign + '.json', output), body);
    await writeFile(new URL('requests.json', output), JSON.stringify(requests, null, 2) + '\n');
    if (status === 429) { stopReason = 'Rate limit; stopped without retrying.'; break; }
    let data;
    try { data = JSON.parse(body); } catch { continue; }
    if (status === 200) {
      routes[aircraft.callsign] = { provider: 'adsbdb', raw: data };
      const route = normalizeRoute(data, aircraft, 'adsbdb');
      const profile = route ? selectionProfile({ aircraft, route }, sample.place) : null;
      outcomes.push({ callsign: aircraft.callsign, status, usableRoute: !!route,
        destination: route?.destination.city, airport: route?.destination.code, profile });
    } else outcomes.push({ callsign: aircraft.callsign, status });
    await new Promise(resolve => setTimeout(resolve, 850));
  }
} catch (error) { stopReason = error.message; }
const result = { ...sample, routes, outcomes, extension: {
  capturedAt: new Date().toISOString(), requestCount: requests.length, stopReason,
  qualification: 'Additional explicit callsign database associations for the SAME original recorded aircraft snapshot. No new aircraft observations or refreshed timestamps.',
} };
await writeFile(new URL('./extended-sample.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ requestCount: requests.length, stopReason,
  outcomes: outcomes.slice(sample.outcomes.length).map(o => ({
    callsign: o.callsign, airport: o.airport, destination: o.destination,
    eligible: o.profile?.eligible, local: o.profile?.localDestination,
    km: o.profile && Math.round(o.profile.remainingKm), band: o.profile?.lengthBand,
  })) }));
