// -----------------------------------------------------------------------------
// The app on a REAL moving clock (sped up 120 times: the 1-minute interval is
// 0.5 s) and a real local HTTP server playing the gateway: the reads leave
// at 0, the interval, twice the interval..., never sooner. The gaps are
// measured on the attempt times the module decides on (wall, simulated). Large
// margins: late under load is fine, early never.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { MeteobridgeApp } from '../src/app.js';
import { MINUTE } from '../src/constants.js';
import { setFetch } from '../src/http.js';
import { SENSORS, fill } from './helpers/gateway.js';
import { realClock } from './helpers/realClock.js';

setFetch((...args) => globalThis.fetch(...args));

const SPEED = 120;
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

async function measure(t, { count, status = 200 }) {
  const clock = realClock({ start: Date.parse('2026-11-15T10:00:00Z'), speed: SPEED });
  const reads = [];
  let app;
  const srv = createServer((req, res) => {
    reads.push(app.state.attempt_at);
    assert.ok(clock.now() >= app.state.attempt_at, 'the request leaves after its attempt');
    const template = new URL(req.url, 'http://x').searchParams.get('template');
    res.writeHead(status);
    res.end(status === 200 ? fill(template, SENSORS) : '');
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const dataDir = mkdtempSync(join(tmpdir(), 'meteobridge-rc-'));
  const gladys = createFakeGladys({ selector: 'meteobridge' });
  await gladys.connect();
  app = new MeteobridgeApp({
    gladys,
    logger: quiet,
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    dataDir,
    // The /data bound is real I/O time: 5 s real, not 5 simulated seconds.
    dataTimeout: 5000 * SPEED,
  });
  t.after(async () => {
    await app.stop();
    clock.close();
    srv.closeAllConnections();
    await new Promise((resolve) => srv.close(resolve));
    rmSync(dataDir, { recursive: true, force: true });
  });
  await app.start({
    address: `127.0.0.1:${srv.address().port}`,
    username: 'meteobridge',
    password: 'pw',
    poll_interval: 1,
  });
  const deadline = Date.now() + 20_000;
  while (reads.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await app.stop();
  assert.ok(reads.length >= count, `only ${reads.length} reads in 20 s`);
  return { gaps: reads.slice(1).map((m, i) => m - reads[i]), gladys };
}

test('real clock: a read every minute, never sooner', async (t) => {
  const { gaps, gladys } = await measure(t, { count: 4 });
  for (const gap of gaps) {
    assert.ok(gap >= MINUTE, `gap ${gap / 1000} s`);
    assert.ok(gap <= 3 * MINUTE, `gap ${gap / 1000} s`);
  }
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('real clock: 503 without Retry-After waits 1 then 2 minutes', async (t) => {
  const { gaps } = await measure(t, { count: 3, status: 503 });
  assert.ok(gaps[0] >= MINUTE && gaps[0] <= 3 * MINUTE, `gap 0: ${gaps[0] / 1000} s`);
  assert.ok(gaps[1] >= 2 * MINUTE && gaps[1] <= 4 * MINUTE, `gap 1: ${gaps[1] / 1000} s`);
});
