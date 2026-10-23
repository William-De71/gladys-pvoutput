import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import {
  TRIGGERS,
  SCENE_ACTIONS,
  SEND_OUTPUTS,
  OUTPUT_OUTPUTS,
  TODAY_OUTPUTS,
} from '../src/events.js';
import { ACTIONS } from '../src/app.js';
import { WIDGETS } from '../src/widgets.js';
import { CUMULATIVE, CONDITIONS, ENERGY_UNITS } from '../src/actions.js';
import { AUTO_LANGUAGE } from '../src/config.js';
import { LANGUAGES } from '../src/i18n.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = read('../gladys-assistant-integration.json');
const pkg = read('../package.json');
const byKey = (list) => new Map(list.map((entry) => [entry.key, entry]));
const values = (field) => field.options.map((option) => option.value);
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const REPO = 'William-De71/gladys-pvoutput';

test('a device integration, in lockstep with package.json, at 0.x until 1.0.0 is decided', () => {
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.name, 'PVOutput');
  assert.equal(manifest.version, pkg.version);
  assert.match(pkg.version, /^0\./);
  assert.equal(manifest.docker_image, `ghcr.io/william-de71/gladys-pvoutput:${pkg.version}`);
  assert.equal(manifest.cover_image, `https://raw.githubusercontent.com/${REPO}/main/cover.jpg`);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.name, 'gladys-pvoutput');
});

test('declares the cloud transport: pvoutput.org only, never a local device', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.match(source('../src/pvoutput-api.js'), /https:\/\/pvoutput\.org/);
  for (const file of [
    'app',
    'parse',
    'budget',
    'events',
    'widgets',
    'device',
    'actions',
    'store',
    'sun',
    'time',
  ]) {
    assert.doesNotMatch(
      source(`../src/${file}.js`),
      /fetch\(|node:https?|node:net|node:dgram/,
      file,
    );
  }
  // A single channel: no transport to publish per device.
  assert.doesNotMatch(source('../src/app.js'), /publishTransports|GLADYS_PREFER_LOCAL/);
});

test('widgets and scenes need Gladys 5.1.0, nothing more; no permission', () => {
  assert.equal(manifest.gladys_version, '>=5.1.0');
  assert.deepEqual(manifest.categories, ['energy']);
  const text = JSON.stringify(manifest);
  assert.doesNotMatch(text, /"source":"houses"/, 'houses need 5.2.0');
  for (const key of [
    'location',
    'network_wake',
    'containers',
    'network_discovery',
    'webhooks',
    'messaging',
    'keywords',
    'countries',
  ]) {
    assert.equal(manifest[key], undefined, key);
  }
  // No widget button with a form (5.2.0): no button at all.
  for (const widget of manifest.widgets) {
    assert.equal(widget.action_timeout_seconds, undefined, widget.key);
  }
  const key = byKey(manifest.config_schema).get('api_key');
  assert.deepEqual([key.type, key.required], ['secret', true]);
  assert.deepEqual(byKey(manifest.config_schema).get('donation').type, 'boolean');
});

test('declares exactly the scene triggers, actions and widgets the code handles', () => {
  const app = source('../src/app.js');
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key),
    Object.values(TRIGGERS),
  );
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key),
    Object.values(SCENE_ACTIONS),
  );
  assert.deepEqual(
    manifest.widgets.map((w) => w.key),
    Object.values(WIDGETS),
  );
  for (const key of Object.keys(WIDGETS)) {
    assert.match(app, new RegExp(`onWidgetGet\\(WIDGETS\\.${key}`), key);
  }
  assert.doesNotMatch(app, /onWidgetAction/, 'no widget button: never a request on a click');
  for (const key of Object.keys(SCENE_ACTIONS)) {
    assert.match(app, new RegExp(`onSceneAction\\(SCENE_ACTIONS\\.${key}`), key);
  }
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  for (const key of Object.keys(ACTIONS)) {
    assert.match(app, new RegExp(`onAction\\(ACTIONS\\.${key}`), key);
  }
  const outputs = (key) =>
    byKey(manifest.scene_actions)
      .get(key)
      .outputs.map((output) => output.key);
  assert.deepEqual(outputs('send_status'), SEND_OUTPUTS);
  assert.deepEqual(outputs('send_daily_output'), OUTPUT_OUTPUTS);
  assert.deepEqual(outputs('get_today'), TODAY_OUTPUTS);
  // The trigger fields are keys of the event data (the core compares them).
  for (const trigger of manifest.scene_triggers) {
    for (const field of trigger.fields ?? []) {
      assert.equal(field.key, 'system');
      assert.equal(field.source, 'devices');
      assert.ok(
        trigger.variables.some((variable) => variable.key === 'system'),
        trigger.key,
      );
    }
  }
});

test('the values of the action fields mirror the code; values are strings (scene variables)', () => {
  const status = byKey(byKey(manifest.scene_actions).get('send_status').fields);
  assert.deepEqual(values(status.get('cumulative')), Object.keys(CUMULATIVE));
  assert.deepEqual(values(status.get('energy_unit')), Object.keys(ENERGY_UNITS));
  assert.equal(status.get('net').type, 'boolean');
  for (const key of [
    'power',
    'energy',
    'consumption_power',
    'consumption_energy',
    'temperature',
    'voltage',
  ]) {
    assert.equal(
      status.get(key).type,
      'string',
      `only strings take {{…}} in the scene editor: ${key}`,
    );
  }
  const output = byKey(byKey(manifest.scene_actions).get('send_daily_output').fields);
  assert.deepEqual(values(output.get('condition')), ['none', ...Object.keys(CONDITIONS)]);
  assert.deepEqual(values(output.get('date')), ['today', 'yesterday']);
  for (const key of [
    'generated',
    'exported',
    'consumption',
    'import_peak',
    'import_off_peak',
    'temperatures',
    'comment',
  ]) {
    assert.equal(output.get(key).type, 'string', key);
  }
});

test('limits of the store: counts, timeouts, sizes, no secret in widget settings', () => {
  assert.ok(manifest.actions.length <= 10);
  assert.ok(manifest.widgets.length >= 1 && manifest.widgets.length <= 5);
  assert.ok(manifest.scene_triggers.length <= 20 && manifest.scene_actions.length <= 20);
  for (const trigger of manifest.scene_triggers) {
    assert.ok((trigger.fields ?? []).length <= 10 && trigger.variables.length <= 20, trigger.key);
    assert.ok(trigger.key.length <= 40);
  }
  for (const action of manifest.scene_actions) {
    assert.ok(action.fields.length <= 10, `${action.key}: ${action.fields.length} fields`);
    assert.ok(action.outputs.length <= 20, action.key);
  }
  for (const action of [...manifest.scene_actions, ...manifest.actions]) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120, action.key);
  }
  for (const widget of manifest.widgets) {
    for (const setting of widget.settings ?? []) {
      assert.ok(!['secret', 'oauth2', 'account_link'].includes(setting.type));
    }
  }
  const size = statSync(new URL('../gladys-assistant-integration.json', import.meta.url)).size;
  assert.ok(size < 100 * 1024, `${size} bytes`);
  const cover = readFileSync(new URL('../cover.jpg', import.meta.url));
  assert.ok(cover.length < 150 * 1024, `cover.jpg: ${cover.length} bytes`);
  assert.equal(cover.readUInt16BE(0), 0xffd8, 'cover.jpg is a JPEG');
});

test('offers the languages of the code, automatic by default', () => {
  const field = byKey(manifest.config_schema).get('language');
  assert.deepEqual(values(field), [AUTO_LANGUAGE, ...LANGUAGES]);
  assert.equal(field.default, AUTO_LANGUAGE);
});
