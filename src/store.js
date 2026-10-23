// -----------------------------------------------------------------------------
// What the integration keeps across restarts, under /data (the only writable
// place of the container), in /data/pvoutput.json:
//
//   - `budget`     the requests of the last hour and the quota headers of
//                  PVOutput (budget.js): a restart never bursts;
//   - `systems`    per System Id: what getsystem said (name, size, location,
//                  status interval, timezone), the last status, the history of
//                  the day, the daily outputs, the lifetime statistics, when
//                  each was read; the features found (`features`: a feature
//                  never disappears); the highest lifetime index published;
//                  what the scene triggers already know (`seen`);
//   - `keyRefused` the reason PVOutput refused the key, or null (the trigger
//                  fires once per refusal).
// The key is never written there.
// -----------------------------------------------------------------------------

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { emptyBudget } from './budget.js';

const DEFAULT_DIR = '/data';
const EMPTY = () => ({ budget: emptyBudget(), systems: {}, keyRefused: null, lastError: null });

/**
 * @description Read a JSON file; an absent or broken file is null.
 * @param {string} path - The file.
 * @param {object} [logger] - Logger.
 * @returns {Promise<object|null>} The value.
 */
async function readJson(path, logger) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger?.warn(`Unable to read ${path}: ${err.message}`);
    }
    return null;
  }
}

/**
 * @description Write a JSON file atomically (a temporary file, then a rename).
 * @param {string} path - The file.
 * @param {object} value - The value.
 * @param {object} [logger] - Logger.
 * @returns {Promise<void>}
 */
async function writeJson(path, value, logger) {
  try {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(value));
    await rename(temporary, path);
  } catch (err) {
    logger?.warn(`Unable to write ${path}: ${err.message}`);
  }
}

/**
 * @description The store.
 * @param {object} [options] - `{ dir, logger }`.
 * @returns {object} `{ data, load, save }`.
 */
function createStore({ dir = DEFAULT_DIR, logger } = {}) {
  const path = join(dir, 'pvoutput.json');
  let writing = Promise.resolve();
  const store = {
    data: EMPTY(),
    /**
     * @description Read the file.
     * @returns {Promise<void>}
     */
    async load() {
      const raw = (await readJson(path, logger)) ?? {};
      const base = EMPTY();
      const part = (value) => (value && typeof value === 'object' ? value : {});
      // Mutated in place: the budget keeps a reference to it.
      Object.assign(store.data.budget, base.budget, part(raw.budget));
      store.data.budget.log = Array.isArray(raw.budget?.log) ? raw.budget.log : [];
      store.data.systems = { ...part(raw.systems) };
      store.data.keyRefused = typeof raw.keyRefused === 'string' ? raw.keyRefused : null;
      store.data.lastError =
        raw.lastError && typeof raw.lastError === 'object' ? raw.lastError : null;
    },
    /**
     * @description Write the state (one write at a time).
     * @returns {Promise<void>}
     */
    save() {
      writing = writing.then(() => writeJson(path, store.data, logger));
      return writing;
    },
  };
  return store;
}

export { DEFAULT_DIR, createStore };
