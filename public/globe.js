import { geoOrthographic, geoPath, geoGraticule, geoDistance } from './vendor/d3-geo.js';
import land from './data/world-land.js';
import { validCoordinates, compassPoint } from './geo.js';

const RADIUS = 58;
const CENTER = [66, 68];
const radians = value => value * Math.PI / 180;
const degrees = value => value * 180 / Math.PI;
const fixed = value => Number(value.toFixed(3));
const graticule = geoGraticule().step([30, 30])();
let cachedObservation;

function observationHeading(aircraft) {
  if (Number.isFinite(aircraft.trueHeading) && aircraft.trueHeading >= 0 && aircraft.trueHeading < 360) return aircraft.trueHeading;
  if (Number.isFinite(aircraft.track) && aircraft.track >= 0 && aircraft.track < 360) return aircraft.track;
  return null;
}

// Project a compass tangent rather than rotating by its geographic bearing.
// This also works at a pole, where stepping latitude/longitude is unstable.
function directionAngle(aircraft, heading, center) {
  const lat = radians(aircraft.lat), delta = radians(aircraft.lon - center[0]);
  const centerLat = radians(center[1]), bearing = radians(heading);
  const east = Math.sin(bearing), north = Math.cos(bearing);
  const x = east * Math.cos(delta) - north * Math.sin(lat) * Math.sin(delta);
  const y = -east * Math.sin(centerLat) * Math.sin(delta)
    - north * (Math.sin(centerLat) * Math.sin(lat) * Math.cos(delta) + Math.cos(centerLat) * Math.cos(lat));
  return Math.atan2(y, x);
}

function directionArrow(point, angle) {
  const x = Math.cos(angle), y = Math.sin(angle);
  const px = point[0] - CENTER[0], py = point[1] - CENTER[1];
  const along = px * x + py * y;
  const edge = -along + Math.sqrt(along * along + RADIUS * RADIUS - px * px - py * py);
  const end = Math.min(24, edge - 1), start = Math.min(11, end / 2);
  const tip = [point[0] + x * end, point[1] + y * end];
  const headLength = Math.min(4, (end - start) / 2), headWidth = headLength * .6;
  const base = [tip[0] - x * headLength, tip[1] - y * headLength];
  return `<line class="globe-direction" x1="${fixed(point[0] + x * start)}" y1="${fixed(point[1] + y * start)}" x2="${fixed(tip[0])}" y2="${fixed(tip[1])}"/>
    <path class="globe-direction globe-direction-head" d="M${fixed(base[0] - y * headWidth)} ${fixed(base[1] + x * headWidth)}L${fixed(tip[0])} ${fixed(tip[1])}L${fixed(base[0] + y * headWidth)} ${fixed(base[1] - x * headWidth)}"/>`;
}

function observationGeometry(aircraft, heading) {
  // Guesses and clues reuse the frozen observation. Keep one projection rather
  // than redraw every continent, and compare values so changed inputs stay safe.
  if (cachedObservation?.lat === aircraft.lat && cachedObservation.lon === aircraft.lon && cachedObservation.heading === heading) return cachedObservation;
  const center = [aircraft.lon - 15, Math.max(-45, Math.min(45, aircraft.lat))];
  const projection = geoOrthographic().rotate([-center[0], -center[1]])
    .scale(RADIUS).translate(CENTER).clipAngle(90).precision(.3);
  const path = geoPath(projection).digits(2);
  const point = projection([aircraft.lon, aircraft.lat]);
  const angle = directionAngle(aircraft, heading, center);
  cachedObservation = {
    lat: aircraft.lat, lon: aircraft.lon, heading, center, projection, path, point,
    background: `<path class="globe-ocean" d="${path({ type: 'Sphere' })}"/>
    <path class="globe-grid" d="${path(graticule)}"/>
    <path class="globe-land" d="${path(land) || ''}"/>`,
    direction: directionArrow(point, angle),
    // The authored silhouette points north; SVG rotation is clockwise from north.
    rotation: fixed(degrees(angle) + 90),
  };
  return cachedObservation;
}

function revealedRoute(route, projection, path, center, planePoint) {
  if (!route || !validCoordinates(route.origin) || !validCoordinates(route.destination)) return { connection: '', endpoint: '', overlap: false, summary: '' };
  const origin = [route.origin.lon, route.origin.lat];
  const destination = [route.destination.lon, route.destination.lat];
  const connectionPath = path({ type: 'LineString', coordinates: [origin, destination] });
  const connection = connectionPath ? `<path class="globe-route" d="${connectionPath}"/>` : '';
  let endpoint = '', overlap = false;
  // Orthographic point projection alone does not hide the far hemisphere.
  if (geoDistance(center, destination) < Math.PI / 2) {
    const point = projection(destination);
    overlap = Math.hypot(point[0] - planePoint[0], point[1] - planePoint[1]) < 17;
    endpoint = `<circle class="globe-marker globe-destination" cx="${fixed(point[0])}" cy="${fixed(point[1])}" r="3.2"/>`;
    const code = route.destination.code;
    if (typeof code === 'string' && /^[A-Z0-9]{3,4}$/.test(code)) {
      const right = point[0] + 8;
      const left = point[0] - 8;
      const rightFits = right + code.length * 6 < 128;
      const labelX = rightFits ? right : left;
      const labelY = point[1] - 7;
      if (labelY > 12 && labelY < 123 && (rightFits || left - code.length * 6 > 4)) {
        endpoint += `<text class="globe-airport-label globe-destination-label" x="${fixed(labelX)}" y="${fixed(labelY)}" text-anchor="${rightFits ? 'start' : 'end'}">${code}</text>`;
      }
    }
  }
  return { connection, endpoint, overlap, summary: ' A dotted line shows the schematic reported route; it is not a recorded flight path.' };
}

/** Render only a frozen aircraft observation. Pass a reported route only after the round ends. */
export function globeHTML(aircraft, options = {}) {
  if (!validCoordinates(aircraft)) return '';
  const heading = observationHeading(aircraft);
  if (heading === null) return '';
  const { center, projection, path, point, background, direction, rotation } = observationGeometry(aircraft, heading);
  // Route geometry is always separate from the cached observation: revealing
  // an answer must never leave destination information in a later playing view.
  const route = revealedRoute(options?.route, projection, path, center, point);
  const headingLabel = heading === aircraft.trueHeading ? 'Current true heading' : 'Current direction of travel';
  const summary = `Globe showing the aircraft position at observation. ${headingLabel} ${Math.round(heading) % 360} degrees ${compassPoint(heading)}.${route.summary}`;
  return `<svg class="flight-globe" viewBox="0 0 132 132" role="img" aria-label="${summary}" focusable="false">
    ${background}
    ${route.connection}
    ${direction}
    <circle class="globe-halo" cx="${fixed(point[0])}" cy="${fixed(point[1])}" r="11"/>
    <g class="globe-plane${route.overlap ? ' globe-plane-dimmed' : ''}" transform="translate(${fixed(point[0])} ${fixed(point[1])}) rotate(${rotation})"><path d="M0-10.5C1-10.5 1.4-9 1.4-7V-2L9 3V5L1.4 2.5V7L4.4 9V10.5L0 9.2-4.4 10.5V9L-1.4 7V2.5L-9 5V3L-1.4-2V-7C-1.4-9-1-10.5 0-10.5Z"/></g>
    ${route.endpoint}
    <text class="globe-north" x="66" y="8" text-anchor="middle" aria-hidden="true">N</text>
  </svg>`;
}
