// -----------------------------------------------------------------------------
// Scene triggers, their payloads, and the outputs of the scene actions.
//
// Triggers (one event per transition, never a periodic snapshot, never as the
// consequence of a scene action):
//   - `system_silent`    no new status for N minutes while the sun is up at the
//                        system (N = 3 status intervals, 30 minutes at least):
//                        the inverters publish nothing at night, so the night
//                        never makes a system silent;
//   - `system_back`      a silent system publishes again;
//   - `daily_summary`    once a day, about an hour after sunset at the system:
//                        production, export, consumption, peak, yield;
//   - `daily_record`     the yield of the day is the record of the life of the
//                        system (getstatistic says the record date is today);
//   - `api_key_refused`  PVOutput refuses the key (once per refusal).
// The first reading of a system is a baseline: nothing fires for what was
// already true. What the triggers know lives in /data.
// -----------------------------------------------------------------------------

import { t, formatNumber } from './i18n.js';
import { MINUTE_MS, HOUR_MS, localParts, isoDate } from './time.js';

const TRIGGERS = {
  SYSTEM_SILENT: 'system_silent',
  SYSTEM_BACK: 'system_back',
  DAILY_SUMMARY: 'daily_summary',
  DAILY_RECORD: 'daily_record',
  API_KEY_REFUSED: 'api_key_refused',
};
const SCENE_ACTIONS = {
  SEND_STATUS: 'send_status',
  SEND_DAILY_OUTPUT: 'send_daily_output',
  GET_TODAY: 'get_today',
};
const SEND_OUTPUTS = ['result', 'date', 'time'];
const OUTPUT_OUTPUTS = ['result', 'date'];
const TODAY_OUTPUTS = [
  'production_kwh',
  'exported_kwh',
  'consumed_kwh',
  'peak_power_w',
  'peak_time',
  'efficiency_kwh_kw',
  'power_w',
  'last_status_time',
  'minutes_since_status',
  'system_name',
  'summary',
];
// A system is silent after this many status intervals without a status, and
// never before 30 minutes; the window of the day starts an hour after sunrise
// and ends an hour before sunset (dawn and dusk publish little or nothing).
const SILENT_INTERVALS = 3;
const SILENT_MIN_MS = 30 * MINUTE_MS;
const DAY_MARGIN_MS = HOUR_MS;
// The daily summary: about an hour after sunset.
const SUMMARY_AFTER_SUNSET_MS = HOUR_MS;

/**
 * @description After how long without a status a system is silent.
 * @param {number|null} statusInterval - Minutes.
 * @returns {number} Milliseconds.
 */
const silentAfter = (statusInterval) =>
  Math.max(SILENT_MIN_MS, SILENT_INTERVALS * (statusInterval || 5) * MINUTE_MS);

/**
 * @description Whether a system is silent now, by day only.
 * @param {object} options - Options.
 * @param {number|null} options.lastStatusAt - The instant of its last status.
 * @param {object|null} options.sun - sun.sunAt() now at the system.
 * @param {number|null} options.statusInterval - Minutes.
 * @param {number} options.now - Now (ms).
 * @returns {boolean|null} True / false, null when it cannot be told (night, no location).
 */
function isSilent({ lastStatusAt, sun, statusInterval, now }) {
  if (!sun || sun.polar === 'night') {
    return null;
  }
  const start = sun.polar === 'day' ? now - 24 * HOUR_MS : sun.sunrise + DAY_MARGIN_MS;
  const end = sun.polar === 'day' ? now + 1 : sun.sunset - DAY_MARGIN_MS;
  if (now < start || now >= end) {
    return null;
  }
  // The silence of the day counts from the start of its window at the latest.
  const since = Math.max(lastStatusAt ?? 0, start);
  return now - since >= silentAfter(statusInterval);
}

/**
 * @description The transitions of silence of a system after a reading.
 * @param {object} seen - What the triggers know (`{ initialized, silent, silentSince }`).
 * @param {object} options - `{ lastStatusAt, sun, statusInterval, now }`.
 * @returns {{ events: string[], next: object }} The triggers to fire and what to remember.
 */
function detectSilence(seen = {}, { lastStatusAt, sun, statusInterval, now }) {
  const events = [];
  const next = { ...seen };
  const silentNow = isSilent({ lastStatusAt, sun, statusInterval, now });
  if (seen.silent === true) {
    // Back: a status newer than the silence, whatever the hour.
    if (Number.isFinite(lastStatusAt) && lastStatusAt > (seen.silentSince ?? 0)) {
      // Only when its silence fired: a baseline silence comes back quietly.
      if (seen.silentFired) events.push(TRIGGERS.SYSTEM_BACK);
      next.silent = false;
      next.silentFired = false;
      next.backAfter = Number.isFinite(seen.silentSince) ? lastStatusAt - seen.silentSince : null;
    }
  } else if (silentNow === true) {
    if (seen.initialized) events.push(TRIGGERS.SYSTEM_SILENT);
    next.silent = true;
    next.silentFired = Boolean(seen.initialized);
    next.silentSince = lastStatusAt ?? now;
  } else if (silentNow === false) {
    next.silent = false;
  }
  next.initialized = true;
  return { events, next };
}

/**
 * @description A value in kWh from watt hours, rounded to the Wh.
 * @param {number|null} wh - Watt hours.
 * @returns {number|null} kWh.
 */
const kwh = (wh) => (Number.isFinite(wh) ? Math.round(wh) / 1000 : null);

/**
 * @description What a system did today, from what the integration knows.
 * @param {object} view - `{ size, timeZone, status, today, history, exportKnown,
 * consumptionKnown }` (app.js).
 * @param {number} now - Now (ms).
 * @returns {object} `{ date, production, exported, consumed (Wh), peakPower (W),
 * peakTime, efficiency (kWh/kW), power (W), condition, lastStatusAt }`.
 */
function todayOf(view, now) {
  const date = localParts(now, view.timeZone).date;
  const status = view.status?.date === date ? view.status : null;
  const output = view.today?.date === date ? view.today : null;
  const production = Math.max(output?.generated ?? 0, status?.energy ?? 0);
  const points = (view.history?.date === date ? view.history.points : []) ?? [];
  let peak = null;
  for (const point of points) {
    if (Number.isFinite(point.power) && (!peak || point.power > peak.power)) {
      peak = point;
    }
  }
  const peakPower = output?.peakPower ?? peak?.power ?? null;
  const peakTime = output?.peakTime ?? peak?.time ?? null;
  const size = Number.isFinite(view.size) && view.size > 0 ? view.size : null;
  const efficiency =
    output?.efficiency ?? (size ? Math.round((production / size) * 1000) / 1000 : null);
  return {
    date,
    production,
    exported: view.exportKnown ? (output?.exported ?? null) : null,
    consumed: view.consumptionKnown
      ? (status?.consumptionEnergy ?? (output?.used || null) ?? null)
      : null,
    peakPower,
    peakTime,
    efficiency,
    power: view.power ?? null,
    condition: output?.condition ?? null,
    lastStatusAt: view.status?.at ?? null,
  };
}

/**
 * @description The sentence of a day, ready for a message.
 * @param {string} name - The name of the system.
 * @param {object} day - todayOf().
 * @param {string} language - The language.
 * @returns {string} "Home: 18.4 kWh produced today (4.38 kWh/kW), peak 3,120 W at 13:05, …".
 */
function summaryOf(name, day, language) {
  const parts = [
    t('summaryProduced', language, {
      name,
      value: formatNumber(kwh(day.production) ?? 0, language, 1),
    }),
  ];
  const extras = [];
  if (Number.isFinite(day.efficiency)) {
    extras.push(t('summaryYield', language, { value: formatNumber(day.efficiency, language, 2) }));
  }
  if (Number.isFinite(day.peakPower) && day.peakPower > 0) {
    extras.push(
      t(day.peakTime ? 'summaryPeakAt' : 'summaryPeak', language, {
        value: formatNumber(day.peakPower, language, 0),
        time: day.peakTime ?? '',
      }),
    );
  }
  if (Number.isFinite(day.exported)) {
    extras.push(
      t('summaryExported', language, { value: formatNumber(kwh(day.exported), language, 1) }),
    );
  }
  if (Number.isFinite(day.consumed)) {
    extras.push(
      t('summaryConsumed', language, { value: formatNumber(kwh(day.consumed), language, 1) }),
    );
  }
  return `${parts[0]}${extras.length ? `, ${extras.join(', ')}` : ''}.`;
}

/**
 * @description The data of an event of a system.
 * @param {object} view - `{ deviceId, name }`.
 * @param {object} extra - The values of this trigger.
 * @returns {object} The flat payload.
 */
const systemData = (view, extra = {}) => ({
  system: view.deviceId,
  system_name: String(view.name ?? '').slice(0, 1000),
  ...extra,
});

/**
 * @description The payload of `daily_summary`.
 * @param {object} view - The view of the system.
 * @param {object} day - todayOf().
 * @param {object} options - `{ language, record }`.
 * @returns {object} The payload.
 */
function summaryData(view, day, { language, record = false }) {
  return systemData(view, {
    date: isoDate(day.date),
    production_kwh: kwh(day.production) ?? 0,
    exported_kwh: kwh(day.exported),
    consumed_kwh: kwh(day.consumed),
    peak_power_w: Number.isFinite(day.peakPower) ? Math.round(day.peakPower) : null,
    peak_time: day.peakTime,
    efficiency_kwh_kw: Number.isFinite(day.efficiency) ? day.efficiency : null,
    condition: day.condition,
    is_record: Boolean(record),
    summary: summaryOf(view.name, day, language).slice(0, 1000),
  });
}

/**
 * @description The outputs of the `get_today` action.
 * @param {object} view - The view of the system.
 * @param {object} options - `{ now, language, formatTime }`.
 * @returns {object} Exactly TODAY_OUTPUTS, scalars or null.
 */
function todayOutputs(view, { now, language, formatTime }) {
  const day = todayOf(view, now);
  const outputs = {
    production_kwh: kwh(day.production) ?? 0,
    exported_kwh: kwh(day.exported),
    consumed_kwh: kwh(day.consumed),
    peak_power_w: Number.isFinite(day.peakPower) ? Math.round(day.peakPower) : null,
    peak_time: day.peakTime,
    efficiency_kwh_kw: Number.isFinite(day.efficiency) ? day.efficiency : null,
    power_w: Number.isFinite(day.power) ? Math.round(day.power) : null,
    last_status_time: Number.isFinite(day.lastStatusAt) ? formatTime(day.lastStatusAt) : null,
    minutes_since_status: Number.isFinite(day.lastStatusAt)
      ? Math.max(0, Math.round((now - day.lastStatusAt) / MINUTE_MS))
      : null,
    system_name: view.name,
    summary: summaryOf(view.name, day, language).slice(0, 1000),
  };
  return pick(outputs, TODAY_OUTPUTS);
}

/**
 * @description Keep only the declared keys of a scene action result.
 * @param {object} outputs - The values.
 * @param {string[]} keys - The declared outputs.
 * @returns {object} The result.
 */
const pick = (outputs, keys) => Object.fromEntries(keys.map((key) => [key, outputs[key] ?? null]));

export {
  TRIGGERS,
  SCENE_ACTIONS,
  SEND_OUTPUTS,
  OUTPUT_OUTPUTS,
  TODAY_OUTPUTS,
  SUMMARY_AFTER_SUNSET_MS,
  silentAfter,
  isSilent,
  detectSilence,
  kwh,
  todayOf,
  summaryOf,
  systemData,
  summaryData,
  todayOutputs,
  pick,
};
