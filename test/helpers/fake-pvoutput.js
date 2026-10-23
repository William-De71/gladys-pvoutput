// A fake PVOutput for the tests: a real HTTP server on 127.0.0.1, with the
// services, the answers and the refusals of the API specification
// (https://pvoutput.org/help/api_specification.html). Tests never touch the
// network. Nothing starts on import (`node --test` also runs this file).
//
//   - authentication by the headers X-Pvoutput-Apikey / X-Pvoutput-SystemId
//     only: the integration never puts them in a URL. Keys: `good-key`
//     (standard), `readonly-key` (reads only: "Forbidden 403: Read only key"
//     on a write), `disabled-key` ("Unauthorized 401: Disabled API Key"),
//     anything else "Unauthorized 401: Missing, invalid or inactive api key
//     information (X-Pvoutput-Apikey)" (the real answer to a wrong key in the
//     headers, checked live on 2026-10-23: HTTP 401, text/plain, no quota header);
//   - an unknown System Id: "Unauthorized 401: Invalid System ID";
//   - `X-Rate-Limit: 1` adds X-Rate-Limit-Remaining / -Limit / -Reset; past the
//     limit of the hour (60, 12 for getstatistic): "Forbidden 403: Exceeded
//     number requests per hour"; HEAD or PUT: "Method Not Allowed 405: POST or
//     GET only";
//   - plain text answers, `,` between fields, `;` between records, NaN for
//     a missing number.
// Two systems around Besançon, statuses generated from the clock of the test
// (a bell from 08:20 to 18:30 local time): 12345 "Maison, toit sud" (a comma in
// the name, 4.2 kW, every 5 minutes, Europe/Paris, with consumption,
// temperature and voltage) and 67890 "Garage" (3 kW, every 10 minutes, no
// timezone given, production only). Never real data.

import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NOW = Date.parse('2026-10-23T12:00:00Z'); // 14:00 in Paris, a Friday
const TZ = 'Europe/Paris';
const KEY = 'good-key';
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const silent = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * @description A temporary folder standing for /data.
 * @returns {string} The path.
 */
const dataDir = () => mkdtempSync(join(tmpdir(), 'pvoutput-'));

const SYSTEMS = {
  12345: {
    name: 'Maison, toit sud',
    size: 4200,
    interval: 5,
    timeZone: 'Europe/Paris',
    latitude: 47.24,
    longitude: 6.02,
    consumption: true,
    temperature: true,
    voltage: true,
    fields: '4200,25000,12,350,DualSun,1,4000,Enphase,S,30.0,No,20210415,47.240000,6.020000,5',
  },
  67890: {
    name: 'Garage',
    size: 3000,
    interval: 10,
    timeZone: '',
    latitude: 47.25,
    longitude: 6.03,
    consumption: false,
    temperature: false,
    voltage: false,
    fields: '3000,25000,9,330,Sunpower,1,3000,SMA,SW,35.0,Low,20190301,47.250000,6.030000,10',
  },
};
const zoneParts = (instant, zone) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone || TZ,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(new Date(instant))
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}${parts.month}${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    hours: Number(parts.hour) + Number(parts.minute) / 60,
  };
};

/**
 * @description The power of a system at a local hour: a bell between 08:20 and 18:30.
 * @param {object} system - The system.
 * @param {number} hours - Local hours (decimal).
 * @returns {number} Watts.
 */
function powerAt(system, hours) {
  const rise = 8 + 20 / 60;
  const set = 18.5;
  if (hours <= rise || hours >= set) {
    return 0;
  }
  return Math.round(
    system.size * 0.74 * Math.sin((Math.PI * (hours - rise)) / (set - rise)) ** 1.4,
  );
}

/**
 * @description The fake PVOutput.
 * @param {object} [options] - `{ now }`: `() => number`, the clock of the statuses.
 * @returns {Promise<object>} `{ url, calls, close(), … }` and the hooks of the tests.
 */
async function startFakePvoutput({ now = () => NOW } = {}) {
  const fake = {
    calls: [],
    posted: [],
    limit: 60,
    statisticLimit: 12,
    used: new Map(),
    // Hooks of the tests.
    silentAfter: {}, // { sid: instant }: no status after it
    offline: false,
    answer: null, // (call) => { status, body } to replace an answer
    recordToday: false,
    now,
  };

  /**
   * @description The statuses of a system on a local day, up to the clock.
   * @param {string} sid - The system.
   * @param {string} date - The local day.
   * @returns {object[]} `{ date, time, energy, power, consumptionEnergy, consumptionPower, temperature, voltage }`.
   */
  function statusesOf(sid, date) {
    const system = SYSTEMS[sid];
    const list = [];
    let energy = 0;
    let consumed = 0;
    const end = Math.min(fake.now(), fake.silentAfter[sid] ?? Infinity);
    // Walk the instants of the day in steps of the status interval.
    for (let at = fake.now() - 3 * 24 * HOUR; at <= end; at += system.interval * MINUTE) {
      const aligned = Math.floor(at / (system.interval * MINUTE)) * system.interval * MINUTE;
      const local = zoneParts(aligned, system.timeZone);
      if (local.date !== date) {
        continue;
      }
      const power = powerAt(system, local.hours);
      energy += (power * system.interval) / 60;
      const usage = 350 + Math.round(250 * Math.sin(local.hours));
      consumed += (usage * system.interval) / 60;
      // Production only by day; a system with a consumption meter publishes all day.
      if (power === 0 && !system.consumption) {
        continue;
      }
      list.push({
        date,
        time: local.time,
        energy: Math.round(energy),
        power,
        consumptionEnergy: system.consumption ? Math.round(consumed) : null,
        consumptionPower: system.consumption ? usage : null,
        temperature: system.temperature ? Math.round((9 + local.hours / 3) * 10) / 10 : null,
        voltage: system.voltage ? Math.round((236 + (local.hours % 4)) * 10) / 10 : null,
        normalised: Math.round((power / system.size) * 1000) / 1000,
      });
    }
    return list;
  }
  const n = (value) => (value === null || value === undefined ? 'NaN' : String(value));

  /**
   * @description The daily output of a past day (made up), or of today (from the statuses).
   * @param {string} sid - The system.
   * @param {string} date - The local day.
   * @param {string} today - Today, locally.
   * @returns {string|null} The record.
   */
  function outputOf(sid, date, today) {
    const system = SYSTEMS[sid];
    let generated;
    let peak = null;
    if (date === today) {
      const statuses = statusesOf(sid, date).filter((s) => s.power > 0);
      if (!statuses.length) return null;
      generated = statuses.at(-1).energy;
      peak = statuses.reduce((best, s) => (s.power > best.power ? s : best));
    } else {
      const day = Number(date.slice(6, 8));
      generated = Math.round(system.size * (2.1 + 1.4 * Math.abs(Math.sin(day * 1.7))));
    }
    const efficiency = (generated / system.size).toFixed(3);
    const exported = system.consumption ? Math.round(generated * 0.45) : 0;
    const used = system.consumption ? 9100 + (Number(date.slice(6, 8)) % 5) * 300 : 0;
    const condition = generated / system.size > 3 ? 'Fine' : 'Partly Cloudy';
    return [
      date,
      generated,
      efficiency,
      exported,
      used,
      peak ? peak.power : Math.round(system.size * 0.7),
      peak ? peak.time : '13:10',
      condition,
      'NaN',
      'NaN',
      'NaN',
      'NaN',
      'NaN',
      'NaN',
    ].join(',');
  }

  /**
   * @description Answer a request.
   * @param {object} call - The parsed request.
   * @returns {{ status: number, body: string, headers?: object }} The answer.
   */
  function answer(call) {
    if (!['GET', 'POST'].includes(call.method)) {
      return { status: 405, body: 'Method Not Allowed 405: POST or GET only' };
    }
    if (call.key === 'disabled-key') {
      return { status: 401, body: 'Unauthorized 401: Disabled API Key' };
    }
    if (call.key !== KEY && call.key !== 'readonly-key') {
      return {
        status: 401,
        body: 'Unauthorized 401: Missing, invalid or inactive api key information (X-Pvoutput-Apikey)',
      };
    }
    const system = SYSTEMS[call.sid];
    if (!system) {
      return { status: 401, body: 'Unauthorized 401: Invalid System ID' };
    }
    const today = zoneParts(fake.now(), system.timeZone).date;
    const params = call.method === 'POST' ? call.form : call.query;
    switch (call.service) {
      case 'getsystem':
        return {
          status: 200,
          body: `${system.name},${system.fields}${params.tz === '1' ? `,${system.timeZone}` : ''};;0`,
        };
      case 'getstatus': {
        if (params.h === '1') {
          const statuses = statusesOf(call.sid, params.d || today);
          if (!statuses.length) return { status: 400, body: 'Bad request 400: No status found' };
          const ordered = params.asc === '1' ? statuses : [...statuses].reverse();
          const limited = ordered.slice(0, Number(params.limit) || 30);
          return {
            status: 200,
            body: limited
              .map((s) =>
                [
                  s.date,
                  s.time,
                  s.energy,
                  (s.energy / system.size).toFixed(3),
                  s.power,
                  s.power,
                  s.normalised,
                  n(s.consumptionEnergy),
                  n(s.consumptionPower),
                  n(s.temperature),
                  n(s.voltage),
                ].join(','),
              )
              .join(';'),
          };
        }
        // The last status of the last 7 days.
        for (let back = 0; back < 7; back += 1) {
          const day = zoneParts(fake.now() - back * 24 * HOUR, system.timeZone).date;
          const statuses = statusesOf(call.sid, day);
          if (statuses.length) {
            const s = statuses.at(-1);
            return {
              status: 200,
              body: [
                s.date,
                s.time,
                s.energy,
                s.power,
                n(s.consumptionEnergy),
                n(s.consumptionPower),
                s.normalised,
                n(s.temperature),
                n(s.voltage),
              ].join(','),
            };
          }
        }
        return { status: 400, body: 'Bad request 400: No status found' };
      }
      case 'getoutput': {
        const records = [];
        for (let back = 0; back < 60; back += 1) {
          const day = zoneParts(fake.now() - back * 24 * HOUR, system.timeZone).date;
          if ((params.df && day < params.df) || (params.dt && day > params.dt)) continue;
          if (records.some((r) => r.startsWith(day))) continue;
          const record = outputOf(call.sid, day, today);
          if (record) records.push(record);
        }
        return { status: 200, body: records.slice(0, Number(params.limit) || 30).join(';') };
      }
      case 'getstatistic': {
        const record = fake.recordToday
          ? [(statusesOf(call.sid, today).at(-1)?.energy ?? 0) / system.size, today]
          : [6.02, '20260612'];
        return {
          status: 200,
          body: [
            12345678 + (statusesOf(call.sid, today).at(-1)?.energy ?? 0),
            5432100,
            9876,
            120,
            25284,
            3.215,
            1650,
            '20210415',
            today,
            Number(record[0]).toFixed(3),
            record[1],
          ].join(','),
        };
      }
      case 'addstatus': {
        if (call.key === 'readonly-key')
          return { status: 403, body: 'Forbidden 403: Read only key' };
        if (!/^\d{8}$/.test(params.d ?? '') || !/^\d{1,2}:\d{2}$/.test(params.t ?? '')) {
          return { status: 400, body: 'Bad request 400: Missing date or time' };
        }
        if (!['v1', 'v2', 'v3', 'v4'].some((k) => params[k] !== undefined)) {
          return { status: 400, body: 'Bad request 400: Missing energy and power values' };
        }
        if (params.c1 && params.n) {
          return { status: 400, body: 'Bad Request 400: Invalid net and cumulative' };
        }
        if (fake.moon) return { status: 400, body: 'Bad request 400: Moon Powered' };
        if (Number(params.v2) > system.size * 1.5) {
          return {
            status: 400,
            body: `Bad request 400: Power value [${params.v2}] too high for system size [${system.size}]`,
          };
        }
        fake.posted.push({ service: 'addstatus', sid: call.sid, params });
        return { status: 200, body: 'OK 200: Added Status' };
      }
      case 'addoutput': {
        if (call.key === 'readonly-key')
          return { status: 403, body: 'Forbidden 403: Read only key' };
        if (!/^\d{8}$/.test(params.d ?? '')) {
          return { status: 400, body: `Bad request 400: Date [${params.d}] invalid` };
        }
        if ((params.tm === undefined) !== (params.tx === undefined)) {
          return { status: 400, body: `Bad request 400: Min/Max temp missing on [${params.d}]` };
        }
        fake.posted.push({ service: 'addoutput', sid: call.sid, params });
        return { status: 200, body: 'OK 200: Added Output' };
      }
      default:
        return { status: 404, body: 'Not Found' };
    }
  }

  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      const url = new URL(request.url, 'http://127.0.0.1');
      const service = (/\/service\/r2\/([a-z]+)\.jsp$/.exec(url.pathname) ?? [])[1] ?? 'unknown';
      const call = {
        method: request.method,
        service,
        key: request.headers['x-pvoutput-apikey'] ?? null,
        sid: request.headers['x-pvoutput-systemid'] ?? null,
        query: Object.fromEntries(url.searchParams),
        form: Object.fromEntries(new URLSearchParams(raw)),
        contentType: request.headers['content-type'] ?? null,
        userAgent: request.headers['user-agent'] ?? null,
        rateHeader: request.headers['x-rate-limit'] ?? null,
        url: request.url,
        at: fake.now(),
      };
      fake.calls.push(call);
      if (fake.offline) {
        request.socket.destroy();
        return;
      }
      // The quota of the hour of the key (all services) and of getstatistic.
      const hour = Math.floor(fake.now() / HOUR);
      const counter = (name) => `${call.key}:${name}:${hour}`;
      const count = (name) => {
        fake.used.set(counter(name), (fake.used.get(counter(name)) ?? 0) + 1);
        return fake.used.get(counter(name));
      };
      const all = count('all');
      const statistic = service === 'getstatistic' ? count('statistic') : 0;
      const headers = { 'Content-Type': 'text/plain;charset=UTF-8' };
      if (call.rateHeader === '1') {
        headers['X-Rate-Limit-Remaining'] = String(Math.max(0, fake.limit - all));
        headers['X-Rate-Limit-Limit'] = String(fake.limit);
        headers['X-Rate-Limit-Reset'] = String(((hour + 1) * HOUR) / 1000);
      }
      let result;
      if (all > fake.limit || statistic > fake.statisticLimit) {
        result = { status: 403, body: 'Forbidden 403: Exceeded number requests per hour' };
      } else {
        result = (fake.answer && fake.answer(call)) || answer(call);
      }
      response.writeHead(result.status, { ...headers, ...(result.headers ?? {}) });
      response.end(result.body);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.url = `http://127.0.0.1:${server.address().port}`;
  fake.close = () =>
    new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  fake.statusesOf = statusesOf;
  fake.of = (service) => fake.calls.filter((call) => call.service === service);
  return fake;
}

export { NOW, TZ, KEY, MINUTE, HOUR, SYSTEMS, silent, dataDir, startFakePvoutput, powerAt };
