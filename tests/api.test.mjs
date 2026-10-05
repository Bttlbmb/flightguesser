import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJson, findNearbyRound, enrichRouteAirline, runtimeConfig } from '../public/api.js';
import { destinationCities, destinationRepeatIds } from '../public/destinations.js';
import { distanceKm } from '../public/geo.js';

const place = { lat: 0, lon: 5, name: 'Test city', kind: 'city' };
const airport = (icao, lon) => ({ icao, iata: icao.slice(1), name: `${icao} Airport`, location: icao, countryiso2: 'GB', lat: 0, lon });
function payload() {
  return { now: Date.now(), ac: [{ hex: 'abc123', flight: 'ABC123', lat: 0, lon: 5, alt_baro: 34000, gs: 420, track: 90, seen: 1, seen_pos: 2, baro_rate: 0 }] };
}
const route = { callsign: 'ABC123', plausible: true, _airports: [airport('AAAA', 0), airport('BBBB', 10)] };
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
const flight = (index, properties = {}) => ({ ...payload().ac[0], hex: (0xabc100 + index).toString(16), flight: `ABC${100 + index}`, ...properties });
const nearby = aircraft => ({ now: Date.now(), ac: aircraft });
const reported = (aircraft, destination, origin = airport('AAAA', 0)) => ({ callsign: aircraft.flight, plausible: true, _airports: [origin, destination] });

test('optional airline lookup resolves an exact reported code once and preserves the route', async () => {
  const original = { callsign: 'TST123', airlineCode: 'TST', origin: 'original', destination: 'unchanged' };
  const urls = [];
  const fetcher = async url => { urls.push(url); return json({ response: [{ name: 'Test Air', icao: 'TST' }] }); };
  const enriched = await enrichRouteAirline(original, { fetcher });
  assert.equal(enriched.airline.name, 'Test Air');
  assert.equal(enriched.destination, original.destination);
  assert.equal(original.airline, undefined);
  assert.equal((await enrichRouteAirline(original, { fetcher })).airline.name, 'Test Air');
  assert.deepEqual(urls, ['https://api.adsbdb.com/v0/airline/TST']);
  assert.equal(await enrichRouteAirline(enriched, { fetcher }), enriched);
  assert.equal(await enrichRouteAirline({ callsign: 'ABC123' }, { fetcher }).then(route=>route.airline), undefined);
  assert.equal(urls.length, 1);
});

test('failed, ambiguous, mismatched or slow optional airline metadata does not block a playable route', async () => {
  const original = { callsign: 'OPT123', airlineCode: 'OPT' };
  for (const fetcher of [
    async()=>json({},404), async()=>{throw new Error('Unavailable');}, async()=>new Response('bad JSON'),
    async()=>json({ response: [{ name: 'Wrong airline', icao: 'XYZ' }] }),
    async()=>json({ response: [{ name: 'One', icao: 'OPT' }, { name: 'Two', icao: 'OPT' }] }),
    (_url,{signal})=>new Promise((_resolve,reject)=>{const keepAlive=setTimeout(()=>reject(new Error('Test timeout')),1000); signal.addEventListener('abort',()=>{clearTimeout(keepAlive); reject(signal.reason);},{once:true});}),
  ]) assert.equal(await enrichRouteAirline(original, { fetcher, timeoutMs: 5 }), original);
});

test('cancellation during optional airline enrichment cannot open a later round', async () => {
  const controller = new AbortController();
  const original = { callsign: 'CAN123', airlineCode: 'CAN' };
  await assert.rejects(enrichRouteAirline(original, { signal:controller.signal, fetcher:async()=>{
    controller.abort(); return json({ response: [{ name: 'Cancelled airline', icao: 'CAN' }] });
  } }), { name:'AbortError' });
});

test('nearby search keeps the explicit route while comparing the bounded pool', async () => {
  const urls = [];
  const round = await findNearbyRound(place, { relay: true, fetcher: async url => {
    urls.push(url);
    return json(url.startsWith('/api/nearby') ? payload() : route);
  } });
  assert.equal(round.mode, 'live');
  assert.equal(round.route.confidence, 'reported');
  assert.equal(round.route.destination.id, 'BBBB');
  assert.equal(urls.length, 4);
  assert.equal(round.diagnostics.routeRequests, 1);
});

test('a route failure never silently becomes a recorded or inferred destination', async () => {
  await assert.rejects(findNearbyRound(place, { relay: true, fetcher: async url => json(url.startsWith('/api/nearby') ? payload() : {}, url.startsWith('/api/nearby') ? 200 : 503) }), error => error.code === 'route-unavailable');
});

test('ambiguous routes and empty coverage produce no playable round', async () => {
  await assert.rejects(findNearbyRound(place, { relay: true, fetcher: async url => json(url.startsWith('/api/nearby') ? payload() : { ...route, _airports: [...route._airports, airport('CCCC', 15)] }) }), error => error.code === 'no-flight');
  const requests = [];
  await assert.rejects(findNearbyRound(place, { relay: true, fetcher: async url => { requests.push(url); return json({ now: Date.now(), ac: [] }); } }), error => error.code === 'no-flight');
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map(url => Number(url.split('/').at(-1))), [50, 100, 250]);
});

test('an unavailable preferred route can use an explicit adsbdb fallback with source retained', async () => {
  const dbAirport = (icao, lon) => ({ icao_code: icao, iata_code: icao.slice(1), name: `${icao} Airport`, municipality: icao, country_iso_name: 'GB', latitude: 0, longitude: lon });
  const dbRoute = { response: { flightroute: { callsign_icao: 'ABC123', origin: dbAirport('AAAA', 0), destination: dbAirport('BBBB', 10) } } };
  const urls = [];
  const round = await findNearbyRound(place, { relay: true, fetcher: async url => {
    urls.push(url);
    if (url.startsWith('/api/nearby')) return json(payload());
    if (url.startsWith('/api/route')) return json({}, 500);
    return json(dbRoute);
  } });
  assert.equal(round.route.provider, 'adsbdb');
  assert.equal(round.route.confidence, 'reported');
  assert.equal(urls.length, 5);
});

test('a contradictory explicit route cannot be overridden by a fallback', async () => {
  let fallbackCalls = 0;
  await assert.rejects(findNearbyRound(place, { relay: true, fetcher: async url => {
    if (url.startsWith('/api/nearby')) return json(payload());
    if (url.includes('adsbdb')) fallbackCalls++;
    return json({ ...route, _airports: [...route._airports, airport('CCCC', 15)] });
  } }), error => error.code === 'no-flight');
  assert.equal(fallbackCalls, 0);
});

test('combined preferred and fallback lookups stay within twelve route requests', async () => {
  let routes = 0;
  let nearby = 0;
  await assert.rejects(findNearbyRound(place, { relay: true, fetcher: async url => {
    if (url.startsWith('/api/nearby')) {
      nearby++;
      const sample = payload();
      sample.ac = Array.from({ length: 20 }, (_, index) => ({ ...sample.ac[0], hex: (0xabc100 + index).toString(16), flight: `ABC${100 + index}` }));
      return json(sample);
    }
    routes++;
    return json({ callsign: 'unknown', _airports: [] });
  } }), error => error.code === 'no-flight');
  assert.equal(routes, 12);
  assert.equal(nearby, 3);
});

test('short-distance arrivals are passed over for a farther destination while comparing usable destinations', async () => {
  const aircraft = [flight(0), flight(1, { lon: 5.05 }), flight(2, { lon: 5.1 })];
  const routes = new Map([
    [aircraft[0].flight, reported(aircraft[0], airport('NEAR', 5.2))],
    [aircraft[1].flight, reported(aircraft[1], airport('FARR', 10))],
    [aircraft[2].flight, reported(aircraft[2], airport('LAST', 15))],
  ]);
  const urls = [];
  const round = await findNearbyRound(place, { relay: true, random: () => 0, fetcher: async url => {
    urls.push(url);
    return json(url.startsWith('/api/nearby') ? nearby(aircraft) : routes.get(url.split('/')[3]));
  } });
  assert.equal(round.route.destination.id, 'FARR');
  assert.ok(distanceKm(round.aircraft, destinationCities(round.route.destination).primary) >= 250);
  assert.equal(round.diagnostics.routeRequests, 3);
  assert.equal(urls.length, 6);
});

test('a preferred flight at a wider radius is selected after excluding the near arrival', async () => {
  const close = flight(0);
  const farther = flight(1, { lon: 6.2 });
  const urls = [];
  const round = await findNearbyRound(place, { relay: true, fetcher: async url => {
    urls.push(url);
    if (url.startsWith('/api/nearby')) return json(nearby(url.endsWith('/50') ? [close] : [close, farther]));
    return json(url.includes(close.flight) ? reported(close, airport('NEAR', 5.2)) : reported(farther, airport('FARR', 10)));
  } });
  assert.equal(round.aircraft.callsign, farther.flight);
  assert.equal(round.searchRadiusNm, 100);
  assert.equal(round.diagnostics.routeRequests, 2);
  assert.equal(urls.filter(url => url.startsWith('/api/nearby')).length, 3);
});

test('only short-distance arrivals produce recovery instead of a trivial fallback', async () => {
  const aircraft = [flight(0), flight(1, { lon: 5.05 })];
  const urls = [];
  await assert.rejects(findNearbyRound(place, { relay: true, fetcher: async url => {
    urls.push(url);
    if (url.startsWith('/api/nearby')) return json(nearby(aircraft));
    return json(url.includes(aircraft[0].flight) ? reported(aircraft[0], airport('NEAR', 5.2)) : reported(aircraft[1], airport('BEST', 7)));
  } }), error => error.code === 'no-interesting-flight');
  assert.equal(urls.filter(url => url.startsWith('/api/route')).length, 2);
  assert.equal(urls.filter(url => url.startsWith('/api/nearby')).length, 3);
});

test('a near-airport arrival cannot pass via a more distant main city point', async () => {
  const tokyoPlace = { lat: 35.6762, lon: 142.45, name: 'East of Tokyo', kind: 'city' };
  const aircraft = flight(0, { ...tokyoPlace, track: 270 });
  const haneda = { ...airport('RJTT', 139.779999), lat: 35.552299, location: 'Tokyo', countryiso2: 'JP' };
  const origin = { ...airport('ORIG', 145.5), lat: tokyoPlace.lat, countryiso2: 'JP' };
  let requests = 0;
  await assert.rejects(findNearbyRound(tokyoPlace, { relay: true, fetcher: async url => {
    requests++;
    return json(url.startsWith('/api/nearby') ? nearby([aircraft]) : reported(aircraft, haneda, origin));
  } }), error => error.code === 'no-interesting-flight');
  assert.equal(requests, 4);
});

test('different airports serving the previous destination city are skipped in either direction', async () => {
  const japanPlace = { lat: 35.5, lon: 135, name: 'Japan', kind: 'city' };
  const japanAirport = (icao, lat, lon, location) => ({ ...airport(icao, lon), lat, location, countryiso2: 'JP' });
  const endpoints = {
    RJTT: japanAirport('RJTT', 35.552299, 139.779999, 'Tokyo'),
    RJAA: japanAirport('RJAA', 35.76858, 140.388714, 'Narita'),
    RJSN: japanAirport('RJSN', 37.954166, 139.112189, 'Niigata'),
  };
  const origin = japanAirport('ORIG', 35.5, 130, 'Origin city');
  for (const [previous, repeated] of [['RJTT', 'RJAA'], ['RJAA', 'RJTT']]) {
    const previousAirport = { ...endpoints[previous], id: previous, city: endpoints[previous].location, country: 'JP' };
    const excludedDestinationIds = new Set(destinationCities(previousAirport).accepted.map(city => city.id));
    const aircraft = [flight(0, japanPlace), flight(1, { ...japanPlace, lon: 135.05 })];
    const round = await findNearbyRound(japanPlace, { relay: true, excludedDestinationIds, fetcher: async url => {
      if (url.startsWith('/api/nearby')) return json(nearby(aircraft));
      return json(url.includes(aircraft[0].flight) ? reported(aircraft[0], endpoints[repeated], origin) : reported(aircraft[1], endpoints.RJSN, origin));
    } });
    assert.equal(round.route.destination.id, 'RJSN');
    assert.equal(round.diagnostics.routeRequests, 2);
    assert.equal(destinationCities(round.route.destination).accepted.some(city => excludedDestinationIds.has(city.id)), false);
  }
});

test('a repeated city is never used as the fallback when no different destination is usable', async () => {
  const excludedDestinationIds = new Set(['airport:GB:BBBB']);
  const urls = [];
  await assert.rejects(findNearbyRound(place, { relay: true, excludedDestinationIds, fetcher: async url => {
    urls.push(url);
    return json(url.startsWith('/api/nearby') ? payload() : route);
  } }), error => error.code === 'no-new-destination');
  assert.equal(urls.length, 4);
  assert.equal(urls.filter(url => url.startsWith('/api/route')).length, 1);
});

test('fallback municipalities do not repeat through a different airport', async () => {
  const previous = { id: 'PREV', code: 'PRV', name: 'Previous airport', city: 'Same Town', country: 'GB', lat: 0, lon: 10 };
  const repeated = { ...airport('NEXT', 10), location: ' SAME town ' };
  const aircraft = [flight(0), flight(1, { lon: 5.05 })];
  const excludedDestinationIds = new Set(destinationRepeatIds(previous));
  const round = await findNearbyRound(place, { relay: true, excludedDestinationIds, fetcher: async url => {
    if (url.startsWith('/api/nearby')) return json(nearby(aircraft));
    return json(url.includes(aircraft[0].flight) ? reported(aircraft[0], repeated) : reported(aircraft[1], airport('DIFF', 10)));
  } });
  assert.equal(round.route.destination.id, 'DIFF');
  assert.equal(round.diagnostics.routeRequests, 2);
});

test('indexed municipality recovery keeps a usable uncurated route selectable without changing its raw endpoint', async () => {
  const unresolved = { ...airport('BBBB', 10), location: 'BBBB Airport' };
  const resolveDestination = endpoint => ({ ...endpoint, city: 'Recovered town' });
  const round = await findNearbyRound(place, { relay: true, resolveDestination, fetcher: async url => {
    return json(url.startsWith('/api/nearby') ? payload() : { ...route, _airports: [route._airports[0], unresolved] });
  } });
  assert.equal(round.route.destination.id, 'BBBB');
  assert.equal(round.route.destination.city, unresolved.location);
  assert.equal(round.route.destination.lat, unresolved.lat);
  assert.equal(round.route.destination.lon, unresolved.lon);
  assert.equal(destinationCities(resolveDestination(round.route.destination)).primary.name, 'Recovered town');
});

test('repeat checks use recovered municipality data and a failed resolver only skips its candidate', async () => {
  const previous = { id: 'PREV', code: 'PRV', name: 'Previous airport', city: 'Recovered town', country: 'GB', lat: 0, lon: 10 };
  const aircraft = [flight(0), flight(1, { lon: 5.05 }), flight(2, { lon: 5.1 })];
  const unresolved = { ...airport('NEXT', 10), location: 'NEXT Airport' };
  const endpoint = [unresolved, airport('FAIL', 10), airport('DIFF', 10)];
  const round = await findNearbyRound(place, {
    relay: true, excludedDestinationIds: new Set(destinationRepeatIds(previous)),
    resolveDestination: airport => {
      if (airport.id === 'FAIL') throw new Error('Unavailable municipality');
      return airport.id === 'NEXT' ? { ...airport, city: 'Recovered town' } : airport;
    },
    fetcher: async url => {
      if (url.startsWith('/api/nearby')) return json(nearby(aircraft));
      const index = aircraft.findIndex(candidate => candidate.flight === url.split('/')[3]);
      return json(reported(aircraft[index], endpoint[index]));
    },
  });
  assert.equal(round.route.destination.id, 'DIFF');
  assert.equal(round.diagnostics.routeRequests, 3);
});

test('destination exclusions also apply to an explicit alternate-provider route', async () => {
  const dbAirport = (icao, lon) => ({ icao_code: icao, iata_code: icao.slice(1), name: `${icao} Airport`, municipality: icao, country_iso_name: 'GB', latitude: 0, longitude: lon });
  const dbRoute = { response: { flightroute: { callsign_icao: 'ABC123', origin: dbAirport('AAAA', 0), destination: dbAirport('BBBB', 10) } } };
  await assert.rejects(findNearbyRound(place, { relay: true, excludedDestinationIds: new Set(['airport:GB:BBBB']), fetcher: async url => {
    if (url.startsWith('/api/nearby')) return json(payload());
    return url.startsWith('/api/route') ? json({}, 500) : json(dbRoute);
  } }), error => error.code === 'no-new-destination');
});

test('searching past repeated destinations still obeys the twelve-route-request limit', async () => {
  const aircraft = Array.from({ length: 20 }, (_, index) => flight(index));
  let routeRequests = 0;
  await assert.rejects(findNearbyRound(place, { relay: true, excludedDestinationIds: new Set(['airport:GB:BBBB']), fetcher: async url => {
    if (url.startsWith('/api/nearby')) return json(nearby(aircraft));
    routeRequests++;
    const candidate = aircraft.find(value => value.flight === url.split('/')[3]);
    return json(reported(candidate, airport('BBBB', 10)));
  } }), error => error.code === 'no-new-destination');
  assert.equal(routeRequests, 12);
});

test('a retained en-route candidate must still be fresh when the search ends', async () => {
  const originalNow = Date.now;
  let clock = originalNow();
  let nearbyRequests = 0;
  const aircraft = flight(0);
  Date.now = () => clock;
  try {
    await assert.rejects(findNearbyRound(place, { relay: true, fetcher: async url => {
      if (url.startsWith('/api/nearby')) {
        nearbyRequests++;
        if (nearbyRequests === 3) clock += 61000;
        return json(nearby(nearbyRequests === 1 ? [aircraft] : []));
      }
      return json(reported(aircraft, airport('FARR', 10)));
    } }), error => error.code === 'no-flight');
  } finally { Date.now = originalNow; }
});

test('cancelling the comparison does not return a retained en-route candidate', async () => {
  const controller = new AbortController();
  const aircraft = flight(0);
  let nearbyRequests = 0;
  await assert.rejects(findNearbyRound(place, { relay: true, signal: controller.signal, fetcher: async url => {
    if (url.startsWith('/api/nearby')) {
      nearbyRequests++;
      if (nearbyRequests === 2) controller.abort();
      return json(nearby([aircraft]));
    }
    return json(reported(aircraft, airport('FARR', 10)));
  } }), error => error.name === 'AbortError');
  assert.equal(nearbyRequests, 2);
});

test('invalid places and pre-cancelled searches send no provider requests', async () => {
  let requests = 0;
  const fetcher = async () => { requests++; return json(payload()); };
  await assert.rejects(findNearbyRound({ ...place, lat: null }, { fetcher }), error => error.code === 'invalid-place');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(findNearbyRound(place, { fetcher, signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(requests, 0);
});

test('cancellation after a route body resolves cannot return a playable flight', async () => {
  const controller = new AbortController();
  await assert.rejects(findNearbyRound(place, { relay: true, signal: controller.signal, fetcher: async url => {
    if (url.startsWith('/api/nearby')) return json(payload());
    return { status: 200, ok: true, json: async () => { controller.abort(); return route; } };
  } }), error => error.name === 'AbortError');
});

test('relay configuration is optional and bounded on hosted and local origins', async () => {
  let requests = 0;
  const fetcher = async () => { requests++; return json({ relay: true }); };
  assert.deepEqual(await runtimeConfig({ fetcher: async url => {
    assert.equal(new URL(url, 'https://bttlbmb.github.io/flightguesser/').href,
      'https://bttlbmb.github.io/flightguesser/config.json');
    return json({ relay: false });
  } }), { relay: false });
  assert.deepEqual(await runtimeConfig({ hostname: 'example.com', fetcher }), { relay: true });
  assert.equal(requests, 1);
  assert.deepEqual(await runtimeConfig({ hostname: 'localhost', fetcher }), { relay: true });
  assert.deepEqual(await runtimeConfig({ hostname: 'localhost', fetcher: async () => json({ relay: 'true' }) }), { relay: false });
  // Keep this timer referenced: AbortSignal.timeout alone does not keep Node alive.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    assert.deepEqual(await runtimeConfig({ hostname: 'localhost', timeoutMs: 5, fetcher: async (url, { signal }) => {
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } }), { relay: false });
  } finally { clearTimeout(keepAlive); }
});

test('rate limiting stops the search immediately and carries the retry delay', async () => {
  let requests = 0;
  await assert.rejects(findNearbyRound(place, { fetcher: async () => { requests++; return json({}, 429, { 'retry-after': '120' }); } }), error => error.code === 'rate-limit' && error.retryAfter === 120);
  assert.equal(requests, 1);
  await assert.rejects(findNearbyRound(place, { fetcher: async () => { requests++; return json(payload()); } }), error => error.code === 'rate-limit');
  assert.equal(requests, 1, 'changing the search must not bypass the shared cooldown');
});

test('invalid JSON and browser failures remain typed errors', async () => {
  await assert.rejects(requestJson('/test', { fetcher: async () => new Response('<html>blocked</html>', { status: 200 }) }), error => error.code === 'invalid-data');
  await assert.rejects(requestJson('/test', { fetcher: async () => { throw new TypeError('Failed to fetch'); } }), error => error.code === 'network');
});

test('an aborted search does not become a provider failure', async () => {
  const controller = new AbortController();
  controller.abort();
  let requests = 0;
  await assert.rejects(requestJson('/test', { signal: controller.signal, fetcher: async () => { requests++; } }), error => error.name === 'AbortError');
  assert.equal(requests, 0);
});

test('an unusable numeric retry header uses the finite policy delay', async () => {
  await assert.rejects(requestJson('/test', { fetcher: async () => json({}, 429, { 'retry-after': '9'.repeat(400) }) }), error => error.code === 'rate-limit' && error.retryAfter === 60);
});

test('cancellation while reading the response body remains cancellation', async () => {
  const controller = new AbortController();
  await assert.rejects(requestJson('/test', { signal: controller.signal, fetcher: async () => ({
    status: 200, ok: true, json: async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    },
  }) }), error => error.name === 'AbortError');
});
