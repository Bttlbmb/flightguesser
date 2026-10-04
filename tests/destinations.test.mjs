import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { indexCities, searchCities, destinationCities, destinationRepeatIds, cityLabel, cityMatchesAirport } from '../public/destinations.js';
import { CITY_LINKS } from '../public/data/city-links.js';
import { mergeRouteAirports } from '../public/airports.js';

const airports = JSON.parse(await readFile(new URL('../public/data/airports.json', import.meta.url), 'utf8'));
const byID = id => airports.find(airport => airport.id === id);
const subset = (...ids) => indexCities(ids.map(byID));

test('curated city links have valid direct membership and preserve airport reference points', () => {
  const primaryCities = new Map();
  assert.equal(new Set(CITY_LINKS.map(city => city.id)).size, CITY_LINKS.length);
  for (const city of CITY_LINKS) {
    for (const id of city.airportIds) {
      assert.equal(byID(id)?.country, city.country, `${city.id}: ${id}`);
    }
    for (const id of city.primaryFor) {
      assert.ok(city.airportIds.includes(id));
      assert.equal(primaryCities.has(id), false, `${id} has more than one primary city`);
      primaryCities.set(id, city.id);
    }
    if (city.coordinateSource.kind === 'airport-coordinate-fallback') {
      const reference = byID(city.coordinateSource.airportId);
      assert.equal(city.lat, reference.lat);
      assert.equal(city.lon, reference.lon);
    }
  }
});

test('Tokyo accepts Haneda and Narita while Narita remains a direct one-airport city', () => {
  const cities = subset('RJTT', 'RJAA');
  const tokyo = cities.find(city => city.name === 'Tokyo');
  const narita = cities.find(city => city.name === 'Narita');
  assert.equal(cityMatchesAirport(tokyo, byID('RJTT')), true);
  assert.equal(cityMatchesAirport(tokyo, byID('RJAA')), true);
  assert.equal(cityMatchesAirport(narita, byID('RJAA')), true);
  assert.equal(cityMatchesAirport(narita, byID('RJTT')), false);
  assert.deepEqual(destinationCities(byID('RJAA')).accepted.map(city => city.name), ['Tokyo', 'Narita']);
  assert.equal(destinationCities(byID('RJAA')).primary.name, 'Tokyo');
  assert.equal(destinationCities(byID('RJTT')).primary.id, tokyo.id);
});

test('Seoul and Incheon do not merge transitively through their shared airport', () => {
  const cities = subset('RKSI', 'RKSS');
  const seoul = cities.find(city => city.name === 'Seoul');
  const incheon = cities.find(city => city.name === 'Incheon');
  assert.equal(cityMatchesAirport(seoul, byID('RKSI')), true);
  assert.equal(cityMatchesAirport(seoul, byID('RKSS')), true);
  assert.equal(cityMatchesAirport(incheon, byID('RKSI')), true);
  assert.equal(cityMatchesAirport(incheon, byID('RKSS')), false);
  assert.deepEqual(destinationCities(byID('RKSS')).accepted.map(city => city.name), ['Seoul']);
  assert.deepEqual(destinationCities(byID('RKSI')).accepted.map(city => city.name), ['Seoul', 'Incheon']);
});

test('Portland in Oregon and Maine remain distinct cities and answers', () => {
  const cities = subset('KPDX', 'KPWM');
  const matches = searchCities(cities, 'Portland');
  assert.equal(matches.total, 2);
  assert.equal(new Set(matches.map(city => city.id)).size, 2);
  assert.deepEqual(new Set(matches.map(cityLabel)), new Set(['Portland, Oregon', 'Portland, Maine']));
  assert.equal(cityMatchesAirport(matches.find(city => city.region === 'Oregon'), byID('KPWM')), false);
  assert.equal(searchCities(cities, 'Portland Maine')[0].region, 'Maine');
});

test('unmapped same-name towns are airport-bound, not false-positive answers', () => {
  const a = { id: 'TESTA', code: 'AAA', city: 'Springfield', name: 'First airport', country: 'US', lat: 40, lon: -80 };
  const b = { ...a, id: 'TESTB', code: 'BBB', name: 'Second airport', lat: 42, lon: -85 };
  const cities = indexCities([a, b]);
  assert.equal(cities.length, 2);
  assert.notEqual(cities[0].id, cities[1].id);
  assert.equal(cityMatchesAirport(cities[0], a), true);
  assert.equal(cityMatchesAirport(cities[0], b), false);
  assert.equal(cities[0].fallback, true);
  assert.equal(cities[0].airportCode, 'AAA');
  assert.equal(destinationCities(a).primary.id, cities[0].id);
});

test('repeat avoidance can match a fallback municipality without changing city membership', () => {
  const a = { id: 'TESTA', code: 'AAA', city: 'Côté d’Ouest', name: 'First airport', country: 'CI', lat: 6, lon: -5 };
  const b = { ...a, id: 'TESTB', code: 'BBB', city: " COTE d'Ouest ", name: 'Second airport', lon: -5.1 };
  const ids = new Set(destinationRepeatIds(a));
  assert.equal(destinationRepeatIds(b).some(id => ids.has(id)), true);
  assert.notEqual(destinationCities(a).primary.id, destinationCities(b).primary.id);
  assert.equal(cityMatchesAirport(destinationCities(a).primary, b), false);
  assert.equal(destinationRepeatIds({ ...b, country: 'FR' }).some(id => ids.has(id)), false);
});

test('repeat avoidance respects fallback regions and established curated homonyms', () => {
  const a = { id: 'TESTA', code: 'AAA', city: 'Springfield', region: 'Illinois', name: 'First airport', country: 'US', lat: 40, lon: -89 };
  const b = { ...a, id: 'TESTB', code: 'BBB', region: 'Massachusetts', name: 'Second airport', lat: 42, lon: -72 };
  const ids = new Set(destinationRepeatIds(a));
  assert.equal(destinationRepeatIds(b).some(id => ids.has(id)), false);
  assert.equal(destinationRepeatIds({ ...b, region: 'Illinois' }).some(id => ids.has(id)), true);
  const oregon = new Set(destinationRepeatIds(byID('KPDX')));
  assert.equal(destinationRepeatIds(byID('KPWM')).some(id => oregon.has(id)), false);
  assert.deepEqual(destinationRepeatIds(byID('KPDX')), ['us-portland-or', 'municipality:US:portland:oregon']);
  assert.deepEqual(destinationRepeatIds(byID('KPWM')), ['us-portland-me', 'municipality:US:portland:maine']);
});

test('repeat avoidance matches real curated and fallback answers in both directions without merging membership', () => {
  for (const [curated, fallback] of [['LFPG', 'LFPB'], ['LFPO', 'LFPB'], ['EGLL', 'EGKB']]) {
    assert.equal(destinationCities(byID(curated)).primary.fallback, false);
    assert.equal(destinationCities(byID(fallback)).primary.fallback, true);
    for (const [previous, next] of [[curated, fallback], [fallback, curated]]) {
      const ids = new Set(destinationRepeatIds(byID(previous)));
      assert.equal(destinationRepeatIds(byID(next)).some(id => ids.has(id)), true, `${previous} → ${next}`);
      assert.equal(cityMatchesAirport(destinationCities(byID(previous)).primary, byID(next)), false);
    }
  }
});

test('repeat avoidance includes every accepted city rather than a provider municipality label', () => {
  const narita = destinationRepeatIds(byID('RJAA'));
  assert.ok(narita.includes('municipality:JP:tokyo:'));
  assert.ok(narita.includes('municipality:JP:narita:'));
  assert.ok(destinationRepeatIds(byID('LFPG')).includes('municipality:FR:paris:'));
  assert.equal(destinationRepeatIds(byID('LFPG')).some(id => id.includes('roissy')), false);
});

test('canonical airport codes and IDs find all direct linked cities with the primary first', () => {
  const cities = subset('RJTT', 'RJAA', 'RKSI', 'RKSS', 'KJFK', 'KLGA', 'KEWR');
  assert.deepEqual(searchCities(cities, 'NRT').map(city => city.name), ['Tokyo', 'Narita']);
  assert.deepEqual(searchCities(cities, 'RJAA').map(city => city.name), ['Tokyo', 'Narita']);
  assert.deepEqual(searchCities(cities, 'ICN').map(city => city.name), ['Seoul', 'Incheon']);
  assert.deepEqual(searchCities(cities, 'GMP').map(city => city.name), ['Seoul']);
  assert.equal(searchCities(cities, 'NYC')[0].name, 'New York');
  assert.equal(searchCities(cities, 'EWR')[0].name, 'New York');
  assert.ok(searchCities(cities, 'Narita International Airport').some(city => city.name === 'Tokyo'));
});

test('real exact airport codes win over a coincidentally matching city alias', () => {
  const collision = { id: 'TESTNYC', code: 'NYC', city: 'Elsewhere', name: 'Test collision', country: 'CA', lat: 50, lon: -100 };
  const cities = indexCities([byID('KJFK'), collision]);
  const found = searchCities(cities, 'NYC');
  assert.equal(found.total, 1);
  assert.equal(found[0].name, 'Elsewhere');
});

test('a supported city group precedes unresolved same-name airport fallbacks', () => {
  const cities = subset('LFPG', 'LFPO', 'LFPB');
  const found = searchCities(cities, 'Paris');
  assert.equal(found[0].id, 'fr-paris');
  assert.equal(found.total, 2);
  assert.equal(found[1].fallback, true);
  // Ranking does not silently add an unsupported airport to the accepted group.
  assert.equal(cityMatchesAirport(found[0], byID('LFPB')), false);
});

test('ordinary apostrophe and diacritic variants search without renaming source data', () => {
  const airport = { id: 'TESTCOTE', code: 'CTE', city: 'Côté d’Ouest', name: "O'Hare Test Airport", country: 'CI', lat: 6, lon: -5 };
  const cities = indexCities([airport]);
  assert.equal(searchCities(cities, "Cote d'Ouest")[0].name, 'Côté d’Ouest');
  assert.equal(searchCities(cities, 'O’Hare')[0].airportCode, 'CTE');
  assert.equal(searchCities(cities, "Cote d'Ivoire").total, 1);
  assert.equal(airport.city, 'Côté d’Ouest');
});

test('country and city initial use city names rather than airport-code initials', () => {
  const cities = subset('RJTT', 'RJAA', 'RJSN', 'RKPC');
  assert.deepEqual(searchCities(cities, 'Japan T').map(city => city.name), ['Tokyo']);
  assert.deepEqual(searchCities(cities, 'N Japan').map(city => city.name), ['Narita', 'Niigata']);
  assert.equal(searchCities(cities, 'South Korea J')[0].name, 'Jeju City');
  assert.equal(searchCities(cities, 'Japan K').total, 0);
});

test('caps report all matches and never pretend the displayed count is the total', () => {
  const inputs = Array.from({ length: 12 }, (_, i) => ({ id: `TEST${i}`, code: `X${i}`, city: `Town ${i}`, name: 'Airport', country: 'US', lat: 30 + i, lon: -100 }));
  const cities = indexCities(inputs);
  assert.equal(searchCities(cities, 'Town').length, 8);
  assert.equal(searchCities(cities, 'Town').total, 12);
  assert.equal(searchCities(cities, 'Town', 3).length, 3);
  assert.equal(searchCities(cities, 'Town', 3).total, 12);
  assert.equal(searchCities(cities, '').total, 0);
  assert.deepEqual(searchCities(cities, 'No such city'), []);
});

test('curated reference points never overwrite route endpoint or airport coordinates', () => {
  const airport = Object.freeze({ ...byID('RJAA'), name: 'Alternate provider label' });
  const before = JSON.stringify(airport);
  const indexed = indexCities([airport]);
  const answer = destinationCities(airport);
  assert.notEqual(answer.primary.lat, airport.lat);
  assert.equal(answer.primary.id, indexed.find(city => city.name === 'Tokyo').id);
  assert.equal(JSON.stringify(airport), before);
  assert.equal(cityMatchesAirport(answer.primary, airport), true);
});

test('all four current recordings have specific curated destination cities', async () => {
  const rounds = JSON.parse(await readFile(new URL('../public/data/practice.json', import.meta.url), 'utf8'));
  assert.deepEqual(rounds.map(round => destinationCities(round.route.destination).primary.name), ['Niigata', 'Jeju City', 'Seoul', 'Seoul']);
  assert.ok(rounds.every(round => !destinationCities(round.route.destination).primary.fallback));
});

test('invalid points are omitted and conflicting country IDs do not acquire curated membership', () => {
  assert.deepEqual(destinationCities(null), { primary: null, accepted: [] });
  assert.equal(indexCities([{ id: 'BAD', city: 'Missing point' }]).length, 0);
  const conflicting = { ...byID('RJAA'), country: 'US' };
  const fallback = destinationCities(conflicting).primary;
  assert.equal(fallback.fallback, true);
  assert.equal(cityMatchesAirport(destinationCities(byID('RJAA')).primary, conflicting), false);
});

test('unresolved airport names never become city guesses or destination cities', () => {
  const noCity = { id: 'TESTNONE', code: 'NON', name: 'A Remote Airport', country: 'US', lat: 40, lon: -90 };
  const nameAsCity = { ...noCity, id: 'TESTNAME', city: noCity.name };
  assert.equal(indexCities([noCity, nameAsCity]).length, 0);
  for (const airport of [noCity, nameAsCity]) {
    assert.throws(() => destinationCities(airport), error => error.code === 'city-data' && /no reliable city/i.test(error.message));
  }
});

test('curated airport identities remain usable even without a provider municipality', () => {
  const airport = { ...byID('RJAA'), city: byID('RJAA').name };
  assert.deepEqual(indexCities([airport]).map(city => city.name), ['Tokyo', 'Narita']);
  assert.equal(destinationCities(airport).primary.name, 'Tokyo');
});

test('a recovered meaningful municipality creates a specific city without mutating raw data', () => {
  const raw = { id: 'TESTREC', code: 'REC', name: 'Regional Airport', city: 'Regional Airport', country: 'US', lat: 40, lon: -90 };
  const recovered = { ...raw, city: 'Actual Town' };
  const city = destinationCities(recovered).primary;
  assert.equal(city.name, 'Actual Town');
  assert.equal(cityMatchesAirport(city, raw), true);
  assert.equal(raw.city, raw.name);
  assert.equal(city.lat, raw.lat);
  assert.equal(city.lon, raw.lon);
});

test('municipality recovery treats casing and punctuation variants of an airport name as missing city data', () => {
  const indexed = { id: 'TESTREC', code: 'REC', name: 'Côte d’Ouest Airport', city: 'Actual Town', country: 'US', lat: 40, lon: -90 };
  const raw = { ...indexed, city: "  COTE d'Ouest   AIRPORT  ", lat: 40.1 };
  const before = structuredClone(raw);
  const [merged] = mergeRouteAirports([indexed], { origin: raw, destination: raw });
  assert.equal(destinationCities(merged).primary.name, 'Actual Town');
  assert.equal(merged.lat, raw.lat);
  assert.deepEqual(raw, before);
  assert.equal(indexed.city, 'Actual Town');
});

test('familiar served cities rank first while original municipality IDs remain directly accepted', () => {
  const cities = indexCities(airports);
  for (const [id, name, secondary, secondaryID, query] of [['EPKK', 'Kraków', 'Balice', 'airport:PL:EPKK', 'Krakow'], ['LGAV', 'Athens', 'Spata-Artemida', 'airport:GR:LGAV', 'Athens']]) {
    const destination = destinationCities(byID(id));
    assert.equal(destination.primary.name, name);
    assert.deepEqual(destination.accepted.map(city => city.name), [name, secondary]);
    assert.equal(destination.accepted[1].id, secondaryID);
    assert.equal(searchCities(cities, query)[0].id, destination.primary.id);
    assert.equal(searchCities(cities, byID(id).code)[0].id, destination.primary.id);
    for (const city of destination.accepted) assert.equal(cityMatchesAirport(city, byID(id)), true);
    const homonym = { ...byID(id), id: 'TESTHOMONYM', code: 'ZZZ', country: 'US', city: name };
    assert.equal(cityMatchesAirport(destination.primary, homonym), false);
  }
  assert.ok(searchCities(cities, 'Greece A').some(city => city.id === 'gr-athens'));
  assert.ok(searchCities(cities, 'Poland K').some(city => city.id === 'pl-krakow'));
});
