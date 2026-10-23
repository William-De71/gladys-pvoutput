// -----------------------------------------------------------------------------
// Sunrise and sunset at the location of a system, from the equations of the
// NOAA solar calculator (https://gml.noaa.gov/grad/solcalc/calcdetails.html),
// accurate to a minute or two away from the poles, without a dependency.
//
// The inverters publish nothing at night: the night spaces out the readings
// and never makes a system "silent"; the end of the day times the daily
// summary. The day of a system is its local calendar day (time.js).
// -----------------------------------------------------------------------------

import { localParts, toInstant, MINUTE_MS, HOUR_MS } from './time.js';

const RAD = Math.PI / 180;
// The sun is "up" once its upper edge crosses the horizon, refraction included.
const ZENITH = 90.833;

/**
 * @description The position of the sun for a Julian century: its declination
 * and the equation of time.
 * @param {number} t - Julian centuries since J2000.0.
 * @returns {{ declination: number, equationOfTime: number }} Degrees and minutes.
 */
function solarPosition(t) {
  const meanLongitude = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const center =
    Math.sin(meanAnomaly * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * meanAnomaly * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * meanAnomaly * RAD) * 0.000289;
  const trueLongitude = meanLongitude + center;
  const omega = 125.04 - 1934.136 * t;
  const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const meanObliquity =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * RAD);
  const declination =
    Math.asin(Math.sin(obliquity * RAD) * Math.sin(apparentLongitude * RAD)) / RAD;
  const y = Math.tan((obliquity / 2) * RAD) ** 2;
  const equationOfTime =
    (4 *
      (y * Math.sin(2 * meanLongitude * RAD) -
        2 * eccentricity * Math.sin(meanAnomaly * RAD) +
        4 * eccentricity * y * Math.sin(meanAnomaly * RAD) * Math.cos(2 * meanLongitude * RAD) -
        0.5 * y * y * Math.sin(4 * meanLongitude * RAD) -
        1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomaly * RAD))) /
    RAD;
  return { declination, equationOfTime };
}

/**
 * @description Julian centuries since J2000.0 of an instant.
 * @param {number} instant - The instant (ms).
 * @returns {number} The centuries.
 */
const centuries = (instant) => (instant / 86400000 + 2440587.5 - 2451545) / 36525;

/**
 * @description Sunrise, solar noon and sunset of a local calendar day.
 * @param {string} date - The local day, "20261023".
 * @param {number} latitude - Degrees, north positive.
 * @param {number} longitude - Degrees, east positive.
 * @param {string} timeZone - The timezone of the day.
 * @returns {{ sunrise: number|null, noon: number, sunset: number|null, polar: string|null }}
 * Instants (ms); `polar` is `night` (the sun never rises) or `day` (it never
 * sets), with no sunrise nor sunset then.
 */
function sunTimes(date, latitude, longitude, timeZone) {
  // Two passes: the second one at the solar noon found by the first.
  let noon = toInstant(date, '12:00', timeZone);
  let position = solarPosition(centuries(noon));
  const midnightUtc = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)),
  );
  for (let pass = 0; pass < 2; pass += 1) {
    const noonMinutes = 720 - 4 * longitude - position.equationOfTime;
    noon = midnightUtc + noonMinutes * MINUTE_MS;
    // Keep the solar noon on the local day asked for (far east / far west).
    const local = localParts(noon, timeZone).date;
    if (local < date) noon += 24 * HOUR_MS;
    if (local > date) noon -= 24 * HOUR_MS;
    position = solarPosition(centuries(noon));
  }
  const cosHourAngle =
    Math.cos(ZENITH * RAD) / (Math.cos(latitude * RAD) * Math.cos(position.declination * RAD)) -
    Math.tan(latitude * RAD) * Math.tan(position.declination * RAD);
  if (cosHourAngle > 1) {
    return { sunrise: null, noon, sunset: null, polar: 'night' };
  }
  if (cosHourAngle < -1) {
    return { sunrise: null, noon, sunset: null, polar: 'day' };
  }
  const halfDay = (Math.acos(cosHourAngle) / RAD) * 4 * MINUTE_MS;
  return {
    sunrise: Math.round(noon - halfDay),
    noon: Math.round(noon),
    sunset: Math.round(noon + halfDay),
    polar: null,
  };
}

/**
 * @description The sun at an instant at a place: up or not, and the times of its local day.
 * @param {number} instant - The instant (ms).
 * @param {object} place - `{ latitude, longitude, timeZone }`.
 * @returns {{ date: string, day: boolean, sunrise: number|null, sunset: number|null,
 * polar: string|null }|null} Null without a location.
 */
function sunAt(instant, { latitude, longitude, timeZone }) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  const { date } = localParts(instant, timeZone);
  const times = sunTimes(date, latitude, longitude, timeZone);
  const day =
    times.polar === 'day' ||
    (times.polar === null && instant >= times.sunrise && instant < times.sunset);
  return { date, day, sunrise: times.sunrise, sunset: times.sunset, polar: times.polar };
}

export { sunTimes, sunAt, solarPosition };
