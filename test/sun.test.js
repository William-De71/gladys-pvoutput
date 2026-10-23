// Sunrise and sunset (NOAA equations), against the published times, within
// two minutes; the polar cases; day or night at an instant.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunTimes, sunAt } from '../src/sun.js';

const near = (instant, iso, label) =>
  assert.ok(
    Math.abs(instant - Date.parse(iso)) <= 2 * 60 * 1000,
    `${label}: ${new Date(instant).toISOString()} vs ${iso}`,
  );

test('sunrise and sunset match the published times', () => {
  // Paris, summer solstice: 05:47 and 21:58 CEST.
  const paris = sunTimes('20260621', 48.8566, 2.3522, 'Europe/Paris');
  near(paris.sunrise, '2026-06-21T03:47:00Z', 'Paris sunrise');
  near(paris.sunset, '2026-06-21T19:58:00Z', 'Paris sunset');
  // New York, same day: 05:25 and 20:31 EDT.
  const york = sunTimes('20260621', 40.7128, -74.006, 'America/New_York');
  near(york.sunrise, '2026-06-21T09:25:00Z', 'New York sunrise');
  near(york.sunset, '2026-06-22T00:31:00Z', 'New York sunset');
  // Sydney, southern summer: 05:41 and 20:05 AEDT.
  const sydney = sunTimes('20261221', -33.8688, 151.2093, 'Australia/Sydney');
  near(sydney.sunrise, '2026-12-20T18:41:00Z', 'Sydney sunrise');
  near(sydney.sunset, '2026-12-21T09:05:00Z', 'Sydney sunset');
});

test('polar night and polar day have no sunrise nor sunset', () => {
  assert.equal(sunTimes('20261221', 78.22, 15.65, 'Arctic/Longyearbyen').polar, 'night');
  assert.equal(sunTimes('20260621', 78.22, 15.65, 'Arctic/Longyearbyen').polar, 'day');
  const day = sunAt(Date.parse('2026-06-21T00:00:00Z'), {
    latitude: 78.22,
    longitude: 15.65,
    timeZone: 'Arctic/Longyearbyen',
  });
  assert.equal(day.day, true);
});

test('day or night at an instant, at the place of a system', () => {
  const place = { latitude: 47.24, longitude: 6.02, timeZone: 'Europe/Paris' };
  assert.equal(sunAt(Date.parse('2026-10-23T12:00:00Z'), place).day, true);
  assert.equal(sunAt(Date.parse('2026-10-23T20:00:00Z'), place).day, false);
  assert.equal(sunAt(Date.parse('2026-10-23T04:00:00Z'), place).day, false);
  assert.equal(sunAt(Date.now(), { latitude: null, longitude: 6, timeZone: 'UTC' }), null);
});
