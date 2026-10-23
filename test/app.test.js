// The whole integration against the fake Gladys of the SDK
// (`@gladysassistant/integration-sdk/testing`), which checks the discovered
// devices, the states and the scene events like the host API does, and a fake
// PVOutput (test/helpers/fake-pvoutput.js), a real HTTP server on 127.0.0.1.
// No test touches the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createApp, ACTIONS, USER_AGENT } from '../src/app.js';
import { WIDGETS } from '../src/widgets.js';
import { TRIGGERS, SCENE_ACTIONS, TODAY_OUTPUTS } from '../src/events.js';
import { sunTimes } from '../src/sun.js';
import {
  startFakePvoutput,
  dataDir,
  silent,
  NOW,
  TZ,
  KEY,
  MINUTE,
  HOUR,
} from './helpers/fake-pvoutput.js';

const CONFIG = { api_key: KEY, system_ids: '12345, 67890', language: 'en' };
const PREFIX = 'ext:test-integration';
const HOME = `${PREFIX}:system:12345`;
const GARAGE = `${PREFIX}:system:67890`;

/**
 * @description The integration, connected to a fake Gladys and a fake PVOutput.
 * @param {object} t - The test context (closes everything after).
 * @param {object} [options] - `{ config, dir, now, fake }`.
 * @returns {Promise<object>} `{ gladys, app, fake, clock, dir }`.
 */
async function startApp(t, { config = CONFIG, dir = dataDir(), now = NOW, fake, clock } = {}) {
  clock ??= { now };
  fake ??= await startFakePvoutput({ now: () => clock.now });
  const gladys = createFakeGladys({ config });
  const app = createApp(gladys, {
    baseUrl: fake.url,
    dataDir: dir,
    now: () => clock.now,
    timeZone: TZ,
    timers: false,
    spacingMs: 0,
    logger: silent,
  });
  await gladys.connect();
  await app.whenReady();
  t.after(async () => {
    await gladys.fake.shutdown().catch(() => {});
    await fake.close();
  });
  return { gladys, app, fake, clock, dir };
}

/**
 * @description Create every offered device, like the user would.
 * @param {object} gladys - The fake Gladys.
 */
async function createAll(gladys) {
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
}
const services = (fake) => fake.calls.map((call) => `${call.service}:${call.sid}`);
const events = (gladys, key) => gladys.fake.sceneEvents.filter((event) => event.key === key);

test('startup: each system read once, its devices offered, the key in headers only', async (t) => {
  const { gladys, app, fake } = await startApp(t);
  assert.deepEqual(fake.calls, [], 'no request before the timer');
  await app.tick();
  assert.deepEqual(services(fake), [
    'getsystem:12345',
    'getstatus:12345',
    'getoutput:12345',
    'getstatistic:12345',
    'getsystem:67890',
    'getstatus:67890',
    'getoutput:67890',
    'getstatistic:67890',
  ]);
  for (const call of fake.calls) {
    assert.equal(call.key, KEY);
    assert.equal(call.method, 'GET');
    assert.equal(call.userAgent, USER_AGENT);
    assert.doesNotMatch(call.url, /key|sid=/);
  }
  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => [
      device.name,
      device.features.map((f) => f.external_id.split(':').pop()),
    ]),
    [
      [
        'Maison, toit sud',
        [
          'power',
          'energy_today',
          'lifetime_energy',
          'consumption_power',
          'consumption_today',
          'temperature',
          'voltage',
        ],
      ],
      ['Garage', ['power', 'energy_today', 'lifetime_energy']],
    ],
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /2 system\(s\): Maison, toit sud \d[\d,]* W, Garage \d[\d,]* W/,
  );
  // The timezone of the garage is blank on PVOutput: the one of Gladys.
  assert.equal(app.viewOf('67890').timeZone, TZ);
  // A second tick right after: nothing is due.
  await app.tick();
  assert.equal(fake.calls.length, 8);
});

test('a restart reads nothing before its time: the budget and the readings are kept in /data', async (t) => {
  const dir = dataDir();
  const clock = { now: NOW };
  const first = await startApp(t, { dir, clock });
  await first.app.tick();
  await first.gladys.fake.shutdown();
  const saved = readFileSync(join(dir, 'pvoutput.json'), 'utf8');
  assert.doesNotMatch(saved, new RegExp(KEY), 'the key never in /data');
  clock.now += 2 * MINUTE;
  const second = await startApp(t, { dir, clock });
  await second.app.tick();
  assert.deepEqual(second.fake.calls, []);
  assert.equal(second.app.budget.remaining(), 52);
  // Its own discovery from /data, without a request.
  assert.equal(second.gladys.fake.discoveredDevices.length, 2);
});

test('created devices get every known state, the widgets are refreshed', async (t) => {
  const { gladys, app, fake } = await startApp(t);
  await app.tick();
  await createAll(gladys);
  const last = (key) => gladys.fake.lastState(`${HOME}:${key}`);
  const statuses = fake.statusesOf('12345', '20261023');
  assert.equal(last('power'), statuses.at(-1).power);
  assert.equal(last('energy_today'), statuses.at(-1).energy / 1000);
  assert.equal(last('consumption_power'), statuses.at(-1).consumptionPower);
  assert.ok(last('lifetime_energy') > 12345);
  assert.equal(last('voltage'), statuses.at(-1).voltage);
  assert.equal(gladys.fake.lastState(`${GARAGE}:consumption_power`), undefined);
  assert.ok(gladys.fake.widgetRefreshes.includes(WIDGETS.PRODUCTION));
  // At night, the power falls to 0 and the energy of the day stays.
  const before = gladys.fake.states.length;
  await app.tick();
  assert.equal(gladys.fake.states.length, before, 'only the changes are published');
});

test('the curve of the day is read only while a production widget is shown', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t);
  await app.tick();
  clock.now += 6 * MINUTE;
  await app.tick();
  assert.equal(fake.calls.filter((call) => call.query.h === '1').length, 0);
  const first = await gladys.fake.widgetGet(WIDGETS.PRODUCTION, {
    settings: { system: HOME },
    language: 'fr',
  });
  assert.deepEqual(validateWidgetContent(first.data.content), []);
  await app.tick();
  const history = fake.calls.filter((call) => call.query.h === '1');
  assert.deepEqual(
    history.map((call) => [call.sid, call.query]),
    [['12345', { d: '20261023', h: '1', limit: '288', asc: '1' }]],
  );
  const shown = await gladys.fake.widgetGet(WIDGETS.PRODUCTION, {
    settings: { system: HOME },
    language: 'fr',
  });
  const chart = shown.data.content.components.find((c) => c.type === 'chart');
  assert.ok(chart.series[0].points.length > 50);
  assert.deepEqual(validateWidgetContent(shown.data.content), []);
  // Read again 15 minutes later at most, never on every widget request.
  await gladys.fake.widgetGet(WIDGETS.PRODUCTION, { settings: { system: HOME } });
  await app.tick();
  assert.equal(fake.calls.filter((call) => call.query.h === '1').length, 1);
  clock.now += 16 * MINUTE;
  await gladys.fake.widgetGet(WIDGETS.PRODUCTION, { settings: { system: HOME } });
  await app.tick();
  assert.equal(fake.calls.filter((call) => call.query.h === '1').length, 2);
  const days = await gladys.fake.widgetGet(WIDGETS.DAYS, {
    settings: { system: GARAGE },
    language: 'de',
  });
  assert.deepEqual(validateWidgetContent(days.data.content), []);
  assert.equal(
    days.data.content.components.find((c) => c.type === 'chart').series[0].points.length,
    30,
  );
});

test('the quota: the readings keep the reserve for the scenes, then pause until the reset', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t);
  // Another app already used 40 requests of the hour on the same key.
  fake.used.set(`${KEY}:all:${Math.floor(clock.now / HOUR)}`, 40);
  await app.tick();
  // 60 - 40 = 20 left: the readings stop once only the reserve (15) is left.
  assert.equal(fake.calls.length, 5);
  assert.equal(app.budget.remaining(), 15);
  clock.now += 10 * MINUTE;
  await app.tick();
  assert.equal(fake.calls.length, 5, 'paused');
  assert.match(gladys.fake.connectionStatus.message.en, /Readings paused until 15:00/);
  // A scene still sends.
  const sent = await gladys.fake.sceneAction(SCENE_ACTIONS.SEND_STATUS, {
    system: HOME,
    power: '1200',
  });
  assert.equal(sent.success, true);
  // After the reset (15:00 in Paris), the readings go on.
  clock.now = Date.parse('2026-10-23T13:01:00Z');
  await app.tick();
  assert.ok(fake.calls.length > 6);
});

test('"Exceeded number requests per hour" pauses everything, sends included', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t);
  fake.used.set(`${KEY}:all:${Math.floor(clock.now / HOUR)}`, 60);
  await app.tick();
  assert.equal(fake.calls.length, 1);
  clock.now += 5 * MINUTE;
  await app.tick();
  assert.equal(fake.calls.length, 1);
  const refused = await gladys.fake.sceneAction(SCENE_ACTIONS.SEND_STATUS, { power: '100' });
  assert.equal(refused.success, false);
  assert.match(refused.error, /used up: try again after 15:00/);
  assert.equal(fake.calls.length, 1, 'not even sent');
});

test('a refused key: one event, a status, tried again an hour later; a new key at once', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t, {
    config: { ...CONFIG, api_key: 'wrong-key' },
  });
  await app.tick();
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(
    events(gladys, TRIGGERS.API_KEY_REFUSED).map((e) => e.data),
    [
      {
        reason: 'invalid_key',
        message:
          'Unauthorized 401: Missing, invalid or inactive api key information (X-Pvoutput-Apikey)',
      },
    ],
  );
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /PVOutput refuse la clé d’API/);
  const widget = await gladys.fake.widgetGet(WIDGETS.PRODUCTION, {});
  assert.match(widget.data.content.components[0].text, /refuses the API key/);
  clock.now += 10 * MINUTE;
  await app.tick();
  assert.equal(fake.calls.length, 1, 'not every tick');
  clock.now += HOUR;
  await app.tick();
  assert.equal(fake.calls.length, 2);
  assert.equal(events(gladys, TRIGGERS.API_KEY_REFUSED).length, 1, 'once per refusal');
  await gladys.fake.configUpdated(CONFIG);
  await app.tick();
  assert.ok(fake.calls.length > 5);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('an unknown System Id is reported, the other systems go on', async (t) => {
  const { gladys, app, fake } = await startApp(t, {
    config: { ...CONFIG, system_ids: '55555, 12345' },
  });
  await app.tick();
  assert.deepEqual(services(fake).slice(0, 2), ['getsystem:55555', 'getsystem:12345']);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.match(gladys.fake.connectionStatus.message.en, /Unknown System Id: 55555/);
  assert.equal(events(gladys, TRIGGERS.API_KEY_REFUSED).length, 0);
});

test('system silent by day, back with its next status; never silent at night', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t);
  await app.tick();
  fake.silentAfter['12345'] = clock.now;
  for (let step = 0; step < 9; step += 1) {
    clock.now += 5 * MINUTE;
    await app.tick();
  }
  const fired = events(gladys, TRIGGERS.SYSTEM_SILENT);
  assert.equal(fired.length, 1);
  assert.equal(fired[0].data.system, HOME);
  assert.equal(fired[0].data.system_name, 'Maison, toit sud');
  assert.ok(fired[0].data.minutes_silent >= 30);
  assert.equal(
    events(gladys, TRIGGERS.SYSTEM_SILENT).filter((e) => e.data.system === GARAGE).length,
    0,
  );
  const widget = await gladys.fake.widgetGet(WIDGETS.PRODUCTION, { settings: { system: HOME } });
  assert.match(
    widget.data.content.components.find((c) => c.type === 'status').items[0].value,
    /^Silent since/,
  );
  delete fake.silentAfter['12345'];
  clock.now += 5 * MINUTE;
  await app.tick();
  const back = events(gladys, TRIGGERS.SYSTEM_BACK);
  assert.equal(back.length, 1);
  assert.ok(back[0].data.minutes_silent >= 40);
});

test('at night nothing is silent, the power falls to 0, the readings slow down', async (t) => {
  const night = Date.parse('2026-10-23T20:30:00Z'); // 22:30 in Paris
  const { gladys, app, fake, clock } = await startApp(t, { now: night });
  await app.tick();
  await createAll(gladys);
  assert.equal(gladys.fake.lastState(`${GARAGE}:power`), 0);
  const count = fake.calls.length;
  for (let step = 0; step < 6; step += 1) {
    clock.now += 5 * MINUTE;
    await app.tick();
  }
  assert.equal(events(gladys, TRIGGERS.SYSTEM_SILENT).length, 0);
  // Status every 30 minutes at night: one more each.
  assert.equal(fake.calls.filter((c, i) => i >= count && c.service === 'getstatus').length, 2);
  assert.equal(app.intervalsFor('12345').status, 30 * MINUTE);
});

test('the summary of the day: once, about an hour after sunset, with a record when there is one', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t);
  await app.tick();
  fake.recordToday = true;
  const sunset = sunTimes('20261023', 47.24, 6.02, 'Europe/Paris').sunset;
  assert.ok(Math.abs(app.summaryTime('12345') - (sunset + HOUR)) < 1000);
  // Until the summary time: nothing.
  while (clock.now < sunset + 50 * MINUTE) {
    clock.now += 10 * MINUTE;
    await app.tick();
  }
  assert.equal(events(gladys, TRIGGERS.DAILY_SUMMARY).length, 0);
  for (let step = 0; step < 6; step += 1) {
    clock.now += 10 * MINUTE;
    await app.tick();
  }
  const summaries = events(gladys, TRIGGERS.DAILY_SUMMARY);
  assert.deepEqual(
    summaries.map((e) => e.data.system),
    [HOME, GARAGE],
  );
  const home = summaries[0].data;
  assert.equal(home.date, '2026-10-23');
  assert.ok(home.production_kwh > 10);
  assert.ok(home.exported_kwh > 0 && home.consumed_kwh > 0);
  assert.equal(home.is_record, true);
  assert.match(home.summary, /^Maison, toit sud: [\d.]+ kWh produced today, [\d.]+ kWh\/kW, peak/);
  assert.equal(summaries[1].data.exported_kwh, null, 'the garage publishes no export');
  const records = events(gladys, TRIGGERS.DAILY_RECORD);
  assert.equal(records.length, 2);
  assert.equal(records[0].data.previous_record_date, '2026-06-12');
  // The next ticks of the evening: no second summary.
  clock.now += HOUR;
  await app.tick();
  assert.equal(events(gladys, TRIGGERS.DAILY_SUMMARY).length, 2);
});

test('a first start after the summary time is a baseline: the first summary is tomorrow', async (t) => {
  const { gladys, app, clock } = await startApp(t, { now: Date.parse('2026-10-23T19:30:00Z') });
  await app.tick();
  clock.now += 30 * MINUTE;
  await app.tick();
  assert.equal(events(gladys, TRIGGERS.DAILY_SUMMARY).length, 0);
});

test('send_status: the values of a scene in the units of PVOutput, now in the timezone of the system', async (t) => {
  const { gladys, app, fake } = await startApp(t);
  await app.tick();
  const ack = await gladys.fake.sceneAction(SCENE_ACTIONS.SEND_STATUS, {
    system: HOME,
    power: '2 350',
    energy: '12 345,6',
    cumulative: 'generation',
    temperature: '21,4',
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    result: 'Maison, toit sud: status of 14:00 sent to PVOutput (OK 200: Added Status).',
    date: '2026-10-23',
    time: '14:00',
  });
  const call = fake.calls.at(-1);
  assert.deepEqual([call.service, call.method, call.sid], ['addstatus', 'POST', '12345']);
  assert.deepEqual(call.form, {
    d: '20261023',
    t: '14:00',
    v1: '12345600',
    v2: '2350',
    v5: '21.4',
    c1: '2',
  });
  // No scene event from an action, ever.
  const before = gladys.fake.sceneEvents.length;
  await gladys.fake.sceneAction(SCENE_ACTIONS.SEND_STATUS, { power: '100' });
  assert.equal(gladys.fake.sceneEvents.length, before);
});

test('send_status: the refusals, in the language of the configuration', async (t) => {
  const { gladys, app, fake } = await startApp(t, { config: { ...CONFIG, language: 'fr' } });
  await app.tick();
  const send = (fields) => gladys.fake.sceneAction(SCENE_ACTIONS.SEND_STATUS, fields);
  let ack = await send({ power: '{{device.power}}' });
  assert.equal(ack.success, false);
  assert.equal(ack.error, 'Puissance produite : « {{device.power}} » n’est pas un nombre.');
  ack = await send({});
  assert.match(ack.error, /^Rien à envoyer/);
  ack = await send({ power: '9000' });
  assert.match(
    ack.error,
    /^Refus de PVOutput : une puissance supérieure de plus de 50 %.*\(Bad request 400: Power value \[9000\]/,
  );
  fake.moon = true;
  ack = await send({ power: '100' });
  assert.match(ack.error, /Moon Powered.*fuseau horaire/);
  fake.moon = false;
  await gladys.fake.configUpdated({ ...CONFIG, api_key: 'readonly-key', language: 'fr' });
  ack = await send({ power: '100' });
  assert.equal(
    ack.error,
    'La clé est une clé en lecture seule : l’envoi demande la clé standard (Settings → API Access).',
  );
});

test('send_daily_output: the Linky values of a day, kWh to Wh', async (t) => {
  const { gladys, app, fake } = await startApp(t);
  await app.tick();
  const ack = await gladys.fake.sceneAction(SCENE_ACTIONS.SEND_DAILY_OUTPUT, {
    date: 'yesterday',
    exported: '6,21',
    consumption: '12 100 Wh',
    import_peak: '4,2',
    import_off_peak: '7.9',
    temperatures: '4 / 18',
    condition: 'showers',
    comment: 'from Gladys',
  });
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.outputs.date, '2026-10-22');
  assert.deepEqual(fake.calls.at(-1).form, {
    d: '20261022',
    e: '6210',
    c: '12100',
    ip: '4200',
    io: '7900',
    tm: '4',
    tx: '18',
    cd: 'Showers',
    cm: 'from Gladys',
  });
});

test('get_today: what the timer read, no request', async (t) => {
  const { gladys, app, fake } = await startApp(t);
  await app.tick();
  const count = fake.calls.length;
  const ack = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_TODAY, { system: HOME });
  assert.equal(fake.calls.length, count);
  assert.deepEqual(Object.keys(ack.data.outputs), TODAY_OUTPUTS);
  const outputs = ack.data.outputs;
  assert.equal(outputs.system_name, 'Maison, toit sud');
  assert.ok(outputs.production_kwh > 5 && outputs.power_w > 1000);
  assert.equal(outputs.last_status_time, '14:00');
  assert.equal(outputs.minutes_since_status, 0);
  assert.match(outputs.summary, /^Maison, toit sud: [\d.]+ kWh produced today/);
  const garage = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_TODAY, { system: GARAGE });
  assert.equal(garage.data.outputs.consumed_kwh, null);
});

test('the configuration buttons: test the connection, diagnostic without the key', async (t) => {
  const logs = [];
  const clock = { now: NOW };
  const fake = await startFakePvoutput({ now: () => clock.now });
  const gladys = createFakeGladys({ config: CONFIG });
  const app = createApp(gladys, {
    baseUrl: fake.url,
    dataDir: dataDir(),
    now: () => clock.now,
    timeZone: TZ,
    timers: false,
    spacingMs: 0,
    logger: { ...silent, info: (line) => logs.push(line) },
  });
  t.after(async () => {
    await gladys.fake.shutdown().catch(() => {});
    await fake.close();
  });
  await gladys.connect();
  await app.whenReady();
  const tested = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.equal(tested.success, true);
  assert.equal(
    tested.data.message.en,
    'Maison, toit sud (12345): 4.2 kW, a status every 5 min, Europe/Paris · Garage (67890): 3 kW, a status every 10 min, Europe/Paris · requests left this hour: 58 of 60',
  );
  assert.match(tested.data.message.fr, /4,2 kWc, un statut toutes les 5 min/);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  const diagnostic = await gladys.fake.action(ACTIONS.DIAGNOSTIC);
  assert.equal(diagnostic.success, true);
  const written = logs.filter((line) => line.startsWith('PVOutput diagnostic')).join('');
  assert.match(written, /"key":"set"/);
  assert.doesNotMatch(written, new RegExp(KEY));
  assert.doesNotMatch(written, /47\.24/, 'no coordinates in the logs');
});

test('no key, no system: a status that says what to do, no request', async (t) => {
  const { gladys, app, fake } = await startApp(t, { config: { system_ids: 'house' } });
  await app.tick();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /Enter the API key/);
  await gladys.fake.configUpdated({ api_key: KEY, system_ids: 'house' });
  assert.match(gladys.fake.connectionStatus.message.de, /Keine System-ID: house/);
  await app.tick();
  assert.deepEqual(fake.calls, []);
});
