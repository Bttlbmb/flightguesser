import { countryName, normalizeSearch as normalize, hasMunicipality } from './airports.js';
import { validCoordinates } from './geo.js';
import { CITY_LINKS } from './data/city-links.js';

const unique = values => [...new Set(values.filter(value => typeof value === 'string' && value.trim()))];
const usableAirport = airport => airport && typeof airport.id === 'string' && airport.id.trim() && validCoordinates(airport);
const linkedCities = new Map();
for (const city of CITY_LINKS) {
  for (const airportId of city.airportIds) {
    if (!linkedCities.has(airportId)) linkedCities.set(airportId, []);
    linkedCities.get(airportId).push(city);
  }
}

// Membership is deliberately direct. Sharing an airport with another city never
// imports that city's other airports, and a municipality name is not an identity.
function linkedDefinitions(airport) {
  return (linkedCities.get(airport.id) || []).filter(city => !airport.country || city.country === airport.country);
}

function fallbackDefinition(airport) {
  if (!hasMunicipality(airport)) {
    const error = new Error('This reported airport has no reliable city information. Try another flight.');
    error.code = 'city-data';
    throw error;
  }
  const country = typeof airport.country === 'string' ? airport.country : '';
  const name = airport.city.trim();
  return {
    id: `airport:${country || 'unknown'}:${encodeURIComponent(airport.id)}`,
    name, country, ...(airport.region ? { region: airport.region } : {}),
    lat: airport.lat, lon: airport.lon,
    airportIds: [airport.id], primaryFor: [airport.id], fallback: true,
    coordinateSource: { kind: 'airport-coordinate-fallback', airportId: airport.id },
  };
}

export function cityLabel(city) {
  return city.region ? `${city.name}, ${city.region}` : city.name;
}

function cityObject(definition, airports) {
  const airportLinks = airports.map(airport => ({ id: airport.id, code: airport.code || '' }));
  const city = {
    id: definition.id, name: definition.name, country: definition.country,
    ...(definition.region ? { region: definition.region } : {}),
    lat: definition.lat, lon: definition.lon,
    airportIds: [...definition.airportIds],
    primaryAirportIds: [...(definition.primaryFor || [])],
    aliases: [...(definition.aliases || [])],
    airportCodes: unique(airportLinks.map(airport => airport.code)),
    airportLinks,
    major: airports.some(airport => airport.major === true),
    fallback: definition.fallback === true,
    ...(definition.coordinateSource ? { coordinateSource: definition.coordinateSource } : {}),
  };
  if (city.fallback) {
    city.airportCode = airports[0]?.code || airports[0]?.id || '';
    city.airportName = airports[0]?.name || '';
  }
  city.search = normalize([city.id, city.name, city.region || '', countryName(city.country), city.country,
    ...city.aliases, ...city.airportIds,
    ...airports.flatMap(airport => [airport.code, airport.id, airport.city, airport.name]),
  ].join(' '));
  return city;
}

export function indexCities(airports) {
  const groups = new Map();
  for (const airport of airports) {
    if (!usableAirport(airport)) continue;
    const links = linkedDefinitions(airport);
    if (!links.length && !hasMunicipality(airport)) continue;
    for (const definition of links.length ? links : [fallbackDefinition(airport)]) {
      if (!groups.has(definition.id)) groups.set(definition.id, { definition, airports: new Map() });
      groups.get(definition.id).airports.set(airport.id, airport);
    }
  }
  return [...groups.values()].map(({ definition, airports }) => cityObject(definition, [...airports.values()]));
}

export function destinationCities(airport) {
  if (!usableAirport(airport)) return { primary: null, accepted: [] };
  const definitions = linkedDefinitions(airport);
  const links = definitions.length ? definitions : [fallbackDefinition(airport)];
  const primaryDefinition = links.find(city => city.primaryFor?.includes(airport.id)) || links[0];
  const accepted = links.map(city => cityObject(city, [airport]));
  return { primary: accepted.find(city => city.id === primaryDefinition.id), accepted };
}

export function destinationRepeatIds(airport, destination = destinationCities(airport)) {
  const ids = destination.accepted.map(city => city.id);
  // Match visible city names across curated and fallback answers for repeat
  // avoidance without turning those names into shared guessing membership.
  for (const city of destination.accepted) {
    if (city.country) ids.push(`municipality:${city.country}:${encodeURIComponent(normalize(city.name))}:${encodeURIComponent(normalize(city.region || ''))}`);
  }
  return unique(ids);
}

export function cityMatchesAirport(city, airport) {
  return !!city && !!airport && typeof airport.id === 'string'
    && (!city.country || !airport.country || city.country === airport.country)
    && Array.isArray(city.airportIds) && city.airportIds.includes(airport.id);
}

// A new round creates a new city array. Weak keys let finished indexes be released
// and keep exact-code lookups and normalized names out of the typing loop.
const searchIndexes = new WeakMap();

function searchIndex(cities) {
  if (searchIndexes.has(cities)) return searchIndexes.get(cities);
  const byId = new Map(), byAirport = new Map(), terms = new Map();
  const countries = new Map();
  const add = (map, key, city) => {
    if (!map.has(key)) map.set(key, []);
    if (!map.get(key).includes(city)) map.get(key).push(city);
  };
  const ordered = [...cities].sort((a, b) => Number(b.major) - Number(a.major)
    || cityLabel(a).localeCompare(cityLabel(b)) || a.id.localeCompare(b.id));
  for (const city of ordered) {
    add(byId, normalize(city.id), city);
    for (const key of [...city.airportIds, ...city.airportCodes]) add(byAirport, normalize(key), city);
    terms.set(city, {
      name: normalize(city.name), aliases: city.aliases.map(normalize),
      primaryKeys: new Set([
        ...city.primaryAirportIds,
        ...city.airportLinks.filter(airport => city.primaryAirportIds.includes(airport.id)).map(airport => airport.code),
      ].map(normalize)),
    });
    if (city.country && !countries.has(city.country)) {
      countries.set(city.country, { code: city.country, name: normalize(countryName(city.country)) });
    }
  }
  const index = { byId, byAirport, terms, ordered, countries: [...countries.values()].sort((a, b) => b.name.length - a.name.length) };
  searchIndexes.set(cities, index);
  return index;
}

function countryIntent(countries, text) {
  for (const country of countries) {
    if (text === country.name) return { country: country.code };
    for (const before of [true, false]) {
      const initial = before ? text.startsWith(`${country.name} `) && text.slice(country.name.length + 1)
        : text.endsWith(` ${country.name}`) && text.slice(0, -country.name.length - 1);
      if (typeof initial === 'string' && /^[\p{L}\p{N}]$/u.test(initial)) return { country: country.code, initial };
    }
  }
  return null;
}

// .total reports every match, even when the displayed result list is capped.
export function searchCities(cities, query, limit = 8) {
  const text = normalize(query);
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 8;
  const result = (found, total) => {
    Object.defineProperty(found, 'total', { value: total });
    return found;
  };
  if (!text) return result([], 0);
  const index = searchIndex(cities);
  const exactCity = index.byId.get(text);
  const exactAirport = index.byAirport.get(text);
  const intent = countryIntent(index.countries, text);
  const words = text.split(' ');
  const buckets = [[], [], [], []];
  let total = 0;
  // Stable ordering is cached. A broad query counts all matches without sorting
  // or allocating a result object for every airport on every keystroke.
  for (const city of exactCity || exactAirport || index.ordered) {
    if (!exactCity && !exactAirport) {
      if (intent ? city.country !== intent.country : !words.every(word => city.search.includes(word))) continue;
    }
    const terms = index.terms.get(city);
    if (intent?.initial && !exactCity && !exactAirport && !terms.name.startsWith(intent.initial)) continue;
    total++;
    const rank = exactCity ? 0 : exactAirport ? (terms.primaryKeys.has(text) ? 0 : 1)
      : terms.name === text || terms.aliases.includes(text) ? (city.fallback ? 1 : 0)
      : terms.name.startsWith(text) || terms.aliases.some(alias => alias.startsWith(text)) ? 2 : 3;
    if (buckets[rank].length < safeLimit) buckets[rank].push(city);
  }
  return result(buckets.flat().slice(0, safeLimit), total);
}
