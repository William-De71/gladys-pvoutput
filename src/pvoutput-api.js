// -----------------------------------------------------------------------------
// HTTP client of the PVOutput API (https://pvoutput.org/help/api_specification.html).
//
//   GET  /service/r2/getsystem.jsp     tz=1                 the system, its timezone
//   GET  /service/r2/getstatus.jsp                          the last live status (7 days)
//   GET  /service/r2/getstatus.jsp     d, h=1, limit, asc=1 the statuses of a day
//   GET  /service/r2/getoutput.jsp     df, dt, limit        the daily outputs
//   GET  /service/r2/getstatistic.jsp                       the lifetime statistics
//   POST /service/r2/addstatus.jsp     d, t, v1…v6, c1, n   a live status
//   POST /service/r2/addoutput.jsp     d, g, e, c, ip, io…  an end of day output
//
// The key and the system id travel in the headers X-Pvoutput-Apikey and
// X-Pvoutput-SystemId, never in a URL (the API also takes them in the query
// string: not used). `X-Rate-Limit: 1` asks for the quota headers
// X-Rate-Limit-Remaining / -Limit / -Reset on every answer. Writes are POSTs
// (form parameters), reads GETs; HEAD answers 405. One request at a time,
// one second at least between two.
//
// Answers are plain text: the data, or a message such as
// "Unauthorized 401: Missing, invalid or inactive api key information
// (X-Pvoutput-Apikey)" for a wrong key sent in the headers (checked live on
// 2026-10-23: HTTP 401, text/plain, no quota headers),
// "Forbidden 403: Exceeded number requests per hour", "Bad request 400: No
// status found". The kind of an error is read from its message and its status.
// -----------------------------------------------------------------------------

import { messageOf } from './parse.js';

const BASE_URL = 'https://pvoutput.org';
const SERVICES = {
  getsystem: '/service/r2/getsystem.jsp',
  getstatus: '/service/r2/getstatus.jsp',
  getoutput: '/service/r2/getoutput.jsp',
  getstatistic: '/service/r2/getstatistic.jsp',
  addstatus: '/service/r2/addstatus.jsp',
  addoutput: '/service/r2/addoutput.jsp',
};
const WRITES = ['addstatus', 'addoutput'];
const TIMEOUT_MS = 20000;
const SPACING_MS = 1000;

/**
 * @description An error of the PVOutput API, with a kind the messages tell apart.
 */
class PvoutputError extends Error {
  /**
   * @param {string} kind - See kindOf.
   * @param {string} message - The message of PVOutput (never the key).
   * @param {object} [extra] - `{ status, service }`.
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'PvoutputError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

/**
 * @description The kind of an error answer.
 * @param {string} message - The message of PVOutput.
 * @param {number} status - The HTTP status.
 * @returns {string} `key` (refused, disabled or missing key), `system` (an
 * unknown or inaccessible system id), `read_only` (a read only key for a write),
 * `rate_limit`, `donation` (a donation-only request), `no_status` (nothing in
 * the last 7 days), `method`, `invalid` (another 400), `failed`.
 */
function kindOf(message, status) {
  const text = String(message ?? '');
  if (/exceeded number requests/i.test(text) || status === 429) {
    return 'rate_limit';
  }
  if (/read only key/i.test(text)) {
    return 'read_only';
  }
  if (/donation mode/i.test(text)) {
    return 'donation';
  }
  if (/invalid system id|inaccessible system id/i.test(text)) {
    return 'system';
  }
  if (/api key|apikey/i.test(text) || status === 401) {
    return 'key';
  }
  if (/no status found/i.test(text)) {
    return 'no_status';
  }
  if (status === 405) {
    return 'method';
  }
  if (status === 403) {
    return 'key';
  }
  if (status >= 400 && status < 500) {
    return 'invalid';
  }
  return 'failed';
}

/**
 * @description The quota headers of an answer.
 * @param {Headers} headers - The headers.
 * @returns {{ remaining: number, limit: number, reset: number }|null} `reset` in ms.
 */
function rateOf(headers) {
  const read = (name) => {
    const value = Number.parseInt(headers.get(name) ?? '', 10);
    return Number.isFinite(value) ? value : null;
  };
  const remaining = read('x-rate-limit-remaining');
  const limit = read('x-rate-limit-limit');
  const reset = read('x-rate-limit-reset');
  if (remaining === null && limit === null) {
    return null;
  }
  return { remaining, limit, reset: reset === null ? null : reset * 1000 };
}

/**
 * @description The PVOutput client.
 * @param {object} options - Options.
 * @param {Function} options.getKey - `() => string`, the API key.
 * @param {string} options.userAgent - The User-Agent of every request.
 * @param {Function} [options.fetch] - The fetch implementation (tests).
 * @param {string} [options.baseUrl] - The site root (tests).
 * @param {Function} [options.onAnswer] - `(service, { status, rate }) => void`, after every answer.
 * @param {number} [options.spacingMs] - Minimum time between two requests.
 * @returns {object} The client.
 */
function createPvoutputClient({
  getKey,
  userAgent,
  fetch: fetchFn = globalThis.fetch,
  baseUrl = BASE_URL,
  onAnswer = () => {},
  spacingMs = SPACING_MS,
}) {
  let busy = Promise.resolve();
  let lastEnd = 0;

  /**
   * @description One request at a time, spaced: a request waits for the previous one.
   * @param {Function} task - `() => Promise`.
   * @returns {Promise<unknown>} Its result.
   */
  function serial(task) {
    const run = busy.then(async () => {
      const wait = lastEnd + spacingMs - Date.now();
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      try {
        return await task();
      } finally {
        lastEnd = Date.now();
      }
    });
    busy = run.catch(() => {});
    return run;
  }

  /**
   * @description Call a service.
   * @param {string} service - A SERVICES key.
   * @param {string|number} systemId - The system.
   * @param {object} [params] - The parameters (query of a read, form of a write).
   * @returns {Promise<string>} The body of a successful answer.
   */
  function call(service, systemId, params = {}) {
    return serial(async () => {
      const key = getKey();
      if (!key) {
        throw new PvoutputError('key', 'No API key', { service });
      }
      const write = WRITES.includes(service);
      const url = new URL(SERVICES[service], baseUrl);
      const form = new URLSearchParams();
      for (const [name, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          (write ? form : url.searchParams).set(name, String(value));
        }
      }
      const headers = {
        'X-Pvoutput-Apikey': key,
        'X-Pvoutput-SystemId': String(systemId),
        'X-Rate-Limit': '1',
        'User-Agent': userAgent,
        Accept: 'text/plain',
      };
      let response;
      try {
        response = await fetchFn(url, {
          method: write ? 'POST' : 'GET',
          headers: write
            ? { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }
            : headers,
          ...(write ? { body: form.toString() } : {}),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        throw new PvoutputError(
          'unreachable',
          String(err?.cause?.code ?? err?.name ?? 'network error'),
          { service },
        );
      }
      const body = await response.text().catch(() => '');
      const rate = rateOf(response.headers);
      onAnswer(service, { status: response.status, rate });
      if (response.status !== 200) {
        const message = messageOf(body).split(key).join('…') || `HTTP ${response.status}`;
        throw new PvoutputError(kindOf(message, response.status), message, {
          status: response.status,
          service,
          rate,
        });
      }
      return body;
    });
  }

  return {
    call,
    getSystem: (systemId) => call('getsystem', systemId, { tz: 1 }),
    getStatus: (systemId) => call('getstatus', systemId),
    getHistory: (systemId, date) =>
      call('getstatus', systemId, { d: date, h: 1, limit: 288, asc: 1 }),
    getOutputs: (systemId, { from, to }) =>
      call('getoutput', systemId, { df: from, dt: to, limit: 50 }),
    getStatistic: (systemId) => call('getstatistic', systemId),
    addStatus: (systemId, params) => call('addstatus', systemId, params),
    addOutput: (systemId, params) => call('addoutput', systemId, params),
  };
}

export { BASE_URL, SERVICES, PvoutputError, kindOf, rateOf, createPvoutputClient };
