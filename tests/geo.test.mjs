import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm, bearingDegrees, angularDifference, compassPoint, validCoordinates, routeGeometry } from '../public/geo.js';

test('great-circle distances handle the antimeridian, poles, and identical points', () => {
  assert.equal(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 0 }), 0);
  assert.ok(Math.abs(distanceKm({ lat: 0, lon: 179 }, { lat: 0, lon: -179 }) - 222.390) < 0.01);
  assert.ok(Math.abs(distanceKm({ lat: 90, lon: 0 }, { lat: -90, lon: 0 }) - 20015.114) < 0.01);
  assert.equal(distanceKm({ lat: null, lon: 0 }, { lat: 0, lon: 0 }), null);
  assert.equal(validCoordinates({ lat: 91, lon: 0 }), false);
  assert.equal(validCoordinates(null), false);
});

test('bearing and compass wrap correctly without inventing a direction at the answer', () => {
  assert.equal(bearingDegrees({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }), 90);
  assert.equal(bearingDegrees({ lat: 0, lon: 0 }, { lat: 0, lon: 0 }), null);
  assert.equal(angularDifference(359, 1), 2);
  assert.equal(angularDifference(-721, 1), 2);
  assert.equal(compassPoint(359), 'N');
  assert.equal(compassPoint(90), 'E');
});

test('geometry rejects direction-reversed and off-route matches', () => {
  const origin = { lat: 0, lon: 0 };
  const destination = { lat: 0, lon: 10 };
  assert.equal(routeGeometry({ lat: 0, lon: 5, track: 90 }, origin, destination).plausible, true);
  assert.equal(routeGeometry({ lat: 0, lon: 5, track: 270 }, origin, destination).reason, 'track-away-from-destination');
  assert.equal(routeGeometry({ lat: 20, lon: 5, track: 90 }, origin, destination).reason, 'outside-route-corridor');
  assert.equal(routeGeometry({ lat: 0, lon: 5, track: null }, origin, destination).plausible, false);
});
