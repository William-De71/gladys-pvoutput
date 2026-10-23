// Widget contents for the generated illustrations, built by the real code of
// the integration: the app itself (src/app.js) wired to the fake Gladys of the
// SDK and the fake PVOutput of the tests (a real local HTTP server), on a
// made-up Friday, 23 October 2026 at 14:00 in Paris: a 4.2 kW system with a
// consumption meter. What the core fills in from a feature is filled in here
// the same way: the live power tile gets the last state of its feature.
// Never real data. Written as JSON for render.js: node gen.mjs <repo> <out.json>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (file) => import(pathToFileURL(join(repo, file)).href);
const { createApp } = await load('src/app.js');
const { LANGUAGES } = await load('src/i18n.js');
const { createFakeGladys } = await import(
  pathToFileURL(join(repo, 'node_modules/@gladysassistant/integration-sdk/lib/testing.js')).href
);
const { startFakePvoutput, dataDir, silent, NOW, KEY } = await load(
  'test/helpers/fake-pvoutput.js',
);

const manifest = JSON.parse(readFileSync(join(repo, 'gladys-assistant-integration.json'), 'utf8'));
const WIDGET_KEYS = ['production', 'days'];
const MINUTE = 60 * 1000;

/**
 * @description One language: the two widgets of the first system.
 * @param {string} language - Language.
 * @returns {Promise<object>} The widget contents.
 */
async function contents(language) {
  const clock = { now: NOW - 10 * MINUTE };
  const fake = await startFakePvoutput({ now: () => clock.now });
  const gladys = createFakeGladys({
    config: { api_key: KEY, system_ids: '12345, 67890', language },
  });
  const app = createApp(gladys, {
    baseUrl: fake.url,
    dataDir: dataDir(),
    now: () => clock.now,
    timeZone: 'Europe/Paris',
    timers: false,
    spacingMs: 0,
    logger: silent,
  });
  await gladys.connect();
  await app.whenReady();
  await app.tick();
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(structuredClone(device));
  }
  const settings = { system: gladys.fake.discoveredDevices[0].external_id };
  await gladys.fake.widgetGet('production', { settings, language });
  clock.now = NOW;
  await app.tick();
  const result = {};
  for (const key of WIDGET_KEYS) {
    result[key] = (await gladys.fake.widgetGet(key, { settings, language })).data.content;
  }
  // The core shows the live tile with the last state of its feature.
  for (const component of result.production.components) {
    if (component.type === 'value' && component.device_feature) {
      component.value = gladys.fake.lastState(component.device_feature);
      component.unit = 'W';
      component.color = 'primary';
      delete component.device_feature;
    }
  }
  await gladys.fake.shutdown();
  await fake.close();
  return result;
}

const all = {};
for (const language of LANGUAGES) {
  all[language] = await contents(language);
}

const card = (key) => {
  const widget = manifest.widgets.find((item) => item.key === key);
  return { icon: widget.icon, label: widget.label };
};
writeFileSync(
  out,
  JSON.stringify({
    contents: all,
    images: {},
    cards: Object.fromEntries(WIDGET_KEYS.map((key) => [key, card(key)])),
  }),
);
