// -----------------------------------------------------------------------------
// Dashboard widgets of the PVOutput integration.
//
//   - `production`  today at a system: the power now (live from the device
//                   once it is created), the energy of the day, its
//                   consumption or export when it publishes them, the yield;
//                   the power curve of the day; when the last status came
//                   (or "silent", or "night"), and the requests left this hour;
//   - `days`        the last 30 days in bars, the total of the month, the best
//                   day, the average, the record of the life of the system and
//                   its lifetime production.
// No button: the readings follow the quota of the key, never a click. The
// curve of the day is only read while a `production` widget is shown.
// Every text exists in the four languages (the content is cached per
// language). Content budget of a card: 8 components, 1 main one, 6 tiles,
// 2 texts (1 body), 1 status, 4 buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { t, ago, formatNumber } from './i18n.js';
import { todayOf, kwh, silentAfter } from './events.js';
import { formatTime, formatDate, localParts, addDays, isoDate } from './time.js';

const WIDGETS = { PRODUCTION: 'production', DAYS: 'days' };
const TTL_SECONDS = { production: 300, days: 1800, message: 120 };
const DAYS = 30;

/**
 * @description Truncate a text to a bound, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - The bound.
 * @returns {string} The text.
 */
function clip(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * @description A widget content made of one message.
 * @param {string} message - The message.
 * @param {object} [options] - `{ heading, ttl }`.
 * @returns {object} The content.
 */
function messageContent(message, { heading, ttl = TTL_SECONDS.message } = {}) {
  const components = [];
  if (heading) {
    components.push({ type: 'text', variant: 'heading', text: clip(heading, 40) });
  }
  components.push({ type: 'text', variant: 'body', text: clip(message, 300) });
  return { ttl_seconds: ttl, components };
}

/**
 * @description An energy as a tile shows it: kWh, or MWh past 10 000 kWh.
 * @param {number} wh - Watt hours.
 * @returns {{ value: number, unit: string }} The value.
 */
function energyTile(wh) {
  const value = kwh(wh) ?? 0;
  if (value >= 10000) {
    return { value: Math.round(value / 100) / 10, unit: 'MWh' };
  }
  return { value: Math.round(value * 10) / 10, unit: 'kWh' };
}

/**
 * @description The caption of a system: "Home · 4.2 kW".
 * @param {object} view - `{ name, size }`.
 * @param {string} language - The language.
 * @returns {string} The caption.
 */
function captionOf(view, language) {
  const size =
    Number.isFinite(view.size) && view.size > 0
      ? t('sizeKw', language, { value: formatNumber(view.size / 1000, language, 2) })
      : null;
  return clip([view.name, size].filter(Boolean).join(' · '), 60);
}

/**
 * @description The row of the state of a system: last status, silent or night.
 * @param {object} view - The view of the system.
 * @param {object} options - `{ language, now }`.
 * @returns {object} A status row.
 */
function stateRow(view, { language, now }) {
  const at = view.status?.at;
  const label = clip(t('rowLastStatus', language), 40);
  const time = (instant) => formatTime(instant, { language, timeZone: view.timeZone, now });
  if (!Number.isFinite(at)) {
    return { label, value: clip(t('rowNoStatus', language), 40), color: WIDGET_COLORS.WARNING };
  }
  if (view.silent) {
    return {
      label,
      value: clip(t('rowSilent', language, { time: time(at) }), 40),
      color: WIDGET_COLORS.WARNING,
    };
  }
  if (view.sun && !view.sun.day && now - at > silentAfter(view.statusInterval)) {
    const sunrise = view.sun.sunrise && view.sun.sunrise > now ? time(view.sun.sunrise) : null;
    return {
      label,
      value: clip(
        sunrise
          ? t('rowNightUntil', language, { time: sunrise })
          : t('rowNight', language, { time: time(at) }),
        40,
      ),
      color: WIDGET_COLORS.NEUTRAL,
    };
  }
  return {
    label,
    value: clip(t('rowAgo', language, { time: time(at), ago: ago(at, now, language) }), 40),
    color: WIDGET_COLORS.SUCCESS,
  };
}

/**
 * @description The row of the quota of the key.
 * @param {object} quota - `{ remaining, limit, pausedUntil }`.
 * @param {object} options - `{ language, now, timeZone }`.
 * @returns {object|null} A status row.
 */
function quotaRow(quota, { language, now, timeZone }) {
  if (!quota || !Number.isFinite(quota.limit)) {
    return null;
  }
  const label = clip(t('rowQuota', language), 40);
  if (quota.pausedUntil > now) {
    return {
      label,
      value: clip(
        t('rowQuotaPaused', language, {
          time: formatTime(quota.pausedUntil, { language, timeZone, now }),
        }),
        40,
      ),
      color: WIDGET_COLORS.WARNING,
    };
  }
  return {
    label,
    value: clip(
      t('rowQuotaLeft', language, {
        remaining: formatNumber(quota.remaining, language, 0),
        limit: formatNumber(quota.limit, language, 0),
      }),
      40,
    ),
    color: WIDGET_COLORS.INFO,
  };
}

/**
 * @description The "production" widget.
 * @param {object} options - Options.
 * @param {object} options.view - The view of the system (app.js).
 * @param {string} options.language - The user language.
 * @param {number} options.now - Now (ms).
 * @param {object} [options.quota] - `{ remaining, limit, pausedUntil }`.
 * @param {string|null} [options.liveFeature] - The external id of the power
 * feature, when its device exists: the tile then moves with every state.
 * @returns {object} The content.
 */
function buildProductionWidget({ view, language, now, quota, liveFeature = null }) {
  if (!view.info) {
    return messageContent(t('widgetWaiting', language), { heading: view.name });
  }
  const day = todayOf(view, now);
  const components = [{ type: 'text', variant: 'caption', text: captionOf(view, language) }];
  const power = Number.isFinite(view.power) ? Math.round(view.power) : null;
  if (liveFeature) {
    components.push({
      type: 'value',
      device_feature: liveFeature,
      label: clip(t('tilePower', language), 24),
      icon: 'zap',
    });
  } else if (power !== null) {
    components.push({
      type: 'value',
      value: power,
      unit: 'W',
      label: clip(t('tilePower', language), 24),
      icon: 'zap',
      color: power > 0 ? WIDGET_COLORS.PRIMARY : WIDGET_COLORS.NEUTRAL,
    });
  }
  components.push({
    type: 'value',
    ...energyTile(day.production),
    label: clip(t('tileToday', language), 24),
    icon: 'sun',
    color: WIDGET_COLORS.SUCCESS,
  });
  if (Number.isFinite(day.consumed)) {
    components.push({
      type: 'value',
      ...energyTile(day.consumed),
      label: clip(t('tileConsumed', language), 24),
      icon: 'home',
    });
  }
  if (Number.isFinite(day.exported)) {
    components.push({
      type: 'value',
      ...energyTile(day.exported),
      label: clip(t('tileExported', language), 24),
      icon: 'upload',
    });
  }
  if (Number.isFinite(day.efficiency)) {
    components.push({
      type: 'value',
      value: Math.round(day.efficiency * 100) / 100,
      unit: 'kWh/kW',
      label: clip(t('tileYield', language), 24),
      icon: 'trending-up',
    });
  }
  const points = view.history?.date === day.date ? (view.history.points ?? []) : [];
  const produced = points.filter((point) => Number.isFinite(point.power));
  const consumed = points.filter((point) => Number.isFinite(point.consumptionPower));
  if (produced.length >= 2) {
    const series = [
      {
        name: clip(t('seriesProduction', language), 24),
        points: produced.slice(-300).map((point) => ({
          t: new Date(point.at).toISOString(),
          v: Math.round(point.power),
        })),
      },
    ];
    if (consumed.length >= 2) {
      series.push({
        name: clip(t('seriesConsumption', language), 24),
        points: consumed.slice(-300).map((point) => ({
          t: new Date(point.at).toISOString(),
          v: Math.round(point.consumptionPower),
        })),
      });
    }
    const peak = produced.reduce((best, point) => (point.power > best.power ? point : best));
    components.push({
      type: 'chart',
      chart_type: 'area',
      title: clip(t('chartToday', language), 40),
      unit: 'W',
      series,
      ...(peak.power > 0
        ? {
            annotations: [
              {
                t: new Date(peak.at).toISOString(),
                value: Math.round(peak.power),
                label: clip(
                  t('annotationPeak', language, { value: formatNumber(peak.power, language, 0) }),
                  16,
                ),
                color: WIDGET_COLORS.WARNING,
              },
            ],
          }
        : {}),
    });
  } else {
    components.push({
      type: 'text',
      variant: 'body',
      text: clip(t(points.length ? 'widgetCurveSoon' : 'widgetCurveLoading', language), 300),
    });
  }
  const rows = [
    stateRow(view, { language, now }),
    quotaRow(quota, { language, now, timeZone: view.timeZone }),
  ].filter(Boolean);
  components.push({ type: 'status', items: rows });
  return { ttl_seconds: TTL_SECONDS.production, components };
}

/**
 * @description The "days" widget.
 * @param {object} options - Options.
 * @param {object} options.view - The view of the system (app.js).
 * @param {string} options.language - The user language.
 * @param {number} options.now - Now (ms).
 * @returns {object} The content.
 */
function buildDaysWidget({ view, language, now }) {
  if (!view.info) {
    return messageContent(t('widgetWaiting', language), { heading: view.name });
  }
  const today = localParts(now, view.timeZone).date;
  const first = addDays(today, -(DAYS - 1));
  const outputs = (view.outputs ?? [])
    .filter(
      (output) => output.date >= first && output.date <= today && Number.isFinite(output.generated),
    )
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (outputs.length === 0) {
    return messageContent(t('widgetNoOutputs', language), {
      heading: view.name,
      ttl: TTL_SECONDS.days,
    });
  }
  const month = today.slice(0, 6);
  const total = outputs
    .filter((output) => output.date.startsWith(month))
    .reduce((sum, output) => sum + output.generated, 0);
  const best = outputs.reduce((top, output) => (output.generated > top.generated ? output : top));
  // The average leaves today out: a day not over yet would pull it down.
  const done = outputs.filter((output) => output.date !== today);
  const average = done.length
    ? done.reduce((sum, output) => sum + output.generated, 0) / done.length
    : null;
  const components = [{ type: 'text', variant: 'caption', text: captionOf(view, language) }];
  components.push({
    type: 'value',
    ...energyTile(total),
    label: clip(t('tileMonth', language), 24),
    icon: 'calendar',
    color: WIDGET_COLORS.SUCCESS,
  });
  components.push({
    type: 'value',
    ...energyTile(best.generated),
    label: clip(t('tileBest', language), 24),
    icon: 'award',
  });
  if (Number.isFinite(average)) {
    components.push({
      type: 'value',
      ...energyTile(average),
      label: clip(t('tileAverage', language), 24),
      icon: 'bar-chart-2',
    });
  }
  const statistic = view.statistic;
  if (Number.isFinite(statistic?.recordEfficiency) && statistic.recordEfficiency > 0) {
    components.push({
      type: 'value',
      value: Math.round(statistic.recordEfficiency * 100) / 100,
      unit: 'kWh/kW',
      label: clip(t('tileRecord', language), 24),
      icon: 'star',
      color: WIDGET_COLORS.WARNING,
    });
  }
  if (Number.isFinite(statistic?.generated) && statistic.generated > 0) {
    components.push({
      type: 'value',
      ...energyTile(statistic.generated),
      label: clip(t('tileLifetime', language), 24),
      icon: 'battery-charging',
    });
  }
  components.push({
    type: 'chart',
    chart_type: 'bar',
    title: clip(t('chartDays', language), 40),
    unit: 'kWh',
    series: [
      {
        name: clip(t('seriesProduction', language), 24),
        points: outputs.map((output) => ({
          t: `${isoDate(output.date)}T00:00:00.000Z`,
          v: kwh(output.generated),
        })),
      },
    ],
  });
  // The dates do not fit under a tile: they go in the rows.
  const rows = [
    {
      label: clip(t('rowBestDay', language), 40),
      value: clip(
        t('rowBestDayValue', language, {
          date: formatDate(best.date, language, { year: false }),
          value: formatNumber(kwh(best.generated), language, 1),
        }),
        40,
      ),
      color: WIDGET_COLORS.SUCCESS,
    },
  ];
  if (statistic?.recordDate && Number.isFinite(statistic.recordEfficiency)) {
    rows.push({
      label: clip(t('rowRecord', language), 40),
      value: clip(formatDate(statistic.recordDate, language), 40),
      color: WIDGET_COLORS.WARNING,
    });
  }
  components.push({ type: 'status', items: rows });
  return { ttl_seconds: TTL_SECONDS.days, components };
}

export {
  WIDGETS,
  TTL_SECONDS,
  DAYS,
  clip,
  messageContent,
  energyTile,
  buildProductionWidget,
  buildDaysWidget,
};
