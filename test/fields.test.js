// -----------------------------------------------------------------------------
// The template and its answer: pure functions, no clock, no network.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELDS,
  MARKER,
  parseAnswer,
  parseMac,
  parseNumber,
  templateTags,
  templateText,
} from '../src/fields.js';
import { templateUrl } from '../src/meteobridge.js';
import { SENSORS, fill } from './helpers/gateway.js';

test('numbers: plain decimals only; anything else is unknown, never 0', () => {
  assert.equal(parseNumber('12.3'), 12.3);
  assert.equal(parseNumber('-0.5'), -0.5);
  assert.equal(parseNumber('0'), 0);
  for (const bad of [
    '',
    ' ',
    '--',
    '12,3',
    '1e3',
    '0x10',
    'NaN',
    'Infinity',
    '+1',
    '1.',
    '.5',
    null,
    undefined,
    3,
  ]) {
    assert.equal(parseNumber(bad), null, String(bad));
  }
});

test('MAC addresses: 12 hex digits, separators dropped; empty, all-zero, broadcast refused', () => {
  assert.equal(parseMac('00:24:A5:B3:12:34'), '0024a5b31234');
  assert.equal(parseMac('00-24-a5-b3-12-34'), '0024a5b31234');
  for (const bad of [
    '--',
    '',
    '00:00:00:00:00:00',
    'FF:FF:FF:FF:FF:FF',
    '00:24:A5:B3:12',
    '../etc',
    null,
  ]) {
    assert.equal(parseMac(bad), null, String(bad));
  }
});

test('the template: the marker, each tag once with the "--" replacement, a short URL', () => {
  const text = templateText();
  const lines = text.split('\n');
  assert.equal(lines[0], MARKER);
  const tags = templateTags().map(([, tag]) => tag);
  assert.equal(new Set(tags).size, tags.length);
  for (const [, tag, , , gate] of FIELDS) {
    assert.ok(tags.includes(tag) && (!gate || tags.includes(gate)));
  }
  for (const line of lines.slice(1)) {
    assert.match(line, /^v\d+=\[[a-z0-9*!]+-[a-z0-9]+:--\]$/);
  }
  // No soil or leaf station (th10 to th18): their "humidity" is not a humidity.
  assert.ok(!tags.some((t) => /^th1\d/.test(t)));
  assert.ok(templateUrl('192.168.1.50').length < 2000);
});

test('the answer: values converted and bounded; marker and identity required', () => {
  const answer = parseAnswer(fill(templateText(), SENSORS));
  assert.equal(answer.ok, true);
  assert.equal(answer.mac, '0024a5b31234');
  assert.equal(answer.station, 'Vantage');
  assert.equal(answer.values.wind_speed, 9);
  assert.equal(answer.values.solar_radiation, 50633);
  assert.equal(answer.values.battery_low_rain, 1);
  assert.equal(answer.values.pm25, undefined);
  assert.deepEqual(parseAnswer('<html></html>'), { ok: false, why: 'marker' });
  assert.deepEqual(parseAnswer(fill(templateText(), {})), { ok: false, why: 'identity' });
  // CRLF line ends are read too.
  assert.equal(
    parseAnswer(fill(templateText(), SENSORS).replace(/\n/g, '\r\n')).values.temperature,
    12.3,
  );
});

test('the answer: a later duplicate line, a __proto__ line or an unknown key changes nothing', () => {
  const body = `${fill(templateText(), SENSORS)}\nv4=99.9\n__proto__=1\nconstructor=2`;
  const answer = parseAnswer(body);
  assert.equal(answer.values.temperature, 12.3);
  assert.equal({}.polluted, undefined);
});

test('the answer: a name with a control or non-ASCII character is dropped, a long one cut', () => {
  const answer = parseAnswer(
    fill(templateText(), {
      ...SENSORS,
      'mbsystem-station': 'Vantage\u0007',
      'mbsystem-platform': 'x'.repeat(99),
    }),
  );
  assert.equal(answer.station, '');
  assert.equal(answer.platform.length, 40);
});

test('a humidity of 0 % is a console without a sensor: unknown; a wind direction of 0 is north', () => {
  const answer = parseAnswer(
    fill(templateText(), { ...SENSORS, 'th0hum-act': '0.0', 'wind0dir-act': '0.0' }),
  );
  assert.equal(answer.values.humidity, undefined);
  assert.equal(answer.values.wind_direction, 0);
});

test('the bounds: a value out of range is left out, never clamped', () => {
  const answer = parseAnswer(
    fill(templateText(), {
      ...SENSORS,
      'th0temp-act': '99.0',
      'th0hum-act': '101.0',
      'wind0dir-act': '361.0',
      'thb0seapress-act': '1200.0',
      'uv0index-act': '-1.0',
    }),
  );
  for (const key of ['temperature', 'humidity', 'wind_direction', 'pressure', 'uv_index']) {
    assert.equal(answer.values[key], undefined, key);
  }
});
