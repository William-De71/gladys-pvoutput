// The fields of the scene actions that send data: numbers as scene variables
// give them, units, the flags of PVOutput, and the refusals before sending.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readQuantity,
  statusParams,
  outputParams,
  refusalKey,
  ActionError,
} from '../src/actions.js';

const NOW = Date.parse('2026-10-23T12:05:30Z'); // 14:05 in Paris
const at = { now: NOW, timeZone: 'Europe/Paris' };
const refused = (fn, key) =>
  assert.throws(fn, (err) => err instanceof ActionError && err.key === key);

test('numbers as Gladys and its users write them', () => {
  const read = (raw) => readQuantity(raw);
  assert.deepEqual(read('1234'), { value: 1234, unit: null });
  assert.deepEqual(read('1 234,5'), { value: 1234.5, unit: null });
  assert.deepEqual(read('1 234,5'), { value: 1234.5, unit: null });
  assert.deepEqual(read('1,234.5'), { value: 1234.5, unit: null });
  assert.deepEqual(read('1.234,5'), { value: 1234.5, unit: null });
  assert.deepEqual(read('12,4 kWh'), { value: 12.4, unit: 'kwh' });
  assert.deepEqual(read('-120 W'), { value: -120, unit: 'w' });
  assert.deepEqual(read('21.5°C'), { value: 21.5, unit: '°c' });
  assert.deepEqual(read(42), { value: 42, unit: null });
  assert.equal(read(''), undefined);
  assert.equal(read('   '), undefined);
  assert.equal(read(undefined), undefined);
  assert.equal(read('{{device.power}}'), null);
  assert.equal(read('abc'), null);
  assert.equal(read('12 kilowatts'), null);
});

test('send_status: kWh to Wh, W rounded, now in the timezone of the system', () => {
  const { params, date, time } = statusParams(
    { power: '2 350,4', energy: '12,345', temperature: '21,46', voltage: '238.2' },
    at,
  );
  assert.deepEqual(params, { d: '20261023', t: '14:05', v1: 12345, v2: 2350, v5: 21.5, v6: 238.2 });
  assert.deepEqual([date, time], ['2026-10-23', '14:05']);
  // Wh as the unit of the field, or written after the value.
  assert.equal(statusParams({ energy: '850', energy_unit: 'wh' }, at).params.v1, 850);
  assert.equal(statusParams({ energy: '850 Wh' }, at).params.v1, 850);
  assert.equal(
    statusParams({ consumption_energy: '1.2', consumption_power: '1,2 kW' }, at).params.v4,
    1200,
  );
  // In Sydney, the same instant is the evening.
  assert.equal(
    statusParams({ power: '0' }, { now: NOW, timeZone: 'Australia/Sydney' }).params.t,
    '23:05',
  );
});

test('send_status: cumulative indexes and net data', () => {
  const index = statusParams({ energy: '12 345,6', cumulative: 'generation' }, at).params;
  assert.deepEqual([index.v1, index.c1], [12345600, 2]);
  assert.equal(
    statusParams({ consumption_energy: '5 000', cumulative: 'consumption' }, at).params.c1,
    3,
  );
  assert.equal(
    statusParams({ energy: '1', consumption_energy: '2', cumulative: 'both' }, at).params.c1,
    1,
  );
  assert.equal(statusParams({ energy: '1', cumulative: 'none' }, at).params.c1, undefined);
  // Net: export and import powers only, negative values allowed.
  const net = statusParams(
    { power: '-350', consumption_power: '120', energy: '3', net: true },
    at,
  ).params;
  assert.deepEqual(net, { d: '20261023', t: '14:05', v2: -350, v4: 120, n: 1 });
  refused(
    () => statusParams({ power: '100', net: true, cumulative: 'generation' }, at),
    'errNetCumulative',
  );
  refused(() => statusParams({ energy: '1', net: true }, at), 'errNetPower');
});

test('send_status: the refusals before anything is sent', () => {
  refused(() => statusParams({}, at), 'errNoValue');
  refused(() => statusParams({ temperature: '20', voltage: '230' }, at), 'errNoValue');
  refused(() => statusParams({ power: '{{power}}' }, at), 'errNotNumber');
  refused(() => statusParams({ power: '-5' }, at), 'errNegative');
  refused(() => statusParams({ energy: '5 W' }, at), 'errUnit');
  refused(() => statusParams({ power: '10', temperature: '150' }, at), 'errRange');
  refused(() => statusParams({ consumption_energy: '250' }, at), 'errConsumptionEnergy');
  refused(() => statusParams({ consumption_power: '120000' }, at), 'errConsumptionPower');
});

test('send_daily_output: today or yesterday, kWh or Wh, temperatures together, condition, comment', () => {
  const { params, date } = outputParams(
    {
      date: 'yesterday',
      generated: '18,4',
      exported: '6 210 Wh',
      consumption: '12.1',
      import_peak: '4,2',
      import_off_peak: '7,9',
      temperatures: '4,5 / 18',
      condition: 'partly_cloudy',
      comment: 'Linky\nok',
    },
    at,
  );
  assert.deepEqual(params, {
    d: '20261022',
    g: 18400,
    e: 6210,
    c: 12100,
    ip: 4200,
    io: 7900,
    tm: 4.5,
    tx: 18,
    cd: 'Partly Cloudy',
    cm: 'Linky ok',
  });
  assert.equal(date, '2026-10-22');
  assert.deepEqual(outputParams({ exported: '3' }, at).params, { d: '20261023', e: 3000 });
  assert.equal(outputParams({ generated: '1', condition: 'none' }, at).params.cd, undefined);
  refused(() => outputParams({}, at), 'errNoOutputValue');
  refused(() => outputParams({ generated: '1', temperatures: '18' }, at), 'errTemperatures');
  refused(() => outputParams({ generated: '1', temperatures: '18 / 4' }, at), 'errTemperatures');
});

test('the refusals of PVOutput get an explanation', () => {
  assert.equal(refusalKey('Bad request 400: Moon Powered'), 'refusedMoon');
  assert.equal(refusalKey('Forbidden 403: Read only key'), 'refusedReadOnly');
  assert.equal(
    refusalKey('Bad request 400: Power value [9000] too high for system size [4200]'),
    'refusedPowerHigh',
  );
  assert.equal(
    refusalKey('Bad request 400: Energy value [90000] too high for system size [4200]'),
    'refusedEnergyHigh',
  );
  assert.equal(
    refusalKey('Bad request 400: Date is older than 14 days [20261001]'),
    'refusedTooOld',
  );
  assert.equal(refusalKey('Bad request 400: Invalid future [20261024]'), 'refusedFuture');
  assert.equal(refusalKey('Bad Request 400: Invalid net and cumulative'), 'errNetCumulative');
  assert.equal(refusalKey('Something new'), 'refusedOther');
});
