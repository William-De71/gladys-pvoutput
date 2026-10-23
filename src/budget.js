// -----------------------------------------------------------------------------
// The request budget of the API key, and the reading intervals it allows.
//
// PVOutput counts the requests per API key, every system and every app using
// the key together: 60 an hour (300 in donation mode), and 12 getstatistic
// an hour (60 in donation mode). Every answer carries the real count
// (X-Rate-Limit-Remaining / -Limit / -Reset): the budget trusts it over its own
// log, so another app using the same key, or a donation mode ticked by
// mistake, only make the integration slower, never refused.
//
//   - the readings never use the last `reserve` requests of the hour (15 of
//     60, 60 of 300): they are kept for the scene actions that send data;
//   - when only the reserve is left, the readings pause until the reset; a
//     "403: Exceeded number requests per hour" pauses everything until then;
//   - the intervals of the readings stretch with the number of systems so
//     that, over an hour, they stay within the limit minus the reserve.
//
// The state is a plain object kept in /data (store.js): a restart neither
// forgets the requests of the hour nor bursts.
// -----------------------------------------------------------------------------

import { MINUTE_MS, HOUR_MS, DAY_MS } from './time.js';

const LIMITS = {
  standard: { all: 60, statistic: 12 },
  donation: { all: 300, statistic: 60 },
};
// After the reset announced by PVOutput, a little margin for clocks apart.
const RESET_MARGIN_MS = 30 * 1000;
// The quota headers are trusted for this long after the answer that carried them.
const RATE_TRUST_MS = 2 * HOUR_MS;

// Reading intervals before any stretching (minutes). `status` is the status
// interval of the system itself (5 to 15) by day.
const BASE = {
  day: { output: 30, statistic: 60, history: 15 },
  night: { status: 30, output: 60, statistic: 180, history: 120 },
  system: 24 * 60,
};
const DEFAULT_STATUS_INTERVAL = 5;

/**
 * @description An empty budget state.
 * @returns {object} The state.
 */
const emptyBudget = () => ({
  seq: 0,
  log: [],
  rate: null,
  pausedUntil: 0,
  statisticPausedUntil: 0,
});

/**
 * @description The budget of the key.
 * @param {object} options - Options.
 * @param {object} options.state - The persisted state (emptyBudget()), mutated in place.
 * @param {Function} options.now - `() => number` in ms.
 * @param {Function} options.donation - `() => boolean`, the donation mode of the configuration.
 * @returns {object} The budget.
 */
function createBudget({ state, now, donation }) {
  const prune = () => {
    state.log = (state.log ?? []).filter((entry) => now() - entry.at < HOUR_MS);
  };
  const configured = () => (donation() ? LIMITS.donation : LIMITS.standard);
  const trusted = () =>
    state.rate && Number.isFinite(state.rate.at) && now() - state.rate.at < RATE_TRUST_MS
      ? state.rate
      : null;

  /**
   * @description The requests an hour of the key: as PVOutput says, else as configured.
   * @returns {number} The limit.
   */
  const limit = () => {
    const rate = trusted();
    return Number.isFinite(rate?.limit) && rate.limit > 0 ? rate.limit : configured().all;
  };

  /**
   * @description The getstatistic requests an hour: 12, or 60 for a donation key.
   * @returns {number} The limit.
   */
  const statisticLimit = () =>
    limit() >= LIMITS.donation.all ? LIMITS.donation.statistic : LIMITS.standard.statistic;

  /**
   * @description The requests kept for the scene actions.
   * @returns {number} The reserve.
   */
  const reserve = () => Math.max(15, Math.round(limit() * 0.2));

  /**
   * @description When the hour of the quota ends.
   * @returns {number} The instant (ms).
   */
  function resetAt() {
    const rate = trusted();
    if (Number.isFinite(rate?.reset) && rate.reset > now()) {
      return rate.reset;
    }
    prune();
    return state.log.length ? state.log[0].at + HOUR_MS : now();
  }

  /**
   * @description The requests left in the hour.
   * @returns {number} The count.
   */
  function remaining() {
    prune();
    const rate = trusted();
    if (Number.isFinite(rate?.remaining) && Number.isFinite(rate?.reset) && now() < rate.reset) {
      // getstatistic counts in the quota of the key too, even if its headers are not read.
      const since = state.log.filter((entry) => (entry.seq ?? 0) > (rate.seq ?? 0)).length;
      return Math.max(0, rate.remaining - since);
    }
    if (Number.isFinite(rate?.reset) && now() >= rate.reset) {
      const since = state.log.filter((entry) => entry.at >= rate.reset).length;
      return Math.max(0, limit() - since);
    }
    return Math.max(0, limit() - state.log.length);
  }

  /**
   * @description The getstatistic requests of the hour.
   * @returns {number} The count.
   */
  function statisticUsed() {
    prune();
    return state.log.filter((entry) => entry.service === 'getstatistic').length;
  }

  /**
   * @description Whether a reading may be sent now.
   * @param {string} service - The service.
   * @returns {boolean} True when allowed.
   */
  function canRead(service) {
    if (now() < state.pausedUntil || remaining() <= reserve()) {
      return false;
    }
    if (service === 'getstatistic') {
      return now() >= state.statisticPausedUntil && statisticUsed() < statisticLimit() - 1;
    }
    return true;
  }

  /**
   * @description Whether a request of a scene action or of a button may be sent now.
   * @returns {boolean} True when allowed.
   */
  const canSend = () => now() >= state.pausedUntil && remaining() > 0;

  /**
   * @description Count an answer (or a request that got no answer).
   * @param {string} service - The service.
   * @param {object} [answer] - `{ rate }`: the quota headers, if any.
   */
  function record(service, { rate } = {}) {
    prune();
    // A sequence number orders the requests of a same millisecond.
    state.seq = (state.seq ?? 0) + 1;
    state.log.push({ at: now(), service, seq: state.seq });
    // The headers of getstatistic may tell its own quota: not the one of the key.
    if (rate && service !== 'getstatistic') {
      state.rate = { ...rate, at: now(), seq: state.seq };
    }
  }

  /**
   * @description PVOutput refused a request for the quota: pause until the reset.
   * @param {string} service - The service refused.
   * @param {object} [rate] - The quota headers of the refusal.
   */
  function exceeded(service, rate) {
    const until = Number.isFinite(rate?.reset) && rate.reset > now() ? rate.reset : null;
    const fallback = Math.max(resetAt(), now() + 10 * MINUTE_MS);
    const keyLeft = service === 'getstatistic' && remaining() > reserve();
    if (keyLeft) {
      state.statisticPausedUntil = (until ?? now() + HOUR_MS) + RESET_MARGIN_MS;
      return;
    }
    state.pausedUntil = (until ?? Math.min(fallback, now() + HOUR_MS)) + RESET_MARGIN_MS;
    if (until) {
      state.rate = {
        remaining: 0,
        limit: rate.limit ?? limit(),
        reset: until,
        at: now(),
        seq: state.seq ?? 0,
      };
    }
  }

  /**
   * @description Whether the readings are paused, and until when.
   * @returns {number} The instant (ms), 0 when not paused.
   */
  function readingsPausedUntil() {
    if (now() < state.pausedUntil) {
      return state.pausedUntil;
    }
    if (remaining() <= reserve()) {
      return Math.max(resetAt(), now() + MINUTE_MS);
    }
    return 0;
  }

  return {
    limit,
    statisticLimit,
    reserve,
    remaining,
    resetAt,
    statisticUsed,
    canRead,
    canSend,
    record,
    exceeded,
    readingsPausedUntil,
    state,
  };
}

/**
 * @description The requests an hour the readings of a system ask for, by day.
 * @param {object} system - `{ statusInterval, history }`: history wanted or not.
 * @returns {number} Requests an hour.
 */
function demandOf({ statusInterval, history }) {
  const status = Math.max(DEFAULT_STATUS_INTERVAL, statusInterval || DEFAULT_STATUS_INTERVAL);
  return (
    60 / status +
    60 / BASE.day.output +
    60 / BASE.day.statistic +
    (history ? 60 / BASE.day.history : 0) +
    60 / BASE.system
  );
}

/**
 * @description How much the intervals stretch so that the readings of every
 * system stay within the limit minus the reserve.
 * @param {object[]} systems - `[{ statusInterval, history }]`.
 * @param {object} budget - `{ limit, reserve, statisticLimit }` (numbers).
 * @returns {{ factor: number, statistic: number }} The stretch, and the
 * smallest getstatistic interval (minutes) its own quota allows.
 */
function stretchOf(systems, { limit, reserve, statisticLimit }) {
  const demand = systems.reduce((total, system) => total + demandOf(system), 0);
  const room = Math.max(1, limit - reserve);
  const statisticRoom = Math.max(1, statisticLimit - 2);
  return {
    factor: Math.max(1, demand / room),
    statistic: (60 * systems.length) / statisticRoom,
  };
}

/**
 * @description The reading intervals of a system.
 * @param {object} options - Options.
 * @param {number|null} options.statusInterval - Minutes, from getsystem.
 * @param {boolean} options.night - The sun is down at the system.
 * @param {number} options.factor - The stretch (stretchOf).
 * @param {number} [options.statisticFloor] - The smallest getstatistic interval (minutes).
 * @returns {{ status: number, output: number, statistic: number, history: number,
 * system: number }} Milliseconds.
 */
function intervalsOf({ statusInterval, night, factor, statisticFloor = 0 }) {
  const own = Math.max(DEFAULT_STATUS_INTERVAL, statusInterval || DEFAULT_STATUS_INTERVAL);
  const minutes = night
    ? {
        status: Math.max(BASE.night.status, own),
        output: BASE.night.output,
        statistic: BASE.night.statistic,
        history: BASE.night.history,
      }
    : { status: own, ...BASE.day };
  const stretch = (value) => Math.round(value * factor * MINUTE_MS);
  return {
    status: stretch(minutes.status),
    output: stretch(minutes.output),
    statistic: Math.max(stretch(minutes.statistic), Math.round(statisticFloor * MINUTE_MS)),
    history: stretch(minutes.history),
    system: Math.max(DAY_MS, stretch(BASE.system)),
  };
}

export {
  LIMITS,
  BASE,
  DEFAULT_STATUS_INTERVAL,
  emptyBudget,
  createBudget,
  demandOf,
  stretchOf,
  intervalsOf,
};
