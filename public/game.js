import { distanceKm, bearingDegrees, compassPoint } from './geo.js';
import { countryName } from './airports.js';
import { destinationCities, cityMatchesAirport, cityLabel } from './destinations.js';
import { normalizeAirline } from './flights.js';

export const MAX_GUESSES = 6;

/** Destination clues use rounded straight-line kilometres, never arrival times. */
export function formatClueDistance(distance) {
  if (!Number.isFinite(distance) || distance < 0) throw new RangeError('A distance must be a nonnegative number.');
  return `${distance < 1 ? '<1' : Math.round(distance).toLocaleString('en')} km`;
}

export function createGame(round) {
  const destination = destinationCities(round.route.destination);
  if (!destination.primary || !destination.accepted.length) throw new Error('The reported airport has no usable destination city.');
  // Flight facts stay fixed. The first missed city adds one
  // reference-city clue; later guesses cannot generate fresh geometry.
  const clues = cluesForRound(round, destination);
  const game = { round, destination, clues, guesses: [], clueIndex: 0, status: 'playing' };
  return game;
}

export function cluesForRound(round, destination = destinationCities(round.route.destination)) {
  const a = round.aircraft;
  const r = round.route;
  const hasTrueHeading = Number.isFinite(a.trueHeading) && a.trueHeading >= 0 && a.trueHeading < 360;
  const heading = hasTrueHeading ? a.trueHeading : a.track;
  const initial = {
    kind: 'direction', title: hasTrueHeading ? 'Current heading' : 'Current direction of travel',
    heading, direction: compassPoint(heading), distanceKm: a.distanceFromPlaceKm,
    detail: 'At the observation. The plane can turn before arrival.',
  };
  const clues = [initial];
  if (r.destination.country) clues.push({ kind: 'text', title: 'Destination country', value: countryName(r.destination.country), detail: 'From the reported route.' });
  const straightLine = distanceKm(a, destination.primary);
  if (straightLine !== null) clues.push({ kind: 'text', title: 'Distance remaining', value: formatClueDistance(straightLine), detail: 'Straight-line estimate to the main destination city. The flight path may be longer.' });
  const airline = normalizeAirline(r.airline, r.airlineCode, r.airline?.provider);
  if (airline && r.callsign?.startsWith(airline.icao)) clues.push({ kind: 'text', title: 'Airline', value: airline.name, detail: 'Operating airline.' });
  const initials = [...new Set(destination.accepted.map(city => Array.from(city.name.trim())[0]?.toLocaleUpperCase('en')).filter(Boolean))];
  if (initials.length) clues.push({ kind: 'text', title: 'City initial', value: initials.join(' / '), detail: `An accepted city starts with ${initials.join(' or ')}.` });
  return clues;
}

export function submitGuess(game, city) {
  if (game.status !== 'playing') return { accepted: false, reason: 'finished' };
  if (!city || typeof city.id !== 'string' || !city.id || typeof city.name !== 'string' || !city.name.trim()
    || !Array.isArray(city.airportIds) || !city.airportIds.length || distanceKm(city, game.destination.primary) === null) return { accepted: false, reason: 'select-city' };
  if (game.guesses.some(guess => guess.city?.id === city.id)) return { accepted: false, reason: 'duplicate' };
  const firstCityGuess = !game.guesses.some(guess => guess.city);
  // Direct airport membership decides a win, even when an accepted city's
  // reference point differs from the main city used for miss feedback.
  const correct = cityMatchesAirport(city, game.round.route.destination);
  const guess = { city, correct, distanceKm: distanceKm(city, game.destination.primary), bearing: correct ? null : bearingDegrees(city, game.destination.primary) };
  game.guesses.push(guess);
  if (!correct && firstCityGuess) {
    const direction = ({ N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south', SW: 'southwest', W: 'west', NW: 'northwest' })[compassPoint(guess.bearing)] ?? 'Nearby';
    // This clue remains tied to the first city; later guesses never update it.
    game.clues.splice(game.clueIndex + 1, 0, { kind: 'text', title: 'Distance & direction', value: `${formatClueDistance(guess.distanceKm)} · ${direction}`, detail: `From ${cityLabel(city)} to the main destination city.` });
    game.clueIndex++;
    guess.clueIndex = game.clueIndex;
  }
  if (correct) game.status = 'won';
  else if (game.guesses.length >= MAX_GUESSES) game.status = 'lost';
  else if (!firstCityGuess && game.clueIndex < game.clues.length - 1) {
    game.clueIndex++;
    guess.clueIndex = game.clueIndex;
  }
  return { accepted: true, guess, status: game.status };
}
