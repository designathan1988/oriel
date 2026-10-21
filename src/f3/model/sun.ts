// Sun position on the forma/3 scene frame (pure: no three, no Date.now).
//
// Sources
// ───────
// NOAA Solar Calculator, Global Monitoring Laboratory:
// https://gml.noaa.gov/grad/solcalc/ — the equations of the "NOAA Solar
// Calculations Details" spreadsheet: Julian day, geometric mean longitude and
// anomaly of the sun, equation of the centre, apparent longitude, mean
// obliquity of the ecliptic, declination, equation of time, true solar time,
// hour angle, zenith and azimuth.
//
// Conventions (see model/schema.ts): meters, Y up, plan in [x, z], degrees.
// Azimuth is measured from true north, clockwise seen from above. True north is
// `north` degrees clockwise from the scene −Z axis, east is +X, so the unit
// vector toward the sun is
//   dir = [cos(alt)·sin(az + north), sin(alt), −cos(alt)·cos(az + north)].
import type { Vec3 } from './schema';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Refraction plus the sun's radius: the sun is "up" at a zenith of 90.833° (NOAA). */
const SUNRISE_ZENITH = 90.833;

export interface SunDate {
  year: number;
  month: number;
  day: number;
}

export interface SunLocation {
  /** Day; a `Date` is read in UTC (its time of day is ignored). */
  date: Date | SunDate;
  /** Latitude in degrees, positive to the north. */
  latitude: number;
  /** Longitude in degrees, positive to the east. */
  longitude: number;
  /** Clock offset from UTC in hours (e.g. −3 for São Paulo, +9 for Tokyo). */
  utcOffset: number;
}

export interface SunOptions extends SunLocation {
  /** Clock hours 0–24 in the zone of `utcOffset` (12 with longitude = 15·utcOffset is solar noon). */
  hour: number;
  /** True north: degrees clockwise from the scene −Z axis (0 = −Z is north). */
  north: number;
}

export interface SunPosition {
  /** Degrees from true north, clockwise seen from above. */
  azimuth: number;
  /** Degrees above the horizon (negative = below). */
  altitude: number;
  /** Unit vector toward the sun in the scene frame (x east-ish, y up, z south-ish). */
  dir: Vec3;
}

export interface SunTimes {
  /** Sunrise in local clock hours; NaN on a polar day or night. */
  sunrise: number;
  /** Sunset in local clock hours; NaN on a polar day or night. */
  sunset: number;
  /** Hours of daylight (0 or 24 on a polar day or night). */
  dayLength: number;
  /** 'day': the sun never sets, 'night': it never rises, null: a normal day. */
  polar: 'day' | 'night' | null;
}

export interface SunPreset {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  utcOffset: number;
}

const deg = (d: number) => d * RAD;
const undeg = (r: number) => r * DEG;
const norm360 = (d: number) => ((d % 360) + 360) % 360;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Julian day of a Gregorian date at 0h UT plus `hours` (Meeus, Astronomical Algorithms, ch. 7). */
function julianDay(date: SunDate, hours = 0): number {
  let y = date.year;
  let m = date.month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + date.day + b - 1524.5 + hours / 24;
}

function dateParts(d: Date | SunDate): SunDate {
  return d instanceof Date ? { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() } : d;
}

interface SolarTerms {
  /** Equation of time (minutes). */
  eqTime: number;
  /** Declination of the sun (degrees). */
  decl: number;
}

/** NOAA solar terms for a Julian century `t`. */
function solarTerms(t: number): SolarTerms {
  // Geometric mean longitude of the sun (degrees).
  const l0 = norm360(280.46646 + t * (36000.76983 + t * 0.0003032));
  // Geometric mean anomaly of the sun (degrees).
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  // Eccentricity of the earth's orbit.
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  // Equation of the centre (degrees).
  const c =
    Math.sin(deg(m)) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(deg(2 * m)) * (0.019993 - 0.000101 * t) +
    Math.sin(deg(3 * m)) * 0.000289;
  // Apparent longitude of the sun (degrees): true longitude corrected for nutation and aberration.
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(deg(omega));
  // Mean obliquity of the ecliptic and its correction (degrees).
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(deg(omega));
  // Declination of the sun (degrees).
  const decl = undeg(Math.asin(clamp(Math.sin(deg(eps)) * Math.sin(deg(lambda)), -1, 1)));
  // Equation of time (minutes): the same terms in the form given by NOAA.
  const y = Math.tan(deg(eps / 2)) ** 2;
  const eqTime =
    4 *
    DEG *
    (y * Math.sin(2 * deg(l0)) -
      2 * e * Math.sin(deg(m)) +
      4 * e * y * Math.sin(deg(m)) * Math.cos(2 * deg(l0)) -
      0.5 * y * y * Math.sin(4 * deg(l0)) -
      1.25 * e * e * Math.sin(2 * deg(m)));
  return { eqTime, decl };
}

/** Sun azimuth and altitude for an instant; deterministic (no clock is read). */
export function sunPosition(o: SunOptions): SunPosition {
  const day = dateParts(o.date);
  const t = (julianDay(day, o.hour - o.utcOffset) - 2451545) / 36525;
  const { eqTime, decl } = solarTerms(t);
  // True solar time (minutes from local midnight) and hour angle (0° at solar noon, + in the afternoon).
  const tst = (((o.hour * 60 + eqTime + 4 * o.longitude - 60 * o.utcOffset) % 1440) + 1440) % 1440;
  const ha = tst / 4 - 180;
  const lat = deg(o.latitude);
  const d = deg(decl);
  // Zenith and altitude (degrees).
  const cosZenith = Math.sin(lat) * Math.sin(d) + Math.cos(lat) * Math.cos(d) * Math.cos(deg(ha));
  const zenith = undeg(Math.acos(clamp(cosZenith, -1, 1)));
  const altitude = 90 - zenith;
  // Azimuth from north, clockwise: NOAA takes the morning (ha < 0) and the afternoon (ha > 0)
  // from opposite sides of the meridian.
  const sinZenith = Math.sin(deg(zenith));
  const cosLat = Math.cos(lat);
  let azimuth: number;
  if (sinZenith < 1e-6 || Math.abs(cosLat) < 1e-9) {
    // The sun is (almost) overhead, or the site is a pole: the azimuth is undefined; fall back to
    // the meridian side of the hour angle.
    azimuth = ha >= 0 ? 180 : 0;
  } else {
    const cosAz = clamp((Math.sin(lat) * Math.cos(deg(zenith)) - Math.sin(d)) / (cosLat * sinZenith), -1, 1);
    const a = undeg(Math.acos(cosAz));
    azimuth = ha > 0 ? (a + 180) % 360 : norm360(540 - a);
  }
  // Scene vector: north is the −Z axis turned `north` degrees clockwise (east = +X).
  const alt = deg(altitude);
  const az = deg(azimuth + o.north);
  const dir: Vec3 = [Math.cos(alt) * Math.sin(az), Math.sin(alt), -Math.cos(alt) * Math.cos(az)];
  return { azimuth: norm360(azimuth), altitude, dir };
}

/** Sunrise and sunset in local clock hours (NOAA; NaN on a polar day or night). */
export function sunriseSunset(o: SunLocation): SunTimes {
  const day = dateParts(o.date);
  // NOAA uses the solar terms of the day (0h UT), not of the instant.
  const { eqTime, decl } = solarTerms((julianDay(day, 0) - 2451545) / 36525);
  // Solar noon in local clock minutes.
  const noon = 720 - 4 * o.longitude - eqTime + 60 * o.utcOffset;
  const lat = deg(o.latitude);
  const d = deg(decl);
  const den = Math.cos(lat) * Math.cos(d);
  if (Math.abs(den) < 1e-9) return { sunrise: NaN, sunset: NaN, dayLength: lat > 0 ? 0 : 24, polar: lat > 0 ? 'night' : 'day' };
  const x = Math.cos(deg(SUNRISE_ZENITH)) / den - Math.tan(lat) * Math.tan(d);
  if (x > 1) return { sunrise: NaN, sunset: NaN, dayLength: 0, polar: 'night' };
  if (x < -1) return { sunrise: NaN, sunset: NaN, dayLength: 24, polar: 'day' };
  const ha = undeg(Math.acos(x));
  const sunrise = (noon - 4 * ha) / 60;
  const sunset = (noon + 4 * ha) / 60;
  return { sunrise, sunset, dayLength: sunset - sunrise, polar: null };
}

/** A few cities, ready to fill a "sun" panel. */
export const SUN_PRESETS: readonly SunPreset[] = [
  { id: 'sao-paulo', name: 'São Paulo', latitude: -23.55, longitude: -46.63, utcOffset: -3 },
  { id: 'rio', name: 'Rio de Janeiro', latitude: -22.91, longitude: -43.17, utcOffset: -3 },
  { id: 'lisbon', name: 'Lisbon', latitude: 38.72, longitude: -9.14, utcOffset: 0 },
  { id: 'new-york', name: 'New York', latitude: 40.71, longitude: -74.01, utcOffset: -5 },
  { id: 'london', name: 'London', latitude: 51.51, longitude: -0.13, utcOffset: 0 },
  { id: 'tokyo', name: 'Tokyo', latitude: 35.68, longitude: 139.69, utcOffset: 9 },
];
