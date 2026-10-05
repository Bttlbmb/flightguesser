import { DataError } from './api.js';
import { decodeAirportData, validAirport } from './airports.js';
import { validCoordinates } from './geo.js';
import { destinationRepeatIds } from './destinations.js';

const validTime = value => Number.isFinite(value) && Number.isFinite(new Date(value).getTime());

export function validRecordedRound(round) {
  const aircraft = round?.aircraft, route = round?.route;
  return round?.mode === 'practice' && validTime(round.recordedAt)
    && validCoordinates(aircraft) && validTime(aircraft.positionObservedAt)
    && Number.isFinite(aircraft.track) && aircraft.track >= 0 && aircraft.track < 360
    && Number.isFinite(aircraft.distanceFromPlaceKm) && aircraft.distanceFromPlaceKm >= 0
    && typeof aircraft.callsign === 'string' && /^[A-Z]{3}\d[A-Z0-9]{0,6}$/.test(aircraft.callsign)
    && validAirport(route?.origin) && validAirport(route?.destination)
    && route.origin.id !== route.destination.id && route.callsign === aircraft.callsign
    && ['adsb.lol', 'adsbdb'].includes(route.provider)
    && validCoordinates(round.place) && typeof round.place.name === 'string' && !!round.place.name.trim();
}

/** Keep local parser failures behind a useful recovery message. Failed loads can retry. */
export async function loadLocalData(path, { code, message, decode, fetcher = fetch }) {
  try {
    const response = await fetcher(path, { signal: AbortSignal.timeout(10000), credentials: 'omit' });
    if (!response.ok) throw new Error('Unavailable data file');
    return decode(await response.json());
  } catch {
    throw new DataError(code, message);
  }
}

export const loadAirportData = () => loadLocalData('./data/airports.json', {
  code: 'airports', message: 'The city list could not be loaded. Try again.', decode: decodeAirportData,
});

export const loadPracticeData = () => loadLocalData('./data/practice.json', {
  code: 'practice', message: 'The recorded flight could not be loaded. Try again.',
  decode: rounds => {
    if (!Array.isArray(rounds) || !rounds.length || !rounds.every(validRecordedRound)) throw new Error('Invalid recordings');
    return rounds;
  },
});

/** Move only an opened recording to the back. A skipped recording keeps its turn. */
export function createPracticeRotation(rounds) {
  const pending = [...rounds];
  return {
    next(excludedDestinationIds, resolveDestination = airport => airport) {
      return pending.find(round => !destinationRepeatIds(resolveDestination(round.route.destination))
        .some(id => excludedDestinationIds.has(id)));
    },
    commit(round) {
      const index = pending.indexOf(round);
      if (index < 0) throw new Error('Unknown practice recording');
      pending.push(...pending.splice(index, 1));
    },
  };
}
