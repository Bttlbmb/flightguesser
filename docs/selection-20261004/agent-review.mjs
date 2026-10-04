import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { findNearbyRound } from '../../public/api.js';
import { bearingDegrees, distanceKm } from '../../public/geo.js';
import { rememberSelection } from '../../public/selection.js';
import { destinationRepeatIds } from '../../public/destinations.js';
const json = data => new Response(JSON.stringify(data));
const seoul = { lat: 37.5665, lon: 126.978, name: 'Seoul', kind: 'city' };
const airport = (icao, iata, location, lat, lon, countryiso2) => ({ icao, iata, name: location + ' Airport', location, lat, lon, countryiso2 });
const icn = airport('RKSI', 'ICN', 'Incheon', 37.4602, 126.4407, 'KR');
const destinations = [airport('RJTT', 'HND', 'Tokyo', 35.5523, 139.78, 'JP'), airport('RCTP', 'TPE', 'Taipei', 25.0777, 121.233, 'TW'), airport('VHHH', 'HKG', 'Hong Kong', 22.3089, 113.915, 'HK'), airport('WSSS', 'SIN', 'Singapore', 1.3502, 103.994, 'SG'), airport('RPLL', 'MNL', 'Manila', 14.5086, 121.02, 'PH'), airport('ZBAA', 'PEK', 'Beijing', 40.0801, 116.585, 'CN')];
const carriers = ['KAL', 'AAR', 'JJA', 'TWB', 'ANA', 'JAL', 'CES', 'CCA', 'CSN', 'CPA', 'SIA', 'THA', 'MAS', 'PAL', 'EVA', 'CAL', 'ALK', 'VJC', 'APJ', 'ESR', 'ASV', 'ABL', 'JNA', 'HVN', 'CHH', 'DKH', 'UZB', 'FIN', 'DLH', 'AFL'];
function rng(seed = 123456789) { return () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32); }
function hubFixture(run, crowded) {
 const aircraft = [], routes = new Map();
 for (let index = 0; index < (crowded ? 30 : 18); index++) {
  const value = { hex: (0xabc100 + index).toString(16), flight: (crowded ? carriers[index] : 'KAL') + (100 + index), lat: 37.5665 - index * .001, lon: 126.978 - index * .001, alt_baro: 6000, gs: 210, seen: 1, seen_pos: 2, baro_rate: -1200 };
  value.track = bearingDegrees(value, icn); aircraft.push(value);
  routes.set(value.flight, { callsign: value.flight, plausible: true, _airports: [destinations[0], icn] });
 }
 for (let index = 0; index < 6; index++) {
  const destination = destinations[(index + run) % 6];
  const value = { hex: (0xabd100 + index).toString(16), flight: 'ABC' + (200 + index), lat: 37.72 + index * .02, lon: 127.2 + index * .03, alt_baro: 34000, gs: 450, seen: 1, seen_pos: 2, baro_rate: 0 };
  value.track = bearingDegrees(value, destination); aircraft.push(value);
  routes.set(value.flight, { callsign: value.flight, plausible: true, _airports: [icn, destination] });
 }
 return { aircraft, routes };
}
async function repeatedHub(runs, crowded) {
 const random = rng(), rows = []; let history = [], last = new Set(), requests = 0;
 for (let run = 0; run < runs; run++) {
  const fixture = hubFixture(run, crowded);
  try {
   const round = await findNearbyRound(seoul, { relay: true, random, history, excludedDestinationIds: last, fetcher: async url => { requests++; return json(url.startsWith('/api/nearby') ? { now: Date.now(), ac: fixture.aircraft } : fixture.routes.get(url.split('/')[3])); } });
   rows.push({ destination: round.route.destination.code, country: round.route.destination.country, remainingKm: distanceKm(round.aircraft, round.route.destination), lengthBand: round.diagnostics.selection.lengthBand, routeRequests: round.diagnostics.routeRequests, distinctDestinations: round.diagnostics.distinctDestinations });
   history = rememberSelection(history, round); last = new Set(destinationRepeatIds(round.route.destination));
  } catch (error) { rows.push({ error: error.code || error.name }); }
 }
 const playable = rows.filter(row => row.destination);
 const counts = key => rows.reduce((result, row) => { const value = row[key] || row.error || 'unknown'; result[value] = (result[value] || 0) + 1; return result; }, {});
 const mean = key => playable.reduce((sum, row) => sum + row[key], 0) / playable.length;
 return { fixture: crowded ? '30 distinct arrival carriers, 6 cruise flights' : '18 same-carrier arrivals, 6 cruise flights', runs, successes: playable.length, counts: counts('destination'), lengthBands: counts('lengthBand'), immediateRepeats: rows.filter((row, index) => index && row.destination && row.destination === rows[index - 1].destination).length, localIncheon: playable.filter(row => row.destination === 'ICN').length, nearArrivals: playable.filter(row => row.remainingKm < 250).length, requests, meanRouteRequests: mean('routeRequests'), meanUniqueCandidates: mean('distinctDestinations'), maxRouteRequests: Math.max(...playable.map(row => row.routeRequests)), minRemainingKm: Math.min(...playable.map(row => row.remainingKm)), maxRemainingKm: Math.max(...playable.map(row => row.remainingKm)), sequence: rows.map(row => row.destination || row.error), rows };
}
const place = { lat: 0, lon: 5, name: 'Test city', kind: 'city' };
const ap = (id, lon) => airport(id, id.slice(1), id, 0, lon, 'GB');
const flight = (index = 0) => ({ hex: (0xabc100 + index).toString(16), flight: 'ABC' + (100 + index), lat: 0, lon: 5 + index * .01, alt_baro: 34000, gs: 450, track: 90, seen: 1, seen_pos: 2, baro_rate: 0 });
const reported = aircraft => ({ callsign: aircraft.flight, plausible: true, _airports: [ap('AAAA', 0), ap('BBBB', 10)] });
async function stressCases() {
 const results = [];
 {
  let count = 0; const aircraft = flight();
  const round = await findNearbyRound(place, { relay: true, random: () => 0, fetcher: async url => {
   if (url.startsWith('/api/nearby')) { if (++count === 2) throw new TypeError('connection disappeared'); return json({ now: Date.now(), ac: [aircraft] }); }
   return json(reported(aircraft));
  } });
  assert.equal(round.aircraft.callsign, aircraft.flight); results.push({ case: 'later nearby network failure retains fresh candidate', pass: true });
 }
 {
  let count = 0; const aircraft = flight(), controller = new AbortController();
  await assert.rejects(findNearbyRound(place, { relay: true, random: () => 0, signal: controller.signal, fetcher: async url => {
   if (url.startsWith('/api/nearby')) { if (++count === 2) controller.abort(); return json({ now: Date.now(), ac: [aircraft] }); }
   return json(reported(aircraft));
  } }), error => error.name === 'AbortError');
  results.push({ case: 'caller cancellation after retained candidate', pass: true });
 }
 {
  const original = AbortSignal.timeout, keepAlive = setTimeout(() => {}, 2000); AbortSignal.timeout = ms => original(ms === 25000 ? 20 : ms);
  let count = 0; const aircraft = flight();
  try {
   const round = await findNearbyRound(place, { relay: true, random: () => 0, fetcher: async (url, { signal }) => {
    if (url.startsWith('/api/nearby')) { if (++count === 2) return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); return json({ now: Date.now(), ac: [aircraft] }); }
    return json(reported(aircraft));
   } });
   assert.equal(round.aircraft.callsign, aircraft.flight); results.push({ case: 'internal overall deadline after retained candidate without caller signal', pass: true });
  } finally { AbortSignal.timeout = original; clearTimeout(keepAlive); }
 }
 {
  const original = Date.now; let clock = original(); Date.now = () => clock;
  const aircraft = [flight(0), flight(1), flight(2)]; let routeCount = 0;
  try {
   await assert.rejects(findNearbyRound(place, { relay: true, random: () => 0, fetcher: async url => {
    if (url.startsWith('/api/nearby')) return json({ now: clock, ac: aircraft });
    if (++routeCount === 1) return json(reported(aircraft[0])); clock += 61000;
    return json({ callsign: 'BAD', plausible: true, _airports: [ap('AAAA', 0), ap('BBBB', 10)] });
   } }), error => error.code === 'no-flight');
   results.push({ case: 'clock advance expires retained candidate during comparison', pass: true });
  } finally { Date.now = original; }
 }
 {
  const aircraft = { ...flight(), lat: 37.5665, lon: 131.5 }; aircraft.track = bearingDegrees(aircraft, icn);
  await assert.rejects(findNearbyRound(seoul, { relay: true, random: () => 0, fetcher: async url => json(url.startsWith('/api/nearby') ? { now: Date.now(), ac: [aircraft] } : { callsign: aircraft.flight, plausible: true, _airports: [destinations[0], icn] }) }), error => error.code === 'no-interesting-flight');
  results.push({ case: 'Seoul and Incheon accepted alias prevents far-out local inbound', pass: true });
 }
 {
  const aircraft = flight(); let count = 0;
  await assert.rejects(findNearbyRound(place, { relay: true, random: () => 0, fetcher: async url => {
   if (url.startsWith('/api/nearby')) { if (++count === 2) return new Response('{}', { status: 429, headers: { 'retry-after': '2' } }); return json({ now: Date.now(), ac: [aircraft] }); }
   return json(reported(aircraft));
  } }), error => error.code === 'rate-limit');
  let requests = 0;
  await assert.rejects(findNearbyRound(place, { fetcher: async () => { requests++; return json({ now: Date.now(), ac: [aircraft] }); } }), error => error.code === 'rate-limit');
  assert.equal(requests, 0); results.push({ case: 'late 429 rejects retained candidate and prevents subsequent requests', pass: true });
 }
 return results;
}
const result = {
 method: 'Independent selection review: fabricated observations, real current API and selection functions, seeded RNG, in-memory ten-round history plus immediate city exclusion; fixed aircraft pool intentionally reused. No provider calls and no game solve-rate or human enjoyment claim.',
 measuredPreChange: { runs: 36, incheon: 36, nearArrivals: 36, requests: 540, routeRequestsPerRun: 12 },
 asymmetricHub: await repeatedHub(36, false), distinctCarrierCrowding: await repeatedHub(72, true), stress: await stressCases(),
};
assert.equal(result.asymmetricHub.successes, 36); assert.equal(result.asymmetricHub.localIncheon, 0); assert.equal(result.asymmetricHub.nearArrivals, 0); assert.equal(result.asymmetricHub.immediateRepeats, 0);
assert.equal(result.distinctCarrierCrowding.successes, 72); assert.equal(result.distinctCarrierCrowding.localIncheon, 0); assert.equal(result.distinctCarrierCrowding.nearArrivals, 0); assert.equal(result.distinctCarrierCrowding.immediateRepeats, 0);
if (process.argv.includes('--save')) await writeFile(new URL('./agent-review-results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, asymmetricHub: { ...result.asymmetricHub, rows: undefined }, distinctCarrierCrowding: { ...result.distinctCarrierCrowding, rows: undefined } }, null, 2));
