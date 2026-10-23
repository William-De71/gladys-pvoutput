import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import {
  buildProductionWidget,
  buildDaysWidget,
  messageContent,
  energyTile,
} from '../src/widgets.js';
import { LANGUAGES } from '../src/i18n.js';
import { sunAt } from '../src/sun.js';
import { toInstant, addDays } from '../src/time.js';

const NOW = Date.parse('2026-10-23T12:00:00Z'); // 14:00 in Paris
const MINUTE = 60 * 1000;
const ZONE = 'Europe/Paris';
const PLACE = { latitude: 47.24, longitude: 6.02, timeZone: ZONE };
const points = Array.from({ length: 70 }, (_, i) => {
  const at = toInstant('20261023', '08:25', ZONE) + i * 5 * MINUTE;
  const power = Math.round(3100 * Math.sin((Math.PI * i) / 120));
  return { at, date: '20261023', time: '', power, consumptionPower: 400 + (i % 7) * 30 };
});
const outputs = Array.from({ length: 31 }, (_, i) => ({
  date: addDays('20261023', -i),
  generated: 9000 + ((i * 2731) % 8000),
  efficiency: 2,
  exported: 4000,
  used: 9000,
  peakPower: 2900,
  peakTime: '13:10',
  condition: 'Fine',
}));
const VIEW = {
  id: '12345',
  name: 'Maison, toit sud',
  size: 4200,
  statusInterval: 5,
  timeZone: ZONE,
  info: { name: 'Maison, toit sud', size: 4200 },
  status: {
    date: '20261023',
    at: NOW - 4 * MINUTE,
    energy: 11200,
    power: 2950,
    consumptionEnergy: 5200,
    consumptionPower: 610,
  },
  today: outputs[0],
  outputs,
  statistic: { generated: 12345678, recordEfficiency: 6.02, recordDate: '20260612' },
  history: { date: '20261023', points },
  exportKnown: true,
  consumptionKnown: true,
  power: 2950,
  silent: false,
  sun: sunAt(NOW, PLACE),
};
const QUOTA = { remaining: 41, limit: 60, pausedUntil: 0 };
const NIGHT = NOW + 8 * 60 * MINUTE;
const views = () => [
  VIEW,
  { ...VIEW, exportKnown: false, consumptionKnown: false, history: null },
  { ...VIEW, silent: true, power: null },
  { ...VIEW, status: null, power: 0, today: null, history: { date: '20261023', points: [] } },
  { ...VIEW, history: { date: '20261023', points: points.slice(0, 1) }, size: null },
  { ...VIEW, info: null },
];

test('every widget passes the checks of the core, in the four languages', () => {
  for (const language of LANGUAGES) {
    const contents = [
      ...views().map((view) => buildProductionWidget({ view, language, now: NOW, quota: QUOTA })),
      buildProductionWidget({
        view: VIEW,
        language,
        now: NOW,
        quota: { ...QUOTA, pausedUntil: NOW + 30 * MINUTE },
      }),
      buildProductionWidget({
        view: VIEW,
        language,
        now: NOW,
        quota: QUOTA,
        liveFeature: 'ext:pvoutput:system:12345:power',
      }),
      buildProductionWidget({
        view: { ...VIEW, sun: sunAt(NIGHT, PLACE) },
        language,
        now: NIGHT,
        quota: QUOTA,
      }),
      ...views().map((view) => buildDaysWidget({ view, language, now: NOW })),
      buildDaysWidget({ view: { ...VIEW, outputs: [] }, language, now: NOW }),
      buildDaysWidget({ view: { ...VIEW, statistic: null }, language, now: NOW }),
      messageContent('A message', { heading: 'Heading' }),
    ];
    for (const content of contents) {
      assert.deepEqual(
        validateWidgetContent(content),
        [],
        `${language}: ${JSON.stringify(content).slice(0, 300)}`,
      );
      const count = (type) => content.components.filter((c) => c.type === type).length;
      assert.ok(content.components.length <= 8);
      assert.ok(count('value') + count('gauge') <= 6);
      assert.ok(count('chart') + count('card-list') + count('image') <= 1);
      assert.ok(count('text') <= 2 && count('status') <= 1);
      for (const component of content.components) {
        if (component.variant === 'caption') assert.ok(component.text.length <= 45, component.text);
      }
    }
  }
});

test('production: the tiles of the day, the curve, its peak, the state and the quota', () => {
  const content = buildProductionWidget({ view: VIEW, language: 'fr', now: NOW, quota: QUOTA });
  const tiles = content.components.filter((c) => c.type === 'value');
  assert.deepEqual(
    tiles.map((tile) => [tile.label, tile.value, tile.unit]),
    [
      ['Puissance', 2950, 'W'],
      ['Aujourd’hui', 11.2, 'kWh'],
      ['Consommé', 5.2, 'kWh'],
      ['Injecté', 4, 'kWh'],
      ['Rendement', 2, 'kWh/kW'],
    ],
  );
  assert.equal(content.components[0].text, 'Maison, toit sud · 4,2 kWc');
  const chart = content.components.find((c) => c.type === 'chart');
  assert.deepEqual(
    chart.series.map((s) => [s.name, s.points.length]),
    [
      ['Production', 70],
      ['Consommation', 70],
    ],
  );
  assert.equal(chart.annotations[0].value, Math.max(...points.map((p) => p.power)));
  const status = content.components.find((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((row) => [row.label, row.value, row.color]),
    [
      ['Dernier statut', '13:56 (il y a 4 min)', 'success'],
      ['Requêtes PVOutput', '41 sur 60 restantes', 'info'],
    ],
  );
  // The live tile follows the device once it exists.
  const live = buildProductionWidget({
    view: VIEW,
    language: 'en',
    now: NOW,
    liveFeature: 'ext:x:power',
  });
  assert.deepEqual(live.components[1], {
    type: 'value',
    device_feature: 'ext:x:power',
    label: 'Power now',
    icon: 'zap',
  });
});

test('production: silent by day, night after sunset, no curve without history', () => {
  const rows = (view, now = NOW) =>
    buildProductionWidget({ view, language: 'en', now }).components.find((c) => c.type === 'status')
      .items[0];
  assert.deepEqual(
    [rows({ ...VIEW, silent: true }).value, rows({ ...VIEW, silent: true }).color],
    ['Silent since 13:56', 'warning'],
  );
  const night = rows({ ...VIEW, sun: sunAt(NIGHT, PLACE) }, NIGHT);
  assert.equal(night.color, 'neutral');
  assert.match(night.value, /^Night/);
  const empty = buildProductionWidget({
    view: { ...VIEW, history: null },
    language: 'en',
    now: NOW,
  });
  assert.equal(
    empty.components.some((c) => c.type === 'chart'),
    false,
  );
  assert.match(empty.components.find((c) => c.variant === 'body').text, /curve of the day/);
});

test('days: 30 bars, the month, the best day, the average without today, the record', () => {
  const content = buildDaysWidget({ view: VIEW, language: 'en', now: NOW });
  const chart = content.components.find((c) => c.type === 'chart');
  assert.equal(chart.chart_type, 'bar');
  assert.equal(chart.series[0].points.length, 30);
  assert.equal(chart.series[0].points.at(-1).t, '2026-10-23T00:00:00.000Z');
  const tiles = content.components.filter((c) => c.type === 'value');
  assert.deepEqual(
    tiles.map((t) => t.label),
    ['This month', 'Best day', 'Daily average', 'Record yield', 'Lifetime'],
  );
  const october = outputs.filter((o) => o.date.startsWith('202610'));
  assert.equal(tiles[0].value, energyTile(october.reduce((s, o) => s + o.generated, 0)).value);
  assert.deepEqual([tiles[4].value, tiles[4].unit], [12.3, 'MWh']);
  const rows = content.components.find((c) => c.type === 'status').items;
  assert.deepEqual(rows[1], { label: 'Record yield on', value: '12 Jun 2026', color: 'warning' });
  assert.match(rows[0].value, /^\d+ (Sept|Oct), [\d.]+ kWh$/);
});
