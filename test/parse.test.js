// The plain text answers of PVOutput, with the examples of its specification.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  num,
  parseSystem,
  parseStatus,
  parseHistory,
  parseOutputs,
  parseStatistic,
} from '../src/parse.js';

test('numbers: NaN and empty fields are absent, never 0', () => {
  assert.equal(num('359'), 359);
  assert.equal(num('0.164'), 0.164);
  assert.equal(num('NaN'), null);
  assert.equal(num(''), null);
  assert.equal(num('-12.5'), -12.5);
  assert.equal(num('abc'), null);
});

test('getsystem: the example of the specification, the timezone, a comma in the name', () => {
  const demo = parseSystem(
    'PVOutput Demo,3200,2162,10,320,Enertech,1,5000,Fronius,N,20.0,No,20120228,-33.868135,151.133423,5;;0',
    { timeZone: false },
  );
  assert.equal(demo.name, 'PVOutput Demo');
  assert.equal(demo.size, 3200);
  assert.equal(demo.statusInterval, 5);
  assert.deepEqual([demo.latitude, demo.longitude], [-33.868135, 151.133423]);
  assert.equal(demo.installDate, '20120228');
  assert.equal(demo.timeZone, null);
  const named = parseSystem(
    'Maison, toit sud,4200,25000,12,350,DualSun,1,4000,Enphase,S,30.0,No,20210415,47.24,6.02,10,Europe/Paris;;0',
  );
  assert.equal(named.name, 'Maison, toit sud');
  assert.equal(named.statusInterval, 10);
  assert.equal(named.timeZone, 'Europe/Paris');
  // A blank timezone, an unknown location.
  const blank = parseSystem('Garage,3000,NaN,9,330,SMA,1,3000,SMA,S,NaN,No,,NaN,NaN,5,;;0');
  assert.equal(blank.timeZone, null);
  assert.equal(blank.latitude, null);
  assert.equal(blank.installDate, null);
  assert.equal(parseSystem('too,short'), null);
});

test('getstatus: the example of the specification', () => {
  assert.deepEqual(parseStatus('20210228,13:00,359,731,92,130,0.164,21.4,240.4'), {
    date: '20210228',
    time: '13:00',
    energy: 359,
    power: 731,
    consumptionEnergy: 92,
    consumptionPower: 130,
    normalised: 0.164,
    temperature: 21.4,
    voltage: 240.4,
  });
  const generation = parseStatus('20210228,9:05,359,731,NaN,NaN,0.164,NaN,NaN');
  assert.equal(generation.time, '09:05');
  assert.equal(generation.consumptionPower, null);
  assert.equal(generation.voltage, null);
  assert.equal(parseStatus('Bad request 400: No status found'), null);
});

test('history of a day: descending turned around, instants in the timezone of the system', () => {
  const points = parseHistory(
    '20200228,10:40,359,0.080,731,732,0.164,92,130,NaN,NaN;20200228,10:35,298,0.067,710,708,0.159,81,130,NaN,NaN;20200228,10:30,239,0.054,710,708,0.159,70,130,NaN,NaN',
    'Australia/Sydney',
  );
  assert.deepEqual(
    points.map((p) => [p.time, p.energy, p.power, p.consumptionPower, p.temperature]),
    [
      ['10:30', 239, 710, 130, null],
      ['10:35', 298, 710, 130, null],
      ['10:40', 359, 731, 130, null],
    ],
  );
  assert.equal(points[0].at, Date.parse('2020-02-27T23:30:00Z'));
});

test('history across the hour repeated when the clocks go back', () => {
  // Paris, 25 October 2026: 02:50, 02:55 (summer time), 02:00, 02:05 (winter time).
  const body = ['02:50', '02:55', '02:00', '02:05', '03:00']
    .map((time, i) => `20261025,${time},${i},0,${i * 10},0,0,NaN,NaN,NaN,NaN`)
    .join(';');
  const points = parseHistory(body, 'Europe/Paris');
  assert.deepEqual(
    points.map((p) => new Date(p.at).toISOString().slice(11, 16)),
    ['00:50', '00:55', '01:00', '01:05', '02:00'],
  );
});

test('getoutput: the example of the specification, newest first', () => {
  const outputs = parseOutputs(
    '20210217,4413,0.460,0,21859,2070,11:00,Fine,-3,6,4220,7308,2030,3888;20210218,479,0.213,0,0,1500,11:10,Showers,NaN,NaN,NaN,NaN,NaN,NaN;',
  );
  assert.deepEqual(
    outputs.map((o) => [
      o.date,
      o.generated,
      o.efficiency,
      o.exported,
      o.used,
      o.peakPower,
      o.peakTime,
      o.condition,
    ]),
    [
      ['20210218', 479, 0.213, 0, 0, 1500, '11:10', 'Showers'],
      ['20210217', 4413, 0.46, 0, 21859, 2070, '11:00', 'Fine'],
    ],
  );
  assert.deepEqual(
    [outputs[1].minTemperature, outputs[1].maxTemperature, outputs[1].importOffPeak],
    [-3, 6, 7308],
  );
  assert.equal(outputs[0].minTemperature, null);
  assert.deepEqual(parseOutputs(''), []);
});

test('getstatistic: the example of the specification', () => {
  assert.deepEqual(
    parseStatistic('24600,14220,2220,800,3400,3.358,27,20210201,20210228,4.653,20210205'),
    {
      generated: 24600,
      exported: 14220,
      averageGeneration: 2220,
      minimumGeneration: 800,
      maximumGeneration: 3400,
      averageEfficiency: 3.358,
      outputs: 27,
      dateFrom: '20210201',
      dateTo: '20210228',
      recordEfficiency: 4.653,
      recordDate: '20210205',
    },
  );
  assert.equal(parseStatistic('NaN,1'), null);
});
