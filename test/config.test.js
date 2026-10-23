import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeConfig,
  readSystemIds,
  readBoolean,
  guessLanguage,
  readLanguage,
  MAX_SYSTEMS,
} from '../src/config.js';

test('System Ids: commas, spaces or semicolons, no duplicate, five at most, garbage kept aside', () => {
  assert.deepEqual(readSystemIds(' 12345 , 67890 '), {
    ids: ['12345', '67890'],
    invalid: [],
    extra: [],
  });
  assert.deepEqual(readSystemIds('12345;12345 #67890').ids, ['12345', '67890']);
  assert.deepEqual(readSystemIds(12345).ids, ['12345']);
  assert.deepEqual(readSystemIds('012345').ids, ['12345']);
  assert.deepEqual(readSystemIds('12345, my house, 0').invalid, ['my', 'house', '0']);
  const many = readSystemIds('1,2,3,4,5,6,7');
  assert.equal(many.ids.length, MAX_SYSTEMS);
  assert.deepEqual(many.extra, ['6', '7']);
  assert.deepEqual(readSystemIds(undefined), { ids: [], invalid: [], extra: [] });
});

test('the configuration: trimmed key, donation as a boolean, a known language or automatic', () => {
  assert.deepEqual(
    normalizeConfig({ api_key: ' key ', system_ids: '12345', donation: 'true', language: 'de' }),
    {
      apiKey: 'key',
      systemIds: ['12345'],
      invalidIds: [],
      extraIds: [],
      donation: true,
      language: 'de',
    },
  );
  const empty = normalizeConfig();
  assert.deepEqual(
    [empty.apiKey, empty.systemIds, empty.donation, empty.language],
    ['', [], false, 'auto'],
  );
  assert.equal(normalizeConfig({ language: 'it' }).language, 'auto');
  assert.deepEqual([true, 'true', 1, '1', false, 'false', undefined, 0].map(readBoolean), [
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
  ]);
});

test('the language of the last widget is kept, a wrong one ignored', () => {
  assert.equal(readLanguage({ last_language: 'es' }, 'fr'), 'es');
  assert.equal(readLanguage({ last_language: 'xx' }, 'fr'), 'fr');
  assert.equal(guessLanguage('Europe/Berlin'), 'de');
});
