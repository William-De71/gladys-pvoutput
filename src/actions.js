// -----------------------------------------------------------------------------
// The fields of the scene actions that send data to PVOutput, turned into the
// parameters of addstatus and addoutput.
//
// The values are `string` fields: in the scene editor of Gladys (5.1.0 and
// later) only those accept the variables `{{…}}` of the previous actions
// ("get the last value of a device"). So they arrive as text: "1234",
// "1 234,5", "12.4 kWh", "" (not sent), or an unresolved "{{…}}" (refused).
//
//   send_status  -> addstatus: d, t (now, in the timezone of the system),
//                   v1 energy generated (Wh), v2 power generated (W),
//                   v3 energy consumed (Wh), v4 power consumed (W),
//                   v5 temperature (°C), v6 voltage (V), c1 the cumulative
//                   flag (1 both, 2 generation, 3 consumption), n=1 net data;
//   send_daily_output -> addoutput: d (today or yesterday), g generated,
//                   e exported, c consumption, ip import peak, io import off
//                   peak (Wh), tm / tx min and max temperatures (both or
//                   none), cd condition, cm comment.
// A refusal is an ActionError: a key of i18n.js and its values, so the
// message is written in the language of the configuration.
// -----------------------------------------------------------------------------

import { localParts, addDays } from './time.js';

const ENERGY_UNITS = { kwh: 1000, wh: 1 };
const CUMULATIVE = { none: null, generation: 2, consumption: 3, both: 1 };
// The conditions of an output, as PVOutput spells them.
const CONDITIONS = {
  fine: 'Fine',
  partly_cloudy: 'Partly Cloudy',
  mostly_cloudy: 'Mostly Cloudy',
  cloudy: 'Cloudy',
  showers: 'Showers',
  snow: 'Snow',
  hazy: 'Hazy',
  fog: 'Fog',
  dusty: 'Dusty',
  frost: 'Frost',
  storm: 'Storm',
};
const MAX_COMMENT = 200;

/**
 * @description A refusal of a scene action, written later in a language.
 */
class ActionError extends Error {
  /**
   * @param {string} key - The key of the message in i18n.js.
   * @param {object} [values] - Its values.
   */
  constructor(key, values = {}) {
    super(key);
    this.name = 'ActionError';
    this.key = key;
    this.values = values;
  }
}

/**
 * @description Read a number typed or given by a scene variable.
 * @param {unknown} raw - "1234", "1 234,5", "-120", "12.4 kWh", 12.
 * @returns {{ value: number, unit: string|null }|null|undefined} The number and
 * the unit written after it (lower case); undefined when empty, null when it
 * is not a number.
 * @example
 * readQuantity('1 234,5 Wh'); // -> { value: 1234.5, unit: 'wh' }
 */
function readQuantity(raw) {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { value: raw, unit: null } : null;
  }
  const text = String(raw)
    .replace(/[\u00a0\u202f\u2009']/g, ' ')
    .trim();
  if (!text) {
    return undefined;
  }
  const match = /^([+-]?[\d\s.,]*\d[\d\s.,]*)\s*([a-zA-Z°%]{0,4})$/.exec(text);
  if (!match) {
    return null;
  }
  let digits = match[1].replace(/\s+/g, '');
  const lastComma = digits.lastIndexOf(',');
  const lastDot = digits.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Both: the last one is the decimal separator, the other groups thousands.
    const decimal = lastComma > lastDot ? ',' : '.';
    const group = decimal === ',' ? '.' : ',';
    digits = digits.split(group).join('').replace(decimal, '.');
  } else if (lastComma >= 0) {
    // A comma alone is a decimal separator (French), unless it groups thousands twice.
    digits =
      (digits.match(/,/g) ?? []).length > 1 ? digits.split(',').join('') : digits.replace(',', '.');
  } else if ((digits.match(/\./g) ?? []).length > 1) {
    digits = digits.split('.').join('');
  }
  const value = Number(digits);
  if (!Number.isFinite(value) || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(digits)) {
    return null;
  }
  return { value, unit: match[2] ? match[2].toLowerCase() : null };
}

/**
 * @description Read one field of a scene action.
 * @param {object} fields - The fields.
 * @param {string} key - The key of the field.
 * @param {object} rule - `{ units: { unit: factor }, defaultFactor, negative, integer, min, max }`.
 * @returns {number|undefined} The value in the unit of PVOutput, undefined when empty.
 */
function readField(fields, key, rule) {
  const quantity = readQuantity(fields[key]);
  if (quantity === undefined) {
    return undefined;
  }
  if (quantity === null) {
    throw new ActionError('errNotNumber', { field: key, value: String(fields[key]).slice(0, 40) });
  }
  let factor = rule.defaultFactor ?? 1;
  if (quantity.unit) {
    if (!(quantity.unit in (rule.units ?? {}))) {
      throw new ActionError('errUnit', { field: key, value: String(fields[key]).slice(0, 40) });
    }
    factor = rule.units[quantity.unit];
  }
  let value = quantity.value * factor;
  if (!rule.negative && value < 0) {
    throw new ActionError('errNegative', { field: key });
  }
  value = rule.integer ? Math.round(value) : Math.round(value * 10) / 10;
  if (Number.isFinite(rule.min) && value < rule.min) {
    throw new ActionError('errRange', { field: key, min: rule.min, max: rule.max });
  }
  if (Number.isFinite(rule.max) && value > rule.max) {
    throw new ActionError('errRange', { field: key, min: rule.min, max: rule.max });
  }
  return value;
}

const ENERGY_RULE = (defaultFactor, negative = false) => ({
  units: { kwh: 1000, wh: 1 },
  defaultFactor,
  integer: true,
  negative,
});
const POWER_RULE = (negative = false) => ({ units: { w: 1, kw: 1000 }, integer: true, negative });
const TEMPERATURE_RULE = { units: { c: 1, '°c': 1 }, negative: true, min: -100, max: 100 };
const VOLTAGE_RULE = { units: { v: 1 }, min: 0, max: 100000 };

/**
 * @description The addstatus parameters of the "send a status" action.
 * @param {object} fields - The resolved fields of the scene action.
 * @param {object} options - `{ now, timeZone }`.
 * @returns {{ params: object, date: string, time: string }} The parameters, and
 * the local date ("2026-10-23") and time ("14:05") sent.
 */
function statusParams(fields, { now, timeZone }) {
  const factor = ENERGY_UNITS[fields.energy_unit] ?? ENERGY_UNITS.kwh;
  const net = fields.net === true || fields.net === 'true';
  const cumulative = Object.hasOwn(CUMULATIVE, fields.cumulative ?? 'none')
    ? CUMULATIVE[fields.cumulative ?? 'none']
    : null;
  if (net && cumulative) {
    throw new ActionError('errNetCumulative');
  }
  const values = {
    v1: readField(fields, 'energy', ENERGY_RULE(factor)),
    v2: readField(fields, 'power', POWER_RULE(net)),
    v3: readField(fields, 'consumption_energy', ENERGY_RULE(factor)),
    v4: readField(fields, 'consumption_power', POWER_RULE(net)),
    v5: readField(fields, 'temperature', TEMPERATURE_RULE),
    v6: readField(fields, 'voltage', VOLTAGE_RULE),
  };
  if (net && values.v2 === undefined && values.v4 === undefined) {
    throw new ActionError('errNetPower');
  }
  if ([values.v1, values.v2, values.v3, values.v4].every((value) => value === undefined)) {
    throw new ActionError('errNoValue');
  }
  if (values.v3 !== undefined && values.v3 > 200000 && cumulative !== 1 && cumulative !== 3) {
    throw new ActionError('errConsumptionEnergy');
  }
  if (values.v4 !== undefined && values.v4 > 100000) {
    throw new ActionError('errConsumptionPower');
  }
  const local = localParts(now, timeZone);
  const params = { d: local.date, t: local.time };
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined && !(net && (name === 'v1' || name === 'v3'))) {
      params[name] = value;
    }
  }
  if (cumulative) params.c1 = cumulative;
  if (net) params.n = 1;
  return { params, date: local.iso, time: local.time };
}

/**
 * @description Read the "min / max" temperatures of a day: both or none.
 * @param {unknown} raw - "4.5 / 18", "4,5;18", "".
 * @returns {{ min: number, max: number }|undefined} The temperatures.
 */
function readTemperatures(raw) {
  const text = String(raw ?? '').trim();
  if (!text) {
    return undefined;
  }
  const parts = text.split(/\s*[/;|]\s*/).filter(Boolean);
  if (parts.length !== 2) {
    throw new ActionError('errTemperatures');
  }
  const [min, max] = parts.map((part, index) =>
    readField(
      { [index ? 'max_temperature' : 'min_temperature']: part },
      index ? 'max_temperature' : 'min_temperature',
      TEMPERATURE_RULE,
    ),
  );
  if (min > max) {
    throw new ActionError('errTemperatures');
  }
  return { min, max };
}

/**
 * @description The addoutput parameters of the "send the output of a day" action.
 * Energies in kWh unless written in Wh ("2350 Wh").
 * @param {object} fields - The resolved fields of the scene action.
 * @param {object} options - `{ now, timeZone }`.
 * @returns {{ params: object, date: string }} The parameters and the local date sent.
 */
function outputParams(fields, { now, timeZone }) {
  const today = localParts(now, timeZone).date;
  const day = fields.date === 'yesterday' ? addDays(today, -1) : today;
  const energy = ENERGY_RULE(ENERGY_UNITS.kwh);
  const values = {
    g: readField(fields, 'generated', energy),
    e: readField(fields, 'exported', energy),
    c: readField(fields, 'consumption', energy),
    ip: readField(fields, 'import_peak', energy),
    io: readField(fields, 'import_off_peak', energy),
  };
  const temperatures = readTemperatures(fields.temperatures);
  const condition = CONDITIONS[fields.condition] ?? null;
  const comment = String(fields.comment ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, MAX_COMMENT);
  if (
    Object.values(values).every((value) => value === undefined) &&
    !temperatures &&
    !condition &&
    !comment
  ) {
    throw new ActionError('errNoOutputValue');
  }
  if (values.c !== undefined && values.c > 999999999) {
    throw new ActionError('errConsumptionEnergy');
  }
  const params = { d: day };
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) params[name] = value;
  }
  if (temperatures) {
    params.tm = temperatures.min;
    params.tx = temperatures.max;
  }
  if (condition) params.cd = condition;
  if (comment) params.cm = comment;
  return { params, date: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}` };
}

// The refusals of PVOutput an action can meet, by their message: the key of a
// translated explanation (the message of PVOutput is shown after it).
const REFUSALS = [
  [/moon powered/i, 'refusedMoon'],
  [/read only key/i, 'refusedReadOnly'],
  [/exceeded number requests/i, 'refusedQuota'],
  [/donation mode/i, 'refusedDonation'],
  [/power value .* too high|peak power .* too high/i, 'refusedPowerHigh'],
  [/energy value .* too high|generation .* too high|consumption .* too high/i, 'refusedEnergyHigh'],
  [/export .* (too high|cannot exceed)/i, 'refusedExportHigh'],
  [/older than 14 days|too old/i, 'refusedTooOld'],
  [/future|too new/i, 'refusedFuture'],
  [/invalid net and cumulative/i, 'errNetCumulative'],
  [/missing net power/i, 'errNetPower'],
  [/lower than the previous|cannot be lower/i, 'refusedLower'],
  [/min\/max temp/i, 'errTemperatures'],
  [/invalid api key|disabled api key|missing, invalid or inactive/i, 'refusedKey'],
  [/invalid system id|inaccessible system id/i, 'refusedSystem'],
];

/**
 * @description The key of the explanation of a refusal of PVOutput.
 * @param {string} message - The message of PVOutput.
 * @returns {string} A key of i18n.js.
 */
function refusalKey(message) {
  return REFUSALS.find(([pattern]) => pattern.test(String(message ?? '')))?.[1] ?? 'refusedOther';
}

export {
  ENERGY_UNITS,
  CUMULATIVE,
  CONDITIONS,
  ActionError,
  readQuantity,
  readField,
  statusParams,
  outputParams,
  readTemperatures,
  refusalKey,
};
