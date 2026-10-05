import { validCoordinates } from './geo.js';

export const normalizeSearch = value => String(value ?? '').normalize('NFD')
  .replace(/\p{Diacritic}/gu, '').replace(/[‘’ʼ＇]/g, "'").toLowerCase().trim().replace(/\s+/g, ' ');

// Keep ISO-code labels usable when the browser lacks the optional name formatter.
const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
const countries = new Map();

export function countryName(code) {
  if (!countries.has(code)) {
    let name;
    try { name = regionNames?.of(code) || code || 'Unknown'; }
    catch { name = code || 'Unknown'; }
    // Thousands of airports share the same country; translate each code once.
    countries.set(code, name);
  }
  return countries.get(code);
}

export function airportLabel(airport) {
  return `${airport.city} (${airport.code})`;
}

export function hasMunicipality(airport) {
  return typeof airport?.city === 'string' && !!airport.city.trim()
    && normalizeSearch(airport.city) !== normalizeSearch(airport.name);
}

// Enrich labels without changing reported endpoint coordinates or source objects.
export function mergeRouteAirports(airports, route) {
  const merged = new Map(airports.map(airport => [airport.id, airport]));
  for (const endpoint of [route.origin, route.destination]) {
    merged.set(endpoint.id, resolveRouteAirport(airports, endpoint));
  }
  return [...merged.values()];
}

/** Validate local and normalized provider airports before they become answers. */
export function validAirport(airport) {
  return validCoordinates(airport)
    && typeof airport.id === 'string' && /^[A-Z0-9-]{3,8}$/.test(airport.id)
    && typeof airport.code === 'string' && /^[A-Z0-9]{3,4}$/.test(airport.code)
    && typeof airport.name === 'string' && !!airport.name.trim() && airport.name.length <= 300
    && typeof airport.city === 'string' && !!airport.city.trim() && airport.city.length <= 300
    && (airport.country == null || typeof airport.country === 'string' && /^[A-Z]{2}$/.test(airport.country));
}

/** Expand the versioned storage rows once, keeping the rest of the game readable. */
export function decodeAirportData(data) {
  if (data?.version !== 1 || !Array.isArray(data.airports) || !data.airports.length) {
    throw new Error('Invalid airport data format');
  }
  const ids = new Set();
  return data.airports.map(row => {
    if (!Array.isArray(row) || (row.length !== 7 && row.length !== 8)
      || (row.length === 8 && row[7] !== 1)) throw new Error('Invalid airport row');
    const [id, code, name, city, country, lat, lon, major] = row;
    const airport = { id, code, name, city, country, lat, lon, major: major === 1 };
    if (!validAirport(airport) || !country || ids.has(id)) throw new Error('Invalid or duplicate airport');
    ids.add(id);
    return airport;
  });
}

// The bundled array stays fixed for the page session. Reuse its lookup table for
// route checks and round openings instead of rebuilding thousands of entries.
const airportIndexes = new WeakMap();
export function resolveRouteAirport(airports, endpoint) {
  if (!airportIndexes.has(airports)) {
    airportIndexes.set(airports, new Map(airports.map(airport => [airport.id, airport])));
  }
  const indexed = airportIndexes.get(airports).get(endpoint.id);
  const city = hasMunicipality(endpoint) ? endpoint.city
    : hasMunicipality(indexed) ? indexed.city : endpoint.city;
  return { ...indexed, ...endpoint, city };
}
