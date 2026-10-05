import { readFile, writeFile } from 'node:fs/promises';
import { aircraftCandidates, normalizeRoute, normalizeAirline, observationTime } from '../public/flights.js';

if (process.argv.slice(2).some(arg => arg !== '--check') || process.argv.length > 3) throw new Error('Usage: node scripts/prepare-practice.mjs [--check]');

const evidence = new URL('../docs/evidence/', import.meta.url);
const payload = JSON.parse(await readFile(new URL('selection-seoul-nearby.json', evidence), 'utf8'));
const place = { name: 'Seoul', lat: 37.5665, lon: 126.978, kind: 'city' };
// Validate recordings at their original time, never at today's clock.
const recordedAt = observationTime(payload);
const candidates = aircraftCandidates(payload, place, 50, recordedAt);
const rounds = [];
for (const callsign of ['KAL2197', 'ESR209', 'APJ735', 'ESR206']) {
  const aircraft = candidates.find(candidate => candidate.callsign === callsign);
  if (!aircraft) throw new Error(`No eligible recorded observation for ${callsign}`);
  const raw = JSON.parse(await readFile(new URL(`selection-${callsign}-route.json`, evidence), 'utf8'));
  const route = normalizeRoute(raw, aircraft);
  if (!route) throw new Error(`Evidence does not support ${callsign}`);
  const airlineEvidence = JSON.parse(await readFile(new URL(`airline-${route.airlineCode}.json`, evidence), 'utf8'));
  const matches = airlineEvidence.response?.filter(value => value.icao === route.airlineCode);
  const airline = matches?.length === 1 ? normalizeAirline(matches[0], route.airlineCode) : null;
  if (!airline) throw new Error(`Airline evidence does not support ${callsign}`);
  route.airline = airline;
  route.matchedAt = recordedAt;
  rounds.push({ mode: 'practice', aircraft, route, place, recordedAt, searchRadiusNm: 50, provider: 'adsb.lol' });
}
const target = new URL('../public/data/practice.json', import.meta.url);
const output = JSON.stringify(rounds) + '\n';
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8') !== output) throw new Error('Practice data needs rebuilding');
  console.log('Practice data matches its original observations and routes');
} else {
  await writeFile(target, output);
  console.log(`Prepared ${rounds.length} recorded rounds from original evidence`);
}
