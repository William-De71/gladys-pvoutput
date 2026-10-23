// -----------------------------------------------------------------------------
// The answers of the PVOutput API: plain text, `,` between the fields, `;`
// between the records, `NaN` where a number does not exist and an empty field
// where a date does not exist (https://pvoutput.org/help/api_specification.html).
// Every parser below follows the field order of that specification and only
// reads the fields it documents. Energies stay in watt hours, powers in watts
// here: the conversions to kWh happen where the values are shown.
// -----------------------------------------------------------------------------

import { readDate, toInstant, HOUR_MS } from './time.js';

/**
 * @description A number of an answer: NaN, empty or garbage is null.
 * @param {unknown} raw - "359", "0.164", "NaN", "".
 * @returns {number|null} The number.
 */
function num(raw) {
  const text = String(raw ?? '').trim();
  if (!text || /^nan$/i.test(text)) {
    return null;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * @description A text field: trimmed, empty is null.
 * @param {unknown} raw - The field.
 * @returns {string|null} The text.
 */
const str = (raw) => {
  const text = String(raw ?? '').trim();
  return text && !/^nan$/i.test(text) ? text : null;
};

/**
 * @description A date field "yyyymmdd": invalid or empty is null.
 * @param {unknown} raw - The field.
 * @returns {string|null} The date.
 */
const date = (raw) => {
  const text = String(raw ?? '').trim();
  return readDate(text) && /^\d{8}$/.test(text) ? text : null;
};

/**
 * @description A time field "hh:mm": invalid or empty is null.
 * @param {unknown} raw - The field.
 * @returns {string|null} The time, two digits each.
 */
const time = (raw) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(raw ?? '').trim());
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
};

/**
 * @description The records of an answer.
 * @param {string} body - The body.
 * @returns {string[][]} The fields of each record, empty records left out.
 */
function records(body) {
  return String(body ?? '')
    .split(/[;\n]/)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => record.split(','));
}

// getsystem: the fields after the name, in order (the name itself may hold a comma).
const SYSTEM_FIELDS = [
  'size',
  'postcode',
  'panels',
  'panelPower',
  'panelBrand',
  'inverters',
  'inverterPower',
  'inverterBrand',
  'orientation',
  'tilt',
  'shade',
  'installDate',
  'latitude',
  'longitude',
  'statusInterval',
];
const SYSTEM_TEXTS = ['postcode', 'panelBrand', 'inverterBrand', 'orientation', 'shade'];

/**
 * @description Read getsystem, asked with `tz=1` (and no other section).
 * @param {string} body - "PVOutput Demo,3200,2162,10,320,Enertech,1,5000,Fronius,N,20.0,No,20120228,-33.868135,151.133423,5,Australia/Sydney;;0".
 * @param {object} [options] - `{ timeZone }`: whether the timezone field was asked for.
 * @returns {object|null} `{ name, size (W), …, latitude, longitude, statusInterval (min), timeZone }`.
 */
function parseSystem(body, { timeZone: withZone = true } = {}) {
  const first = String(body ?? '').split(';')[0];
  const fields = first.split(',');
  const tail = SYSTEM_FIELDS.length + (withZone ? 1 : 0);
  if (fields.length < tail + 1) {
    return null;
  }
  const nameEnd = fields.length - tail;
  const values = fields.slice(nameEnd);
  const system = { name: str(fields.slice(0, nameEnd).join(',')) };
  SYSTEM_FIELDS.forEach((key, index) => {
    system[key] = SYSTEM_TEXTS.includes(key) ? str(values[index]) : num(values[index]);
  });
  system.installDate = date(values[SYSTEM_FIELDS.indexOf('installDate')]);
  system.timeZone = withZone ? str(values[SYSTEM_FIELDS.length]) : null;
  if (!Number.isFinite(system.statusInterval) || system.statusInterval <= 0) {
    system.statusInterval = null;
  }
  if (
    !Number.isFinite(system.latitude) ||
    !Number.isFinite(system.longitude) ||
    Math.abs(system.latitude) > 90 ||
    Math.abs(system.longitude) > 180 ||
    (system.latitude === 0 && system.longitude === 0)
  ) {
    system.latitude = null;
    system.longitude = null;
  }
  return system;
}

/**
 * @description Read getstatus (the last status, no history).
 * @param {string} body - "20210228,13:00,359,731,92,130,0.164,21.4,240.4".
 * @returns {object|null} `{ date, time, energy (Wh), power (W), consumptionEnergy (Wh),
 * consumptionPower (W), normalised (kW/kW), temperature (°C), voltage (V) }`.
 */
function parseStatus(body) {
  const [fields] = records(body);
  if (!fields || !date(fields[0]) || !time(fields[1])) {
    return null;
  }
  return {
    date: date(fields[0]),
    time: time(fields[1]),
    energy: num(fields[2]),
    power: num(fields[3]),
    consumptionEnergy: num(fields[4]),
    consumptionPower: num(fields[5]),
    normalised: num(fields[6]),
    temperature: num(fields[7]),
    voltage: num(fields[8]),
  };
}

/**
 * @description Read the history of a day (getstatus `h=1`), in any order.
 * Instants in the timezone of the system; the hour repeated when the clocks
 * go back is told apart by the order of the records.
 * @param {string} body - "20200228,10:40,359,0.080,731,732,0.164,92,130,NaN,NaN;…".
 * @param {string} timeZone - The timezone of the system.
 * @returns {object[]} `{ at, date, time, energy, efficiency, power, averagePower,
 * normalised, consumptionEnergy, consumptionPower, temperature, voltage }`, oldest first.
 */
function parseHistory(body, timeZone) {
  const rows = records(body)
    .filter((fields) => date(fields[0]) && time(fields[1]))
    .map((fields) => ({
      date: date(fields[0]),
      time: time(fields[1]),
      energy: num(fields[2]),
      efficiency: num(fields[3]),
      power: num(fields[4]),
      averagePower: num(fields[5]),
      normalised: num(fields[6]),
      consumptionEnergy: num(fields[7]),
      consumptionPower: num(fields[8]),
      temperature: num(fields[9]),
      voltage: num(fields[10]),
    }));
  // The answer may be descending (the default) or ascending (asc=1, what the
  // integration asks for): a descending answer is turned around.
  const ascending =
    rows.length < 2 || `${rows[0].date}${rows[0].time}` <= `${rows.at(-1).date}${rows.at(-1).time}`;
  const ordered = ascending ? rows : [...rows].reverse();
  let previous = -Infinity;
  for (const row of ordered) {
    let at = toInstant(row.date, row.time, timeZone);
    // The second pass of the repeated hour: one hour later than its first reading.
    if (at <= previous && at + HOUR_MS > previous) {
      at += HOUR_MS;
    }
    row.at = at;
    previous = at;
  }
  return ordered.filter((row) => Number.isFinite(row.at)).sort((a, b) => a.at - b.at);
}

/**
 * @description Read getoutput (daily outputs, not aggregated).
 * @param {string} body - "20210218,479,0.213,0,0,1500,11:10,Showers,NaN,NaN,NaN,NaN,NaN,NaN;…".
 * @returns {object[]} `{ date, generated (Wh), efficiency (kWh/kW), exported (Wh),
 * used (Wh), peakPower (W), peakTime, condition, minTemperature, maxTemperature,
 * importPeak, importOffPeak, importShoulder, importHighShoulder }`, newest first.
 */
function parseOutputs(body) {
  return records(body)
    .filter((fields) => date(fields[0]))
    .map((fields) => ({
      date: date(fields[0]),
      generated: num(fields[1]),
      efficiency: num(fields[2]),
      exported: num(fields[3]),
      used: num(fields[4]),
      peakPower: num(fields[5]),
      peakTime: time(fields[6]),
      condition: str(fields[7]),
      minTemperature: num(fields[8]),
      maxTemperature: num(fields[9]),
      importPeak: num(fields[10]),
      importOffPeak: num(fields[11]),
      importShoulder: num(fields[12]),
      importHighShoulder: num(fields[13]),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * @description Read getstatistic (lifetime when no date range is asked for).
 * @param {string} body - "24600,14220,2220,800,3400,3.358,27,20210201,20210228,4.653,20210205".
 * @returns {object|null} `{ generated, exported, averageGeneration, minimumGeneration,
 * maximumGeneration (Wh), averageEfficiency, recordEfficiency (kWh/kW), outputs,
 * dateFrom, dateTo, recordDate }`.
 */
function parseStatistic(body) {
  const [fields] = records(body);
  if (!fields || fields.length < 11 || num(fields[0]) === null) {
    return null;
  }
  return {
    generated: num(fields[0]),
    exported: num(fields[1]),
    averageGeneration: num(fields[2]),
    minimumGeneration: num(fields[3]),
    maximumGeneration: num(fields[4]),
    averageEfficiency: num(fields[5]),
    outputs: num(fields[6]),
    dateFrom: date(fields[7]),
    dateTo: date(fields[8]),
    recordEfficiency: num(fields[9]),
    recordDate: date(fields[10]),
  };
}

/**
 * @description The first line of an answer that is a message ("OK 200: Added Status").
 * @param {string} body - The body.
 * @returns {string} The message, 200 characters at most.
 */
function messageOf(body) {
  return String(body ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

export {
  num,
  records,
  parseSystem,
  parseStatus,
  parseHistory,
  parseOutputs,
  parseStatistic,
  messageOf,
  SYSTEM_FIELDS,
};
