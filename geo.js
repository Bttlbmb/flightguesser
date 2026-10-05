export const EARTH_RADIUS_KM = 6371.0088;
const rad = value => value * Math.PI / 180;
const deg = value => value * 180 / Math.PI;

export function validCoordinates(point) {
  return Boolean(point) && Number.isFinite(point.lat) && Number.isFinite(point.lon)
    && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180;
}

export function distanceKm(a, b) {
  if (!validCoordinates(a) || !validCoordinates(b)) return null;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  // Roundoff near antipodal points can push h just outside the square-root domain.
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)));
}

export function bearingDegrees(a, b) {
  // Nearly coincident points have no useful direction; do not invent one at the answer.
  if (!validCoordinates(a) || !validCoordinates(b) || distanceKm(a, b) < 0.001) return null;
  const delta = rad(b.lon - a.lon);
  const y = Math.sin(delta) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat))
    - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(delta);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function angularDifference(a, b) {
  // JavaScript remainder keeps its sign; normalize it before measuring the short arc.
  return Math.abs((((a - b) % 360 + 540) % 360) - 180);
}

export function compassPoint(degrees) {
  if (!Number.isFinite(degrees)) return null;
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((degrees % 360) + 360) % 360 / 45) % 8];
}

export function routeGeometry(aircraft, origin, destination) {
  if (![aircraft, origin, destination].every(validCoordinates)) return { plausible: false, reason: 'missing-coordinates' };
  const length = distanceKm(origin, destination);
  if (length < 50) return { plausible: false, reason: 'route-too-short' };
  const fromOrigin = distanceKm(origin, aircraft);
  const toDestination = distanceKm(aircraft, destination);
  const excess = fromOrigin + toDestination - length;
  // Allow normal routing deviations while rejecting an obvious callsign mismatch.
  if (excess > Math.max(150, length * 0.15)) return { plausible: false, reason: 'outside-route-corridor' };
  const destinationBearing = bearingDegrees(aircraft, destination);
  if (!Number.isFinite(aircraft.track) || (destinationBearing !== null && angularDifference(aircraft.track, destinationBearing) > 85)) {
    return { plausible: false, reason: 'track-away-from-destination' };
  }
  return { plausible: true, lengthKm: length, toDestinationKm: toDestination, excessKm: excess };
}
