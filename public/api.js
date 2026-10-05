import { aircraftCandidates, normalizeRoute, normalizeAirline, MAX_ROUTE_LOOKUPS, SEARCH_RADII_NM } from './flights.js';
import { validCoordinates } from './geo.js';
import { selectionProfile, orderAircraftCandidates, rankSelections, pickSelection, TARGET_DESTINATION_COUNT, COMPARISON_WINDOW_MS } from './selection.js';

const MAX_SELECTED_POSITION_AGE_MS = 60000;
let providerPauseUntil = 0;
const airlineNames = new Map();

export async function enrichRouteAirline(route, { signal, fetcher = fetch, timeoutMs = 1500, relay = false } = {}) {
  if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
  const code = route?.airlineCode;
  if (!/^[A-Z]{3}$/.test(code ?? '') || !route.callsign?.startsWith(code) || normalizeAirline(route.airline, code, route.airline?.provider)) return route;
  const cached = airlineNames.get(code);
  if (cached) return { ...route, airline: cached };
  // Airline metadata is optional. One short lookup must not turn a usable route
  // into a failed round, and no identity is guessed from a callsign prefix alone.
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetcher(relay ? `/api/airline/${code}` : `https://api.adsbdb.com/v0/airline/${code}`, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      credentials: relay ? 'same-origin' : 'omit', referrerPolicy: 'no-referrer',
    });
    if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
    if (!response.ok) return route;
    const data = await response.json();
    if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
    if (timeout.aborted || !Array.isArray(data?.response)) return route;
    const matches = data.response.filter(value => value?.icao === code);
    const airline = matches.length === 1 ? normalizeAirline(matches[0], code) : null;
    if (!airline) return route;
    if (airlineNames.size >= 200) airlineNames.delete(airlineNames.keys().next().value);
    airlineNames.set(code, airline);
    return { ...route, airline };
  } catch {
    if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
    return route;
  }
}

export class DataError extends Error {
  constructor(code, message, retryAfter = null) {
    super(message);
    this.name = 'DataError';
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export async function requestJson(url, { signal, fetcher = fetch, timeoutMs = 10000 } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const checkCancelled = () => {
    if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
    if (timeout.aborted) throw new DataError('timeout', 'The aircraft service took too long to respond.');
  };
  checkCancelled();
  let response;
  try { response = await fetcher(url, { signal: combined, credentials: url.startsWith('/api/') ? 'same-origin' : 'omit', referrerPolicy: 'no-referrer' }); }
  catch {
    checkCancelled();
    throw new DataError('network', 'The aircraft service could not be reached from this browser.');
  }
  checkCancelled();
  if (response.status === 429) {
    const raw = response.headers.get('retry-after');
    const seconds = Number(raw);
    // Malformed headers must not produce an infinite pause in every later search.
    const retryAfter = /^\d+$/.test(raw ?? '') && Number.isSafeInteger(seconds) ? Math.max(1, seconds) : 60;
    providerPauseUntil = Math.max(providerPauseUntil, Date.now() + retryAfter * 1000);
    throw new DataError('rate-limit', 'The flight data service needs a pause.', retryAfter);
  }
  if (!response.ok) throw new DataError('provider', 'The aircraft service is unavailable right now.');
  try {
    const data = await response.json();
    checkCancelled();
    return data;
  }
  catch {
    checkCancelled();
    throw new DataError('invalid-data', 'The aircraft service returned an unreadable response.');
  }
}

export async function runtimeConfig({ fetcher = fetch, timeoutMs = 1500 } = {}) {
  try {
    // Relative configuration works at a project subpath as well as a domain root.
    // Static builds supply this file; local and Worker relays override it.
    const response = await fetcher('./config.json', { credentials: 'same-origin', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return { relay: false };
    const config = await response.json();
    return { relay: config.relay === true,
      ...(config.telemetryProvider === 'adsb.fi' ? { telemetryProvider: 'adsb.fi' } : {}),
      ...(config.routeProvider === 'adsbdb' ? { routeProvider: 'adsbdb' } : {}),
    };
  } catch { return { relay: false }; }
}

export async function findNearbyRound(place, options = {}) {
  if (options.signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
  if (!validCoordinates(place)) throw new DataError('invalid-place', 'Choose a place with valid coordinates.');
  if (providerPauseUntil > Date.now()) throw new DataError('rate-limit', 'The flight data service needs a pause.', Math.ceil((providerPauseUntil - Date.now()) / 1000));
  const deadline = AbortSignal.timeout(25000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  try { return await findWithinBudget(place, { ...options, signal, callerSignal: options.signal }); }
  catch (error) {
    if (deadline.aborted && !options.signal?.aborted) throw new DataError('timeout', 'Finding a usable flight took too long. Try another city or a recorded flight.');
    throw error;
  }
}

async function findWithinBudget(place, {
  signal, callerSignal = null, relay = false, telemetryProvider = 'adsb.lol', routeProvider = 'adsb.lol', onProgress = () => {}, fetcher = fetch,
  excluded = new Set(), excludedDestinationIds = new Set(), resolveDestination = airport => airport,
  history = [], random = Math.random,
} = {}) {
  const lat = Number(place.lat.toFixed(2));
  const lon = Number(place.lon.toFixed(2));
  const checked = new Set();
  let routeRequests = 0, routeFailures = 0, repeatedDestination = false, uninteresting = 0;
  let comparisonEndsAt = Infinity;
  const usable = [];
  const freshCandidates = () => usable.filter(candidate => Date.now() - candidate.aircraft.positionObservedAt <= MAX_SELECTED_POSITION_AGE_MS);
  const select = () => {
    if (callerSignal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
    const picked = pickSelection(freshCandidates(), { history, random });
    if (!picked) return null;
    const { profile, ...candidate } = picked.candidate;
    return {
      mode: 'live', ...candidate, place, provider: telemetryProvider, selectedAt: Date.now(),
      diagnostics: {
        routeRequests, routeFailures, candidatesCompared: usable.length,
        distinctDestinations: rankSelections(freshCandidates(), history).length,
        uninteresting, selectionScore: picked.score, selection: profile,
      },
    };
  };
  const request = async (url, timeoutMs = 10000) => {
    const remaining = comparisonEndsAt - Date.now();
    if (remaining <= 0) throw new DataError('comparison-complete', 'The candidate comparison is complete.');
    return requestJson(url, { signal, fetcher, timeoutMs: Math.max(1, Math.min(timeoutMs, remaining)) });
  };
  try {
    search: for (const radiusNm of SEARCH_RADII_NM) {
      onProgress({ radiusKm: Math.round(radiusNm * 1.852), stage: 'nearby' });
      const nearbyUrl = relay ? `/api/nearby/${lat}/${lon}/${radiusNm}` : telemetryProvider === 'adsb.fi' ? `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${radiusNm}` : `https://api.adsb.lol/v2/point/${lat}/${lon}/${radiusNm}`;
      const payload = await request(nearbyUrl);
      const candidates = orderAircraftCandidates(aircraftCandidates(payload, place, radiusNm)
        .filter(aircraft => !excluded.has(aircraft.hex) && !checked.has(aircraft.hex)), random);
      const isLastRadius = radiusNm === SEARCH_RADII_NM.at(-1);
      const allowance = isLastRadius ? MAX_ROUTE_LOOKUPS - routeRequests : Math.min(4, MAX_ROUTE_LOOKUPS - routeRequests);
      const radiusStart = routeRequests;
      for (const aircraft of candidates) {
        if (Date.now() >= comparisonEndsAt) break search;
        if (routeRequests - radiusStart >= allowance || routeRequests >= MAX_ROUTE_LOOKUPS) break;
        if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
        if (Date.now() - aircraft.positionObservedAt > MAX_SELECTED_POSITION_AGE_MS) continue;
        checked.add(aircraft.hex);
        routeRequests++;
        onProgress({ radiusKm: Math.round(radiusNm * 1.852), stage: 'route' });
        const url = routeProvider === 'adsbdb'
          ? (relay ? `/api/callsign/${aircraft.callsign}` : `https://api.adsbdb.com/v0/callsign/${aircraft.callsign}`)
          : relay
          ? `/api/route/${aircraft.callsign}/${aircraft.lat}/${aircraft.lon}`
          : `https://api.adsb.lol/api/0/route/${aircraft.callsign}/${aircraft.lat}/${aircraft.lon}`;
        let route, fallbackAllowed = false;
        try {
          const raw = await request(url, 6000);
          route = normalizeRoute(raw, aircraft, routeProvider);
          fallbackAllowed = routeProvider === 'adsb.lol' && (!Array.isArray(raw?._airports) || raw._airports.length === 0);
        } catch (error) {
          if (error.name === 'AbortError' || error.code === 'rate-limit' || error.code === 'comparison-complete') throw error;
          routeFailures++;
          fallbackAllowed = routeProvider === 'adsb.lol';
        }
        if (!route && fallbackAllowed && routeRequests - radiusStart < allowance && routeRequests < MAX_ROUTE_LOOKUPS) {
          routeRequests++;
          try {
            const raw = await request(relay ? `/api/callsign/${aircraft.callsign}` : `https://api.adsbdb.com/v0/callsign/${aircraft.callsign}`, 6000);
            route = normalizeRoute(raw, aircraft, 'adsbdb');
          } catch (error) {
            if (error.name === 'AbortError' || error.code === 'rate-limit' || error.code === 'comparison-complete') throw error;
            routeFailures++;
          }
        }
        if (!route || Date.now() - aircraft.positionObservedAt > MAX_SELECTED_POSITION_AGE_MS) continue;
        let profile;
        try { profile = selectionProfile({ aircraft, route }, place, { resolveDestination }); }
        catch { continue; }
        if (profile.destinationIds.some(id => excludedDestinationIds.has(id))) {
          repeatedDestination = true;
          continue;
        }
        if (!profile.eligible) { uninteresting++; continue; }
        usable.push({ aircraft, route, searchRadiusNm: radiusNm, profile });
        // A usable flight starts a short comparison window. The existing overall
        // deadline and request cap still bound searches with no playable match.
        comparisonEndsAt = Math.min(comparisonEndsAt, Date.now() + COMPARISON_WINDOW_MS);
        if (rankSelections(freshCandidates(), history).length >= TARGET_DESTINATION_COUNT) {
          const selected = select();
          if (selected) return selected;
          break search;
        }
      }
      if (routeRequests >= MAX_ROUTE_LOOKUPS) break;
    }
  } catch (error) {
    if (callerSignal?.aborted || error.code === 'rate-limit') throw error;
    const retained = select();
    if (retained) return retained;
    if (error.code !== 'comparison-complete') throw error;
  }
  const selected = select();
  if (selected) return selected;
  if (uninteresting) throw new DataError('no-interesting-flight', 'Nearby flights were heading back here or too close to landing. Try another city or a recorded flight.');
  if (repeatedDestination) throw new DataError('no-new-destination', 'No nearby flight had a different destination city with usable fresh data.');
  if (routeFailures && routeFailures === routeRequests) throw new DataError('route-unavailable', 'Aircraft were found, but their reported routes could not be checked.');
  throw new DataError('no-flight', 'No nearby flight had enough fresh data and a usable reported route.');
}
