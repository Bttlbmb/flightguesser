import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { globeHTML } from '../public/globe.js';
import land from '../public/data/world-land.js';
import { geoOrthographic, geoContains } from '../public/vendor/d3-geo.js';

const practice = JSON.parse(await readFile(new URL('../public/data/practice.json', import.meta.url), 'utf8'))[0];

function planeTransform(html) {
  const match = html.match(/class="globe-plane(?: globe-plane-dimmed)?" transform="translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\)"/);
  assert.ok(match, 'an aircraft marker must have a finite projected transform');
  return { x: Number(match[1]), y: Number(match[2]), rotation: Number(match[3]) };
}

function angularDifference(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

// An independent short geodesic gives the local direction in the rendered map.
function expectedRotation(aircraft, bearing) {
  const radians = value => value * Math.PI / 180;
  const lat = radians(aircraft.lat), lon = radians(aircraft.lon), angle = radians(bearing);
  const step = radians(.0001);
  const nextLat = Math.asin(Math.sin(lat) * Math.cos(step) + Math.cos(lat) * Math.sin(step) * Math.cos(angle));
  const nextLon = lon + Math.atan2(Math.sin(angle) * Math.sin(step) * Math.cos(lat), Math.cos(step) - Math.sin(lat) * Math.sin(nextLat));
  const centerLat = Math.max(-45, Math.min(45, aircraft.lat));
  const project = geoOrthographic().rotate([15 - aircraft.lon, -centerLat]).scale(58).translate([66, 68]);
  const a = project([aircraft.lon, aircraft.lat]), b = project([nextLon * 180 / Math.PI, nextLat * 180 / Math.PI]);
  return Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI + 90;
}

test('globe rejects missing or invalid coordinates and directions without inventing values', () => {
  for (const aircraft of [undefined, null, {}, { lat: null, lon: 0, track: 90 }, { lat: '0', lon: 0, track: 90 },
    { lat: 91, lon: 0, track: 90 }, { lat: 0, lon: -181, track: 90 }, { lat: 0, lon: Infinity, track: 90 },
    { lat: 0, lon: 0, track: null }, { lat: 0, lon: 0, trueHeading: 360, track: 360 },
    { lat: 0, lon: 0, trueHeading: -1, track: NaN }]) {
    assert.equal(globeHTML(aircraft), '');
  }
});

test('heading selection preserves zero and falls back to track only when true heading is invalid', () => {
  const base = { lat: 37, lon: 127 };
  const trueNorth = globeHTML({ ...base, trueHeading: 0, track: 180 });
  assert.match(trueNorth, /Current true heading 0 degrees N/);
  assert.equal(planeTransform(trueNorth).rotation, planeTransform(globeHTML({ ...base, track: 0 })).rotation);
  for (const trueHeading of [null, undefined, -1, 360, NaN, Infinity, '90']) {
    const fallback = globeHTML({ ...base, trueHeading, track: 90 });
    assert.match(fallback, /Current direction of travel 90 degrees E/);
    assert.equal(planeTransform(fallback).rotation, planeTransform(globeHTML({ ...base, track: 90 })).rotation);
  }
});

test('cardinal and diagonal headings follow projected local directions near poles and antimeridian', () => {
  for (const position of [{ lat: 0, lon: 0 }, { lat: 37.28833, lon: 126.919088 },
    { lat: 55, lon: 179.999 }, { lat: -55, lon: -179.999 }, { lat: 89.9, lon: 45 }, { lat: -89.9, lon: -90 }]) {
    for (const heading of [0, 45, 90, 180, 270, 359]) {
      const aircraft = { ...position, track: heading };
      const actual = planeTransform(globeHTML(aircraft));
      assert.ok(angularDifference(actual.rotation, expectedRotation(aircraft, heading)) < .06,
        `${JSON.stringify(position)}, heading ${heading}: local map direction differs`);
      assert.ok(Math.hypot(actual.x - 66, actual.y - 68) < 58, 'aircraft must stay on the visible hemisphere');
    }
  }
});

test('exact poles render stable finite markers and direction arrows remain inside the globe', () => {
  for (const lat of [-90, 90]) for (const lon of [-180, 0, 180]) for (const track of [0, 90, 180, 270]) {
    const html = globeHTML({ lat, lon, track });
    assert.doesNotMatch(html, /NaN|Infinity/);
    const aircraft = planeTransform(html);
    assert.ok(Number.isFinite(aircraft.rotation));
    const ray = html.match(/class="globe-direction" x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/);
    assert.ok(ray);
    for (let i = 1; i <= 3; i += 2) assert.ok(Math.hypot(Number(ray[i]) - 66, Number(ray[i + 1]) - 68) < 58);
    const head = html.match(/class="globe-direction globe-direction-head" d="M([-\d.]+) ([-\d.]+)L([-\d.]+) ([-\d.]+)L([-\d.]+) ([-\d.]+)"/);
    assert.ok(head, 'the direction line must have an arrowhead');
    assert.deepEqual(head.slice(3, 5), ray.slice(3, 5), 'the arrowhead must meet the forward end of the line');
    for (let i = 1; i <= 5; i += 2) assert.ok(Math.hypot(Number(head[i]) - 66, Number(head[i + 1]) - 68) < 58);
    const tip = head.slice(3, 5).map(Number);
    const base = [(Number(head[1]) + Number(head[5])) / 2, (Number(head[2]) + Number(head[6])) / 2];
    const headDirection = Math.atan2(tip[1] - base[1], tip[0] - base[0]) * 180 / Math.PI + 90;
    assert.ok(angularDifference(headDirection, aircraft.rotation) < .1, 'the arrowhead must point in the aircraft direction');
  }
});

test('bundled published geometry renders land across continents and keeps ocean distinct', () => {
  assert.equal(land.type, 'MultiPolygon');
  assert.ok(land.coordinates.length > 100);
  for (const [lon, lat] of [[126.978, 37.5665], [13.4, 52.5], [7.4, 9.1], [-105, 40], [133.88, -23.7]]) {
    assert.equal(geoContains(land, [lon, lat]), true);
    const html = globeHTML({ lat, lon, track: 90 });
    const path = html.match(/class="globe-land" d="([^"]+)"/);
    assert.ok(path && path[1].length > 100, 'visible hemisphere should contain real continental geometry');
    assert.doesNotMatch(html, /NaN|Infinity/);
  }
  assert.equal(geoContains(land, [-140, 0]), false);
});

test('default globe is fixed and contains no hidden route or destination information', () => {
  const html = globeHTML(practice.aircraft);
  assert.equal(html, globeHTML(practice.aircraft));
  assert.equal(html, globeHTML({ ...practice.aircraft, route: practice.route, destination: practice.route.destination, callsign: '<script>secret</script>' }));
  assert.doesNotMatch(html, /globe-route|globe-destination|KIJ|Niigata|ICN|<script>|data-lat|data-lon/);
  assert.match(html, /position at observation/);
});

test('reused observations reflect changed coordinates and headings without retaining a revealed answer', () => {
  const aircraft = { lat: 37.5, lon: 127, track: 90 };
  const baseline = globeHTML(aircraft);
  globeHTML(aircraft, { route: practice.route });
  assert.equal(globeHTML(aircraft), baseline, 'a reveal must not leak into an unrevealed view');

  aircraft.trueHeading = 90;
  assert.match(globeHTML(aircraft), /Current true heading 90 degrees E/);
  aircraft.trueHeading = 180;
  assert.notEqual(planeTransform(globeHTML(aircraft)).rotation, planeTransform(baseline).rotation);
  aircraft.lat = -37.5;
  aircraft.lon = -127;
  assert.notDeepEqual(planeTransform(globeHTML(aircraft)), planeTransform(baseline));
  assert.equal(globeHTML({ lat: 37.5, lon: 127, track: 90 }), baseline, 'returning to an earlier observation must restore its geometry');
});

test('explicit revealed route adds schematic geometry without moving the frozen aircraft', () => {
  const before = planeTransform(globeHTML(practice.aircraft));
  const html = globeHTML(practice.aircraft, { route: practice.route });
  assert.deepEqual(planeTransform(html), before);
  assert.match(html, /class="globe-route"/);
  assert.match(html, /class="globe-marker globe-destination"/);
  assert.match(html, />KIJ<\/text>/);
  assert.match(html, /globe-plane-dimmed/);
  assert.ok(html.indexOf('globe-destination"') > html.indexOf('class="globe-plane'), 'revealed marker must paint above the plane');
  assert.match(html, /schematic reported route/);
});

test('far-hemisphere destinations are clipped rather than changing the globe or showing a mirrored marker', () => {
  const route = { origin: practice.route.origin, destination: { lat: 40.7, lon: -74, code: 'JFK' } };
  const html = globeHTML(practice.aircraft, { route });
  assert.deepEqual(planeTransform(html), planeTransform(globeHTML(practice.aircraft)));
  assert.match(html, /class="globe-route"/);
  assert.doesNotMatch(html, /globe-destination|>JFK</);
  const d = html.match(/class="globe-route" d="([^"]+)"/)[1];
  const numbers = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  for (let i = 0; i < numbers.length; i += 2) assert.ok(Math.hypot(numbers[i] - 66, numbers[i + 1] - 68) <= 58.02, 'route must be clipped at the globe rim');
});

test('malformed reveal data leaves the aircraft intact and airport codes cannot inject markup', () => {
  const baseline = globeHTML(practice.aircraft);
  for (const route of [null, {}, { origin: practice.route.origin }, { origin: {}, destination: practice.route.destination },
    { origin: practice.route.origin, destination: { lat: 91, lon: 0 } }]) {
    assert.equal(globeHTML(practice.aircraft, { route }), baseline);
  }
  const html = globeHTML(practice.aircraft, { route: { ...practice.route, destination: { ...practice.route.destination, code: '<script>bad</script>' } } });
  assert.match(html, /globe-destination/);
  assert.doesNotMatch(html, /<script>|bad|globe-destination-label/);
});
