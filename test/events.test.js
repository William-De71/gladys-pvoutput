// Scene triggers: silence by day only, one event per transition, a baseline at
// first; what a day did and its sentence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSilent,
  detectSilence,
  silentAfter,
  todayOf,
  summaryOf,
  TRIGGERS,
} from '../src/events.js';
import { sunAt } from '../src/sun.js';

const MINUTE = 60 * 1000;
const PLACE = { latitude: 47.24, longitude: 6.02, timeZone: 'Europe/Paris' };
const NOON = Date.parse('2026-10-23T12:00:00Z');
const sun = (at) => sunAt(at, PLACE);

test('silent after 3 status intervals, 30 minutes at least', () => {
  assert.equal(silentAfter(5), 30 * MINUTE);
  assert.equal(silentAfter(15), 45 * MINUTE);
  assert.equal(silentAfter(null), 30 * MINUTE);
});

test('silence is judged by day only, an hour after sunrise and an hour before sunset', () => {
  const judge = (now, last) =>
    isSilent({ lastStatusAt: last, sun: sun(now), statusInterval: 5, now });
  assert.equal(judge(NOON, NOON - 10 * MINUTE), false);
  assert.equal(judge(NOON, NOON - 40 * MINUTE), true);
  // Night: never silent, whatever the last status.
  assert.equal(judge(Date.parse('2026-10-23T21:00:00Z'), NOON), null);
  // Morning: yesterday's last status does not count before the window has lasted 30 minutes.
  const sunrise = sun(NOON).sunrise;
  assert.equal(judge(sunrise + 70 * MINUTE, NOON - 20 * 60 * MINUTE), false);
  assert.equal(judge(sunrise + 95 * MINUTE, NOON - 20 * 60 * MINUTE), true);
  // No location: cannot tell.
  assert.equal(isSilent({ lastStatusAt: 0, sun: null, statusInterval: 5, now: NOON }), null);
});

test('one event per transition, a quiet baseline, back only after a fired silence', () => {
  const step = (seen, now, last) =>
    detectSilence(seen, { lastStatusAt: last, sun: sun(now), statusInterval: 5, now });
  // Baseline already silent: nothing fires, and its return is quiet too.
  let state = step({}, NOON, NOON - 60 * MINUTE);
  assert.deepEqual(state.events, []);
  assert.equal(state.next.silent, true);
  state = step(state.next, NOON + 5 * MINUTE, NOON + 4 * MINUTE);
  assert.deepEqual(state.events, []);
  // Then a real silence, once, and the return.
  state = step(state.next, NOON + 40 * MINUTE, NOON + 4 * MINUTE);
  assert.deepEqual(state.events, [TRIGGERS.SYSTEM_SILENT]);
  state = step(state.next, NOON + 45 * MINUTE, NOON + 4 * MINUTE);
  assert.deepEqual(state.events, [], 'still silent: no new event');
  state = step(state.next, NOON + 50 * MINUTE, NOON + 50 * MINUTE);
  assert.deepEqual(state.events, [TRIGGERS.SYSTEM_BACK]);
  assert.equal(state.next.backAfter, 46 * MINUTE);
});

test('the day of a system and its sentence', () => {
  const view = {
    size: 4200,
    timeZone: 'Europe/Paris',
    exportKnown: true,
    consumptionKnown: true,
    power: 1200,
    status: { date: '20261023', energy: 18100, consumptionEnergy: 12050, at: NOON },
    today: {
      date: '20261023',
      generated: 18400,
      efficiency: 4.381,
      exported: 6200,
      used: 12100,
      peakPower: 3120,
      peakTime: '13:05',
      condition: 'Fine',
    },
    history: null,
  };
  const day = todayOf(view, NOON);
  assert.deepEqual(
    [day.production, day.efficiency, day.exported, day.consumed, day.peakPower, day.peakTime],
    [18400, 4.381, 6200, 12050, 3120, '13:05'],
  );
  assert.equal(
    summaryOf('Maison', day, 'fr'),
    'Maison : 18,4 kWh produits aujourd’hui, 4,38 kWh/kWc, pic de 3 120 W à 13:05, 6,2 kWh injectés, 12,1 kWh consommés.',
  );
  assert.equal(
    summaryOf('Home', { ...day, exported: null, consumed: null, peakPower: null }, 'en'),
    'Home: 18.4 kWh produced today, 4.38 kWh/kW.',
  );
  // Yesterday's status and no output today: a new day, nothing produced yet.
  const fresh = todayOf(
    { ...view, today: null, status: { ...view.status, date: '20261022' } },
    NOON,
  );
  assert.deepEqual([fresh.production, fresh.efficiency], [0, 0]);
});
