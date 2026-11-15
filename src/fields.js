// -----------------------------------------------------------------------------
// What a Meteobridge reports, and how it lands in Gladys. Pure: no clock, no
// network.
//
// The tags are those of the official wiki ("Templates" page):
// `[<sensor>-<selector>:--]`. Without a converter, the gateway gives its own
// fixed metric units: °C, %, hPa, m/s, mm, mm/h, W/m², µg/m³. They are
// converted here, once, to the units the Gladys core lists for each category
// (DEVICE_FEATURE_UNITS_BY_CATEGORY of server/utils/constants.js): only the
// wind (m/s -> km/h) and the solar radiation (W/m² -> lux) change.
//
// The selector `act` is the most recent value, invalid once the sensor has
// not been heard for its hold time: the gateway then writes the replacement
// `--`, which stays unknown here (never 0). The rain of the day (`sumday`)
// is an aggregate that never goes invalid: it is published only while the
// rain gauge itself is current (`rain0total-act`, its gate).
//
// The feature key is a name of this integration (`temperature`,
// `rain_today`...), never a tag: it is part of the external id, so it never
// changes.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { DEVICE_TYPE, MAX_LINES } from './constants.js';

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

/** A plain decimal as the gateway writes it ("12.3", "-0.5"); anything else is unknown. */
export function parseNumber(text) {
  if (typeof text !== 'string' || !/^-?\d{1,7}(\.\d{1,4})?$/.test(text)) {
    return null;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

// --- Kinds: Gladys category, type, unit, bounds, conversion ---------------------
// The core lists no unit for `angle-sensor` and `battery-low`: the wind
// direction keeps its own `degree` unit (as the approved weather modules),
// the battery flag has none.

export const KINDS = {
  temperature: {
    category: CAT.TEMPERATURE_SENSOR,
    type: TYPES.SENSOR.DECIMAL,
    unit: UNITS.CELSIUS,
    min: -60,
    max: 70,
    convert: (v) => round(v, 1),
  },
  // An extra sensor is often a probe (pool, greenhouse, water tank): kept
  // out of the room temperature average of Gladys.
  probe: {
    category: CAT.TEMPERATURE_SENSOR,
    type: TYPES.TEMPERATURE_SENSOR.PROBE,
    unit: UNITS.CELSIUS,
    min: -60,
    max: 80,
    convert: (v) => round(v, 1),
  },
  humidity: {
    category: CAT.HUMIDITY_SENSOR,
    type: TYPES.SENSOR.DECIMAL,
    unit: UNITS.PERCENT,
    min: 0,
    max: 100,
    convert: (v) => round(v, 1),
  },
  pressure: {
    category: CAT.PRESSURE_SENSOR,
    type: TYPES.SENSOR.DECIMAL,
    unit: UNITS.HECTO_PASCAL,
    min: 500,
    max: 1100,
    convert: (v) => round(v, 1),
  },
  // m/s -> km/h.
  wind: {
    category: CAT.SPEED_SENSOR,
    type: TYPES.SPEED_SENSOR.DECIMAL,
    unit: UNITS.KILOMETER_PER_HOUR,
    min: 0,
    max: 400,
    convert: (v) => round(v * 3.6, 1),
  },
  direction: {
    category: CAT.ANGLE_SENSOR,
    type: TYPES.SENSOR.INTEGER,
    unit: UNITS.DEGREE,
    min: 0,
    max: 360,
    convert: (v) => Math.round(v),
  },
  rainRate: {
    category: CAT.PRECIPITATION_SENSOR,
    type: TYPES.PRECIPITATION_SENSOR.DECIMAL,
    unit: UNITS.MILLIMETER_PER_HOUR,
    min: 0,
    max: 2000,
    convert: (v) => round(v, 1),
  },
  // The rain since midnight (time of the gateway): a daily amount, in the
  // one daily unit the core lists for the category. It falls back to 0 at
  // midnight: not a lifetime counter.
  rainDay: {
    category: CAT.PRECIPITATION_SENSOR,
    type: TYPES.PRECIPITATION_SENSOR.DECIMAL,
    unit: UNITS.MILLIMETER_PER_DAY,
    min: 0,
    max: 2000,
    convert: (v) => round(v, 1),
  },
  uv: {
    category: CAT.UV_SENSOR,
    type: TYPES.UV_SENSOR.INTEGER,
    unit: UNITS.UV_INDEX,
    min: 0,
    max: 20,
    convert: (v) => Math.round(v),
  },
  // The core has no W/m² unit: the solar radiation is shown in lux, with the
  // usual daylight approximation (1 W/m² ≈ 126.6 lx, 1/0.0079), as the
  // approved WeatherLink and Ambient Weather modules do.
  solar: {
    category: CAT.LIGHT_SENSOR,
    type: TYPES.SENSOR.INTEGER,
    unit: UNITS.LUX,
    min: 0,
    max: 250_000,
    convert: (v) => Math.round(v / 0.0079),
  },
  pm25: {
    category: CAT.PM25_SENSOR,
    type: TYPES.SENSOR.DECIMAL,
    unit: UNITS.MICROGRAM_PER_CUBIC_METER,
    min: 0,
    max: 2000,
    convert: (v) => round(v, 1),
  },
  // Meteobridge: 0 = OK, 1 = low; Gladys: 1 = low. Anything else is unknown.
  batteryLow: {
    category: CAT.BATTERY_LOW,
    type: TYPES.BATTERY_LOW.BINARY,
    min: 0,
    max: 1,
    convert: (v) => (v === 0 || v === 1 ? v : NaN),
  },
};

/**
 * [feature key, tag, kind, feature name, gate tag?]: the order of the
 * features in Gladys. Extra sensors th1 to th8 only: th10 to th18 are Davis
 * soil and leaf stations, whose "humidity" is a soil moisture or a leaf
 * wetness (left out of this version).
 */
export const FIELDS = [
  ['temperature', 'th0temp-act', 'temperature', 'Outdoor temperature'],
  ['humidity', 'th0hum-act', 'humidity', 'Outdoor humidity'],
  ['dew_point', 'th0dew-act', 'temperature', 'Dew point'],
  ['indoor_temperature', 'thb0temp-act', 'temperature', 'Indoor temperature'],
  ['indoor_humidity', 'thb0hum-act', 'humidity', 'Indoor humidity'],
  ['pressure', 'thb0seapress-act', 'pressure', 'Pressure (sea level)'],
  ['pressure_station', 'thb0press-act', 'pressure', 'Pressure (station)'],
  ['wind_speed', 'wind0avgwind-act', 'wind', 'Wind speed (average)'],
  ['wind_gust', 'wind0wind-act', 'wind', 'Wind gust'],
  ['wind_direction', 'wind0dir-act', 'direction', 'Wind direction'],
  ['wind_chill', 'wind0chill-act', 'temperature', 'Wind chill'],
  ['rain_rate', 'rain0rate-act', 'rainRate', 'Rain rate'],
  ['rain_today', 'rain0total-sumday', 'rainDay', 'Rain today', 'rain0total-act'],
  ['uv_index', 'uv0index-act', 'uv', 'UV index'],
  ['solar_radiation', 'sol0rad-act', 'solar', 'Solar radiation'],
  ['pm25', 'air0pm-act', 'pm25', 'PM2.5'],
  ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => [
    [`extra_temperature_${n}`, `th${n}temp-act`, 'probe', `Extra temperature ${n}`],
    [`extra_humidity_${n}`, `th${n}hum-act`, 'humidity', `Extra humidity ${n}`],
  ]),
  ['battery_low_outdoor', 'th0lowbat-act', 'batteryLow', 'Battery low (outdoor sensor)'],
  ['battery_low_wind', 'wind0lowbat-act', 'batteryLow', 'Battery low (anemometer)'],
  ['battery_low_rain', 'rain0lowbat-act', 'batteryLow', 'Battery low (rain gauge)'],
  ['battery_low_console', 'thb0lowbat-act', 'batteryLow', 'Battery low (console)'],
];

export const FIELD_KEYS = new Set(FIELDS.map(([key]) => key));

/** The system variables read with the values (identity and names). */
export const SYSTEM = {
  mac: 'mbsystem-mac',
  platform: 'mbsystem-platform',
  station: 'mbsystem-station',
  version: 'mbsystem-swversion',
};

/** The first line of the template: an answer without it is not ours. */
export const MARKER = 'gladys-meteobridge=1';

/** Every tag read, each once: [line key, tag]. Line keys are short (a URL of ~1.5 KB). */
export function templateTags() {
  const tags = [];
  const seen = new Set();
  const add = (tag) => {
    if (!seen.has(tag)) {
      seen.add(tag);
      tags.push([`v${tags.length}`, tag]);
    }
  };
  for (const tag of Object.values(SYSTEM)) {
    add(tag);
  }
  for (const [, tag, , , gate] of FIELDS) {
    add(tag);
    if (gate) {
      add(gate);
    }
  }
  return tags;
}

/** The template text: the marker, then one `key=[tag:--]` line per tag. */
export function templateText() {
  return [MARKER, ...templateTags().map(([key, tag]) => `${key}=[${tag}:--]`)].join('\n');
}

/** Printable ASCII only, trimmed and bounded (a name, never a value). */
const label = (text, max) =>
  typeof text === 'string' && text !== '--' && /^[\x20-\x7e]*$/.test(text)
    ? text.trim().slice(0, max)
    : '';

/** "00:24:A5:B3:12:34" -> "0024a5b31234"; anything else -> null. */
export function parseMac(text) {
  if (typeof text !== 'string') {
    return null;
  }
  const hex = text.trim().replace(/[:-]/g, '').toLowerCase();
  return /^[0-9a-f]{12}$/.test(hex) && !/^0{12}$|^f{12}$/.test(hex) ? hex : null;
}

/**
 * The filled template -> `{ ok: true, mac, platform, station, version,
 * values }` or `{ ok: false, why }` (`marker`: not the answer of this
 * template; `identity`: no readable MAC address). `values` holds the usable
 * values only: converted, rounded, within the bounds.
 */
export function parseAnswer(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/, MAX_LINES)
    .map((l) => l.replace(/\r$/, ''));
  if (lines[0]?.trim() !== MARKER) {
    return { ok: false, why: 'marker' };
  }
  const byKey = new Map();
  for (const line of lines.slice(1)) {
    const eq = line.indexOf('=');
    if (eq < 1) {
      continue;
    }
    const key = line.slice(0, eq);
    if (/^v\d{1,3}$/.test(key) && !byKey.has(key)) {
      byKey.set(key, line.slice(eq + 1).trim());
    }
  }
  const byTag = new Map(templateTags().map(([key, tag]) => [tag, byKey.get(key)]));
  const mac = parseMac(byTag.get(SYSTEM.mac));
  if (!mac) {
    return { ok: false, why: 'identity' };
  }
  const values = {};
  for (const [key, tag, kindName, , gate] of FIELDS) {
    if (gate && parseNumber(byTag.get(gate)) === null) {
      continue;
    }
    const raw = parseNumber(byTag.get(tag));
    if (raw === null) {
      continue;
    }
    const kind = KINDS[kindName];
    const value = kind.convert(raw);
    // A value out of the bounds is left out, never clamped into a false reading.
    if (Number.isFinite(value) && value >= kind.min && value <= kind.max) {
      values[key] = value;
    }
  }
  return {
    ok: true,
    mac,
    platform: label(byTag.get(SYSTEM.platform), 40),
    station: label(byTag.get(SYSTEM.station), 60),
    version: label(byTag.get(SYSTEM.version), 20),
    values,
  };
}

// --- Gladys devices and states ------------------------------------------------------

const idsOf = (gladys, mac) => gladys.externalIds(DEVICE_TYPE, mac);

/** The device name: "Meteobridge" and the station type when known. */
export const gatewayName = ({ station, platform }) =>
  station ? `Meteobridge ${station}` : platform ? `Meteobridge ${platform}` : 'Meteobridge';

const featureOf = (ids, key, kindName, name) => {
  const kind = KINDS[kindName];
  return {
    name,
    external_id: ids.feature(key),
    category: kind.category,
    type: kind.type,
    ...(kind.unit ? { unit: kind.unit } : {}),
    min: kind.min,
    max: kind.max,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  };
};

/**
 * The Gladys device of a gateway: every feature it has ever given, plus
 * every feature of the device already created (a sensor out of range never
 * removes a feature: the core would mark the device as changed and "Update"
 * would drop its history).
 */
export function deviceOf(gladys, { mac, name, fields }) {
  const ids = idsOf(gladys, mac);
  const created = (gladys.devices ?? []).find((d) => d.external_id === ids.device);
  const createdFeatures = created?.features ?? [];
  const createdIds = new Set(createdFeatures.map((f) => f.external_id));
  const features = FIELDS.filter(
    ([key]) => fields.has(key) || createdIds.has(ids.feature(key)),
  ).map(([key, , kindName, featureName]) => featureOf(ids, key, kindName, featureName));
  const prefix = `${ids.device}:`;
  for (const feature of createdFeatures) {
    const id = String(feature.external_id ?? '');
    const key = id.startsWith(prefix) ? id.slice(prefix.length) : '';
    if (key && !FIELD_KEYS.has(key)) {
      features.push({
        name: feature.name,
        external_id: feature.external_id,
        category: feature.category,
        type: feature.type,
        ...(feature.unit ? { unit: feature.unit } : {}),
        min: feature.min,
        max: feature.max,
        read_only: true,
        has_feedback: false,
        keep_history: feature.keep_history !== false,
      });
    }
  }
  return {
    name,
    external_id: ids.device,
    // The integration reads the gateway at its own pace: Gladys has nothing to poll.
    should_poll: false,
    features,
  };
}

/** The states of a reading, for the publishStates format. */
export function statesOf(gladys, { mac, values }) {
  const ids = idsOf(gladys, mac);
  return FIELDS.filter(([key]) => typeof values?.[key] === 'number').map(([key]) => ({
    device_feature_external_id: ids.feature(key),
    state: values[key],
  }));
}
