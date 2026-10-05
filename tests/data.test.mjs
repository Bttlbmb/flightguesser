import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { decodeAirportData, resolveRouteAirport } from '../public/airports.js';
import { createPracticeRotation, validRecordedRound, loadLocalData } from '../public/data.js';
import { destinationRepeatIds } from '../public/destinations.js';

const recordings = JSON.parse(await readFile(new URL('../public/data/practice.json', import.meta.url), 'utf8'));
const row = ['TEST', 'TES', 'Test Airport', 'Test City', 'GB', 0, 0];

test('compact airport data rejects incompatible, incomplete and ambiguous rows', () => {
  const airport = decodeAirportData({ version: 1, airports: [row] })[0];
  assert.equal(airport.major, false);
  assert.equal(airport.lat, 0);
  assert.equal(decodeAirportData({ version: 1, airports: [[...row, 1]] })[0].major, true);
  for (const data of [null, [], { version: 2, airports: [row] }, { version: 1, airports: [] },
    { version: 1, airports: [row, row] }, { version: 1, airports: [row.slice(0, 6)] },
    { version: 1, airports: [[...row, 2]] }, { version: 1, airports: [[...row.slice(0, 5), null, 0]] },
    { version: 1, airports: [[...row.slice(0, 4), '', 0, 0]] }]) {
    assert.throws(() => decodeAirportData(data));
  }
});

test('local data failures retain a readable recovery error and allow a fresh retry', async () => {
  const options = { code: 'airports', message: 'Try the city list again.', decode: decodeAirportData };
  for (const fetcher of [async () => { throw new Error('Offline'); }, async () => new Response('bad json'),
    async () => new Response('{}'), async () => new Response('{}', { status: 503 })]) {
    await assert.rejects(loadLocalData('/data/airports.json', { ...options, fetcher }),
      { code: 'airports', message: options.message });
  }
  const data = await loadLocalData('/data/airports.json', { ...options,
    fetcher: async () => new Response(JSON.stringify({ version: 1, airports: [row] })) });
  assert.equal(data[0].city, 'Test City');
});

test('all recordings remain reachable without adjacent repeats of accepted cities', () => {
  const rotation = createPracticeRotation(recordings);
  let previous = new Set();
  const callsigns = [];
  for (let index = 0; index < 12; index++) {
    const round = rotation.next(previous);
    assert.ok(round);
    const ids = destinationRepeatIds(round.route.destination);
    assert.equal(ids.some(id => previous.has(id)), false);
    callsigns.push(round.aircraft.callsign);
    previous = new Set(ids);
    rotation.commit(round);
  }
  assert.deepEqual(callsigns.slice(0, 5), ['KAL2197', 'ESR209', 'APJ735', 'KAL2197', 'ESR206']);
  assert.equal(new Set(callsigns).size, 4);
});

test('uncommitted practice openings do not advance and a repeated-only pool is empty', () => {
  const rotation = createPracticeRotation(recordings);
  assert.equal(rotation.next(new Set()), recordings[0]);
  assert.equal(rotation.next(new Set()), recordings[0]);
  assert.equal(createPracticeRotation([recordings[0]]).next(new Set(destinationRepeatIds(recordings[0].route.destination))), undefined);
  assert.throws(() => rotation.commit({}), /Unknown/);
});

test('recorded data requires original timestamps, valid places and matching route identity', () => {
  assert.ok(recordings.every(validRecordedRound));
  for (const mutate of [r => { r.recordedAt = NaN; }, r => { r.place.lat = null; },
    r => { r.route.callsign = 'ABC123'; }, r => { r.route.destination.city = ''; },
    r => { r.aircraft.track = 360; }, r => { r.mode = 'live'; }]) {
    const round = structuredClone(recordings[0]);
    mutate(round);
    assert.equal(validRecordedRound(round), false);
  }
});

test('municipality recovery preserves provider coordinates and does not mutate source data', () => {
  const airports = decodeAirportData({ version: 1, airports: [row] });
  const endpoint = { ...airports[0], city: 'Test Airport', lat: .5, name: 'Provider Airport' };
  endpoint.city = endpoint.name;
  const resolved = resolveRouteAirport(airports, endpoint);
  assert.equal(resolved.city, 'Test City');
  assert.equal(resolved.lat, .5);
  assert.equal(endpoint.city, 'Provider Airport');
  assert.equal(airports[0].lat, 0);
});

test('practice can be reproduced exactly from the preserved source responses', async () => {
  await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../scripts/prepare-practice.mjs', import.meta.url)), '--check']);
});
