// The HTTP client against the fake PVOutput: headers, methods, the quota
// headers and the kind of every refusal of the specification.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPvoutputClient, kindOf, rateOf } from '../src/pvoutput-api.js';
import { startFakePvoutput, KEY } from './helpers/fake-pvoutput.js';

const client = (fake, key = KEY, onAnswer) =>
  createPvoutputClient({
    getKey: () => key,
    userAgent: 'gladys-pvoutput/test',
    baseUrl: fake.url,
    spacingMs: 0,
    ...(onAnswer ? { onAnswer } : {}),
  });

test('the key and the System Id travel in headers, never in a URL; reads GET, writes POST', async (t) => {
  const fake = await startFakePvoutput();
  t.after(() => fake.close());
  const answers = [];
  const api = client(fake, KEY, (service, answer) => answers.push([service, answer.rate?.limit]));
  await api.getSystem('12345');
  await api.addStatus('12345', { d: '20261023', t: '14:00', v2: 1000 });
  const [read, write] = fake.calls;
  assert.deepEqual(
    [read.method, read.key, read.sid, read.query],
    ['GET', KEY, '12345', { tz: '1' }],
  );
  assert.equal(read.rateHeader, '1');
  assert.equal(read.userAgent, 'gladys-pvoutput/test');
  assert.deepEqual(
    [write.method, write.contentType, write.form],
    ['POST', 'application/x-www-form-urlencoded', { d: '20261023', t: '14:00', v2: '1000' }],
  );
  assert.deepEqual(write.query, {});
  for (const call of fake.calls) {
    assert.doesNotMatch(call.url, /good-key|key=|sid=/);
  }
  assert.deepEqual(answers, [
    ['getsystem', 60],
    ['addstatus', 60],
  ]);
});

test('every refusal of the specification gets its kind; the key never in a message', async (t) => {
  const fake = await startFakePvoutput();
  t.after(() => fake.close());
  const kind = (promise) =>
    promise.then(
      () => 'ok',
      (err) => [err.kind, err.status, err.message],
    );
  assert.deepEqual(await kind(client(fake, 'wrong-key').getStatus('12345')), [
    'key',
    401,
    'Unauthorized 401: Missing, invalid or inactive api key information (X-Pvoutput-Apikey)',
  ]);
  assert.deepEqual((await kind(client(fake, 'disabled-key').getStatus('12345'))).slice(0, 2), [
    'key',
    401,
  ]);
  assert.deepEqual((await kind(client(fake).getStatus('55555'))).slice(0, 2), ['system', 401]);
  assert.deepEqual(
    (
      await kind(
        client(fake, 'readonly-key').addStatus('12345', { d: '20261023', t: '14:00', v2: 1 }),
      )
    ).slice(0, 2),
    ['read_only', 403],
  );
  assert.equal((await kind(client(fake, '').getStatus('12345')))[0], 'key');
  fake.limit = 1;
  assert.deepEqual((await kind(client(fake).getStatus('12345'))).slice(0, 2), ['rate_limit', 403]);
  assert.match(
    String(await kind(client(fake).getStatus('12345'))),
    /Exceeded number requests per hour/,
  );
});

test('kinds from the messages, quota headers', () => {
  assert.equal(kindOf('Bad request 400: No status found', 400), 'no_status');
  assert.equal(kindOf('Forbidden 403: Donation Mode', 403), 'donation');
  assert.equal(kindOf('Unauthorized 401: Inaccessible System ID', 401), 'system');
  assert.equal(
    kindOf(
      'Unauthorized 401: Missing, invalid or inactive api key information (X-Pvoutput-Apikey)',
      401,
    ),
    'key',
  );
  assert.equal(kindOf('Method Not Allowed 405: POST or GET only', 405), 'method');
  assert.equal(kindOf('Bad request 400: Moon Powered', 400), 'invalid');
  assert.equal(kindOf('', 502), 'failed');
  const headers = new Headers({
    'X-Rate-Limit-Remaining': '41',
    'X-Rate-Limit-Limit': '60',
    'X-Rate-Limit-Reset': '1792749600',
  });
  assert.deepEqual(rateOf(headers), { remaining: 41, limit: 60, reset: 1792749600000 });
  assert.equal(rateOf(new Headers()), null);
});

test('the fake answers HEAD with 405, like PVOutput', async (t) => {
  const fake = await startFakePvoutput();
  t.after(() => fake.close());
  const response = await fetch(`${fake.url}/service/r2/getstatus.jsp`, {
    method: 'PUT',
    headers: { 'X-Pvoutput-Apikey': KEY },
  });
  assert.equal(response.status, 405);
  assert.equal(await response.text(), 'Method Not Allowed 405: POST or GET only');
});

test('a network failure is "unreachable"', async () => {
  const api = createPvoutputClient({
    getKey: () => KEY,
    userAgent: 'test',
    spacingMs: 0,
    fetch: async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    },
  });
  await assert.rejects(api.getStatus('12345'), { kind: 'unreachable', message: 'ENOTFOUND' });
});
