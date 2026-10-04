import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { aircraftCandidates, observationTime } from '../../public/flights.js';
import { orderAircraftCandidates } from '../../public/selection.js';

const output = new URL('./live-capture/', import.meta.url);
await mkdir(output);
const place = { name: 'Seoul', kind: 'city', lat: 37.5665, lon: 126.978 };
const requests = [];
const request = async (id, url) => {
  const at = new Date().toISOString();
  const raw = execFileSync('curl', ['-sS', '--max-time', '15', '-A',
    'Flightguesser-local-MVP/0.1 (local-only technical spike)', '-w', '\n%{http_code}', url], { encoding: 'utf8', maxBuffer: 6000000 });
  const split = raw.lastIndexOf('\n');
  const status = Number(raw.slice(split + 1));
  const body = raw.slice(0, split);
  requests.push({ id, url, at, status });
  await writeFile(new URL(id + '.json', output), body);
  await writeFile(new URL('requests.json', output), JSON.stringify(requests, null, 2) + '\n');
  if (status === 429) throw new Error('Provider rate limit: stopped with no retry.');
  if (status !== 200) throw new Error('Provider HTTP ' + status + ': stopped.');
  await new Promise(resolve => setTimeout(resolve, 850));
  return JSON.parse(body);
};
const payload = await request('nearby', 'https://api.adsb.lol/v2/point/37.57/126.98/250');
const clock = observationTime(payload);
let seed = 486;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const all = aircraftCandidates(payload, place, 250, clock);
const chosen = [];
for (const [radius, count] of [[50, 4], [100, 4], [250, 2]]) {
  chosen.push(...orderAircraftCandidates(all.filter(a => a.distanceFromPlaceKm <= radius * 1.852
    && !chosen.some(old => old.hex === a.hex)), random).slice(0, count));
}
const routes = {};
for (const aircraft of chosen.slice(0, 10)) {
  routes[aircraft.callsign] = await request('route-' + aircraft.callsign,
    `https://api.adsb.lol/api/0/route/${aircraft.callsign}/${aircraft.lat}/${aircraft.lon}`);
}
await writeFile(new URL('sample.json', output), JSON.stringify({
  capturedAt: new Date().toISOString(), place, recordedAt: clock, eligibleObservations: all.length,
  sampled: chosen.map(a => ({ callsign: a.callsign, hex: a.hex, distanceFromPlaceKm: a.distanceFromPlaceKm })),
  qualification: 'One real captured sky snapshot. Replay selection runs are recorded simulations, not new live observations.',
  payload, routes,
}, null, 2) + '\n');
console.log(JSON.stringify({ output: output.pathname, requests: requests.length, eligibleObservations: all.length,
  sampled: chosen.map(a => a.callsign) }));
