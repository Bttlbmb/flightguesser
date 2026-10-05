import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionProfile, selectionHistoryEntry, rememberSelection, scoreSelection, pickSelection, orderAircraftCandidates } from '../public/selection.js';
import { findNearbyRound } from '../public/api.js';
import { distanceKm } from '../public/geo.js';

const airport = (id, lat, lon, city = id, country = 'GB') => ({ id, code: id, name: id + ' Airport', city, country, lat, lon });
const place = { name: 'Test city', lat: 0, lon: 0, kind: 'city' };
const roundTo = (id = 'BBBB', lon = 10) => ({
  place, aircraft: { hex: 'abc123', callsign: 'ABC123', lat: 0, lon: 1, altitudeFt: 34000, speedKnots: 420, track: 90, verticalRateFpm: 0 },
  route: { origin: airport('AAAA', 0, 0), destination: airport(id, 0, lon), provider: 'adsb.lol' },
});
const candidate = round => ({ ...round, profile: selectionProfile(round) });
const json = data => new Response(JSON.stringify(data));
const observed = (callsign, lon = 5) => ({ hex: (0xabc000 + Number(callsign.slice(3))).toString(16), flight: callsign, lat: 0, lon, alt_baro: 34000, gs: 420, track: 90, seen: 1, seen_pos: 1, baro_rate: 0 });
const providerAirport = (id, lon) => ({ icao: id, iata: id.slice(1), name: id + ' Airport', location: id, countryiso2: 'GB', lat: 0, lon });
const providerRoute = aircraft => ({ callsign: aircraft.flight, plausible: true, _airports: [providerAirport('AAAA', 0), providerAirport('BBBB', 10)] });
const testPlace = { ...place, lon: 5 };

test('Seoul and device coordinates reject far-out Incheon arrivals as local answers', () => {
  const round = roundTo();
  round.place = { name: 'you', kind: 'device', lat: 37.5665, lon: 126.978 };
  round.route.origin = airport('RJTT', 35.552299, 139.779999, 'Tokyo', 'JP');
  round.route.destination = airport('RKSI', 37.469075, 126.450517, 'Incheon', 'KR');
  round.aircraft = { ...round.aircraft, lat: 37.6, lon: 130.5, track: 270 };
  const profile = selectionProfile(round);
  assert.ok(profile.airportRemainingKm > 250);
  assert.ok(profile.remainingKm > 250);
  assert.equal(profile.localDestination, true);
  assert.equal(profile.eligible, false);
  // Accepted-city geometry also excludes a local served city whose airport
  // happens to sit beyond the local-distance cutoff.
  const airportFarAway = { ...round, route: { ...round.route, destination: { ...round.route.destination, lon: 130 } } };
  assert.ok(distanceKm(round.place, airportFarAway.route.destination) > 150);
  assert.equal(selectionProfile(airportFarAway).localDestination, true);
});

test('regional outbound stays playable while low descending approach is rejected', () => {
  const round = roundTo('BBBB', 4);
  assert.ok(selectionProfile(round).remainingKm < 500);
  assert.equal(selectionProfile(round).eligible, true);
  round.aircraft.altitudeFt = 8000;
  round.aircraft.verticalRateFpm = -1200;
  assert.equal(selectionProfile(round).approaching, true);
  assert.equal(selectionProfile(round).eligible, false);
  round.aircraft.verticalRateFpm = 1200;
  assert.equal(selectionProfile(round).eligible, true);
});

test('selection quality follows displayed true heading, with valid zero and track fallback', () => {
  const round = roundTo();
  const profile = selectionProfile(round);
  round.aircraft.trueHeading = 270;
  assert.ok(scoreSelection(profile) > scoreSelection(selectionProfile(round)));
  round.aircraft.trueHeading = NaN;
  assert.equal(selectionProfile(round).headingError, profile.headingError);
  round.route.destination = airport('NORT', 10, 1);
  round.aircraft.trueHeading = 0;
  assert.equal(selectionProfile(round).headingError, 0);
});

test('recent answer aliases beat soft carrier/country/length preferences without becoming hard exclusions', () => {
  const repeated = candidate(roundTo('BBBB', 10));
  const novel = candidate(roundTo('CCCC', 11));
  const history = rememberSelection([], repeated);
  for (const random of [() => 0, () => 0.999]) {
    assert.equal(pickSelection([repeated, novel], { history, random }).candidate.route.destination.id, 'CCCC');
    assert.equal(pickSelection([repeated], { history, random }).candidate.route.destination.id, 'BBBB');
  }
  assert.equal(history[0].airline, 'ABC');
});

test('ten planes serving one city do not multiply that answer in the random draw', () => {
  const repeated = Array.from({ length: 10 }, (_, index) => {
    const round = roundTo('BBBB', 10);
    round.aircraft.callsign = 'ABC' + (100 + index);
    return candidate(round);
  });
  const another = candidate(roundTo('CCCC', 10));
  const selected = [0.2, 0.8].map(draw => pickSelection([...repeated, another], { random: () => draw }).candidate.route.destination.id);
  assert.deepEqual(selected, ['BBBB', 'CCCC']);
});

test('history holds the last ten answer summaries and no location or telemetry', () => {
  let history = [];
  for (let index = 0; index < 12; index++) history = rememberSelection(history, roundTo('BBBB', 10));
  assert.equal(history.length, 10);
  assert.deepEqual(Object.keys(selectionHistoryEntry(roundTo())).sort(),
    ['airline', 'country', 'destinationIds', 'lengthBand'].sort());
});

test('many descending carrier groups cannot bury a single carrier of outbound cruise flights', () => {
  const good = Array.from({ length: 6 }, (_, index) => ({ ...roundTo().aircraft, callsign: 'ABC' + index }));
  const bad = Array.from({ length: 30 }, (_, index) => ({
    ...roundTo().aircraft, callsign: String.fromCharCode(65 + index % 26) + 'ZZ' + index,
    altitudeFt: 6000, verticalRateFpm: -1200,
  }));
  const ordered = orderAircraftCandidates([...bad, ...good], () => 0.4);
  assert.ok(ordered.slice(0, 6).every(aircraft => aircraft.altitudeFt === 34000));
  assert.equal(new Set(ordered).size, 36);
});

test('candidate pool survives a later transport error while retaining the explicit answer', async () => {
  const aircraft = observed('ABC123');
  let nearbyRequests = 0;
  const round = await findNearbyRound(testPlace, { relay: true, random: () => 0, fetcher: async url => {
    if (url.startsWith('/api/nearby')) {
      if (++nearbyRequests === 2) throw new Error('Connection disappeared');
      return json({ now: Date.now(), ac: [aircraft] });
    }
    return json(providerRoute(aircraft));
  } });
  assert.equal(round.route.destination.id, 'BBBB');
  assert.equal(round.diagnostics.routeRequests, 1);
});

test('the overall deadline can select retained data, but caller cancellation cannot', async () => {
  const originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = ms => originalTimeout(ms === 25000 ? 20 : ms);
  const keepAlive = setTimeout(() => {}, 1000);
  const aircraft = observed('ABC123');
  try {
    let nearbyRequests = 0;
    const round = await findNearbyRound(testPlace, { relay: true, random: () => 0, fetcher: async (url, { signal }) => {
      if (url.startsWith('/api/nearby')) {
        if (++nearbyRequests === 2) return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
        return json({ now: Date.now(), ac: [aircraft] });
      }
      return json(providerRoute(aircraft));
    } });
    assert.equal(round.route.destination.id, 'BBBB');
    const caller = new AbortController();
    nearbyRequests = 0;
    await assert.rejects(findNearbyRound(testPlace, { relay: true, signal: caller.signal, fetcher: async url => {
      if (url.startsWith('/api/nearby')) {
        if (++nearbyRequests === 2) caller.abort();
        return json({ now: Date.now(), ac: [aircraft] });
      }
      return json(providerRoute(aircraft));
    } }), { name: 'AbortError' });
  } finally { AbortSignal.timeout = originalTimeout; clearTimeout(keepAlive); }
});

test('expired comparison never returns null or a stale retained observation', async () => {
  const originalNow = Date.now;
  let clock = originalNow();
  Date.now = () => clock;
  const aircraft = [observed('ABC123'), observed('ABC124', 5.1), observed('ABC125', 5.2)];
  let routes = 0;
  try {
    await assert.rejects(findNearbyRound(testPlace, { relay: true, random: () => 0, fetcher: async url => {
      if (url.startsWith('/api/nearby')) return json({ now: clock, ac: aircraft });
      if (++routes === 2) clock += 61000;
      return json(providerRoute(aircraft.find(a => url.includes(a.flight))));
    } }), error => error.code === 'no-flight');
  } finally { Date.now = originalNow; }
});

test('a clock jump between pool completion and final draw produces a typed error, never null', async () => {
  const originalNow = Date.now;
  let clock = originalNow(), ranked = 0;
  Date.now = () => clock;
  const aircraft = [123, 124, 125, 126].map(index => observed('ABC' + index));
  const history = [];
  history.slice = () => { if (++ranked === 10) clock += 61000; return []; };
  try {
    await assert.rejects(findNearbyRound(testPlace, { relay: true, random: () => 0, history, fetcher: async url => {
      if (url.startsWith('/api/nearby')) return json({ now: clock, ac: aircraft });
      const a = aircraft.find(value => url.includes(value.flight));
      const index = aircraft.indexOf(a);
      return json({ callsign: a.flight, plausible: true, _airports: [providerAirport('AAAA', 0), providerAirport(['BBBB', 'CCCC', 'DDDD', 'EEEE'][index], 10 + index)] });
    } }), error => error.code === 'no-flight');
  } finally { Date.now = originalNow; }
});

test('later provider rate limiting stops even when a candidate has already been retained', async () => {
  const aircraft = observed('ABC123');
  let nearbyRequests = 0;
  await assert.rejects(findNearbyRound(testPlace, { relay: true, fetcher: async url => {
    if (url.startsWith('/api/nearby')) {
      if (++nearbyRequests === 2) return new Response('{}', { status: 429, headers: { 'retry-after': '1' } });
      return json({ now: Date.now(), ac: [aircraft] });
    }
    return json(providerRoute(aircraft));
  } }), error => error.code === 'rate-limit');
});

