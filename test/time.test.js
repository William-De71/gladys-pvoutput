// Timezones: PVOutput writes local dates and times of each system, without a
// zone; the conversions go through Intl only, the changes of time included.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  localParts,
  toInstant,
  addDays,
  isoDate,
  systemTimeZone,
  isTimeZone,
  formatTime,
  formatDate,
} from '../src/time.js';

test('local parts of an instant, in the timezone of a system', () => {
  const at = Date.parse('2026-10-23T12:00:00Z');
  assert.deepEqual(
    [localParts(at, 'Europe/Paris').date, localParts(at, 'Europe/Paris').time],
    ['20261023', '14:00'],
  );
  assert.equal(localParts(at, 'Australia/Sydney').time, '23:00');
  // Past midnight in Sydney: already the next day there.
  assert.equal(localParts(Date.parse('2026-10-23T14:30:00Z'), 'Australia/Sydney').date, '20261024');
  assert.equal(localParts(at, 'America/Los_Angeles').iso, '2026-10-23');
});

test('a local date and time back to an instant, both changes of time of Paris', () => {
  assert.equal(toInstant('20261023', '14:05', 'Europe/Paris'), Date.parse('2026-10-23T12:05:00Z'));
  // Clocks go back on 25 October 2026 at 03:00: 02:30 happens twice, the first one is read.
  assert.equal(toInstant('20261025', '02:30', 'Europe/Paris'), Date.parse('2026-10-25T00:30:00Z'));
  assert.equal(toInstant('20261025', '03:30', 'Europe/Paris'), Date.parse('2026-10-25T02:30:00Z'));
  // Clocks go forward on 29 March 2026 at 02:00: 02:30 does not exist -> right after the gap.
  assert.equal(toInstant('20260329', '02:30', 'Europe/Paris'), Date.parse('2026-03-29T01:30:00Z'));
  assert.equal(toInstant('20260329', '03:00', 'Europe/Paris'), Date.parse('2026-03-29T01:00:00Z'));
  // Southern hemisphere: Sydney goes forward on 4 October 2026.
  assert.equal(
    toInstant('20261004', '01:59', 'Australia/Sydney'),
    Date.parse('2026-10-03T15:59:00Z'),
  );
  assert.equal(
    toInstant('20261004', '03:00', 'Australia/Sydney'),
    Date.parse('2026-10-03T16:00:00Z'),
  );
  assert.equal(toInstant('2026-10-23', '9:00', 'UTC'), Date.parse('2026-10-23T09:00:00Z'));
  assert.equal(toInstant('20261332', '10:00', 'UTC'), null);
  assert.equal(toInstant('20261023', '25:00', 'UTC'), null);
});

test('days, ISO dates and the timezone of a system', () => {
  assert.equal(addDays('20261101', -1), '20261031');
  assert.equal(addDays('20261231', 1), '20270101');
  assert.equal(addDays('20240228', 1), '20240229');
  assert.equal(isoDate('20261023'), '2026-10-23');
  assert.equal(isoDate('nope'), null);
  assert.equal(isTimeZone('Europe/Paris'), true);
  assert.equal(isTimeZone('Mars/Olympus'), false);
  // The timezone of getsystem, else the one of Gladys, else UTC.
  assert.equal(systemTimeZone('Australia/Sydney', 'Europe/Paris'), 'Australia/Sydney');
  assert.equal(systemTimeZone('', 'Europe/Paris'), 'Europe/Paris');
  assert.equal(systemTimeZone('GMT+10 something', undefined), 'UTC');
});

test('times and dates in the language of the user', () => {
  const at = Date.parse('2026-10-23T12:05:00Z');
  assert.equal(formatTime(at, { language: 'fr', timeZone: 'Europe/Paris', now: at }), '14:05');
  assert.match(
    formatTime(at, { language: 'en', timeZone: 'Europe/Paris', now: at + 86400000 }),
    /Fri.*14:05/,
  );
  assert.equal(formatDate('20260612', 'fr'), '12 juin 2026');
  assert.equal(formatDate('20260612', 'en', { year: false }), '12 Jun');
});
