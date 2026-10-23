// -----------------------------------------------------------------------------
// The devices of the integration, offered on the Discovery screen.
//
// One device per PVOutput system, named like the system on PVOutput, offered
// once getsystem answered (it gives the name and the size). Read-only
// features, in a stable order:
//   - `power`              power produced (energy-production-sensor / power, W);
//   - `energy_today`       energy produced today (energy-production-sensor /
//                          daily-production, kWh);
//   - `lifetime_energy`    lifetime production (energy-production-sensor /
//                          index, kWh): a production index, it never feeds the
//                          consumption nor the cost of Gladys — the history only;
//   - `consumption_power`  power consumed (energy-sensor / power, W) and
//   - `consumption_today`  energy consumed today (energy-sensor / index-today,
//                          kWh), only when the system publishes a consumption
//                          (not `daily-consumption`: Gladys would price it and
//                          count it twice with the meter of the house);
//   - `temperature`        the temperature the system publishes
//                          (temperature-sensor / probe: an inverter or outdoor
//                          temperature stays out of the room average);
//   - `voltage`            the voltage it publishes (energy-sensor / voltage, V).
// A feature appears once the system gave a value for it, and stays for good
// (the list is kept in /data). The yield of the day (kWh/kW) has no Gladys
// unit: it lives in the widgets and the scenes, never in a feature. Neither
// does the energy exported today: Gladys has no daily export type, and an
// index that falls back to 0 every night would be a lie.
//
// External ids: the System Id — `ext:pvoutput:system:12345`, features
// `…:12345:power`. `should_poll` stays false: the integration reads PVOutput
// on its own timer, within the quota of the key.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { t } from './i18n.js';

const DEVICE_TYPE = 'system';

// PVOutput refuses a power 50 % above the size of the system, and an energy
// above 12 kWh/kW: the natural bounds of the production features. Without a
// size, wide bounds.
const POWER_RATIO = 1.5;
const ENERGY_PER_KW = 12;

const FEATURES = [
  {
    key: 'power',
    category: C.ENERGY_PRODUCTION_SENSOR,
    type: T.ENERGY_PRODUCTION_SENSOR.POWER,
    unit: U.WATT,
    bounds: (size) => [
      0,
      size ? Math.max(100, Math.ceil((size * POWER_RATIO) / 100) * 100) : 100000,
    ],
    always: true,
  },
  {
    key: 'energy_today',
    category: C.ENERGY_PRODUCTION_SENSOR,
    type: T.ENERGY_PRODUCTION_SENSOR.DAILY_PRODUCTION,
    unit: U.KILOWATT_HOUR,
    bounds: (size) => [0, size ? Math.max(1, Math.ceil((size / 1000) * ENERGY_PER_KW)) : 1000],
    always: true,
  },
  {
    key: 'lifetime_energy',
    category: C.ENERGY_PRODUCTION_SENSOR,
    type: T.ENERGY_PRODUCTION_SENSOR.INDEX,
    unit: U.KILOWATT_HOUR,
    bounds: () => [0, 100000000],
  },
  {
    key: 'consumption_power',
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.POWER,
    unit: U.WATT,
    // The maximum power consumption PVOutput accepts.
    bounds: () => [0, 100000],
  },
  {
    key: 'consumption_today',
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.INDEX_TODAY,
    unit: U.KILOWATT_HOUR,
    // The maximum energy consumption PVOutput accepts (200,000 Wh).
    bounds: () => [0, 200],
  },
  {
    key: 'temperature',
    category: C.TEMPERATURE_SENSOR,
    type: T.TEMPERATURE_SENSOR.PROBE,
    unit: U.CELSIUS,
    // The temperature range of PVOutput.
    bounds: () => [-100, 100],
  },
  {
    key: 'voltage',
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.VOLTAGE,
    unit: U.VOLT,
    bounds: () => [0, 1000],
  },
];
const FEATURE_KEYS = FEATURES.map((feature) => feature.key);
// Decimals of the published states.
const DECIMALS = {
  power: 0,
  energy_today: 3,
  lifetime_energy: 3,
  consumption_power: 0,
  consumption_today: 3,
  temperature: 1,
  voltage: 1,
};

/**
 * @description Round a value to the decimals of its feature.
 * @param {string} key - The feature key.
 * @param {number} value - The value.
 * @returns {number} The rounded value.
 */
function round(key, value) {
  const factor = 10 ** (DECIMALS[key] ?? 1);
  return Math.round(value * factor) / factor;
}

/**
 * @description The external ids of a system.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {string} systemId - The System Id.
 * @returns {{ device: string, feature: Function }} The ids.
 */
const idsOf = (gladys, systemId) => gladys.externalIds(DEVICE_TYPE, String(systemId));

/**
 * @description The System Id of a device (or feature) external id.
 * @param {unknown} externalId - The id.
 * @returns {string|null} The System Id.
 * @example
 * systemOfExternalId('ext:pvoutput:system:12345:power'); // -> '12345'
 */
function systemOfExternalId(externalId) {
  const match = /:system:(\d+)(?::[a-z_]+)?$/.exec(String(externalId ?? ''));
  return match ? match[1] : null;
}

/**
 * @description The feature keys of a system, in a stable order.
 * @param {string[]} found - The features found so far.
 * @returns {string[]} The keys.
 */
const featureKeysOf = (found) =>
  FEATURES.filter((feature) => feature.always || (found ?? []).includes(feature.key)).map(
    (feature) => feature.key,
  );

/**
 * @description Build the device of a system.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} system - `{ id, name, size, features }`.
 * @param {string} [language] - Language of the feature names.
 * @returns {object} The discovered device.
 */
function buildSystemDevice(gladys, system, language = 'en') {
  const ids = idsOf(gladys, system.id);
  const size = Number.isFinite(system.size) && system.size > 0 ? system.size : null;
  return {
    name: String(system.name || `PVOutput ${system.id}`).slice(0, 100),
    external_id: ids.device,
    model: 'PVOutput',
    should_poll: false,
    params: [{ name: 'PVOUTPUT_SYSTEM_ID', value: String(system.id) }],
    features: featureKeysOf(system.features).map((key) => {
      const feature = FEATURES.find((candidate) => candidate.key === key);
      const [min, max] = feature.bounds(size);
      return {
        name: t(`feature_${key}`, language),
        external_id: ids.feature(key),
        category: feature.category,
        type: feature.type,
        unit: feature.unit,
        min,
        max,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      };
    }),
  };
}

/**
 * @description The states of a system, from its values now (app.js decides
 * which are known): a value left out is left untouched.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} system - `{ id, features }`.
 * @param {object} values - `{ power, energy_today, … }` in W, kWh, °C, V; null = unknown.
 * @returns {object[]} `{ device_feature_external_id, state }`.
 */
function buildSystemStates(gladys, system, values) {
  const ids = idsOf(gladys, system.id);
  return featureKeysOf(system.features)
    .filter((key) => Number.isFinite(values?.[key]))
    .map((key) => ({
      device_feature_external_id: ids.feature(key),
      state: round(key, values[key]),
    }));
}

export {
  DEVICE_TYPE,
  FEATURES,
  FEATURE_KEYS,
  round,
  idsOf,
  systemOfExternalId,
  featureKeysOf,
  buildSystemDevice,
  buildSystemStates,
};
