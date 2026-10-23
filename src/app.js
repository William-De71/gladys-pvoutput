// -----------------------------------------------------------------------------
// The PVOutput integration: every handler, registered on a Gladys client.
//
// Brings the solar systems of a PVOutput account (pvoutput.org) into Gladys,
// with the API key of the account, for up to five systems:
//   - devices (device.js): one per system, its power, its energy of the day,
//     its lifetime production, and its consumption, temperature and voltage
//     when it publishes them;
//   - scene triggers (events.js): system silent / back by day, the summary of
//     the day after sunset, a record yield, the key refused;
//   - scene actions: send a live status (addstatus) or the output of a day
//     (addoutput) from values of Gladys, read the day of a system;
//   - dashboard widgets (widgets.js): today at a system, its last 30 days.
//
// Within the quota of the key (budget.js): 60 requests an hour for every
// system together (300 in donation mode), a part of it kept for the scene
// actions that send data. The integration's own timer reads, per system, the
// last status at the status interval of the system (every 30 minutes at
// night), the daily outputs every 30 minutes, the lifetime statistics every
// hour, the system once a day, and the curve of the day only while a widget
// shows it; the intervals stretch with the number of systems. Never on a
// Gladys poll, never from a widget, never twice at startup (kept in /data).
//
// index.js only creates the SDK client; the tests drive this module with the
// fake Gladys of the SDK and a fake PVOutput (test/helpers/fake-pvoutput.js).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import {
  normalizeConfig,
  readLanguage,
  guessLanguage,
  INTERNAL_KEYS,
  AUTO_LANGUAGE,
} from './config.js';
import { createPvoutputClient, PvoutputError } from './pvoutput-api.js';
import { parseSystem, parseStatus, parseHistory, parseOutputs, parseStatistic } from './parse.js';
import { createBudget, stretchOf, intervalsOf } from './budget.js';
import { createStore, DEFAULT_DIR } from './store.js';
import { sunAt } from './sun.js';
import {
  idsOf,
  systemOfExternalId,
  featureKeysOf,
  buildSystemDevice,
  buildSystemStates,
} from './device.js';
import {
  TRIGGERS,
  SCENE_ACTIONS,
  SEND_OUTPUTS,
  OUTPUT_OUTPUTS,
  SUMMARY_AFTER_SUNSET_MS,
  silentAfter,
  detectSilence,
  todayOf,
  systemData,
  summaryData,
  todayOutputs,
  pick,
} from './events.js';
import { statusParams, outputParams, ActionError, refusalKey } from './actions.js';
import { WIDGETS, messageContent, buildProductionWidget, buildDaysWidget } from './widgets.js';
import {
  MINUTE_MS,
  HOUR_MS,
  defaultTimeZone,
  systemTimeZone,
  localParts,
  toInstant,
  addDays,
  formatTime,
} from './time.js';
import { t, all, formatNumber, LANGUAGES } from './i18n.js';

const ACTIONS = { TEST_CONNECTION: 'test_connection', DIAGNOSTIC: 'diagnostic' };
const TICK_MS = 30 * 1000;
// No burst at startup: the first readings wait a little, even when due.
const STARTUP_DELAY_MS = 15 * 1000;
// A refused key is tried again every hour (or at once with a new key); an
// unknown System Id every 6 hours.
const KEY_RETRY_MS = HOUR_MS;
const SYSTEM_RETRY_MS = 6 * HOUR_MS;
const SYSTEM_FIRST_RETRY_MS = 5 * MINUTE_MS;
// The curve of the day is read while a production widget was shown lately.
const WIDGET_SEEN_MS = 30 * MINUTE_MS;
// Without a location (or in a polar day or night), the summary comes at 21:00.
const SUMMARY_FALLBACK_TIME = '21:00';
const DIAGNOSTIC_CHUNK = 3000;
const DAYS_KEPT = 31;
const { version: VERSION } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const USER_AGENT = `gladys-pvoutput/${VERSION} (+https://github.com/William-De71/gladys-pvoutput)`;

/**
 * @description Why PVOutput refused the key, as a stable word for the scenes.
 * @param {string} message - The message of PVOutput.
 * @returns {string} `disabled_key` or `invalid_key` (a wrong key, or a key
 * and a System Id that do not go together: PVOutput says the same).
 */
function keyReason(message) {
  if (/disabled api key/i.test(message)) return 'disabled_key';
  return 'invalid_key';
}

/**
 * @description Register every handler of the integration on a Gladys client.
 * @param {object} gladys - A GladysIntegration (or the fake Gladys of the SDK).
 * @param {object} [options] - Options.
 * @param {Function} [options.fetch] - HTTP transport of PVOutput (tests).
 * @param {string} [options.baseUrl] - The site root (tests).
 * @param {string} [options.dataDir] - The writable folder (/data).
 * @param {Function} [options.now] - `() => number` in ms (tests).
 * @param {string} [options.timeZone] - IANA timezone of Gladys (TZ by default).
 * @param {boolean} [options.timers] - Arm the reading timer (false in tests).
 * @param {number} [options.spacingMs] - Time between two requests (0 in tests).
 * @param {object} [options.logger] - Logger.
 * @returns {object} Handles for the tests.
 */
function createApp(
  gladys,
  {
    fetch: fetchFn,
    baseUrl,
    dataDir = DEFAULT_DIR,
    now = () => Date.now(),
    timeZone = defaultTimeZone(),
    timers = true,
    spacingMs,
    logger = sdkLogger,
  } = {},
) {
  let config = normalizeConfig();
  let language = guessLanguage(timeZone);
  let createdDevices = new Set();
  let lastStatus = null;
  let lastDiscovery = null;
  let lastKeyTry = 0;
  let timer = null;
  let startTimer = null;
  let running = null;
  let stopped = false;
  // When a production widget of a system was last asked for (memory only).
  const widgetSeen = new Map();

  const store = createStore({ dir: dataDir, logger });
  const budget = createBudget({
    state: store.data.budget,
    now,
    donation: () => config.donation,
  });
  const api = createPvoutputClient({
    getKey: () => config.apiKey,
    userAgent: USER_AGENT,
    onAnswer: (service, answer) => budget.record(service, answer),
    ...(fetchFn ? { fetch: fetchFn } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(Number.isFinite(spacingMs) ? { spacingMs } : {}),
  });

  /**
   * @description Remember the language of a widget request, and store it when it changed.
   * @param {string} next - The language.
   */
  function rememberLanguage(next) {
    if (!LANGUAGES.includes(next) || next === language) {
      return;
    }
    language = next;
    gladys
      .setConfig({ [INTERNAL_KEYS.language]: next })
      .catch((err) => logger.warn(`Unable to store the language: ${err.message}`));
  }

  /**
   * @description Language of the texts Gladys does not ask for in a language.
   * @returns {string} The language.
   */
  const textLanguage = () => (config.language === AUTO_LANGUAGE ? language : config.language);

  // --- What is known of a system -----------------------------------------------------

  /**
   * @description What is kept of a system.
   * @param {string} id - The System Id.
   * @returns {object} The state (store.js).
   */
  function stateOf(id) {
    store.data.systems[id] ??= {};
    const state = store.data.systems[id];
    state.info ??= null;
    state.status ??= null;
    state.history ??= null;
    state.outputs ??= [];
    state.statistic ??= null;
    state.features ??= [];
    state.seen ??= {};
    state.at ??= {};
    state.fetched ??= {};
    return state;
  }

  /**
   * @description The timezone of a system.
   * @param {string} id - The System Id.
   * @returns {string} An IANA name.
   */
  const zoneOf = (id) => systemTimeZone(stateOf(id).info?.timeZone, timeZone);

  /**
   * @description The sun at a system now.
   * @param {string} id - The System Id.
   * @returns {object|null} sun.sunAt().
   */
  function sunOf(id) {
    const info = stateOf(id).info;
    return info ? sunAt(now(), { ...info, timeZone: zoneOf(id) }) : null;
  }

  /**
   * @description Whether the last status of a system is recent enough to be "now".
   * @param {string} id - The System Id.
   * @returns {boolean} True when fresh.
   */
  function statusFresh(id) {
    const state = stateOf(id);
    return (
      Number.isFinite(state.status?.at) &&
      now() - state.status.at <= silentAfter(state.info?.statusInterval)
    );
  }

  /**
   * @description The power produced now: the last status when fresh, 0 at
   * night or on a new day, unknown when a system is late by day.
   * @param {string} id - The System Id.
   * @returns {number|null} Watts.
   */
  function powerOf(id) {
    const state = stateOf(id);
    if (statusFresh(id)) {
      return state.status.power;
    }
    const sun = sunOf(id);
    const today = localParts(now(), zoneOf(id)).date;
    if (!state.status || state.status.date !== today || (sun && !sun.day)) {
      return 0;
    }
    return null;
  }

  /**
   * @description The view of a system the widgets, the scenes and the states use.
   * @param {string} id - The System Id.
   * @returns {object} The view.
   */
  function viewOf(id) {
    const state = stateOf(id);
    const zone = zoneOf(id);
    const today = localParts(now(), zone).date;
    return {
      id,
      deviceId: idsOf(gladys, id).device,
      name: state.info?.name || `PVOutput ${id}`,
      size: state.info?.size ?? null,
      statusInterval: state.info?.statusInterval ?? null,
      timeZone: zone,
      info: state.info,
      status: state.status,
      today: state.outputs.find((output) => output.date === today) ?? null,
      outputs: state.outputs,
      statistic: state.statistic,
      history: state.history,
      features: state.features,
      exportKnown: state.outputs.some((output) => output.exported > 0),
      consumptionKnown: state.features.includes('consumption_today'),
      power: powerOf(id),
      silent: state.seen.silent === true,
      sun: sunOf(id),
    };
  }

  /**
   * @description The values of the features of a system now.
   * @param {string} id - The System Id.
   * @returns {object} `{ power, energy_today, … }`, null when unknown.
   */
  function valuesOf(id) {
    const state = stateOf(id);
    const view = viewOf(id);
    const today = localParts(now(), view.timeZone).date;
    const fresh = statusFresh(id);
    const status = state.status;
    const statusToday = status?.date === today ? status : null;
    const day = todayOf(view, now());
    const kw = (wh) => (Number.isFinite(wh) ? wh / 1000 : null);
    return {
      power: view.power,
      energy_today: kw(day.production),
      lifetime_energy: Number.isFinite(state.lifetime) ? state.lifetime : null,
      consumption_power: fresh ? status.consumptionPower : null,
      consumption_today: kw(statusToday?.consumptionEnergy),
      temperature: fresh ? status.temperature : null,
      voltage: fresh ? status.voltage : null,
    };
  }

  /**
   * @description Add the features a reading revealed (never removes one).
   * @param {string} id - The System Id.
   * @param {object[]} readings - Statuses or history points.
   */
  function learnFeatures(id, readings) {
    const state = stateOf(id);
    const found = new Set(state.features);
    for (const reading of readings) {
      if (!reading) continue;
      if (reading.consumptionPower > 0 || reading.consumptionEnergy > 0) {
        found.add('consumption_power');
        found.add('consumption_today');
      }
      if (Number.isFinite(reading.temperature)) found.add('temperature');
      if (reading.voltage > 0) found.add('voltage');
    }
    if (Number.isFinite(state.statistic?.generated)) found.add('lifetime_energy');
    state.features = featureKeysOf([...found]).filter((key) => found.has(key));
  }

  // --- Errors and status -------------------------------------------------------------

  /**
   * @description The message of an error, for a user.
   * @param {Error} err - The error.
   * @param {string} lang - The language.
   * @returns {string} The message.
   */
  function errorText(err, lang) {
    if (err instanceof ActionError) {
      return t(err.key, lang, {
        ...err.values,
        field: err.values?.field ? t(`field_${err.values.field}`, lang) : '',
      });
    }
    const detail = String(err?.message ?? '').slice(0, 120);
    const key = {
      key: 'errKey',
      system: 'errSystem',
      read_only: 'refusedReadOnly',
      rate_limit: 'refusedQuota',
      donation: 'refusedDonation',
      unreachable: 'errUnreachable',
      no_status: 'errNoStatus',
    }[err?.kind];
    if (key) {
      return t(key, lang, { detail, system: err?.system ?? '' });
    }
    if (err?.kind === 'invalid') {
      return t('refusedWith', lang, { reason: t(refusalKey(detail), lang), detail });
    }
    return t('errFailed', lang, { detail });
  }

  /**
   * @description Report the connection status, only when it changed.
   * @param {boolean} connected - Connected or not.
   * @param {object} message - The multi-language message.
   * @returns {Promise<void>}
   */
  async function reportStatus(connected, message) {
    const clipped = Object.fromEntries(
      Object.entries(message).map(([lang, text]) => [lang, text.slice(0, 200)]),
    );
    const signature = JSON.stringify([connected, clipped]);
    if (signature === lastStatus) {
      return;
    }
    lastStatus = signature;
    try {
      await gladys.setConnectionStatus(connected, clipped);
    } catch (err) {
      lastStatus = null;
      logger.error('Unable to report the connection status', err);
    }
  }

  /**
   * @description "15:00" in the timezone of Gladys.
   * @param {number} instant - The instant.
   * @param {string} lang - The language.
   * @returns {string} The time.
   */
  const timeText = (instant, lang) => formatTime(instant, { language: lang, timeZone, now: now() });

  /**
   * @description Work out the connection status.
   * @returns {Promise<void>}
   */
  async function refreshStatus() {
    if (!config.apiKey) {
      await reportStatus(false, all('statusNoKey'));
      return;
    }
    if (config.systemIds.length === 0) {
      await reportStatus(
        false,
        all(config.invalidIds.length ? 'statusInvalidIds' : 'statusNoSystem', {
          ids: config.invalidIds.join(', '),
        }),
      );
      return;
    }
    if (store.data.keyRefused) {
      await reportStatus(
        false,
        all((lang) => errorText({ kind: 'key', message: store.data.keyRefused }, lang)),
      );
      return;
    }
    const failing = config.systemIds.filter((id) => stateOf(id).error?.kind === 'system');
    if (failing.length === config.systemIds.length) {
      await reportStatus(false, all('errSystem', { system: failing.join(', ') }));
      return;
    }
    const known = config.systemIds.filter((id) => stateOf(id).info);
    if (known.length === 0) {
      await reportStatus(true, all('statusWaiting'));
      return;
    }
    const paused = budget.readingsPausedUntil();
    const line = (id, lang) => {
      const view = viewOf(id);
      const power = Number.isFinite(view.power) ? `${formatNumber(view.power, lang, 0)} W` : '–';
      return t('systemLine', lang, { name: view.name, value: power });
    };
    await reportStatus(
      true,
      all((lang) => {
        const parts = [
          t('statusOk', lang, {
            count: known.length,
            systems: known.map((id) => line(id, lang)).join(', '),
          }),
        ];
        if (failing.length)
          parts.push(t('statusSomeFailing', lang, { systems: failing.join(', ') }));
        if (paused) parts.push(t('statusPaused', lang, { time: timeText(paused, lang) }));
        if (config.extraIds.length) parts.push(t('statusTooMany', lang));
        return parts.join(' ');
      }),
    );
  }

  /**
   * @description Refresh the list of the devices the user created.
   * @returns {Promise<void>}
   */
  async function refreshCreatedDevices() {
    try {
      const devices = await gladys.getDevices();
      createdDevices = new Set(devices.map((device) => device.external_id));
    } catch (err) {
      logger.warn(`Unable to read the devices: ${err.message}`);
    }
  }

  /**
   * @description Ask the open widgets to pull their content again.
   */
  function refreshWidgets() {
    for (const key of Object.values(WIDGETS)) {
      Promise.resolve(gladys.requestWidgetRefresh(key)).catch(() => {});
    }
  }

  /**
   * @description Publish scene events, one by one.
   * @param {Array<{ key: string, data: object }>} events - The events.
   * @returns {Promise<void>}
   */
  async function publishEvents(events) {
    for (const { key, data } of events) {
      logger.info(`PVOutput: ${key}${data.system_name ? ` (${data.system_name})` : ''}`);
      try {
        await gladys.publishSceneEvent(key, data);
      } catch (err) {
        logger.warn(`Unable to fire ${key}: ${err.message}`);
      }
    }
  }

  // --- Devices -----------------------------------------------------------------------

  /**
   * @description Offer a device per known system on the Discovery screen, when they changed.
   * @param {boolean} [force] - Publish even when unchanged.
   * @returns {Promise<number>} How many devices were offered.
   */
  async function publishDiscoveredDevices(force = false) {
    const lang = textLanguage();
    const devices = config.systemIds
      .filter((id) => stateOf(id).info)
      .map((id) => {
        const state = stateOf(id);
        return buildSystemDevice(
          gladys,
          { id, name: state.info.name, size: state.info.size, features: state.features },
          lang,
        );
      });
    const signature = JSON.stringify(devices);
    if (force || signature !== lastDiscovery) {
      await gladys.publishDiscoveredDevices(devices);
      lastDiscovery = signature;
    }
    return devices.length;
  }

  /**
   * @description Publish the states of a system, when its device exists.
   * @param {string} id - The System Id.
   * @returns {Promise<void>}
   */
  async function publishStates(id) {
    if (!createdDevices.has(idsOf(gladys, id).device)) {
      return;
    }
    const state = stateOf(id);
    const states = buildSystemStates(gladys, { id, features: state.features }, valuesOf(id));
    if (states.length) {
      await gladys
        .publishChangedStates(states)
        .catch((err) => logger.warn(`Unable to publish the states of ${id}: ${err.message}`));
    }
  }

  // --- Reading -----------------------------------------------------------------------

  /**
   * @description The reading intervals of a system now.
   * @param {string} id - The System Id.
   * @returns {object} intervalsOf().
   */
  function intervalsFor(id) {
    const systems = config.systemIds.map((other) => ({
      statusInterval: stateOf(other).info?.statusInterval ?? null,
      history: now() - (widgetSeen.get(other) ?? 0) < WIDGET_SEEN_MS,
    }));
    const { factor, statistic } = stretchOf(systems, {
      limit: budget.limit(),
      reserve: budget.reserve(),
      statisticLimit: budget.statisticLimit(),
    });
    const sun = sunOf(id);
    return intervalsOf({
      statusInterval: stateOf(id).info?.statusInterval ?? null,
      night: Boolean(sun && !sun.day),
      factor,
      statisticFloor: statistic,
    });
  }

  /**
   * @description When the summary of today is due at a system.
   * @param {string} id - The System Id.
   * @returns {number} The instant (ms).
   */
  function summaryTime(id) {
    const sun = sunOf(id);
    if (sun?.sunset) {
      return sun.sunset + SUMMARY_AFTER_SUNSET_MS;
    }
    return toInstant(localParts(now(), zoneOf(id)).date, SUMMARY_FALLBACK_TIME, zoneOf(id));
  }

  /**
   * @description The readings due at a system, in order.
   * @param {string} id - The System Id.
   * @returns {string[]} `system`, `status`, `output`, `statistic`, `history`.
   */
  function dueOf(id) {
    const state = stateOf(id);
    const at = state.at;
    const since = (task) => now() - (at[task] ?? 0);
    if (state.error?.kind === 'system' && since('system') < SYSTEM_RETRY_MS) {
      return [];
    }
    if (!state.info) {
      // Not read yet: tried again every 5 minutes after a failure.
      return since('system') >= SYSTEM_FIRST_RETRY_MS ? ['system'] : [];
    }
    const every = intervalsFor(id);
    const due = [];
    if (since('system') >= every.system) due.push('system');
    if (since('status') >= every.status) due.push('status');
    // The summary needs the outputs and statistics read after the end of the day.
    const summary = summaryTime(id);
    const today = localParts(now(), zoneOf(id)).date;
    const summaryWaits = now() >= summary - 30 * MINUTE_MS && state.seen.summaryDate !== today;
    const fetchedBefore = (task) => (state.fetched[task] ?? 0) < summary - 30 * MINUTE_MS;
    if (
      since('output') >= every.output ||
      (summaryWaits && fetchedBefore('output') && since('output') >= 5 * MINUTE_MS)
    ) {
      due.push('output');
    }
    if (
      since('statistic') >= every.statistic ||
      (summaryWaits && fetchedBefore('statistic') && since('statistic') >= 5 * MINUTE_MS)
    ) {
      due.push('statistic');
    }
    const wanted = now() - (widgetSeen.get(id) ?? 0) < WIDGET_SEEN_MS;
    if (wanted && (state.history?.date !== today || since('history') >= every.history)) {
      due.push('history');
    }
    return due;
  }

  /**
   * @description The service of a reading.
   * @param {string} task - The reading.
   * @returns {string} The service.
   */
  const serviceOf = (task) =>
    ({
      system: 'getsystem',
      status: 'getstatus',
      output: 'getoutput',
      statistic: 'getstatistic',
      history: 'getstatus',
    })[task];

  /**
   * @description Run one reading of a system.
   * @param {string} id - The System Id.
   * @param {string} task - The reading.
   * @returns {Promise<void>}
   */
  async function read(id, task) {
    const state = stateOf(id);
    const zone = zoneOf(id);
    const today = localParts(now(), zone).date;
    state.at[task] = now();
    if (task === 'system') {
      const info = parseSystem(await api.getSystem(id));
      if (!info) {
        throw new PvoutputError('failed', 'Unexpected answer of getsystem');
      }
      state.info = info;
    } else if (task === 'status') {
      try {
        const status = parseStatus(await api.getStatus(id));
        state.status = status
          ? { ...status, at: toInstant(status.date, status.time, zone) }
          : state.status;
      } catch (err) {
        if (err.kind !== 'no_status') throw err;
        // Nothing in the last 7 days: not an error, a quiet system.
      }
      learnFeatures(id, [state.status]);
    } else if (task === 'output') {
      const outputs = parseOutputs(
        await api.getOutputs(id, { from: addDays(today, -(DAYS_KEPT - 1)), to: today }),
      );
      state.outputs = outputs.slice(0, DAYS_KEPT);
    } else if (task === 'statistic') {
      const statistic = parseStatistic(await api.getStatistic(id));
      if (statistic) {
        const previous = state.statistic;
        // The record before today, for the record trigger.
        if (previous?.recordDate && previous.recordDate !== today) {
          state.previousRecord = {
            efficiency: previous.recordEfficiency,
            date: previous.recordDate,
          };
        }
        state.statistic = statistic;
        if (Number.isFinite(statistic.generated)) {
          // An index never goes down.
          state.lifetime = Math.max(state.lifetime ?? 0, statistic.generated / 1000);
        }
        learnFeatures(id, []);
      }
    } else if (task === 'history') {
      let points = [];
      try {
        points = parseHistory(await api.getHistory(id, today), zone).filter(
          (point) => point.date === today,
        );
      } catch (err) {
        if (err.kind !== 'no_status') throw err;
      }
      state.history = { date: today, points };
      learnFeatures(id, points);
    }
    state.fetched[task] = now();
    if (state.error) {
      state.error = null;
    }
  }

  /**
   * @description Read what is due, within the budget, then publish what changed.
   * @returns {Promise<void>}
   */
  async function runReadings() {
    if (!config.apiKey || config.systemIds.length === 0) {
      await refreshStatus();
      return;
    }
    if (store.data.keyRefused && now() - lastKeyTry < KEY_RETRY_MS) {
      await refreshStatus();
      return;
    }
    const events = [];
    let changed = false;
    let stop = false;
    for (const id of config.systemIds) {
      if (stop) break;
      const queue = dueOf(id);
      while (queue.length) {
        const task = queue.shift();
        if (!budget.canRead(serviceOf(task))) {
          // Kept for the scene actions, or paused until the reset.
          if (serviceOf(task) !== 'getstatistic') stop = true;
          if (stop) break;
          continue;
        }
        try {
          if (store.data.keyRefused) lastKeyTry = now();
          const first = task === 'system' && !stateOf(id).info;
          await read(id, task);
          changed = true;
          // A system read for the first time: its other readings at once.
          if (first) queue.push(...dueOf(id).filter((next) => next !== 'system'));
          if (store.data.keyRefused) {
            store.data.keyRefused = null;
            logger.info('PVOutput accepts the key again');
          }
        } catch (err) {
          const kind = err.kind ?? 'failed';
          logger.warn(`PVOutput ${task} of ${id} (${kind}): ${err.message}`);
          store.data.lastError = { kind, message: String(err.message).slice(0, 200), at: now() };
          if (kind === 'rate_limit') {
            budget.exceeded(serviceOf(task), err.rate);
            if (serviceOf(task) !== 'getstatistic') stop = true;
            break;
          }
          if (kind === 'key') {
            lastKeyTry = now();
            if (store.data.keyRefused !== err.message) {
              store.data.keyRefused = err.message;
              events.push({
                key: TRIGGERS.API_KEY_REFUSED,
                data: {
                  reason: keyReason(err.message),
                  message: String(err.message).slice(0, 1000),
                },
              });
            }
            stop = true;
            break;
          }
          if (kind === 'system') {
            stateOf(id).error = { kind, message: String(err.message).slice(0, 200) };
            break;
          }
        }
      }
    }
    for (const id of config.systemIds) {
      if (stateOf(id).info) {
        events.push(...detectEvents(id));
      }
    }
    await store.save();
    await publishEvents(events);
    if (changed) {
      await publishDiscoveredDevices().catch((err) =>
        logger.warn(`Unable to offer the devices: ${err.message}`),
      );
      for (const id of config.systemIds) {
        await publishStates(id);
      }
      refreshWidgets();
    }
    await refreshStatus();
  }

  /**
   * @description The scene events of a system after the readings.
   * @param {string} id - The System Id.
   * @returns {Array<{ key: string, data: object }>} The events.
   */
  function detectEvents(id) {
    const state = stateOf(id);
    const events = [];
    const view = viewOf(id);
    const lang = textLanguage();
    // Silence: judged only on a status read lately (never while the readings wait).
    const fresh =
      now() - (state.fetched.status ?? 0) <= Math.max(2 * intervalsFor(id).status, 20 * MINUTE_MS);
    if (fresh) {
      const { events: fired, next } = detectSilence(state.seen, {
        lastStatusAt: state.status?.at ?? null,
        sun: view.sun,
        statusInterval: view.statusInterval,
        now: now(),
      });
      for (const key of fired) {
        const minutes = (ms) =>
          Number.isFinite(ms) ? Math.max(0, Math.round(ms / MINUTE_MS)) : null;
        const extra =
          key === TRIGGERS.SYSTEM_SILENT
            ? {
                last_status_time: Number.isFinite(state.status?.at)
                  ? formatTime(state.status.at, {
                      language: lang,
                      timeZone: view.timeZone,
                      now: now(),
                    })
                  : null,
                minutes_silent: minutes(
                  Number.isFinite(state.status?.at) ? now() - state.status.at : null,
                ),
                last_power_w: Number.isFinite(state.status?.power)
                  ? Math.round(state.status.power)
                  : null,
              }
            : {
                minutes_silent: minutes(next.backAfter),
                power_w: Number.isFinite(state.status?.power)
                  ? Math.round(state.status.power)
                  : null,
              };
        events.push({ key, data: systemData(view, extra) });
      }
      state.seen = next;
    }
    // The summary of the day, about an hour after sunset.
    const today = localParts(now(), view.timeZone).date;
    const due = summaryTime(id);
    if (!state.seen.summaryInitialized) {
      // A first start after the summary time is a baseline: the first summary is tomorrow.
      state.seen.summaryInitialized = true;
      if (now() >= due) state.seen.summaryDate = today;
    }
    if (now() >= due && state.seen.summaryDate !== today) {
      const outputsRead = (state.fetched.output ?? 0) >= due - 30 * MINUTE_MS;
      const statisticRead = (state.fetched.statistic ?? 0) >= due - 30 * MINUTE_MS;
      // Wait for fresh outputs (30 minutes at most), and the statistics if they come.
      if ((outputsRead && statisticRead) || now() >= due + 30 * MINUTE_MS) {
        const record =
          statisticRead &&
          state.statistic?.recordDate === today &&
          state.seen.recordDate !== today &&
          todayOf(view, now()).production > 0;
        const day = todayOf(view, now());
        events.push({
          key: TRIGGERS.DAILY_SUMMARY,
          data: summaryData(view, day, { language: lang, record }),
        });
        if (record) {
          events.push({
            key: TRIGGERS.DAILY_RECORD,
            data: systemData(view, {
              date: `${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}`,
              efficiency_kwh_kw: state.statistic.recordEfficiency,
              production_kwh: Math.round(day.production) / 1000,
              previous_record_kwh_kw: state.previousRecord?.efficiency ?? null,
              previous_record_date: state.previousRecord?.date
                ? `${state.previousRecord.date.slice(0, 4)}-${state.previousRecord.date.slice(4, 6)}-${state.previousRecord.date.slice(6, 8)}`
                : null,
            }),
          });
          state.seen.recordDate = today;
        }
        state.seen.summaryDate = today;
      }
    }
    return events;
  }

  /**
   * @description Run the readings (one round at a time).
   * @returns {Promise<void>}
   */
  function tick() {
    if (!running) {
      running = runReadings()
        .catch((err) => logger.error('Readings', err))
        .finally(() => {
          running = null;
        });
    }
    return running;
  }

  /**
   * @description (Re)arm the reading timer.
   */
  function schedule() {
    clearInterval(timer);
    clearTimeout(startTimer);
    if (!timers || stopped) {
      return;
    }
    startTimer = setTimeout(tick, STARTUP_DELAY_MS);
    startTimer.unref?.();
    timer = setInterval(tick, TICK_MS);
    timer.unref?.();
  }

  /**
   * @description Forget the systems no longer configured, offer the devices, arm the timer.
   * @returns {Promise<void>}
   */
  async function applyConfig() {
    for (const id of Object.keys(store.data.systems)) {
      if (!config.systemIds.includes(id)) {
        delete store.data.systems[id];
      }
    }
    await store.save();
    logger.info(`${config.systemIds.length} system(s): ${config.systemIds.join(', ') || 'none'}`);
    await publishDiscoveredDevices().catch((err) =>
      logger.warn(`Unable to offer the devices: ${err.message}`),
    );
    for (const id of config.systemIds) {
      await publishStates(id);
    }
    await refreshStatus();
    schedule();
  }

  /**
   * @description The system a widget or a scene action targets.
   * @param {unknown} externalId - The `source: "devices"` value.
   * @returns {string|null} The System Id, the first one by default.
   */
  function target(externalId) {
    const id = systemOfExternalId(externalId);
    return config.systemIds.includes(id) ? id : (config.systemIds[0] ?? null);
  }

  // --- Dashboard widgets -------------------------------------------------------------

  /**
   * @description The common start of a widget: a key, a system.
   * @param {object} settings - The widget settings.
   * @param {string} lang - The language.
   * @returns {{ id?: string, content?: object }} The system, or the content to show.
   */
  function widgetSystem(settings, lang) {
    if (!config.apiKey) {
      return { content: messageContent(t('statusNoKey', lang)) };
    }
    if (store.data.keyRefused) {
      return {
        content: messageContent(errorText({ kind: 'key', message: store.data.keyRefused }, lang)),
      };
    }
    const id = target(settings.system);
    if (!id) {
      return { content: messageContent(t('statusNoSystem', lang)) };
    }
    return { id };
  }

  /**
   * @description The quota as a widget shows it.
   * @returns {object} `{ remaining, limit, pausedUntil }`.
   */
  const quotaView = () => ({
    remaining: budget.remaining(),
    limit: budget.limit(),
    pausedUntil: budget.readingsPausedUntil(),
  });

  gladys.onWidgetGet(WIDGETS.PRODUCTION, async ({ settings = {}, language: lang }) => {
    rememberLanguage(lang);
    const { id, content } = widgetSystem(settings, lang);
    if (content) {
      return content;
    }
    const before = widgetSeen.get(id) ?? 0;
    widgetSeen.set(id, now());
    const view = viewOf(id);
    // The curve of the day is read by the timer from now on; the first time, soon.
    if (now() - before >= WIDGET_SEEN_MS && timers) {
      setTimeout(() => tick(), 1000).unref?.();
    }
    const ids = idsOf(gladys, id);
    return buildProductionWidget({
      view,
      language: lang,
      now: now(),
      quota: quotaView(),
      liveFeature: createdDevices.has(ids.device) ? ids.feature('power') : null,
    });
  });

  gladys.onWidgetGet(WIDGETS.DAYS, async ({ settings = {}, language: lang }) => {
    rememberLanguage(lang);
    const { id, content } = widgetSystem(settings, lang);
    if (content) {
      return content;
    }
    return buildDaysWidget({ view: viewOf(id), language: lang, now: now() });
  });

  // --- Scene actions -----------------------------------------------------------------

  /**
   * @description The system of a scene action, ready to send.
   * @param {object} fields - The fields.
   * @param {string} lang - The language.
   * @returns {string} The System Id.
   */
  function sendTarget(fields, lang) {
    if (!config.apiKey) {
      throw new Error(t('statusNoKey', lang));
    }
    const id = target(fields.system);
    if (!id) {
      throw new Error(t('statusNoSystem', lang));
    }
    if (!budget.canSend()) {
      throw new Error(t('refusedQuotaUntil', lang, { time: timeText(budget.resetAt(), lang) }));
    }
    return id;
  }

  /**
   * @description Send a request of a scene action, its refusal written for the user.
   * @param {Function} task - `() => Promise<string>`.
   * @param {string} lang - The language.
   * @returns {Promise<string>} The answer of PVOutput.
   */
  async function send(task, lang) {
    try {
      return await task();
    } catch (err) {
      if (err.kind === 'rate_limit') {
        budget.exceeded('addstatus', err.rate);
      }
      logger.warn(`PVOutput refused a scene action (${err.kind ?? 'error'}): ${err.message}`);
      throw new Error(errorText(err, lang).slice(0, 500), { cause: err });
    }
  }

  gladys.onSceneAction(SCENE_ACTIONS.SEND_STATUS, async (fields = {}) => {
    const lang = textLanguage();
    const id = sendTarget(fields, lang);
    let request;
    try {
      request = statusParams(fields, { now: now(), timeZone: zoneOf(id) });
    } catch (err) {
      throw new Error(errorText(err, lang), { cause: err });
    }
    const answer = await send(() => api.addStatus(id, request.params), lang);
    logger.info(`PVOutput: status of ${id} sent for ${request.date} ${request.time}`);
    return pick(
      {
        result: t('sentStatus', lang, {
          name: viewOf(id).name,
          time: request.time,
          answer: String(answer).trim().slice(0, 80),
        }),
        date: request.date,
        time: request.time,
      },
      SEND_OUTPUTS,
    );
  });

  gladys.onSceneAction(SCENE_ACTIONS.SEND_DAILY_OUTPUT, async (fields = {}) => {
    const lang = textLanguage();
    const id = sendTarget(fields, lang);
    let request;
    try {
      request = outputParams(fields, { now: now(), timeZone: zoneOf(id) });
    } catch (err) {
      throw new Error(errorText(err, lang), { cause: err });
    }
    const answer = await send(() => api.addOutput(id, request.params), lang);
    logger.info(`PVOutput: output of ${id} sent for ${request.date}`);
    return pick(
      {
        result: t('sentOutput', lang, {
          name: viewOf(id).name,
          date: request.date,
          answer: String(answer).trim().slice(0, 80),
        }),
        date: request.date,
      },
      OUTPUT_OUTPUTS,
    );
  });

  // Answers from what the timer read: the action never sends a request of its own.
  gladys.onSceneAction(SCENE_ACTIONS.GET_TODAY, async (fields = {}) => {
    const lang = textLanguage();
    if (!config.apiKey) {
      throw new Error(t('statusNoKey', lang));
    }
    const id = target(fields.system);
    if (!id) {
      throw new Error(t('statusNoSystem', lang));
    }
    const view = viewOf(id);
    return todayOutputs(view, {
      now: now(),
      language: lang,
      formatTime: (instant) =>
        formatTime(instant, { language: lang, timeZone: view.timeZone, now: now() }),
    });
  });

  // --- Configuration screen actions --------------------------------------------------
  gladys.onAction(ACTIONS.TEST_CONNECTION, async () => {
    if (!config.apiKey) {
      return all('statusNoKey');
    }
    if (config.systemIds.length === 0) {
      return all(config.invalidIds.length ? 'statusInvalidIds' : 'statusNoSystem', {
        ids: config.invalidIds.join(', '),
      });
    }
    const lines = [];
    let changed = false;
    for (const id of config.systemIds) {
      if (!budget.canSend()) {
        lines.push({ id, err: Object.assign(new Error('quota'), { kind: 'rate_limit' }) });
        continue;
      }
      try {
        const info = parseSystem(await api.getSystem(id));
        if (!info) {
          throw new PvoutputError('failed', 'Unexpected answer of getsystem');
        }
        const state = stateOf(id);
        state.info = info;
        state.at.system = now();
        state.fetched.system = now();
        state.error = null;
        changed = true;
        lines.push({ id, info });
      } catch (err) {
        if (err.kind === 'rate_limit') budget.exceeded('getsystem', err.rate);
        if (err.kind === 'system') stateOf(id).error = { kind: 'system', message: err.message };
        lines.push({ id, err });
        if (err.kind === 'key') break;
      }
    }
    if (lines.some((line) => line.info)) {
      if (store.data.keyRefused) store.data.keyRefused = null;
    }
    await store.save();
    if (changed) {
      await publishDiscoveredDevices().catch(() => {});
      schedule();
    }
    await refreshStatus();
    return all((lang) => {
      const text = lines.map(({ id, info, err }) => {
        if (err) {
          return `${id}: ${errorText(err, lang)}`;
        }
        return t('testLine', lang, {
          name: info.name || id,
          id,
          size: Number.isFinite(info.size) ? formatNumber(info.size / 1000, lang, 2) : '–',
          interval: info.statusInterval ?? '–',
          zone: systemTimeZone(info.timeZone, timeZone),
        });
      });
      text.push(
        t('testQuota', lang, {
          remaining: formatNumber(budget.remaining(), lang, 0),
          limit: formatNumber(budget.limit(), lang, 0),
        }),
      );
      return text.join(' · ').slice(0, 1000);
    });
  });

  gladys.onAction(ACTIONS.DIAGNOSTIC, async () => {
    const iso = (value) => (value ? new Date(value).toISOString() : null);
    const report = {
      version: VERSION,
      timeZone: timeZone ?? null,
      key: config.apiKey ? 'set' : 'missing',
      systems: config.systemIds,
      invalidIds: config.invalidIds,
      donation: config.donation,
      language: config.language,
      keyRefused: store.data.keyRefused,
      lastError: store.data.lastError,
      budget: {
        limit: budget.limit(),
        reserve: budget.reserve(),
        remaining: budget.remaining(),
        resetAt: iso(budget.resetAt()),
        pausedUntil: iso(budget.readingsPausedUntil()),
        requestsLastHour: store.data.budget.log.length,
        rate: store.data.budget.rate,
      },
      details: config.systemIds.map((id) => {
        const state = stateOf(id);
        const sun = sunOf(id);
        return {
          id,
          created: createdDevices.has(idsOf(gladys, id).device),
          info: state.info
            ? {
                ...state.info,
                latitude: state.info.latitude !== null ? 'set' : null,
                longitude: undefined,
              }
            : null,
          timeZone: zoneOf(id),
          features: state.features,
          status: state.status,
          history: state.history
            ? { date: state.history.date, points: state.history.points.length }
            : null,
          outputs: state.outputs.length,
          statistic: state.statistic,
          at: Object.fromEntries(Object.entries(state.at).map(([key, value]) => [key, iso(value)])),
          intervals: state.info ? intervalsFor(id) : null,
          sun: sun ? { day: sun.day, sunrise: iso(sun.sunrise), sunset: iso(sun.sunset) } : null,
          seen: state.seen,
          error: state.error ?? null,
        };
      }),
    };
    const json = JSON.stringify(report);
    const count = Math.max(1, Math.ceil(json.length / DIAGNOSTIC_CHUNK));
    for (let chunk = 0; chunk < count; chunk += 1) {
      logger.info(
        `PVOutput diagnostic ${chunk + 1}/${count}: ${json.slice(chunk * DIAGNOSTIC_CHUNK, (chunk + 1) * DIAGNOSTIC_CHUNK)}`,
      );
    }
    return all('diagnosticDone', { count });
  });

  // --- Devices -----------------------------------------------------------------------
  gladys.onScanRequest(async () => {
    const count = await publishDiscoveredDevices(true);
    logger.info(`Scan: ${count} device(s) offered`);
    if (count < config.systemIds.length) {
      tick();
    }
  });

  gladys.onDeviceCreated(async () => {
    await refreshCreatedDevices();
    // States sent before the device existed were dropped by Gladys, and the SDK
    // forgot what it sent for this device: send everything known again.
    for (const id of config.systemIds) {
      await publishStates(id);
    }
    refreshWidgets();
  });

  gladys.onDeviceDeleted(refreshCreatedDevices);

  // --- Configuration -----------------------------------------------------------------

  /**
   * @description Reload the whole config (internal keys included).
   * @param {object} [fallback] - Raw values to use when the read fails.
   * @returns {Promise<void>}
   */
  async function loadConfig(fallback) {
    try {
      const raw = await gladys.getConfig();
      config = normalizeConfig(raw);
      language = readLanguage(raw, language);
    } catch (err) {
      if (fallback) {
        config = normalizeConfig(fallback);
      }
      logger.error('Unable to read the configuration', err);
    }
  }

  gladys.onConfigUpdated(async (rawConfig) => {
    const previousKey = config.apiKey;
    await loadConfig(rawConfig);
    logger.info('Configuration updated');
    lastStatus = null;
    lastDiscovery = null;
    if (config.apiKey !== previousKey) {
      // A new key: tried at the next tick, and its own quota.
      store.data.keyRefused = null;
      lastKeyTry = 0;
      store.data.budget.rate = null;
      store.data.budget.pausedUntil = 0;
      store.data.budget.statisticPausedUntil = 0;
      for (const id of config.systemIds) {
        if (stateOf(id).error?.kind === 'system') {
          stateOf(id).error = null;
          stateOf(id).at.system = 0;
        }
      }
    }
    await applyConfig();
  });

  // --- Connection lifecycle ----------------------------------------------------------
  // Each (re)connection resynchronizes; the promise lets the tests wait for it.
  let startup = Promise.resolve();
  gladys.on('connected', () => {
    startup = (async () => {
      await store.load();
      await loadConfig();
      await refreshCreatedDevices();
      lastStatus = null;
      lastDiscovery = null;
      await applyConfig();
    })().catch((err) => logger.error('Startup', err));
  });

  // --- Graceful shutdown -------------------------------------------------------------
  gladys.handleShutdown(async (signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    stopped = true;
    clearInterval(timer);
    clearTimeout(startTimer);
    await store.save();
  });

  return {
    store,
    budget,
    tick,
    dueOf,
    viewOf,
    valuesOf,
    intervalsFor,
    summaryTime,
    seeWidget: (id) => widgetSeen.set(id, now()),
    getConfig: () => config,
    whenReady: () => startup,
  };
}

export { createApp, keyReason, ACTIONS, USER_AGENT, KEY_RETRY_MS };
