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

// Enrich city labels without mutating observations or replacing endpoint positions.
export function mergeRouteAirports(airports, route) {
  const merged = new Map(airports.map(airport => [airport.id, airport]));
  for (const endpoint of [route.origin, route.destination]) {
    const indexed = merged.get(endpoint.id);
    const municipality = hasMunicipality(endpoint) ? endpoint.city
      : hasMunicipality(indexed) ? indexed.city : endpoint.city;
    merged.set(endpoint.id, { ...indexed, ...endpoint, city: municipality });
  }
  return [...merged.values()];
}
