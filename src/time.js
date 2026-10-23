// -----------------------------------------------------------------------------
// Times. PVOutput writes its dates and times in the local time of each system
// ("20261023", "14:05"), without a zone. The timezone of a system is the one
// getsystem gives with `tz=1` when it is a valid IANA name, else the timezone
// of the Gladys instance (TZ, given by the supervisor), else UTC.
//
// Conversions use Intl only (no dependency). A local time that happens twice
// (the clocks go back) is read as the first one, and the history of a day
// fixes the second one by its order; a local time that does not exist (the
// clocks go forward) is read as the instant right after the gap.
// -----------------------------------------------------------------------------

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * @description The timezone of the instance.
 * @returns {string|undefined} An IANA name, undefined for the system one.
 */
function defaultTimeZone() {
  return process.env.TZ || undefined;
}

/**
 * @description Whether a text is a timezone Intl knows.
 * @param {unknown} value - "Europe/Paris", "Australia/Sydney".
 * @returns {boolean} True when valid.
 */
function isTimeZone(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: value.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * @description The timezone of a system: its own, the one of Gladys, or UTC.
 * @param {unknown} systemZone - The timezone getsystem gave.
 * @param {string} [fallback] - The timezone of Gladys.
 * @returns {string} An IANA name.
 */
function systemTimeZone(systemZone, fallback = defaultTimeZone()) {
  if (isTimeZone(systemZone)) {
    return systemZone.trim();
  }
  return isTimeZone(fallback) ? fallback : 'UTC';
}

const formatters = new Map();
/**
 * @description A cached Intl formatter of the calendar fields in a timezone.
 * @param {string} timeZone - The timezone.
 * @returns {Intl.DateTimeFormat} The formatter.
 */
function partsFormatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    );
  }
  return formatters.get(timeZone);
}

/**
 * @description The local calendar fields of an instant.
 * @param {number} instant - The instant (ms).
 * @param {string} timeZone - The timezone.
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number,
 * second: number, date: string, iso: string, time: string }} The fields;
 * `date` "20261023" (PVOutput), `iso` "2026-10-23", `time` "14:05".
 */
function localParts(instant, timeZone) {
  const fields = Object.fromEntries(
    partsFormatter(timeZone)
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  const pad = (n) => String(n).padStart(2, '0');
  const { year, month, day, hour, minute, second } = fields;
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    date: `${year}${pad(month)}${pad(day)}`,
    iso: `${year}-${pad(month)}-${pad(day)}`,
    time: `${pad(hour)}:${pad(minute)}`,
  };
}

/**
 * @description The offset of a timezone at an instant: local minus UTC.
 * @param {number} instant - The instant (ms).
 * @param {string} timeZone - The timezone.
 * @returns {number} Milliseconds.
 */
function offsetAt(instant, timeZone) {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * @description Read "20261023" or "2026-10-23".
 * @param {unknown} value - The date.
 * @returns {{ year: number, month: number, day: number }|null} The fields.
 */
function readDate(value) {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) {
    return null;
  }
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/**
 * @description The instant of a local date and time of a timezone.
 * @param {string} date - "20261023" or "2026-10-23".
 * @param {string} time - "14:05" or "9:00" ("00:00" when empty).
 * @param {string} timeZone - The timezone.
 * @returns {number|null} The instant (ms), null when the date or the time is invalid.
 * @example
 * toInstant('20261025', '02:30', 'Europe/Paris'); // the first 02:30 (CEST)
 */
function toInstant(date, time, timeZone) {
  const day = readDate(date);
  const clock = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? '00:00').trim() || '00:00');
  if (!day || !clock) {
    return null;
  }
  const [hour, minute] = clock.slice(1).map(Number);
  if (hour > 24 || minute > 59) {
    return null;
  }
  const wall = Date.UTC(day.year, day.month - 1, day.day, hour, minute);
  // The two candidate offsets around the wall time (they differ around a change).
  const before = offsetAt(wall - DAY_MS / 2, timeZone);
  const after = offsetAt(wall + DAY_MS / 2, timeZone);
  const candidates = [...new Set([before, after])]
    .map((offset) => wall - offset)
    .filter((instant) => wall - offsetAt(instant, timeZone) === instant)
    .sort((a, b) => a - b);
  if (candidates.length) {
    return candidates[0];
  }
  // In a gap (the clocks went forward): the instant right after it.
  return wall - Math.min(before, after);
}

/**
 * @description The local date of the day before / after a local date.
 * @param {string} date - "20261023".
 * @param {number} days - Days to add (negative: before).
 * @returns {string} "20261022".
 */
function addDays(date, days) {
  const day = readDate(date);
  const next = new Date(Date.UTC(day.year, day.month - 1, day.day + days));
  const pad = (n) => String(n).padStart(2, '0');
  return `${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`;
}

/**
 * @description "2026-10-23" from "20261023".
 * @param {string} date - The PVOutput date.
 * @returns {string|null} The ISO date.
 */
function isoDate(date) {
  const day = readDate(date);
  if (!day) {
    return null;
  }
  const pad = (n) => String(n).padStart(2, '0');
  return `${day.year}-${pad(day.month)}-${pad(day.day)}`;
}

/**
 * @description "14:05" in the language and timezone of the user; the day too
 * when it is not today.
 * @param {number|null} instant - The instant (ms).
 * @param {object} [options] - `{ language, timeZone, now }`.
 * @returns {string} The time, '' when none.
 */
function formatTime(instant, { language = 'en', timeZone = defaultTimeZone(), now } = {}) {
  if (!Number.isFinite(instant)) {
    return '';
  }
  const locale = language === 'en' ? 'en-GB' : language;
  const sameDay =
    !Number.isFinite(now) || localParts(instant, timeZone).date === localParts(now, timeZone).date;
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    ...(sameDay ? {} : { weekday: 'short', day: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant));
}

/**
 * @description A calendar date in the language of the user: "23 oct. 2026".
 * @param {string} date - "20261023".
 * @param {string} language - The language.
 * @param {object} [options] - `{ year }`: false to leave the year out.
 * @returns {string} The date, '' when invalid.
 */
function formatDate(date, language, { year = true } = {}) {
  const day = readDate(date);
  if (!day) {
    return '';
  }
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    ...(year ? { year: 'numeric' } : {}),
  }).format(new Date(Date.UTC(day.year, day.month - 1, day.day)));
}

export {
  MINUTE_MS,
  HOUR_MS,
  DAY_MS,
  defaultTimeZone,
  isTimeZone,
  systemTimeZone,
  localParts,
  offsetAt,
  readDate,
  toInstant,
  addDays,
  isoDate,
  formatTime,
  formatDate,
};
