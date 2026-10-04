import test from 'node:test';
import assert from 'node:assert/strict';
import { aircraftCandidates, normalizeObservation, normalizeRoute, normalizeAirline, normalizeAirport, observationTime } from '../public/flights.js';

const place = { lat: 0, lon: 5 };
const now = Date.now();
const raw = { hex: 'abc123', flight: 'ABC123  ', lat: 0, lon: 5, alt_baro: 34000, gs: 420, track: 90, baro_rate: 0, seen_pos: 2, seen: 1 };
const aircraft = normalizeObservation(raw, now, place);
const airport = (icao, lon) => ({ icao, iata: icao.slice(1), name: `${icao} Airport`, location: icao, countryiso2: 'GB', lat: 0, lon });
const route = { callsign: 'ABC123', plausible: true, _airports: [airport('AAAA', 0), airport('BBBB', 10)] };

test('airline identity requires a named exact ICAO match, without changing route validation', () => {
  const airline = { name: ' Example Air ', icao: 'ABC' };
  assert.deepEqual(normalizeAirline(airline, 'ABC'), { name: 'Example Air', icao: 'ABC', provider: 'adsbdb' });
  for (const value of [null, { name: 'Name', icao: 'DEF' }, { name: 42, icao: 'ABC' }, { name: ' ', icao: 'ABC' }, { name: 'Invalid\nname', icao: 'ABC' }]) assert.equal(normalizeAirline(value, 'ABC'), null);
  assert.equal(normalizeRoute({ ...route, airline_code: 'ABC' }, aircraft).airlineCode, 'ABC');
  assert.equal(normalizeRoute({ ...route, airline_code: 'DEF' }, aircraft).airlineCode, undefined);
  assert.equal(normalizeRoute({ ...route, airline_code: 'ABC', plausible: false }, aircraft), null);
});

test('fresh airborne candidates preserve valid zero telemetry', () => {
  assert.equal(aircraft.verticalRateFpm, 0);
  assert.equal(aircraft.distanceFromPlaceKm, 0);
  assert.equal(observationTime({ now: now / 1000 }), now);
  assert.equal(normalizeObservation({ ...raw, lat: null }, now, place), null);
  assert.equal(normalizeObservation({ ...raw, seen_pos: null }, now, place), null);
  assert.equal(normalizeObservation({ ...raw, seen_pos: 31 }, now, place), null);
  assert.equal(normalizeObservation(raw, now - 61000, place), null);
  assert.equal(normalizeObservation({ ...raw, alt_baro: 'ground' }, now, place), null);
  assert.equal(normalizeObservation({ ...raw, flight: 'N12345' }, now, place), null);
  assert.equal(normalizeObservation({ ...raw, hex: 123456 }, now, place), null);
  assert.equal(normalizeObservation(raw, now, place, NaN), null);
  assert.equal(normalizeObservation({ ...raw, hex: 'ABC123' }, now, place).hex, 'abc123');
  assert.equal(normalizeObservation({ ...raw, true_heading: 360 }, now, place).trueHeading, null);
  assert.equal(normalizeObservation({ ...raw, true_heading: 0 }, now, place).trueHeading, 0);
});

test('selection rejects duplicate callsigns and targets outside the requested radius', () => {
  assert.equal(aircraftCandidates({ now, ac: [null, 42, raw] }, place, 50).length, 1);
  assert.equal(aircraftCandidates({ now, ac: [raw, { ...raw, hex: 'abc124' }] }, place, 50).length, 0);
  assert.equal(aircraftCandidates({ now, ac: [{ ...raw, lon: 15 }] }, place, 50).length, 0);
  assert.equal(aircraftCandidates({ now, ac: [raw] }, place, 50).length, 1);
});

test('route answers require an exact callsign, two distinct valid airports, and plausible geometry', () => {
  assert.equal(normalizeRoute(route, aircraft)?.destination.id, 'BBBB');
  assert.equal(normalizeRoute({ ...route, callsign: 'ABC124' }, aircraft), null);
  assert.equal(normalizeRoute({ ...route, _airports: [...route._airports, airport('CCCC', 12)] }, aircraft), null);
  assert.equal(normalizeRoute({ ...route, plausible: false }, aircraft), null);
  assert.equal(normalizeRoute(route, { ...aircraft, track: 270 }), null);
  assert.equal(normalizeRoute(route, null), null);
  assert.equal(normalizeRoute(route, aircraft, 'unknown'), null);
  assert.equal(normalizeAirport({ ...airport('AAAA', 0), lat: null }), null);
  assert.equal(normalizeAirport({ ...airport('AAAA', 0), name: { value: 'Airport' } }), null);
  assert.equal(normalizeAirport({ ...airport('AAAA', 0), iata: ['AAA'] }), null);
});

test('adsbdb route has the same safety boundary and excludes midpoint ambiguity', () => {
  const dbAirport = (icao, lon) => ({ icao_code: icao, iata_code: icao.slice(1), name: `${icao} Airport`, municipality: icao, country_iso_name: 'GB', latitude: 0, longitude: lon });
  const flightroute = { callsign_icao: 'ABC123', origin: dbAirport('AAAA', 0), destination: dbAirport('BBBB', 10), airline: { name: 'Example Air', icao: 'ABC' } };
  assert.equal(normalizeRoute({ response: { flightroute } }, aircraft, 'adsbdb')?.confidence, 'reported');
  assert.equal(normalizeRoute({ response: { flightroute } }, aircraft, 'adsbdb').airline.name, 'Example Air');
  assert.equal(normalizeRoute({ response: { flightroute: { ...flightroute, midpoint: dbAirport('CCCC', 7) } } }, aircraft, 'adsbdb'), null);
});
