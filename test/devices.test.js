// The traps of the Gladys core that the fake Gladys does not catch
// (community feedback, thread 11005): should_poll with poll_frequency, min /
// max / read_only / has_feedback on every feature, category / type / unit
// pairs the core knows (DEVICE_FEATURE_UNITS_BY_CATEGORY of
// server/utils/constants.js, the same in 5.1.0 and on master), and a single
// invalid field rejecting the whole discovery batch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import {
  idsOf,
  systemOfExternalId,
  featureKeysOf,
  buildSystemDevice,
  buildSystemStates,
  FEATURE_KEYS,
} from '../src/device.js';
import { LANGUAGES } from '../src/i18n.js';

const fakeGladys = {
  externalIds: (type, id) => ({
    device: `ext:pvoutput:${type}:${id}`,
    feature: (key) => `ext:pvoutput:${type}:${id}:${key}`,
  }),
};
const FULL = { id: '12345', name: 'Maison, toit sud', size: 4200, features: FEATURE_KEYS };
const SMALL = { id: '67890', name: 'Garage', size: 3000, features: [] };

// The units the core accepts per category (server/utils/constants.js,
// DEVICE_FEATURE_UNITS_BY_CATEGORY, read on v5.1.0 and upstream/master on 2026-10-23).
const UNITS_BY_CATEGORY = {
  [C.ENERGY_PRODUCTION_SENSOR]: [U.WATT, U.KILOWATT, U.WATT_HOUR, U.KILOWATT_HOUR],
  [C.ENERGY_SENSOR]: [U.VOLT, U.WATT, U.KILOWATT, U.WATT_HOUR, U.KILOWATT_HOUR],
  [C.TEMPERATURE_SENSOR]: [U.CELSIUS],
};
const PAIRS = {
  power: [C.ENERGY_PRODUCTION_SENSOR, T.ENERGY_PRODUCTION_SENSOR.POWER, U.WATT],
  energy_today: [
    C.ENERGY_PRODUCTION_SENSOR,
    T.ENERGY_PRODUCTION_SENSOR.DAILY_PRODUCTION,
    U.KILOWATT_HOUR,
  ],
  lifetime_energy: [C.ENERGY_PRODUCTION_SENSOR, T.ENERGY_PRODUCTION_SENSOR.INDEX, U.KILOWATT_HOUR],
  consumption_power: [C.ENERGY_SENSOR, T.ENERGY_SENSOR.POWER, U.WATT],
  consumption_today: [C.ENERGY_SENSOR, T.ENERGY_SENSOR.INDEX_TODAY, U.KILOWATT_HOUR],
  temperature: [C.TEMPERATURE_SENSOR, T.TEMPERATURE_SENSOR.PROBE, U.CELSIUS],
  voltage: [C.ENERGY_SENSOR, T.ENERGY_SENSOR.VOLTAGE, U.VOLT],
};

test('devices are never polled by Gladys: the integration has its own timer', () => {
  const device = buildSystemDevice(fakeGladys, FULL);
  assert.equal(device.should_poll, false);
  assert.equal(device.poll_frequency, undefined);
});

test('every feature carries min, max, read_only and has_feedback, in every language', () => {
  for (const language of LANGUAGES) {
    for (const system of [FULL, SMALL]) {
      const device = buildSystemDevice(fakeGladys, system, language);
      for (const feature of device.features) {
        assert.equal(typeof feature.min, 'number', feature.external_id);
        assert.equal(typeof feature.max, 'number', feature.external_id);
        assert.ok(feature.min < feature.max);
        assert.equal(feature.read_only, true);
        assert.equal(feature.has_feedback, false);
      }
      assert.equal(new Set(device.features.map((f) => f.name)).size, device.features.length);
    }
  }
});

test('category / type / unit pairs of the SDK the core accepts; no daily consumption, no export', () => {
  const device = buildSystemDevice(fakeGladys, FULL);
  assert.deepEqual(
    device.features.map((feature) => feature.external_id.split(':').pop()),
    Object.keys(PAIRS),
  );
  for (const feature of device.features) {
    const key = feature.external_id.split(':').pop();
    assert.deepEqual([feature.category, feature.type, feature.unit], PAIRS[key], key);
    assert.ok(UNITS_BY_CATEGORY[feature.category].includes(feature.unit), key);
    if (feature.category === C.ENERGY_SENSOR) {
      assert.notEqual(feature.type, T.ENERGY_SENSOR.DAILY_CONSUMPTION, 'Gladys would price it');
      assert.notEqual(feature.type, T.ENERGY_SENSOR.INDEX, 'it would count as a meter');
    }
  }
});

test('bounds from the size: PVOutput refuses 50 % above it, 12 kWh/kW a day', () => {
  const bounds = (system) =>
    Object.fromEntries(
      buildSystemDevice(fakeGladys, system).features.map((f) => [
        f.external_id.split(':').pop(),
        [f.min, f.max],
      ]),
    );
  assert.deepEqual(bounds(FULL).power, [0, 6300]);
  assert.deepEqual(bounds(FULL).energy_today, [0, 51]);
  assert.deepEqual(bounds({ ...SMALL, size: null }).power, [0, 100000]);
  assert.deepEqual(bounds(FULL).temperature, [-100, 100]);
});

test('production features always, the others once found, in a stable order', () => {
  const device = buildSystemDevice(
    fakeGladys,
    { ...SMALL, features: ['voltage', 'consumption_today'] },
    'fr',
  );
  assert.deepEqual(
    device.features.map((feature) => [feature.external_id, feature.name]),
    [
      ['ext:pvoutput:system:67890:power', 'Production solaire'],
      ['ext:pvoutput:system:67890:energy_today', 'Production du jour'],
      ['ext:pvoutput:system:67890:consumption_today', 'Consommation du jour'],
      ['ext:pvoutput:system:67890:voltage', 'Tension'],
    ],
  );
  assert.equal(device.name, 'Garage');
  assert.deepEqual(device.params, [{ name: 'PVOUTPUT_SYSTEM_ID', value: '67890' }]);
  assert.deepEqual(featureKeysOf([]), ['power', 'energy_today']);
});

test('ids from the System Id', () => {
  assert.equal(systemOfExternalId('ext:pvoutput:system:12345:power'), '12345');
  assert.equal(systemOfExternalId('ext:pvoutput:system:67890'), '67890');
  assert.equal(systemOfExternalId('nothing'), null);
});

test('states: rounded, an unknown value left untouched', () => {
  const states = buildSystemStates(fakeGladys, SMALL, {
    power: 1234.6,
    energy_today: 7.89912,
    voltage: 230,
  });
  assert.deepEqual(states, [
    { device_feature_external_id: 'ext:pvoutput:system:67890:power', state: 1235 },
    { device_feature_external_id: 'ext:pvoutput:system:67890:energy_today', state: 7.899 },
  ]);
  assert.deepEqual(buildSystemStates(fakeGladys, SMALL, { power: null }), []);
});

test('the discovery batch and the states pass the checks of the fake host API', async (t) => {
  const gladys = createFakeGladys({});
  t.after(() => gladys.fake.shutdown());
  await gladys.connect();
  for (const language of LANGUAGES) {
    await gladys.publishDiscoveredDevices([
      buildSystemDevice(gladys, FULL, language),
      buildSystemDevice(gladys, SMALL, language),
    ]);
  }
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
  const values = Object.fromEntries(FEATURE_KEYS.map((key, index) => [key, index + 1]));
  await gladys.publishStates(buildSystemStates(gladys, FULL, values));
  assert.equal(gladys.fake.lastState(idsOf(gladys, '12345').feature('consumption_power')), 4);
});
