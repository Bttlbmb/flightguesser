import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGame, submitGuess, revealClue, MAX_GUESSES } from '../../public/game.js';
import { indexCities, searchCities, cityLabel, destinationRepeatIds } from '../../public/destinations.js';
import { countryName, mergeRouteAirports } from '../../public/airports.js';
import { distanceKm, bearingDegrees, compassPoint, routeGeometry } from '../../public/geo.js';
import { createGameServer } from '../../scripts/serve.mjs';

const root = new URL('../../', import.meta.url);
const airports = JSON.parse(await readFile(new URL('public/data/airports.json', root), 'utf8'));
const practice = JSON.parse(await readFile(new URL('public/data/practice.json', root), 'utf8'));
const byCode = new Map(airports.map(a => [a.code, a]));
const cityIndex = indexCities(airports);
const profiles = ['casual', 'geography', 'aviation', 'cautious', 'analytical'];
const date = practice[0].recordedAt;
const norm = n => (n + 360) % 360;
function interpolate(a, b, fraction) {
  const rad = Math.PI / 180;
  const vector = p => [Math.cos(p.lat * rad) * Math.cos(p.lon * rad), Math.cos(p.lat * rad) * Math.sin(p.lon * rad), Math.sin(p.lat * rad)];
  const va = vector(a), vb = vector(b);
  const angle = Math.acos(Math.max(-1, Math.min(1, va.reduce((sum, v, i) => sum + v * vb[i], 0))));
  const w1 = Math.sin((1 - fraction) * angle) / Math.sin(angle), w2 = Math.sin(fraction * angle) / Math.sin(angle);
  const p = va.map((v, i) => v * w1 + vb[i] * w2);
  return { lat: Math.atan2(p[2], Math.hypot(p[0], p[1])) / rad, lon: Math.atan2(p[1], p[0]) / rad };
}
const patch = (name, lat, lon) => ({ name, lat, lon, kind: 'city' });
const places = {
  Seoul: patch('Seoul', 37.5665, 126.978), London: patch('London', 51.5074, -.1278),
  'New York': patch('New York', 40.7128, -74.006), Paris: patch('Paris', 48.8566, 2.3522),
  Singapore: patch('Singapore', 1.3521, 103.8198), Sydney: patch('Sydney', -33.8688, 151.2093),
  Tokyo: patch('Tokyo', 35.6762, 139.6503),
};
// Deliberately fabricated observations: these test the current rules, not real schedules or provider coverage.
const definitions = [
  { origin: 'ICN', destination: 'HND', place: 'Seoul', airline: ['KAL', 'Korean Air'], category: 'common-city' },
  { origin: 'LHR', destination: 'DXB', place: 'London', airline: ['UAE', 'Emirates'], category: 'airline-hub' },
  { origin: 'JFK', destination: 'PDX', place: 'New York', airline: ['ASA', 'Alaska Airlines'], category: 'same-name-city' },
  { origin: 'LHR', destination: 'KRK', place: 'London', airline: ['LOT', 'LOT Polish Airlines'], category: 'municipality-label' },
  { origin: 'CDG', destination: 'FNC', place: 'Paris', airline: ['TVF', 'Transavia France'], category: 'less-familiar-city' },
  { origin: 'SIN', destination: 'MNL', place: 'Singapore', airline: ['PAL', 'Philippine Airlines'], category: 'qualified-city-label' },
  { origin: 'LHR', destination: 'ATH', place: 'London', airline: ['AEE', 'Aegean Airlines'], category: 'municipality-label' },
  { origin: 'SYD', destination: 'MEL', place: 'Sydney', category: 'missing-airline' },
  { origin: 'LHR', destination: 'CDG', place: 'Paris', fraction: .82, airline: ['AFR', 'Air France'], category: 'near-arrival-fallback' },
  { origin: 'NRT', destination: 'YVR', place: 'Tokyo', airline: ['ACA', 'Air Canada'], category: 'long-haul-great-circle' },
];
const fixtures = definitions.map((def, i) => {
  const origin = structuredClone(byCode.get(def.origin)), destination = structuredClone(byCode.get(def.destination));
  const place = places[def.place];
  const point = interpolate(origin, destination, def.fraction ?? .012);
  const track = bearingDegrees(point, destination);
  const code = def.airline?.[0] ?? 'TST';
  const aircraft = { ...point, hex: (0xabcdef - i).toString(16), callsign: code + (100 + i), track, trueHeading: norm(track + 4), altitudeFt: 15000, speedKnots: 310, verticalRateFpm: 0, observedAt: date, positionObservedAt: date, positionAge: 0, distanceFromPlaceKm: distanceKm(place, point), type: 'A320' };
  const geometry = routeGeometry(aircraft, origin, destination);
  if (!geometry.plausible) throw new Error('Invalid fixture geometry ' + i);
  const route = { callsign: aircraft.callsign, origin, destination, provider: 'adsb.lol', matchedAt: date, geometry, confidence: 'reported', ...(def.airline ? { airlineCode: code, airline: { icao: code, name: def.airline[1], provider: 'adsbdb' } } : {}) };
  return { mode: 'practice', aircraft, route, place, recordedAt: date, provider: 'adsb.lol', auditFixture: true, auditCategory: def.category };
});
const sessions = new Map(profiles.map(id => [id, { id, position: -1, practiceIndex: 0, lastDestinationIds: new Set(), game: null, cityIndex, records: [], current: null }]));
const directions = { N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south', SW: 'southwest', W: 'west', NW: 'northwest' };
const plain = clue => clue.kind === 'direction'
  ? { title: 'First clue', type: clue.title, heading: Math.round(clue.heading) % 360, direction: clue.direction, distanceFromStartingCityKm: Math.max(1, Math.round(clue.distanceKm)) }
  : { title: clue.title, value: clue.value, detail: clue.detail };
function visible(s) {
  if (!s.game) return { player: s.id, status: 'ready', totalRounds: 20 };
  const g = s.game;
  const shown = g.status === 'playing' ? g.clues.slice(0, g.clueIndex + 1) : g.clues;
  return {
    player: s.id, roundNumber: s.position + 1, totalRounds: 20, phase: s.current.phase,
    status: g.status, startingCity: g.round.place.name,
    mapDescription: 'The aircraft marker is near ' + g.round.place.name + '. No route or destination is drawn before the round ends.',
    guessesLeft: MAX_GUESSES - g.guesses.length, cluesRemaining: Math.max(0, g.clues.length - 1 - g.clueIndex),
    clues: shown.map(plain),
    history: g.guesses.map(guess => ({ ...(guess.kind === 'clue' ? { action: 'clue' } : { action: 'guess', city: cityLabel(guess.city), country: countryName(guess.city.country), correct: guess.correct }), ...(Number.isInteger(guess.clueIndex) ? { revealedClue: plain(g.clues[guess.clueIndex]) } : {}) })),
    ...(g.status === 'playing' ? {} : { destinationCity: cityLabel(g.status === 'won' ? g.guesses.at(-1).city : g.destination.primary), mainDestinationCity: cityLabel(g.destination.primary), acceptedCities: g.destination.accepted.map(cityLabel), destinationCountry: countryName(g.round.route.destination.country), airport: g.round.route.destination.name + ' (' + g.round.route.destination.code + ')', callsign: g.round.aircraft.callsign }),
  };
}
const metadata = {
  startedAt: new Date().toISOString(), totalPlannedRounds: 100, players: profiles,
  methodology: 'Five independent LLM role-play agents, twenty scored rounds each. Same ten shipped practice rounds in actual rotation and same ten labeled synthetic fixtures. Core game and search imported unchanged. No live provider calls. Answer hidden until finish. Map represented by named starting city and rounded heading/distance, without a visual globe or precise aircraft coordinates.',
  sourceHashes: Object.fromEntries(await Promise.all(['public/game.js','public/destinations.js','public/app.js','public/data/practice.json','public/data/airports.json'].map(async path => [path, createHash('sha256').update(await readFile(new URL(path, root))).digest('hex')]))),
  fixtures: fixtures.map((round, i) => ({ number: 11 + i, category: round.auditCategory, round })),
};
async function persist() {
  const data = { metadata, updatedAt: new Date().toISOString(), players: [...sessions.values()].map(s => ({ player: s.id, started: s.records.length, completed: s.records.filter(r => r.status !== 'playing').length, rounds: s.records })) };
  await writeFile(new URL('./rounds.json', import.meta.url), JSON.stringify(data, null, 2));
}
function completeRecord(s) {
  const r = s.current, g = s.game;
  r.status = g.status;
  r.attemptsUsed = g.guesses.length;
  r.cityGuesses = g.guesses.filter(q => q.city).length;
  r.paidClues = g.assistance;
  if (g.status !== 'playing') {
    r.finishedAt = new Date().toISOString();
    r.answer = { city: cityLabel(g.destination.primary), accepted: g.destination.accepted.map(cityLabel), country: g.round.route.destination.country, airportId: g.round.route.destination.id, airportCode: g.round.route.destination.code };
    r.finalState = visible(s);
  }
}
function start(s) {
  if (s.game?.status === 'playing') throw new Error('Finish the current round before opening another.');
  if (s.position >= 19) return { player: s.id, status: 'complete', completed: 20 };
  s.position++;
  let round, phase;
  if (s.position < 10) {
    const index = Array.from({ length: practice.length }, (_, k) => (s.practiceIndex + k) % practice.length).find(i => !destinationRepeatIds(practice[i].route.destination).some(id => s.lastDestinationIds.has(id)));
    if (index === undefined) throw new Error('Practice rotation has no different destination.');
    round = structuredClone(practice[index]);
    s.practiceIndex = (index + 1) % practice.length;
    phase = 'shipped-practice';
  } else { round = structuredClone(fixtures[s.position - 10]); phase = 'controlled-fixture'; }
  s.cityIndex = indexCities(mergeRouteAirports(airports, round.route));
  s.game = createGame(round);
  s.lastDestinationIds = new Set(destinationRepeatIds(round.route.destination, s.game.destination));
  s.current = { number: s.position + 1, phase, category: round.auditCategory ?? 'bundled-recording', startedAt: new Date().toISOString(), status: 'playing', actions: [] };
  s.records.push(s.current);
  s.current.initialState = visible(s);
  completeRecord(s);
  return visible(s);
}
function search(s, query) {
  const matches = searchCities(s.cityIndex, query);
  return { query, total: matches.total, cities: matches.map((c, i) => ({ choice: i, id: c.id, name: cityLabel(c), country: countryName(c.country), countryCode: c.country, ...(c.fallback ? { airport: c.airportName, airportCode: c.airportCode } : {}) })) };
}
function act(s, input) {
  if (!s.game || s.game.status !== 'playing') throw new Error('Open a playing round first.');
  if (!['guess','clue'].includes(input.action)) throw new Error('Use action guess or clue.');
  const before = visible(s);
  const evidence = { action: input.action, reason: String(input.reason ?? '').slice(0, 1800), source: String(input.source ?? '').slice(0, 120), confidence: typeof input.confidence === 'number' ? input.confidence : null, before, at: new Date().toISOString() };
  if (input.action === 'clue') {
    if (!revealClue(s.game)) throw new Error('No further clue is available.');
  } else {
    let city;
    if (typeof input.cityId === 'string') city = s.cityIndex.find(c => c.id === input.cityId);
    else {
      if (typeof input.query !== 'string' || !input.query.trim()) throw new Error('Provide a city query or cityId.');
      const matches = searchCities(s.cityIndex, input.query);
      const choice = Number.isInteger(input.choice) ? input.choice : 0;
      city = matches[choice];
      evidence.query = input.query; evidence.choice = choice;
      evidence.search = search(s, input.query);
    }
    if (!city) throw new Error('No matching city. Search before guessing.');
    evidence.cityId = city.id; evidence.city = cityLabel(city);
    const result = submitGuess(s.game, city);
    if (!result.accepted) throw new Error(result.reason);
    evidence.correct = result.guess.correct;
  }
  evidence.after = visible(s);
  s.current.actions.push(evidence);
  completeRecord(s);
  return evidence.after;
}
const send = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
const api = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/audit/overview') return send(res, 200, { players: [...sessions.values()].map(s => ({ player: s.id, roundsStarted: s.records.length, completed: s.records.filter(r => r.status !== 'playing').length, currentRound: s.position + 1, state: s.game?.status ?? 'ready' })), planned: 100 });
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 3 || parts[0] !== 'play' || !sessions.has(parts[1])) return send(res, 404, { error: 'Use your assigned /play/player/state, search, next or action endpoint.' });
    const s = sessions.get(parts[1]), endpoint = parts[2];
    if (req.method === 'GET' && endpoint === 'state') return send(res, 200, visible(s));
    if (req.method === 'GET' && endpoint === 'search') return send(res, 200, search(s, url.searchParams.get('q') ?? ''));
    if (req.method !== 'POST') return send(res, 405, { error: 'POST required for actions.' });
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 8000) throw new Error('Request too large'); }
    const input = body ? JSON.parse(body) : {};
    let result;
    if (endpoint === 'next') result = start(s);
    else if (endpoint === 'action') result = act(s, input);
    else throw new Error('Unknown endpoint');
    await persist(); send(res, 200, result);
  } catch (error) { send(res, 400, { error: error.message }); }
});
await persist();
const staticServer = createGameServer({ directory: new URL('public/', root).pathname, live: false });
staticServer.listen(5191, '127.0.0.1', () => console.log('Current unmodified game: http://127.0.0.1:5191'));
api.listen(5190, '127.0.0.1', () => console.log('Blind playtest API: http://127.0.0.1:5190/play/PLAYER/state'));
process.on('SIGINT', () => { api.close(); staticServer.close(); process.exit(0); });
