// -----------------------------------------------------------------------------
// Configuration of the PVOutput integration.
//
// Fields of the config_schema:
//   - `api_key`     the API key of the PVOutput account (a `secret`: never sent
//                   back to the UI, never logged). A read only key reads; the
//                   standard key is needed to send statuses and outputs;
//   - `system_ids`  the System Id of each system to follow, separated by
//                   commas ("12345" or "12345, 67890"), five at most: the key
//                   of an account serves its systems;
//   - `donation`    the account is in donation mode: 300 requests an hour
//                   instead of 60 (the answers of PVOutput correct a wrong tick);
//   - `language`    language of the texts Gladys does not ask for in a
//                   language (feature names, scene texts): `auto` follows the
//                   language of the last widget, or the timezone.
//
// Internal key, outside the config_schema (never shown in the UI):
//   - `last_language` language of the last widget request.
// -----------------------------------------------------------------------------

import { isLanguage } from './i18n.js';

const MAX_SYSTEMS = 5;
const AUTO_LANGUAGE = 'auto';
const INTERNAL_KEYS = { language: 'last_language' };

const readString = (raw) =>
  typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';

/**
 * @description Read a boolean of the configuration ("true", true, 1).
 * @param {unknown} raw - The value.
 * @returns {boolean} The boolean.
 */
const readBoolean = (raw) => raw === true || raw === 1 || /^(true|1|yes|on)$/i.test(String(raw));

/**
 * @description Read the System Ids typed by the user.
 * @param {unknown} raw - "12345, 67890", "12345;67890", 12345.
 * @returns {{ ids: string[], invalid: string[], extra: string[] }} The valid ids
 * (five at most, no duplicate), the parts that are not an id, the ids past five.
 * @example
 * readSystemIds(' 12345 , 67890 '); // -> { ids: ['12345', '67890'], invalid: [], extra: [] }
 */
function readSystemIds(raw) {
  const parts = readString(raw)
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const ids = [];
  const invalid = [];
  for (const part of parts) {
    const id = part.replace(/^#/, '');
    if (!/^\d{1,9}$/.test(id) || Number(id) === 0) {
      invalid.push(part.slice(0, 20));
    } else if (!ids.includes(String(Number(id)))) {
      ids.push(String(Number(id)));
    }
  }
  return { ids: ids.slice(0, MAX_SYSTEMS), invalid, extra: ids.slice(MAX_SYSTEMS) };
}

/**
 * @description Normalize the raw config object from the host API.
 * @param {object} [rawConfig] - The raw config values.
 * @returns {object} `{ apiKey, systemIds, invalidIds, extraIds, donation, language }`.
 * @example
 * normalizeConfig({ api_key: 'k', system_ids: '12345' });
 */
function normalizeConfig(rawConfig = {}) {
  const config = rawConfig ?? {};
  const { ids, invalid, extra } = readSystemIds(config.system_ids);
  return {
    apiKey: readString(config.api_key),
    systemIds: ids,
    invalidIds: invalid,
    extraIds: extra,
    donation: readBoolean(config.donation),
    language: isLanguage(config.language) ? config.language : AUTO_LANGUAGE,
  };
}

// The timezones of the countries that speak the languages of the integration:
// the automatic language before any widget was shown.
const TIMEZONE_LANGUAGES = {
  fr: [
    'Europe/Paris',
    'Europe/Monaco',
    'Europe/Brussels',
    'Europe/Luxembourg',
    'Indian/Reunion',
    'Indian/Mayotte',
    'America/Guadeloupe',
    'America/Martinique',
    'America/Cayenne',
    'America/Miquelon',
    'Pacific/Noumea',
    'Pacific/Tahiti',
    'America/Montreal',
    'Africa/Abidjan',
    'Africa/Dakar',
    'Africa/Casablanca',
    'Africa/Algiers',
    'Africa/Tunis',
  ],
  de: ['Europe/Berlin', 'Europe/Busingen', 'Europe/Vienna', 'Europe/Zurich', 'Europe/Vaduz'],
  es: [
    'Europe/Madrid',
    'Atlantic/Canary',
    'Africa/Ceuta',
    'America/Mexico_City',
    'America/Bogota',
    'America/Lima',
    'America/Santiago',
    'America/Caracas',
    'America/Montevideo',
    'America/Asuncion',
    'America/La_Paz',
    'America/Guayaquil',
    'America/Havana',
    'America/Costa_Rica',
    'America/Panama',
  ],
};

/**
 * @description The language of the texts guessed from a timezone, before
 * any widget was shown.
 * @param {string} timezone - IANA timezone of Gladys.
 * @returns {string} en, fr, de or es.
 * @example
 * guessLanguage('Europe/Paris'); // -> 'fr'
 */
function guessLanguage(timezone) {
  const zone = String(timezone ?? '');
  if (zone.startsWith('America/Argentina/')) {
    return 'es';
  }
  const found = Object.entries(TIMEZONE_LANGUAGES).find(([, zones]) => zones.includes(zone));
  return found ? found[0] : 'en';
}

/**
 * @description Read the stored language of the last widget request.
 * @param {object} [rawConfig] - The raw config values.
 * @param {string} fallback - The language to keep when nothing valid is stored.
 * @returns {string} The language.
 */
function readLanguage(rawConfig, fallback) {
  const language = (rawConfig ?? {})[INTERNAL_KEYS.language];
  return isLanguage(language) ? language : fallback;
}

export {
  MAX_SYSTEMS,
  AUTO_LANGUAGE,
  INTERNAL_KEYS,
  readBoolean,
  readSystemIds,
  normalizeConfig,
  guessLanguage,
  readLanguage,
};
