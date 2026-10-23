// The quota of the key: the reserve kept for the scenes, the headers of
// PVOutput trusted over the log, the pause until the reset, the stretch of the
// intervals with the number of systems, the night.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBudget, emptyBudget, stretchOf, intervalsOf, demandOf } from '../src/budget.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const budgetAt = (clock, donation = false) =>
  createBudget({ state: emptyBudget(), now: () => clock.now, donation: () => donation });

test('60 an hour, 15 of them kept for the scenes; 300 and 60 in donation mode', () => {
  const clock = { now: 10 * HOUR };
  const budget = budgetAt(clock);
  assert.deepEqual([budget.limit(), budget.reserve(), budget.statisticLimit()], [60, 15, 12]);
  const donor = budgetAt(clock, true);
  assert.deepEqual([donor.limit(), donor.reserve(), donor.statisticLimit()], [300, 60, 60]);
  for (let i = 0; i < 44; i += 1) budget.record('getstatus');
  assert.equal(budget.remaining(), 16);
  assert.equal(budget.canRead('getstatus'), true);
  budget.record('getstatus');
  assert.equal(budget.canRead('getstatus'), false, 'the reserve is for the scenes');
  assert.equal(budget.canSend(), true);
  assert.ok(budget.readingsPausedUntil() >= clock.now);
  // An hour later, the log is empty again.
  clock.now += HOUR;
  assert.equal(budget.remaining(), 60);
});

test('the headers of PVOutput win: another app on the same key, a wrong donation tick', () => {
  const clock = { now: 10 * HOUR + 5 * MINUTE };
  const budget = budgetAt(clock, true);
  budget.record('getstatus', { rate: { remaining: 20, limit: 60, reset: 11 * HOUR } });
  assert.deepEqual([budget.limit(), budget.remaining(), budget.reserve()], [60, 20, 15]);
  budget.record('getoutput');
  assert.equal(budget.remaining(), 19);
  // getstatistic counts on the key, but its headers are never taken for the key.
  budget.record('getstatistic', { rate: { remaining: 11, limit: 12, reset: 11 * HOUR } });
  assert.deepEqual([budget.limit(), budget.remaining()], [60, 18]);
  // After the reset: the limit again, minus what was sent since.
  clock.now = 11 * HOUR + MINUTE;
  budget.record('getstatus');
  assert.equal(budget.remaining(), 59);
});

test('"Exceeded number requests per hour" pauses everything until the reset', () => {
  const clock = { now: 10 * HOUR + 20 * MINUTE };
  const budget = budgetAt(clock);
  budget.exceeded('getstatus', { remaining: 0, limit: 60, reset: 11 * HOUR });
  assert.equal(budget.canRead('getstatus'), false);
  assert.equal(budget.canSend(), false);
  assert.equal(budget.readingsPausedUntil(), 11 * HOUR + 30 * 1000);
  clock.now = 11 * HOUR + MINUTE;
  assert.equal(budget.canRead('getstatus'), true);
});

test('getstatistic has its own quota: 12 an hour, one kept', () => {
  const clock = { now: 10 * HOUR };
  const budget = budgetAt(clock);
  for (let i = 0; i < 10; i += 1) budget.record('getstatistic');
  assert.equal(budget.canRead('getstatistic'), true);
  budget.record('getstatistic');
  assert.equal(budget.canRead('getstatistic'), false);
  assert.equal(budget.canRead('getstatus'), true);
  // Refused for its own quota while the key still has room: only it pauses.
  budget.exceeded('getstatistic', null);
  assert.equal(budget.canRead('getoutput'), true);
});

test('the intervals stretch with the number of systems, and slow down at night', () => {
  const limits = { limit: 60, reserve: 15, statisticLimit: 12 };
  const one = [{ statusInterval: 5, history: true }];
  assert.ok(Math.abs(demandOf(one[0]) - 19.04) < 0.01);
  assert.equal(stretchOf(one, limits).factor, 1);
  assert.equal(stretchOf([...one, ...one], limits).factor, 1);
  const five = Array.from({ length: 5 }, () => ({ statusInterval: 5, history: true }));
  const { factor, statistic } = stretchOf(five, limits);
  assert.ok(factor > 2 && factor < 2.2, String(factor));
  // Over an hour, every system together stays within 45 requests.
  const every = intervalsOf({ statusInterval: 5, night: false, factor, statisticFloor: statistic });
  const perHour = (ms) => HOUR / ms;
  const total =
    5 *
    (perHour(every.status) +
      perHour(every.output) +
      perHour(every.statistic) +
      perHour(every.history) +
      perHour(every.system));
  assert.ok(total <= 45.01, String(total));
  assert.ok(5 * perHour(every.statistic) <= 10);
  const day = intervalsOf({ statusInterval: 5, night: false, factor: 1 });
  assert.deepEqual(
    [day.status, day.output, day.statistic, day.history].map((ms) => ms / MINUTE),
    [5, 30, 60, 15],
  );
  const night = intervalsOf({ statusInterval: 5, night: true, factor: 1 });
  assert.deepEqual(
    [night.status, night.output, night.statistic].map((ms) => ms / MINUTE),
    [30, 60, 180],
  );
  assert.equal(intervalsOf({ statusInterval: 15, night: false, factor: 1 }).status, 15 * MINUTE);
  assert.equal(stretchOf(five, { limit: 300, reserve: 60, statisticLimit: 60 }).factor, 1);
});
