import { distanceKm, bearingDegrees, angularDifference } from './geo.js';
import { destinationCities, destinationRepeatIds } from './destinations.js';

export const MIN_REMAINING_KM = 250;
export const LOCAL_DESTINATION_RADIUS_KM = 150;
export const SELECTION_HISTORY_SIZE = 10;
export const TARGET_DESTINATION_COUNT = 4;
export const COMPARISON_WINDOW_MS = 8000;

const overlap = (a, b) => a.some(id => b.includes(id));
const bandFor = km => km < 1000 ? 'regional' : km < 4000 ? 'medium' : 'long';
const unit = random => {
  const value = random();
  return Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0;
};

export function selectionProfile(round, place = round.place, { resolveDestination = airport => airport } = {}) {
  const { aircraft, route } = round;
  const destinationAirport = resolveDestination(route.destination);
  const destination = destinationCities(destinationAirport);
  if (!destination.primary || !destination.accepted.length) throw new Error('No destination city.');
  const remainingKm = distanceKm(aircraft, destination.primary);
  const airportRemainingKm = distanceKm(aircraft, route.destination);
  const destinationFromPlaceKm = Math.min(distanceKm(place, route.destination),
    ...destination.accepted.map(city => distanceKm(place, city)));
  // Device locations have no city identity. Geographic distance also covers
  // airports shared by two cities, such as Seoul and Incheon.
  const localDestination = destinationFromPlaceKm < LOCAL_DESTINATION_RADIUS_KM;
  const approaching = airportRemainingKm < 500 && aircraft.altitudeFt < 12000
    && aircraft.verticalRateFpm < -300;
  const direction = Number.isFinite(aircraft.trueHeading) && aircraft.trueHeading >= 0 && aircraft.trueHeading < 360
    ? aircraft.trueHeading : aircraft.track;
  const bearing = bearingDegrees(aircraft, destination.primary);
  const headingError = bearing === null ? 180 : angularDifference(direction, bearing);
  const valid = [remainingKm, airportRemainingKm, destinationFromPlaceKm, headingError].every(Number.isFinite);
  return {
    destinationIds: destinationRepeatIds(destinationAirport, destination),
    country: destinationAirport.country || '',
    airline: route.airlineCode || aircraft.callsign.slice(0, 3),
    routeKey: `${route.origin.id}:${route.destination.id}`,
    lengthBand: bandFor(remainingKm),
    remainingKm, airportRemainingKm, destinationFromPlaceKm, headingError,
    localDestination, approaching,
    eligible: valid && !localDestination && !approaching
      && remainingKm >= MIN_REMAINING_KM && airportRemainingKm >= MIN_REMAINING_KM,
    curatedCity: !destination.primary.fallback,
  };
}

export function selectionHistoryEntry(round, options = {}) {
  const profile = selectionProfile(round, round.place, options);
  // History contains answer identities, never the player's location or telemetry.
  return {
    destinationIds: profile.destinationIds, country: profile.country,
    airline: profile.airline, routeKey: profile.routeKey, lengthBand: profile.lengthBand,
  };
}

export function rememberSelection(history, round, options = {}) {
  return [...history, selectionHistoryEntry(round, options)].slice(-SELECTION_HISTORY_SIZE);
}

export function scoreSelection(profile, history = []) {
  const recent = history.slice(-SELECTION_HISTORY_SIZE).reverse();
  let repeated = 0, country = 0, airline = 0, length = 0;
  recent.forEach((entry, index) => {
    const weight = 1 - index / SELECTION_HISTORY_SIZE;
    if (overlap(profile.destinationIds, entry.destinationIds || [])) repeated = Math.max(repeated, weight);
    if (profile.country && entry.country === profile.country) country += weight;
    if (entry.airline === profile.airline) airline += weight;
    if (entry.lengthBand === profile.lengthBand) length += weight;
  });
  // Novel answers dominate soft preferences; country, carrier and length then
  // break up runs of otherwise equally good geography puzzles.
  return 100 + 20 * Math.max(0, 1 - profile.headingError / 90) + (profile.curatedCity ? 3 : 0)
    - (repeated ? 80 + 20 * repeated : 0)
    - Math.min(24, country * 8) - Math.min(12, airline * 4) - Math.min(16, length * 5);
}

export function rankSelections(candidates, history = []) {
  const ranked = candidates.filter(candidate => candidate.profile.eligible)
    .map(candidate => ({ candidate, score: scoreSelection(candidate.profile, history) }))
    .sort((a, b) => b.score - a.score || a.candidate.aircraft.callsign.localeCompare(b.candidate.aircraft.callsign));
  const distinct = [];
  for (const item of ranked) {
    if (!distinct.some(other => overlap(item.candidate.profile.destinationIds, other.candidate.profile.destinationIds))) distinct.push(item);
  }
  return distinct;
}

export function pickSelection(candidates, { history = [], random = Math.random } = {}) {
  const ranked = rankSelections(candidates, history);
  if (!ranked.length) return null;
  // Sample similarly strong answers once per city, so ten planes going to one
  // hub do not get ten times the chance of a single flight elsewhere.
  const pool = ranked.filter(item => item.score >= ranked[0].score - 12);
  const total = pool.reduce((sum, item) => sum + 13 - (ranked[0].score - item.score), 0);
  let draw = unit(random) * total;
  for (const item of pool) {
    draw -= 13 - (ranked[0].score - item.score);
    if (draw < 0) return item;
  }
  return pool.at(-1);
}

function shuffled(values, random) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(unit(random) * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

function orderTier(candidates, random) {
  const groups = new Map();
  for (const aircraft of candidates) {
    const key = `${aircraft.callsign.slice(0, 3)}:${Math.floor(aircraft.track / 45)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ aircraft, priority:
      (aircraft.altitudeFt >= 18000 ? 12 : 0)
      - (aircraft.altitudeFt < 12000 && aircraft.verticalRateFpm < -300 ? 24 : 0)
      + unit(random) * 8 });
  }
  const ordered = shuffled([...groups.values()], random)
    .map(group => group.sort((a, b) => b.priority - a.priority).map(item => item.aircraft));
  const result = [];
  // Spend scarce lookups across carrier/direction groups before taking another
  // plane from the same group. Nearest-first repeatedly samples hub arrivals.
  for (let index = 0; ordered.some(group => index < group.length); index++) {
    for (const group of ordered) if (group[index]) result.push(group[index]);
  }
  return result;
}

export function orderAircraftCandidates(candidates, random = Math.random) {
  const descending = aircraft => aircraft.altitudeFt < 12000 && aircraft.verticalRateFpm < -300;
  // Round-robin within each telemetry tier. A fleet of low descending arrivals
  // must not bury multiple cruise flights merely because it has more carriers.
  return [
    ...orderTier(candidates.filter(aircraft => !descending(aircraft)), random),
    ...orderTier(candidates.filter(descending), random),
  ];
}
