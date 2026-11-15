// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys, a fake Meteobridge and a test
// clock that moves on its own (every read of the clock advances it).
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { MIN_GAP, MeteobridgeApp, tagOf } from '../src/app.js';
import { normalizeConfig } from '../src/config.js';
import { ACTION_TEST, HOUR, MINUTE, PAUSE_MAX, SECOND } from '../src/constants.js';
import { FIELDS, deviceOf } from '../src/fields.js';
import { createClock } from './helpers/clock.js';
import {
  ADDRESS,
  CONFIG,
  MAC,
  PASSWORD,
  USER,
  fill,
  installFetch,
  text,
} from './helpers/gateway.js';

const START = Date.parse('2026-11-15T10:00:00Z');
const F = (key, mac = MAC) => `ext:meteobridge:gateway:${mac}:${key}`;

let gw;
afterEach(() => gw?.restore());

function memoryLogger() {
  const lines = [];
  const log =
    (level) =>
    (...args) =>
      lines.push(`${level} ${args.map(String).join(' ')}`);
  return { lines, info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') };
}

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'meteobridge-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The device as the user created it from the Discovery tab (every field). */
function createdDevice(mac = MAC) {
  const gladys = createFakeGladys({ selector: 'meteobridge' });
  return deviceOf(gladys, { mac, name: 'Meteobridge', fields: new Set(FIELDS.map(([k]) => k)) });
}

async function setup(
  t,
  {
    config = CONFIG,
    dir,
    devices = [],
    clock = createClock(START),
    fs,
    connect = true,
    listen = true,
  } = {},
) {
  const dataDir = dir ?? tempDir(t);
  const gladys = createFakeGladys({ selector: 'meteobridge', config, devices });
  const logger = memoryLogger();
  const app = new MeteobridgeApp({
    gladys,
    logger,
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    dataDir,
    fs,
  });
  clock.waitFor = () => app.reading;
  // The wiring of index.js.
  gladys.onScanRequest(() => app.publishDiscovered({ force: true }));
  gladys.onDeviceCreated(() => app.publishStates());
  gladys.onAction(ACTION_TEST, () => app.testConnection());
  gladys.onConfigUpdated((c) => app.start(c));
  if (listen) gladys.on('connected', () => app.connected());
  gladys.on('disconnected', () => app.stop());
  t.after(() => app.stop());
  if (connect) {
    await gladys.connect();
    await app.reading;
    await clock.settle();
  }
  return { app, gladys, clock, dataDir, logger };
}

const status = (gladys) => gladys.fake.connectionStatus;
const stateFile = (dir) => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));

// --- First read ---------------------------------------------------------------------

test('the first read: one device per gateway, the fields it gave, values in core units', async (t) => {
  gw = installFetch();
  const { gladys } = await setup(t);
  assert.equal(gw.calls.length, 1);
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, `ext:meteobridge:gateway:${MAC}`);
  assert.equal(device.name, 'Meteobridge Vantage');
  assert.equal(device.should_poll, false);
  const keys = device.features.map((f) => f.external_id.split(':').pop());
  assert.ok(keys.includes('temperature') && keys.includes('battery_low_rain'));
  assert.ok(!keys.includes('pm25'), 'a sensor never given has no feature');
  assert.ok(!keys.includes('extra_temperature_2'));
  await gladys.fake.deviceCreated(createdDevice());
  assert.equal(gladys.fake.lastState(F('temperature')), 12.3);
  assert.equal(gladys.fake.lastState(F('wind_speed')), 9, '2.5 m/s = 9 km/h');
  assert.equal(gladys.fake.lastState(F('wind_gust')), 22);
  assert.equal(gladys.fake.lastState(F('wind_direction')), 263);
  assert.equal(gladys.fake.lastState(F('solar_radiation')), 50633, '400 W/m² in lux');
  assert.equal(gladys.fake.lastState(F('pressure')), 1018.6);
  assert.equal(gladys.fake.lastState(F('rain_today')), 3.4);
  assert.equal(gladys.fake.lastState(F('battery_low_rain')), 1);
  assert.equal(gladys.fake.lastState(F('battery_low_outdoor')), 0);
  assert.equal(gladys.fake.lastState(F('extra_temperature_1')), 24.8);
  assert.equal(gladys.fake.lastState(F('pm25')), undefined);
  assert.equal(status(gladys).connected, true);
  assert.match(
    status(gladys).message.en,
    /Meteobridge Vantage: \d+ recent value\(s\), read every 1 min/,
  );
});

test('the request: the template page, Basic authentication, the password never in the URL', async (t) => {
  gw = installFetch();
  await setup(t);
  const [call] = gw.calls;
  const url = new URL(call.url);
  assert.equal(url.origin, `http://${ADDRESS}`);
  assert.equal(url.pathname, '/cgi-bin/template.cgi');
  assert.equal(url.searchParams.get('contenttype'), 'text/plain');
  assert.ok(!call.url.includes(PASSWORD));
  assert.equal(
    call.init.headers.Authorization,
    `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`,
  );
  assert.match(
    call.init.headers['User-Agent'],
    /^gladys-meteobridge\/0\.1\.0 \(\+https:\/\/github\.com\/LM1LC3N7\/gladys-meteobridge\)$/,
  );
  assert.equal(call.init.redirect, 'manual');
  assert.equal(call.init.method, undefined, 'GET only');
  assert.match(call.template, /^gladys-meteobridge=1\n/);
  assert.match(call.template, /=\[th0temp-act:--\]/);
});

test('a created device gets the current values at once; nothing for a device not created', async (t) => {
  gw = installFetch();
  const { gladys } = await setup(t);
  assert.equal(gladys.fake.states.length, 0, 'no device created yet');
  await gladys.fake.deviceCreated(createdDevice());
  assert.equal(gladys.fake.lastState(F('temperature')), 12.3);
});

// --- Unknown values ------------------------------------------------------------------

test('"--", text, a comma or an empty value is unknown, never 0; out of bounds left out', async (t) => {
  gw = installFetch();
  Object.assign(gw.sensors, {
    'th0temp-act': '--',
    'th0hum-act': '',
    'thb0temp-act': 'Aus',
    'thb0hum-act': '45,5',
    'wind0avgwind-act': '0x10',
    'thb0seapress-act': '20.0',
    'th0lowbat-act': '0.5',
    'uv0index-act': '1e2',
  });
  const { gladys } = await setup(t, { devices: [createdDevice()] });
  for (const key of [
    'temperature',
    'humidity',
    'indoor_temperature',
    'indoor_humidity',
    'wind_speed',
    'pressure',
    'battery_low_outdoor',
    'uv_index',
  ]) {
    assert.equal(gladys.fake.lastState(F(key)), undefined, key);
  }
  assert.equal(gladys.fake.lastState(F('dew_point')), 9.1);
});

test('the rain of the day is published only while the rain gauge is heard (its rate current)', async (t) => {
  gw = installFetch();
  gw.sensors['rain0rate-act'] = '--';
  const { gladys } = await setup(t, { devices: [createdDevice()] });
  assert.equal(gladys.fake.lastState(F('rain_today')), undefined);
});

// --- Pace ----------------------------------------------------------------------------

test('one read per interval; the test button never reads sooner', async (t) => {
  gw = installFetch();
  const { gladys, clock } = await setup(t, { config: { ...CONFIG, poll_interval: 5 } });
  assert.equal(gw.calls.length, 1);
  const ack = await gladys.fake.action(ACTION_TEST);
  assert.equal(gw.calls.length, 1);
  assert.match(ack.data.message.en, /Nothing reads sooner than the interval/);
  assert.match(ack.data.message.en, /temperature 12\.3 °C/);
  await clock.advance(5 * MINUTE - SECOND);
  assert.equal(gw.calls.length, 1);
  await clock.advance(2 * SECOND);
  assert.equal(gw.calls.length, 2);
  await clock.advance(20 * MINUTE);
  assert.equal(gw.calls.length, 6);
  // A timer that fires early never reads before its time.
  await clock.fireEarly();
  assert.equal(gw.calls.length, 6);
});

test('the test button reads when the interval allows it', async (t) => {
  gw = installFetch();
  const { gladys, clock, app } = await setup(t, { config: { ...CONFIG, poll_interval: 5 } });
  await clock.advance(5 * MINUTE + SECOND);
  assert.equal(gw.calls.length, 2);
  // Due but the timer did not fire yet (a timer late under load).
  app.timers.clearTimeout(app.readTimer);
  app.readTimer = undefined;
  app.attemptMono -= 5 * MINUTE;
  const ack = await gladys.fake.action(ACTION_TEST);
  assert.equal(gw.calls.length, 3);
  assert.match(ack.data.message.fr, /température 12,3 °C/);
});

test('a restart never reads before the interval; the attempt is on disk before the request', async (t) => {
  gw = installFetch((call, g) => {
    assert.ok(stateFile(dataDir).attempt_at > 0, 'attempt saved before');
    return g.answer(call);
  });
  const dataDir = tempDir(t);
  const clock = createClock(START);
  const first = await setup(t, { dir: dataDir, clock, config: { ...CONFIG, poll_interval: 10 } });
  await first.app.stop();
  await clock.advance(3 * MINUTE);
  await setup(t, { dir: dataDir, clock, config: { ...CONFIG, poll_interval: 10 } });
  assert.equal(gw.calls.length, 1);
  await clock.advance(7 * MINUTE - 2 * SECOND);
  assert.equal(gw.calls.length, 1);
  await clock.advance(4 * SECOND);
  assert.equal(gw.calls.length, 2);
});

test('an attempt time of /data in the future counts as now (never a read storm)', async (t) => {
  gw = installFetch();
  const dataDir = tempDir(t);
  writeFileSync(join(dataDir, 'state.json'), JSON.stringify({ attempt_at: START + 10 * HOUR }));
  const { app, clock } = await setup(t, { dir: dataDir });
  assert.equal(gw.calls.length, 0);
  assert.ok(app.state.attempt_at <= clock.now(), 'a future date is not kept');
  await clock.advance(MINUTE + SECOND);
  assert.equal(gw.calls.length, 1);
});

test('a corrupt /data file waits one interval, then is replaced', async (t) => {
  gw = installFetch();
  const dataDir = tempDir(t);
  writeFileSync(join(dataDir, 'state.json'), '{not json');
  const { clock } = await setup(t, { dir: dataDir });
  assert.equal(gw.calls.length, 0);
  await clock.advance(MINUTE + SECOND);
  assert.equal(gw.calls.length, 1);
  assert.equal(stateFile(dataDir).gateway.mac, MAC);
});

// --- Refusal -----------------------------------------------------------------------------

test('401: refused, never tried again by itself; only an 8-bit tag in /data', async (t) => {
  gw = installFetch(() => text('', 401));
  const { app, gladys, clock, dataDir, logger } = await setup(t);
  assert.equal(gw.calls.length, 1);
  assert.deepEqual(clock.pending(), [], 'no read timer while refused');
  await app.read();
  assert.equal(gw.calls.length, 1, 'a periodic read never sends refused credentials');
  await clock.advance(5 * HOUR);
  assert.equal(gw.calls.length, 1, 'no automatic try');
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.en, /refuses the user name or the password/);
  const saved = stateFile(dataDir);
  assert.ok(Number.isInteger(saved.refused.tag) && saved.refused.tag < 256);
  assert.equal(saved.refused.tag, tagOf(saved.refused.salt, normalizeConfig(CONFIG)));
  const everything = [
    readFileSync(join(dataDir, 'state.json'), 'utf8'),
    JSON.stringify(gladys.fake.connectionStatuses),
    logger.lines.join('\n'),
  ].join('\n');
  assert.ok(!everything.includes(PASSWORD), 'the password is nowhere');
  assert.ok(!everything.includes(Buffer.from(`${USER}:${PASSWORD}`).toString('base64')));
});

test('refused: a restart with the same credentials does not try them; new ones are tried soon', async (t) => {
  gw = installFetch(() => text('', 401));
  const dataDir = tempDir(t);
  const clock = createClock(START);
  const first = await setup(t, { dir: dataDir, clock });
  await first.app.stop();
  await clock.advance(2 * HOUR);
  const again = await setup(t, { dir: dataDir, clock });
  await clock.advance(HOUR);
  assert.equal(gw.calls.length, 1, 'same refused credentials: not sent again');
  await again.app.stop();
  gw.handler = undefined;
  // The 8-bit tag may collide with another password (1 in 256): pick one that does not.
  let other = 'Another-Pw-0';
  const salt = stateFile(dataDir).refused.salt;
  const tag = stateFile(dataDir).refused.tag;
  for (let i = 1; tagOf(salt, normalizeConfig({ ...CONFIG, password: other })) === tag; i += 1) {
    assert.ok(i < 1000, 'the 8-bit tag never differs: broken');
    other = `Another-Pw-${i}`;
  }

  const fixed = await setup(t, { dir: dataDir, clock, config: { ...CONFIG, password: other } });
  await clock.advance(MIN_GAP + SECOND);
  assert.equal(gw.calls.length, 2);
  assert.equal(status(fixed.gladys).connected, true);
  assert.equal(stateFile(dataDir).refused, null);
});

test('refused: saving other credentials tries them soon; the test button tries again after the interval', async (t) => {
  gw = installFetch(() => text('', 401));
  const { gladys, clock } = await setup(t);
  const early = await gladys.fake.action(ACTION_TEST);
  assert.equal(gw.calls.length, 1);
  assert.match(early.data.message.en, /Nothing reads sooner/);
  await clock.advance(MINUTE + SECOND);
  assert.equal(gw.calls.length, 1);
  const ack = await gladys.fake.action(ACTION_TEST);
  assert.equal(gw.calls.length, 2, 'one try per click, the interval passed');
  assert.match(ack.data.message.en, /refuses/);
  gw.handler = undefined;
  await gladys.fake.configUpdated({ ...CONFIG, password: 'Fixed-Pw-7' });
  await clock.advance(MIN_GAP + SECOND);
  assert.equal(gw.calls.length, 3);
  assert.equal(status(gladys).connected, true);
});

test('403 is not a refusal: the reads go on at the interval', async (t) => {
  gw = installFetch(() => text('', 403));
  const { gladys, clock, dataDir } = await setup(t);
  await clock.advance(3 * MINUTE + SECOND);
  assert.equal(gw.calls.length, 4);
  assert.equal(stateFile(dataDir).refused, null);
  assert.match(status(gladys).message.en, /HTTP 403.*not a refusal/);
});

// --- Pauses ---------------------------------------------------------------------------------

test('503: a pause from Retry-After, kept across a restart, at most 30 minutes', async (t) => {
  gw = installFetch(() => text('', 503, { 'retry-after': '600' }));
  const dataDir = tempDir(t);
  const clock = createClock(START);
  const first = await setup(t, { dir: dataDir, clock });
  assert.ok(stateFile(dataDir).pause_until >= START + 10 * MINUTE);
  await first.app.stop();
  await clock.advance(5 * MINUTE);
  const again = await setup(t, { dir: dataDir, clock });
  assert.equal(gw.calls.length, 1);
  const ack = await again.gladys.fake.action(ACTION_TEST);
  assert.match(ack.data.message.en, /paused until/);
  assert.equal(gw.calls.length, 1);
  await clock.advance(5 * MINUTE + 2 * SECOND);
  assert.equal(gw.calls.length, 2);
  gw.handler = () => text('', 503, { 'retry-after': '999999' });
  await clock.advance(10 * MINUTE + SECOND);
  assert.equal(gw.calls.length, 3);
  assert.ok(stateFile(dataDir).pause_until <= clock.now() + PAUSE_MAX);
  await clock.advance(PAUSE_MAX + SECOND);
  assert.equal(gw.calls.length, 4);
});

test('429 without Retry-After: 1 minute doubling; a success ends the pause', async (t) => {
  gw = installFetch(() => text('', 429));
  const { clock, gladys } = await setup(t);
  await clock.advance(MINUTE + SECOND);
  assert.equal(gw.calls.length, 2);
  await clock.advance(MINUTE + SECOND);
  assert.equal(gw.calls.length, 2, 'second pause: 2 minutes');
  gw.handler = undefined;
  await clock.advance(MINUTE + SECOND);
  assert.equal(gw.calls.length, 3);
  assert.equal(status(gladys).connected, true);
  await clock.advance(MINUTE + SECOND);
  assert.equal(gw.calls.length, 4);
});

// --- Answers that are not the template -------------------------------------------------------

test('an answer that is not the filled template, or without a MAC address, is not a reading', async (t) => {
  gw = installFetch(() => text('<html>login</html>'));
  const { gladys, clock } = await setup(t, { devices: [createdDevice()] });
  assert.equal(gladys.fake.discoveredDevices.length, 0);
  assert.match(status(gladys).message.en, /not that of a Meteobridge/);
  gw.handler = (call, g) => text(fill(call.template, { ...g.sensors, 'mbsystem-mac': '--' }));
  await clock.advance(MINUTE + SECOND);
  assert.equal(gladys.fake.states.length, 0);
  gw.handler = () => text('', 404);
  await clock.advance(MINUTE + SECOND);
  assert.match(status(gladys).message.en, /not that of a Meteobridge/);
  gw.handler = () => text('x'.repeat(64 * 1024));
  await clock.advance(MINUTE + SECOND);
  assert.match(status(gladys).message.en, /no answer/);
  gw.handler = () => text('', 302, { location: 'http://evil.example/' });
  await clock.advance(MINUTE + SECOND);
  assert.equal(gw.calls.length, 5, 'a redirection is never followed');
  assert.equal(gladys.fake.states.length, 0);
});

test('another gateway at the address is its own device; the old values are never its values', async (t) => {
  gw = installFetch();
  const { gladys, clock } = await setup(t, { devices: [createdDevice()] });
  gw.sensors['mbsystem-mac'] = '00:24:A5:00:00:01';
  gw.sensors['th0temp-act'] = '-3.0';
  await clock.advance(MINUTE + SECOND);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.external_id),
    ['ext:meteobridge:gateway:0024a5000001'],
  );
  assert.equal(gladys.fake.lastState(F('temperature')), 12.3, 'the first device keeps its value');
  await gladys.fake.deviceCreated(createdDevice('0024a5000001'));
  assert.equal(gladys.fake.lastState(F('temperature', '0024a5000001')), -3);
});

// --- Freshness ---------------------------------------------------------------------------------

test('a gateway that stops answering: nothing stale published, the status says it', async (t) => {
  gw = installFetch();
  const { gladys, clock } = await setup(t);
  gw.handler = () => {
    throw new TypeError('fetch failed');
  };
  await clock.advance(6 * MINUTE);
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.en, /no answer/);
  await gladys.fake.deviceCreated(createdDevice());
  assert.equal(
    gladys.fake.states.length,
    0,
    'past twice the interval (5 min at least): not published',
  );
});

test('a reading over a minute old, sent to a device created later, carries its own date', async (t) => {
  gw = installFetch();
  const { gladys, clock } = await setup(t, { config: { ...CONFIG, poll_interval: 10 } });
  await clock.advance(3 * MINUTE);
  await gladys.fake.deviceCreated(createdDevice());
  const sent = gladys.fake.states.find((s) => s.device_feature_external_id === F('temperature'));
  assert.ok(sent.created_at, 'dated');
  assert.ok(Math.abs(Date.parse(sent.created_at) - START) < SECOND);
});

test('after a restart, the gateway is listed again but no value is published before a read', async (t) => {
  gw = installFetch();
  const dataDir = tempDir(t);
  const clock = createClock(START);
  const first = await setup(t, { dir: dataDir, clock, config: { ...CONFIG, poll_interval: 10 } });
  await first.app.stop();
  const again = await setup(t, {
    dir: dataDir,
    clock,
    devices: [createdDevice()],
    config: { ...CONFIG, poll_interval: 10 },
  });
  assert.equal(again.gladys.fake.discoveredDevices.length, 1);
  assert.equal(again.gladys.fake.states.length, 0);
  assert.match(status(again.gladys).message.en, /Waiting for the first read/);
  await again.gladys.fake.scanRequest();
  assert.equal(again.gladys.fake.discoveredDevices.length, 1);
});

// --- Lifecycle -------------------------------------------------------------------------------------

test('getConfig() failing in `connected`: retried with a growing wait, then the reads start', async (t) => {
  gw = installFetch();
  const { app, gladys, clock } = await setup(t, { connect: false, listen: false });
  await gladys.connect();
  let failures = 2;
  const real = gladys.getConfig.bind(gladys);
  t.mock.method(gladys, 'getConfig', async () => {
    if (failures > 0) {
      failures -= 1;
      throw new Error('timeout');
    }
    return real();
  });
  await app.connected();
  assert.equal(gw.calls.length, 0);
  assert.match(status(gladys).message.en, /Configuration not read/);
  await clock.advance(10 * SECOND + 1);
  assert.equal(gw.calls.length, 0);
  await clock.advance(20 * SECOND + 1);
  // The start after the retry loads /data (real I/O): wait for its read.
  await until(() => gw.calls.length === 1);
  await app.reading;
  assert.equal(status(gladys).connected, true);
});

test('/data unreadable: tried again every 10 s, no read meanwhile', async (t) => {
  gw = installFetch();
  let broken = 2;
  const fs = await import('node:fs/promises');
  const fake = {
    ...fs,
    readFile: async (...args) => {
      if (broken > 0) {
        broken -= 1;
        throw Object.assign(new Error('EIO'), { code: 'EIO' });
      }
      return fs.readFile(...args);
    },
    mkdir: fs.mkdir,
    writeFile: fs.writeFile,
    rename: fs.rename,
  };
  const { gladys, clock } = await setup(t, { fs: fake });
  assert.equal(gw.calls.length, 0);
  assert.match(status(gladys).message.en, /cannot be read/);
  await clock.advance(10 * SECOND + 1);
  assert.equal(gw.calls.length, 0);
  await clock.advance(10 * SECOND + 1);
  assert.equal(gw.calls.length, 1);
});

test('/data not writable: the read waits (no request without its attempt on disk)', async (t) => {
  gw = installFetch();
  let broken = true;
  const fs = await import('node:fs/promises');
  const fake = {
    readFile: fs.readFile,
    mkdir: fs.mkdir,
    rename: fs.rename,
    writeFile: async (...args) => {
      if (broken) throw Object.assign(new Error('EROFS'), { code: 'EROFS' });
      return fs.writeFile(...args);
    },
  };
  const { gladys, clock } = await setup(t, { fs: fake });
  assert.equal(gw.calls.length, 0);
  assert.match(status(gladys).message.en, /cannot be written/);
  broken = false;
  await clock.advance(10 * SECOND + 1);
  assert.equal(gw.calls.length, 1);
});

test('a configuration saved during a read: the late answer is dropped, nothing published', async (t) => {
  let release;
  // A gateway that answers even after the request was aborted (late, slow stack).
  gw = installFetch(
    (call, g) =>
      new Promise((resolve) => {
        release = () => resolve(g.answer(call));
      }),
  );
  const clock = createClock(START);
  const { app, gladys } = await setup(t, { clock, connect: false, devices: [createdDevice()] });
  const connecting = gladys.connect();
  // /data is real I/O: wait (real time, bounded) for the request to leave.
  const until = Date.now() + 5000;
  while (!release && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(release, 'the read is in flight');
  const restarting = app.start({ ...CONFIG, address: '192.168.1.51' });
  await clock.settle();
  release();
  await restarting;
  await connecting;
  await clock.settle();
  assert.equal(gladys.fake.states.length, 0);
  assert.equal(gladys.fake.discoveredDevices.length, 0);
  assert.equal(gw.calls.length, 1);
});

test('the last reading counts only for the gateway known (status, values)', async (t) => {
  gw = installFetch();
  const { app, gladys } = await setup(t);
  assert.equal(status(gladys).connected, true);
  app.state.gateway = { ...app.state.gateway, mac: '0024a5000001' };
  await app.updateStatus();
  assert.equal(status(gladys).connected, false, 'no value of this gateway yet');
  await gladys.fake.deviceCreated(createdDevice('0024a5000001'));
  assert.equal(gladys.fake.states.length, 0);
});

test('a configuration error: nothing read, the status says what to fix', async (t) => {
  gw = installFetch();
  const { gladys } = await setup(t, { config: { address: ADDRESS, password: PASSWORD } });
  assert.equal(gw.calls.length, 0);
  assert.match(status(gladys).message.en, /user name/);
  const ack = await gladys.fake.action(ACTION_TEST);
  assert.match(ack.data.message.en, /user name/);
});

test('shutdown writes /data and stops every timer', async (t) => {
  gw = installFetch();
  const { app, clock, dataDir } = await setup(t);
  await app.shutdown();
  assert.equal(stateFile(dataDir).gateway.mac, MAC);
  await clock.advance(HOUR);
  assert.equal(gw.calls.length, 1);
  assert.deepEqual(clock.pending(), []);
});

// --- Review r1: lifecycle, abort, identity of the features ---------------------------

/** Wait (real time, bounded) for a condition the real /data I/O makes true. */
async function until(condition, ms = 5000) {
  const end = Date.now() + ms;
  while (!condition() && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(condition(), 'condition not met in time');
}

test('stop() while getConfig() is pending: its late answer starts nothing, no timer is left', async (t) => {
  gw = installFetch();
  const { app, gladys, clock } = await setup(t, { connect: false, listen: false });
  await gladys.connect();
  let answer;
  t.mock.method(
    gladys,
    'getConfig',
    () =>
      new Promise((resolve, reject) => {
        answer = { resolve, reject };
      }),
  );
  const late = app.connected();
  await clock.settle();
  await app.stop();
  answer.resolve(CONFIG);
  await late;
  await clock.advance(10 * MINUTE);
  assert.equal(gw.calls.length, 0, 'disconnected: nothing read');
  assert.deepEqual(clock.pending(), []);
  // A failure after stop(): no retry armed.
  const failing = app.connected();
  await clock.settle();
  await app.stop();
  answer.reject(new Error('timeout'));
  await failing;
  assert.deepEqual(clock.pending(), []);
  await clock.advance(HOUR);
  assert.equal(gw.calls.length, 0);
});

test('a configuration saved while getConfig() is pending wins over its late answer', async (t) => {
  gw = installFetch();
  const { app, gladys, clock } = await setup(t, { connect: false, listen: false });
  await gladys.connect();
  let resolveLate;
  t.mock.method(gladys, 'getConfig', () => new Promise((resolve) => (resolveLate = resolve)));
  const late = app.connected();
  await clock.settle();
  await app.start({ ...CONFIG, address: '192.168.1.51' });
  resolveLate(CONFIG);
  await late;
  await app.reading;
  await clock.advance(30 * SECOND);
  assert.ok(gw.calls.length >= 1);
  assert.ok(gw.calls.every((c) => new URL(c.url).hostname === '192.168.1.51'));
});

test('getConfig() retries wait 10, 20, then 40 s, and start again from 10 s after a success', async (t) => {
  gw = installFetch();
  const { app, gladys, clock } = await setup(t, { connect: false, listen: false });
  await gladys.connect();
  const real = gladys.getConfig.bind(gladys);
  let fail = 3;
  let asked = 0;
  t.mock.method(gladys, 'getConfig', async () => {
    asked += 1;
    if (fail > 0) {
      fail -= 1;
      throw new Error('timeout');
    }
    return real();
  });
  await app.connected();
  assert.equal(asked, 1);
  await clock.advance(10 * SECOND - 100);
  assert.equal(asked, 1);
  await clock.advance(200);
  assert.equal(asked, 2);
  await clock.advance(20 * SECOND - 300);
  assert.equal(asked, 2);
  await clock.advance(400);
  assert.equal(asked, 3);
  await clock.advance(40 * SECOND - 400);
  assert.equal(asked, 3);
  await clock.advance(400);
  assert.equal(asked, 4);
  await until(() => gw.calls.length === 1);
  await app.reading;
  fail = 1;
  await app.connected();
  assert.equal(asked, 5);
  await clock.advance(10 * SECOND + 100);
  assert.equal(asked, 6, 'the wait starts again from 10 s');
});

test('stop() during a read aborts the request at once (never waits for the gateway)', async (t) => {
  gw = installFetch(
    (call) =>
      new Promise((resolve, reject) => {
        const fail = () => reject(new DOMException('aborted', 'AbortError'));
        call.init.signal.addEventListener('abort', fail);
        // Safety net so that a broken abort fails the test instead of hanging it.
        setTimeout(fail, 3000).unref();
      }),
  );
  const clock = createClock(START);
  const { app, gladys } = await setup(t, { clock, connect: false });
  const connecting = gladys.connect();
  await until(() => gw.calls.length === 1);
  const outcome = await Promise.race([
    app.stop().then(() => 'stopped'),
    new Promise((resolve) => setTimeout(() => resolve('hung'), 2000).unref()),
  ]);
  assert.equal(outcome, 'stopped');
  await connecting;
});

test('a configuration saved while the attempt is being written: nothing leaves for the old one', async (t) => {
  gw = installFetch();
  const fs = await import('node:fs/promises');
  let releaseWrite;
  let block = true;
  const fake = {
    readFile: fs.readFile,
    mkdir: fs.mkdir,
    rename: fs.rename,
    writeFile: async (...args) => {
      if (block) {
        block = false;
        await new Promise((resolve) => (releaseWrite = resolve));
      }
      return fs.writeFile(...args);
    },
  };
  const clock = createClock(START);
  const { app, gladys } = await setup(t, { clock, fs: fake, connect: false });
  const connecting = gladys.connect();
  await until(() => releaseWrite !== undefined);
  const restarting = app.start({ ...CONFIG, address: '192.168.1.51' });
  await clock.settle();
  releaseWrite();
  await restarting;
  await connecting;
  await app.reading;
  assert.ok(
    gw.calls.every((c) => new URL(c.url).hostname !== ADDRESS),
    'the old address never asked',
  );
});

test('the Discovery keeps every created feature, those not given lately and those unknown', async (t) => {
  gw = installFetch();
  const created = createdDevice();
  created.features.push({
    ...created.features[0],
    name: 'A field of a later version',
    external_id: F('later_field'),
  });
  const { gladys } = await setup(t, { devices: [created] });
  const ids = gladys.fake.discoveredDevices[0].features.map((f) => f.external_id);
  assert.ok(ids.includes(F('pm25')), 'created, never given by this gateway');
  assert.ok(ids.includes(F('later_field')), 'created, unknown to this version');
  assert.ok(ids.includes(F('temperature')));
});

test('refused credentials typed again after a field was emptied are not sent again', async (t) => {
  gw = installFetch(() => text('', 401));
  const { gladys, clock } = await setup(t);
  await gladys.fake.configUpdated({ ...CONFIG, username: '' });
  await gladys.fake.configUpdated(CONFIG);
  await clock.advance(10 * MINUTE);
  assert.equal(gw.calls.length, 1);
  assert.match(status(gladys).message.en, /refuses/);
});

test('after a success, the 429 pause starts again from 1 minute', async (t) => {
  gw = installFetch(() => text('', 429));
  const { clock } = await setup(t);
  await clock.advance(MINUTE + SECOND);
  assert.equal(gw.calls.length, 2);
  gw.handler = undefined;
  await clock.advance(2 * MINUTE + SECOND);
  assert.equal(gw.calls.length, 3);
  gw.handler = () => text('', 429);
  await clock.advance(MINUTE + SECOND);
  assert.equal(gw.calls.length, 4);
  await clock.advance(MINUTE + SECOND);
  assert.equal(gw.calls.length, 5, 'one minute, not four');
});

test('a reconnection publishes the Discovery list again (Gladys may have restarted)', async (t) => {
  gw = installFetch();
  const { app, gladys } = await setup(t);
  const spy = t.mock.method(gladys, 'publishDiscoveredDevices');
  await app.connected();
  assert.equal(spy.mock.callCount(), 1);
});

test('with a 1-minute interval a reading stays current 5 minutes (the floor)', async (t) => {
  gw = installFetch();
  const { gladys, clock } = await setup(t);
  gw.handler = () => {
    throw new TypeError('fetch failed');
  };
  await clock.advance(4 * MINUTE);
  await gladys.fake.deviceCreated(createdDevice());
  assert.equal(gladys.fake.lastState(F('temperature')), 12.3);
});

test('outdoor temperatures are probes (out of the room average); the indoor one is not', async (t) => {
  gw = installFetch();
  const { gladys } = await setup(t);
  const type = (key) =>
    gladys.fake.discoveredDevices[0].features.find((f) => f.external_id === F(key)).type;
  for (const key of ['temperature', 'dew_point', 'wind_chill', 'extra_temperature_1']) {
    assert.equal(type(key), 'probe', key);
  }
  assert.equal(type('indoor_temperature'), 'decimal');
});
