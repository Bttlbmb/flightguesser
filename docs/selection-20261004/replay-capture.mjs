import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { findNearbyRound, DataError } from '../../public/api.js';
import { aircraftCandidates, normalizeRoute, SEARCH_RADII_NM, MAX_ROUTE_LOOKUPS } from '../../public/flights.js';
import { selectionProfile, rememberSelection } from '../../public/selection.js';
import { destinationCities, destinationRepeatIds } from '../../public/destinations.js';
import { distanceKm } from '../../public/geo.js';

const extended = process.argv.includes('--extended');
const sample = JSON.parse(await readFile(new URL(extended ? './extended-sample.json' : './live-capture/sample.json', import.meta.url), 'utf8'));
const known = new Set(Object.keys(sample.routes));
const rawAircraft = sample.payload.ac.filter(a => known.has(a.flight?.trim()));
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const originalNow = Date.now;
Date.now = () => sample.recordedAt;
function seeded(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
const fetcher = async url => {
  if (url.startsWith('/api/nearby')) return json({ ...sample.payload, ac: rawAircraft });
  // The recorded primary lookup failed. This replay deliberately models that
  // outage for every lookup and supplies only explicitly captured fallback data.
  if (url.startsWith('/api/route')) return json({}, 500);
  const route = sample.routes[url.split('/').at(-1)];
  return route ? json(route.raw) : json({}, 404);
};
async function baseline(place, { excluded = new Set(), excludedDestinationIds = new Set() } = {}) {
  const checked = new Set(), shorter = [];
  let routeRequests = 0;
  const selected = candidate => ({ mode: 'live', ...candidate, place, diagnostics: { routeRequests } });
  for (const radiusNm of SEARCH_RADII_NM) {
    const candidates = aircraftCandidates({ ...sample.payload, ac: rawAircraft }, place, radiusNm)
      .filter(a => !checked.has(a.hex) && !excluded.has(a.hex));
    const allowance = radiusNm === 250 ? MAX_ROUTE_LOOKUPS - routeRequests : Math.min(4, MAX_ROUTE_LOOKUPS - routeRequests);
    const start = routeRequests;
    for (const aircraft of candidates) {
      if (routeRequests - start >= allowance || routeRequests >= MAX_ROUTE_LOOKUPS) break;
      checked.add(aircraft.hex);
      routeRequests++; // failed primary request
      if (routeRequests - start >= allowance || routeRequests >= MAX_ROUTE_LOOKUPS) continue;
      routeRequests++;
      const captured = sample.routes[aircraft.callsign];
      const route = captured && normalizeRoute(captured.raw, aircraft, captured.provider);
      if (!route) continue;
      const destination = destinationCities(route.destination);
      if (destinationRepeatIds(route.destination, destination).some(id => excludedDestinationIds.has(id))) continue;
      const candidate = { aircraft, route, searchRadiusNm: radiusNm };
      const remainingKm = distanceKm(aircraft, destination.primary);
      if (remainingKm >= 250) return selected(candidate);
      shorter.push({ candidate, remainingKm });
    }
    if (routeRequests >= MAX_ROUTE_LOOKUPS) break;
  }
  if (shorter.length) return selected(shorter.sort((a, b) => b.remainingKm - a.remainingKm)[0].candidate);
  throw new DataError('no-flight', 'No match in recorded subset.');
}
function row(round, label, run, seed) {
  const profile = selectionProfile(round);
  return { label, run, seed, callsign: round.aircraft.callsign, destination: destinationCities(round.route.destination).primary.name,
    airport: round.route.destination.code, country: profile.country, remainingKm: profile.remainingKm,
    airportRemainingKm: profile.airportRemainingKm, headingError: profile.headingError,
    localDestination: profile.localDestination, approaching: profile.approaching,
    routeRequests: round.diagnostics.routeRequests, distinctCompared: round.diagnostics.distinctDestinations || 1 };
}
const rows = [];
try {
  for (const [label, select] of [['baseline-fresh', baseline], ['new-fresh', findNearbyRound]]) {
    for (let run = 0; run < 60; run++) {
      try {
        rows.push(row(await select(sample.place, { relay: true, fetcher, random: seeded(700 + run) }), label, run, 700 + run));
      } catch (error) { rows.push({ label, run, seed: 700 + run, error: error.code || error.name }); }
    }
  }
  for (const [label, select] of [['baseline-session', baseline], ['new-session', findNearbyRound]]) {
    for (let session = 0; session < 20; session++) {
      let history = [], excludedDestinationIds = new Set();
      const excluded = new Set(), random = seeded(900 + session);
      for (let run = 0; run < 3; run++) {
        let round;
        try { round = await select(sample.place, { relay: true, fetcher, random, history, excluded, excludedDestinationIds }); }
        catch (error) { rows.push({ label, run: session * 3 + run, seed: 900 + session, error: error.code || error.name }); continue; }
        rows.push(row(round, label, session * 3 + run, 900 + session));
        history = rememberSelection(history, round);
        excluded.add(round.aircraft.hex);
        excludedDestinationIds = new Set(destinationRepeatIds(round.route.destination));
      }
    }
  }
} finally { Date.now = originalNow; }
const summaries = {};
for (const label of [...new Set(rows.map(r => r.label))]) {
  const attempted = rows.filter(r => r.label === label);
  const selected = attempted.filter(r => !r.error), counts = {};
  for (const r of selected) counts[r.destination] = (counts[r.destination] || 0) + 1;
  summaries[label] = {
    attempts: attempted.length, selections: selected.length, failures: attempted.filter(r => r.error), destinationCounts: counts,
    countries: [...new Set(selected.map(r => r.country))],
    localDestinations: selected.filter(r => r.localDestination).length,
    nearArrivals: selected.filter(r => r.airportRemainingKm < 250 || r.remainingKm < 250 || r.approaching).length,
    remainingRangeKm: [Math.min(...selected.map(r => r.remainingKm)), Math.max(...selected.map(r => r.remainingKm))],
    meanRouteRequests: selected.reduce((sum, r) => sum + r.routeRequests, 0) / selected.length,
    maxRouteRequests: Math.max(...selected.map(r => r.routeRequests)),
    headingWithin30Degrees: selected.filter(r => r.headingError <= 30).length,
  };
}
for (const r of rows.filter(r => r.label.startsWith('new') && !r.error)) {
  assert.equal(r.localDestination, false);
  assert.equal(r.approaching, false);
  assert.ok(r.remainingKm >= 250 && r.airportRemainingKm >= 250);
  assert.ok(r.routeRequests <= 12);
}
assert.ok(Object.keys(summaries['new-session'].destinationCounts).length >= 3);
await writeFile(new URL(extended ? './extended-replay-results.json' : './capture-replay-results.json', import.meta.url), JSON.stringify({
  evidence: '120 baseline and 120 new selections from explicitly captured real route associations around Seoul at a single instant. Replays use the original observation clock, not refreshed live timestamps.',
  limitations: 'Known-route subset only; primary outage replay is simulated using the observed HTTP500. Sixty fresh-seed selections and twenty three-round sessions per algorithm. One recorded moment and a sampled route subset; no worldwide or longitudinal coverage claim.',
  recordedAt: sample.recordedAt, capturedCallsigns: [...known], summaries, rows,
}, null, 2) + '\n');
console.log(JSON.stringify(summaries, null, 2));
