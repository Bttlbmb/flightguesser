import { validCoordinates, distanceKm, routeGeometry } from './geo.js';

export const MAX_POSITION_AGE_SECONDS = 30;
export const MAX_RESPONSE_AGE_SECONDS = 60;
export const SEARCH_RADII_NM = [50, 100, 250];
export const MAX_ROUTE_LOOKUPS = 12;

const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const heading = value => number(value) !== null && value >= 0 && value < 360 ? value : null;
export const normalizeCallsign = value => typeof value === 'string' ? value.trim().toUpperCase() : '';

export function normalizeAirline(raw, expectedCode, provider = 'adsbdb') {
  if (!/^[A-Z]{3}$/.test(expectedCode ?? '') || raw?.icao !== expectedCode
    || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 150
    || /[\u0000-\u001f\u007f]/.test(raw.name)) return null;
  return { name: raw.name.trim(), icao: expectedCode, provider };
}

export function normalizeAirport(raw, provider = 'adsb.lol') {
  if (!raw || typeof raw !== 'object' || !['adsb.lol', 'adsbdb'].includes(provider)) return null;
  const airport = provider === 'adsbdb' ? {
    id: raw.icao_code, code: raw.iata_code || raw.icao_code, name: raw.name,
    city: raw.municipality || raw.name, country: raw.country_iso_name,
    lat: number(raw.latitude), lon: number(raw.longitude),
  } : {
    id: raw.icao, code: raw.iata || raw.icao, name: raw.name,
    city: raw.location || raw.name, country: raw.countryiso2,
    lat: number(raw.lat), lon: number(raw.lon),
  };
  if (typeof airport.id !== 'string' || !/^[A-Z0-9-]{3,8}$/.test(airport.id)
    || typeof airport.code !== 'string' || !/^[A-Z0-9]{3,4}$/.test(airport.code)
    || typeof airport.name !== 'string' || !airport.name.trim() || airport.name.length > 300
    || typeof airport.city !== 'string' || !airport.city.trim() || airport.city.length > 300
    || (airport.country != null && (typeof airport.country !== 'string' || !/^[A-Z]{2}$/.test(airport.country)))
    || !validCoordinates(airport)) return null;
  return airport;
}

export function normalizeObservation(raw, observedAt, place, clock = Date.now()) {
  if (!raw || typeof raw !== 'object' || !validCoordinates(place) || !Number.isFinite(clock)) return null;
  const callsign = normalizeCallsign(raw.flight);
  const positionAge = number(raw.seen_pos);
  const messageAge = number(raw.seen);
  const responseAge = (clock - observedAt) / 1000;
  const aircraft = {
    hex: typeof raw.hex === 'string' ? raw.hex.toLowerCase() : '', callsign, lat: number(raw.lat), lon: number(raw.lon),
    altitudeFt: number(raw.alt_baro), speedKnots: number(raw.gs),
    track: heading(raw.track), trueHeading: heading(raw.true_heading),
    verticalRateFpm: number(raw.baro_rate), positionAge, observedAt,
    type: typeof raw.t === 'string' ? raw.t : null,
  };
  // Airline-form callsigns exclude most private, ground, and unidentified targets.
  // This is a selection heuristic, not a guarantee that a flight carries passengers.
  if (!/^[A-Z]{3}\d[A-Z0-9]{0,6}$/.test(callsign)
    || !/^[a-f0-9]{6}$/i.test(aircraft.hex ?? '')
    || !validCoordinates(aircraft)
    || positionAge === null || positionAge < 0 || positionAge > MAX_POSITION_AGE_SECONDS
    || messageAge === null || messageAge < 0 || messageAge > MAX_POSITION_AGE_SECONDS
    || !Number.isFinite(observedAt) || responseAge < -10 || responseAge > MAX_RESPONSE_AGE_SECONDS
    || aircraft.altitudeFt === null || aircraft.altitudeFt < 1000 || aircraft.altitudeFt > 55000
    || aircraft.speedKnots === null || aircraft.speedKnots < 100 || aircraft.speedKnots > 700
    || aircraft.track === null
    || raw.alt_baro === 'ground' || raw.on_ground === true
    || raw.dbFlags && (raw.dbFlags & 1)) return null;
  aircraft.distanceFromPlaceKm = distanceKm(place, aircraft);
  aircraft.positionObservedAt = observedAt - positionAge * 1000;
  return aircraft;
}

export function observationTime(payload) {
  const value = number(payload?.now);
  if (value === null) return NaN;
  // Provider versions use either epoch seconds or milliseconds; freshness needs one unit.
  return value < 1e12 ? value * 1000 : value;
}

export function aircraftCandidates(payload, place, radiusNm, clock = Date.now()) {
  if (!Array.isArray(payload?.ac)) return [];
  const observedAt = observationTime(payload);
  const counts = new Map();
  for (const raw of payload.ac) {
    const key = normalizeCallsign(raw?.flight);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return payload.ac.map(raw => normalizeObservation(raw, observedAt, place, clock))
    .filter(aircraft => aircraft && counts.get(aircraft.callsign) === 1
      && aircraft.distanceFromPlaceKm <= radiusNm * 1.852 + 0.5)
    .sort((a, b) => a.distanceFromPlaceKm - b.distanceFromPlaceKm);
}

export function normalizeRoute(raw, aircraft, provider = 'adsb.lol') {
  if (!aircraft || !validCoordinates(aircraft) || !['adsb.lol', 'adsbdb'].includes(provider)) return null;
  let origin, destination, callsign, airlineCode, airline;
  if (provider === 'adsb.lol') {
    if (!Array.isArray(raw?._airports) || raw._airports.length !== 2 || raw.plausible !== true) return null;
    callsign = normalizeCallsign(raw.callsign);
    origin = normalizeAirport(raw._airports[0]);
    destination = normalizeAirport(raw._airports[1]);
    airlineCode = raw.airline_code;
  } else {
    const route = raw?.response?.flightroute;
    if (!route || route.midpoint) return null;
    callsign = normalizeCallsign(route.callsign_icao || route.callsign);
    origin = normalizeAirport(route.origin, 'adsbdb');
    destination = normalizeAirport(route.destination, 'adsbdb');
    airlineCode = route.airline?.icao;
    airline = normalizeAirline(route.airline, airlineCode);
  }
  if (!origin || !destination || origin.id === destination.id || callsign !== aircraft.callsign) return null;
  // Independently reject obvious contradictions; a provider's plausible flag is not confirmation.
  const geometry = routeGeometry(aircraft, origin, destination);
  if (!geometry.plausible) return null;
  const hasAirlineCode = typeof airlineCode === 'string' && /^[A-Z]{3}$/.test(airlineCode) && callsign.startsWith(airlineCode);
  return { callsign, origin, destination, provider, matchedAt: Date.now(), geometry, confidence: 'reported',
    ...(hasAirlineCode ? { airlineCode, ...(airline ? { airline } : {}) } : {}) };
}
