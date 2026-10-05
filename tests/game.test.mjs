import { decodeAirportData } from '../public/airports.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGame, submitGuess, revealClue, cluesForRound, MAX_GUESSES, formatClueDistance } from '../public/game.js';
import { destinationCities } from '../public/destinations.js';
import { distanceKm, bearingDegrees } from '../public/geo.js';

const [airlineRound] = JSON.parse(await readFile(new URL('../public/data/practice.json', import.meta.url), 'utf8'));
// Most rule cases exercise the shorter sequence used when airline data is absent.
const { airline: omittedAirline, airlineCode: omittedCode, ...routeWithoutAirline } = airlineRound.route;
const round = { ...airlineRound, route: routeWithoutAirline };
const airports = decodeAirportData(JSON.parse(await readFile(new URL('../public/data/airports.json', import.meta.url), 'utf8')));
const airport = code => airports.find(value => value.code === code);
const city = code => destinationCities(airport(code)).primary;
const roundTo = code => ({ ...round, route: { ...round.route, destination: airport(code) } });
const linked = (code, name) => destinationCities(airport(code)).accepted.find(value => value.name === name);

test('country and remaining distance precede optional airline, with the initial last', () => {
  const game = createGame(airlineRound);
  assert.deepEqual(game.clues.map(clue => clue.title), ['Current heading', 'Destination country', 'Distance remaining', 'Airline', 'City initial']);
  assert.equal(game.clues[3].value, 'Korean Air');
  assert.equal(submitGuess(game, city('LHR')).guess.clueIndex, 1);
  assert.equal(game.clues[1].title, 'Distance & direction');
  assert.equal(submitGuess(game, city('HND')).guess.clueIndex, 2);
  assert.equal(game.clues[2].title, 'Destination country');
  assert.equal(submitGuess(game, city('ICN')).guess.clueIndex, 3);
  assert.equal(game.clues[3].title, 'Distance remaining');
  assert.equal(submitGuess(game, city('CJU')).guess.clueIndex, 4);
  assert.equal(game.clues[4].value, 'Korean Air');
  assert.equal(submitGuess(game, city('JFK')).guess.clueIndex, 5);
  assert.equal(game.clues[5].title, 'City initial');
  for (const airline of [null, { name: ' ', icao: 'KAL' }, { name: 'Wrong airline', icao: 'ABC' }, { name: 'x'.repeat(151), icao: 'KAL' }]) {
    assert.equal(cluesForRound({ ...airlineRound, route: { ...airlineRound.route, airline } }).some(clue => clue.title === 'Airline'), false);
  }
  assert.equal(cluesForRound(round).some(clue => clue.title === 'Airline'), false);
});

test('the first missed city reveals one combined distance/direction clue that never updates or repeats', () => {
  const game = createGame(airlineRound);
  assert.equal(submitGuess(game, null).accepted, false);
  assert.equal(game.clues.some(clue => clue.title === 'Distance & direction'), false);
  const first = submitGuess(game, city('LHR')).guess;
  const clue = structuredClone(game.clues[first.clueIndex]);
  assert.equal(clue.title, 'Distance & direction');
  assert.equal(clue.value, '9,308 km · northeast');
  assert.equal(clue.detail, 'From London to the main destination city.');
  assert.equal(game.guesses.length, 1);
  assert.equal(game.assistance, 0);
  const beforeDuplicate = structuredClone(game);
  assert.equal(submitGuess(game, city('LHR')).reason, 'duplicate');
  assert.deepEqual(game, beforeDuplicate);
  for (const code of ['HND', 'ICN', 'CJU', 'JFK', 'CDG']) submitGuess(game, city(code));
  assert.deepEqual(game.clues.filter(value => value.title === 'Distance & direction'), [clue]);
  assert.equal(game.guesses.filter(guess => game.clues[guess.clueIndex]?.title === clue.title).length, 1);
  assert.equal(game.status, 'lost');
});

test('paid reveals before the first city keep their history and still allow one first-guess clue', () => {
  const game = createGame(airlineRound);
  while (revealClue(game)) {}
  const paidHistory = game.guesses.map(guess => structuredClone(game.clues[guess.clueIndex]));
  assert.equal(game.guesses.length, 4);
  const miss = submitGuess(game, city('LHR')).guess;
  assert.equal(game.clues[miss.clueIndex].title, 'Distance & direction');
  assert.deepEqual(game.guesses.slice(0, 4).map(guess => game.clues[guess.clueIndex]), paidHistory);
  assert.equal(game.guesses.length, 5);
  const last = submitGuess(game, city('HND')).guess;
  assert.equal(Object.hasOwn(last, 'clueIndex'), false);
  assert.equal(game.clues.filter(clue => clue.title === 'Distance & direction').length, 1);
  assert.equal(game.status, 'lost');
});

test('a correct first city ends the round without creating a reference-city clue', () => {
  const game = createGame(airlineRound);
  assert.equal(submitGuess(game, game.destination.primary).status, 'won');
  assert.equal(game.clues.some(clue => clue.title === 'Distance & direction'), false);
  assert.equal(Object.hasOwn(game.guesses[0], 'clueIndex'), false);
});

test('missing, malformed and repeated city selections preserve guesses and clues', () => {
  const game = createGame(round);
  for (const selection of [null, airport('LHR'), { ...city('LHR'), lat: 95 }, { ...city('LHR'), airportIds: [] }]) {
    assert.equal(submitGuess(game, selection).reason, 'select-city');
  }
  assert.equal(game.guesses.length, 0);
  assert.equal(game.clueIndex, 0);
  assert.equal(submitGuess(game, city('LHR')).accepted, true);
  assert.equal(game.clueIndex, 1);
  assert.equal(submitGuess(game, { ...city('LGW'), name: 'London alias' }).reason, 'duplicate');
  assert.equal(game.guesses.length, 1);
  assert.equal(game.clueIndex, 1);
});

test('extra clues consume an attempt and stop at the actual final clue', () => {
  const game = createGame(round);
  const count = cluesForRound(round).length;
  for (let i = 1; i < count; i++) {
    assert.equal(revealClue(game), true);
    assert.equal(game.guesses.length, i);
    assert.deepEqual(game.guesses.at(-1), { kind: 'clue', clueIndex: i, correct: false });
  }
  const before = structuredClone(game);
  assert.equal(revealClue(game), false);
  assert.deepEqual(game, before);
  assert.equal(game.assistance, count - 1);
  assert.equal(game.guesses.length, count - 1);
  assert.equal(game.clueIndex, count - 1);
});

test('paid clues and city guesses share the six attempts and preserve duplicate protection', () => {
  const game = createGame(round);
  assert.equal(revealClue(game), true);
  assert.equal(submitGuess(game, city('LHR')).accepted, true);
  assert.equal(submitGuess(game, city('LHR')).reason, 'duplicate');
  assert.equal(game.guesses.length, 2);
  assert.equal(game.clueIndex, 2);
  assert.equal(game.assistance, 1);
  for (const code of ['HND', 'ICN', 'CJU']) assert.equal(submitGuess(game, city(code)).accepted, true);
  assert.equal(game.status, 'playing');
  assert.equal(submitGuess(game, game.destination.primary).status, 'won');
  assert.equal(game.guesses.length, 6);
  const before = structuredClone(game);
  assert.equal(revealClue(game), false);
  assert.deepEqual(game, before);
});

test('mixed paid clues and missed city guesses retain each newly revealed clue in order', () => {
  const game = createGame(round);
  const originalClues = structuredClone(game.clues);
  assert.equal(revealClue(game), true);
  const firstMiss = submitGuess(game, city('LHR')).guess;
  assert.equal(revealClue(game), true);
  const secondMiss = submitGuess(game, city('HND')).guess;
  assert.deepEqual(game.guesses.map(guess => guess.clueIndex), [1, 2, 3, 4]);
  assert.equal(firstMiss, game.guesses[1]);
  assert.equal(secondMiss, game.guesses[3]);
  assert.deepEqual(game.guesses.map(guess => game.clues[guess.clueIndex].title), ['Destination country', 'Distance & direction', 'Distance remaining', 'City initial']);
  assert.deepEqual(game.clues.filter(clue => clue.title !== 'Distance & direction'), originalClues);
  assert.equal(game.assistance, 2);
  assert.equal(game.guesses.length, 4);
  assert.equal(game.status, 'playing');
});

test('history follows the actual clue list when optional facts are missing and does not repeat exhausted clues', () => {
  const partial = structuredClone(round);
  partial.route.destination.country = '';
  const game = createGame(partial);
  assert.deepEqual(game.clues.map(clue => clue.title), ['Current heading', 'Distance remaining', 'City initial']);
  const distanceMiss = submitGuess(game, city('LHR')).guess;
  assert.equal(game.clues[distanceMiss.clueIndex].title, 'Distance & direction');
  assert.equal(revealClue(game), true);
  assert.equal(game.clues[game.guesses.at(-1).clueIndex].title, 'Distance remaining');
  const initialMiss = submitGuess(game, city('HND')).guess;
  assert.equal(game.clues[initialMiss.clueIndex].title, 'City initial');
  const exhaustedMiss = submitGuess(game, city('ICN')).guess;
  assert.equal(Object.hasOwn(exhaustedMiss, 'clueIndex'), false);
  assert.equal(game.clueIndex, game.clues.length - 1);
  assert.equal(game.guesses.length, 4);
  assert.equal(game.status, 'playing');
});

test('a correct city guess does not attach a new clue to the winning history row', () => {
  const game = createGame(round);
  const miss = submitGuess(game, city('LHR')).guess;
  const winner = submitGuess(game, game.destination.primary).guess;
  assert.equal(miss.clueIndex, 1);
  assert.equal(Object.hasOwn(winner, 'clueIndex'), false);
  assert.equal(game.clueIndex, 1);
  assert.equal(game.status, 'won');
});

test('a terminal miss leaves remaining unrevealed clues unattached to its history row', () => {
  const game = createGame(round);
  while (game.clues.length <= MAX_GUESSES) game.clues.push({ kind: 'text', title: 'Additional clue', value: 'An extra clue' });
  const misses = ['LHR', 'HND', 'ICN', 'CJU', 'JFK', 'CDG'].map(code => submitGuess(game, city(code)).guess);
  assert.deepEqual(misses.slice(0, 5).map(guess => guess.clueIndex), [1, 2, 3, 4, 5]);
  assert.equal(Object.hasOwn(misses.at(-1), 'clueIndex'), false);
  assert.equal(game.clueIndex, 5);
  assert.equal(game.clues.length, 8);
  assert.equal(game.status, 'lost');
});

test('revealing a clue on the sixth attempt loses the round and freezes further actions', () => {
  const game = createGame(round);
  while (game.clues.length <= MAX_GUESSES) game.clues.push({ kind: 'text', title: 'Additional clue', value: 'An extra clue' });
  for (const code of ['LHR', 'HND', 'ICN', 'CJU', 'JFK']) assert.equal(submitGuess(game, city(code)).accepted, true);
  assert.equal(game.status, 'playing');
  assert.equal(revealClue(game), true);
  assert.equal(game.guesses.length, 6);
  assert.equal(game.guesses.at(-1).kind, 'clue');
  assert.equal(game.clueIndex, 6);
  assert.equal(game.status, 'lost');
  const before = structuredClone(game);
  assert.equal(revealClue(game), false);
  assert.equal(submitGuess(game, game.destination.primary).reason, 'finished');
  assert.deepEqual(game, before);
});

test('Tokyo is correct for either Haneda or Narita without changing the reported airport', () => {
  for (const code of ['HND', 'NRT']) {
    const source = roundTo(code);
    const before = structuredClone(source);
    const game = createGame(source);
    assert.equal(submitGuess(game, city('HND')).status, 'won');
    assert.deepEqual(source, before);
    assert.equal(game.round.route.destination.code, code);
    assert.equal(submitGuess(game, city('LHR')).reason, 'finished');
    assert.equal(revealClue(game), false);
  }
});

test('Seoul and Incheon each match ICN, while Incheon does not match GMP', () => {
  for (const name of ['Seoul', 'Incheon']) {
    const game = createGame(roundTo('ICN'));
    assert.equal(submitGuess(game, linked('ICN', name)).status, 'won');
  }
  const gimpo = createGame(roundTo('GMP'));
  assert.equal(submitGuess(gimpo, linked('ICN', 'Incheon')).guess.correct, false);
  assert.equal(gimpo.status, 'playing');
  assert.equal(submitGuess(gimpo, linked('ICN', 'Seoul')).status, 'won');
});

test('Narita is accepted for NRT but is not transitively accepted for Haneda', () => {
  assert.equal(submitGuess(createGame(roundTo('NRT')), linked('NRT', 'Narita')).status, 'won');
  const haneda = createGame(roundTo('HND'));
  assert.equal(submitGuess(haneda, linked('NRT', 'Narita')).guess.correct, false);
  assert.equal(haneda.status, 'playing');
});

test('miss geometry uses city reference points, while a linked win keeps its real internal distance', () => {
  const game = createGame(roundTo('ICN'));
  const london = city('LHR');
  const miss = submitGuess(game, london).guess;
  assert.equal(miss.distanceKm, distanceKm(london, game.destination.primary));
  assert.equal(miss.bearing, bearingDegrees(london, game.destination.primary));
  assert.notEqual(miss.distanceKm, distanceKm(london, game.round.route.destination));
  const win = submitGuess(game, linked('ICN', 'Incheon')).guess;
  assert.equal(win.correct, true);
  assert.ok(win.distanceKm > 1);
  assert.equal(win.distanceKm, distanceKm(win.city, game.destination.primary));
  assert.equal(win.bearing, null);
});

test('city initials include every linked answer and never expose an airport-code clue', () => {
  const incheon = cluesForRound(roundTo('ICN'));
  assert.equal(incheon.at(-1).title, 'City initial');
  assert.deepEqual(incheon.at(-1).value.split(' / ').sort(), ['I', 'S']);
  const narita = cluesForRound(roundTo('NRT'));
  assert.deepEqual(narita.at(-1).value.split(' / ').sort(), ['N', 'T']);
  assert.equal(narita.some(clue => clue.title === 'Airport code'), false);
});

test('aircraft-distance clue uses the primary city without changing the exact route target', () => {
  const source = roundTo('ICN');
  const clue = cluesForRound(source).find(value => value.title === 'Distance remaining');
  const expected = Math.round(distanceKm(source.aircraft, destinationCities(source.route.destination).primary)).toLocaleString('en');
  assert.equal(clue.value, `${expected} km`);
  assert.match(clue.detail, /main destination city/);
  assert.equal(source.route.destination.id, 'RKSI');
});

test('six different wrong cities end the round while retaining the frozen answer', () => {
  const game = createGame(round);
  const answer = structuredClone(game.round.route.destination);
  for (const code of ['LHR', 'HND', 'ICN', 'CJU', 'JFK', 'CDG']) assert.equal(submitGuess(game, city(code)).accepted, true);
  assert.equal(game.status, 'lost');
  assert.equal(game.guesses.length, 6);
  assert.deepEqual(game.round.route.destination, answer);
  assert.equal(submitGuess(game, game.destination.primary).reason, 'finished');
});

test('telemetry never becomes a clue, even when all aircraft facts are reported', () => {
  const reported = structuredClone(round);
  reported.aircraft.altitudeFt = 31000;
  reported.aircraft.speedKnots = 510;
  reported.aircraft.verticalRateFpm = 0;
  const partial = structuredClone(round);
  partial.aircraft.altitudeFt = null;
  partial.aircraft.speedKnots = null;
  partial.aircraft.verticalRateFpm = null;
  const clues = cluesForRound(reported);
  assert.deepEqual(clues.map(clue => clue.title), ['Current heading', 'Destination country', 'Distance remaining', 'City initial']);
  assert.deepEqual(clues, cluesForRound(partial));
  assert.equal(clues.some(clue => clue.kind === 'telemetry'), false);
  assert.equal(clues.some(clue => /arrival|ETA/i.test(clue.title)), false);
});

test('origin is never a clue, whether its municipality is known or missing', () => {
  const partial = structuredClone(round);
  partial.route.origin = { ...airport('LHR'), id: 'UNKNOWN', city: '', name: 'Unknown airport' };
  assert.deepEqual(cluesForRound(round), cluesForRound(partial));
  assert.equal(cluesForRound(round).some(clue => clue.title === 'Origin city'), false);
  assert.equal(cluesForRound(partial).some(clue => clue.title === 'Origin city'), false);
  assert.equal(submitGuess(createGame(partial), destinationCities(partial.route.destination).primary).status, 'won');
});

test('an unmappable or invalid destination never opens an unguessable city round', () => {
  for (const destination of [{ ...airport('LHR'), id: 'UNKNOWN', city: '', name: 'Unknown airport' }, { ...airport('LHR'), lat: null }]) {
    assert.throws(() => createGame({ ...round, route: { ...round.route, destination } }), /city/);
  }
});

test('distance clues round kilometres and reject missing or invalid distances', () => {
  for (const [distance, expected] of [[0, '<1 km'], [.5, '<1 km'], [1, '1 km'], [258.4, '258 km'], [1076, '1,076 km']]) {
    assert.equal(formatClueDistance(distance), expected);
  }
  for (const distance of [null, NaN, Infinity, -1]) assert.throws(() => formatClueDistance(distance), /distance/);
});

test('current direction preserves true north and explains that the aircraft can turn', () => {
  const north = cluesForRound({ ...round, aircraft: { ...round.aircraft, trueHeading: 0, track: 90 } })[0];
  assert.equal(north.title, 'Current heading');
  assert.equal(north.heading, 0);
  assert.match(north.detail, /can turn before arrival/);
  const track = cluesForRound({ ...round, aircraft: { ...round.aircraft, trueHeading: null, track: 90 } })[0];
  assert.equal(track.title, 'Current direction of travel');
  assert.equal(track.heading, 90);
});

test('served-city labels and initials include Kraków and Athens without removing old answers', () => {
  for (const [code, main, secondary, initials] of [['KRK', 'Kraków', 'Balice', ['K', 'B']], ['ATH', 'Athens', 'Spata-Artemida', ['A', 'S']]]) {
    const source = roundTo(code);
    assert.equal(createGame(source).destination.primary.name, main);
    assert.deepEqual(cluesForRound(source).at(-1).value.split(' / '), initials);
    for (const name of [main, secondary]) {
      const game = createGame(source);
      assert.equal(submitGuess(game, linked(code, name)).status, 'won');
      assert.equal(game.round.route.destination.code, code);
      assert.equal(game.clues.some(clue => clue.title === 'Distance & direction'), false);
    }
  }
});
