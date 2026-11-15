// -----------------------------------------------------------------------------
// The integration: reads the Meteobridge every N minutes (one request, the
// template of src/fields.js), keeps one Gladys device per gateway (its MAC
// address) and publishes the current values. index.js only wires the SDK
// handlers. Read only: nothing is ever changed on the gateway.
//
// Clocks: `now` (wall) only dates what goes to /data and the times shown;
// `monotonic` decides inside the process when the next read may leave and
// whether a reading is still current. After a restart the wait is rebuilt
// from the attempt time saved in /data, which is written BEFORE every read
// (a read waits while /data cannot be written).
//
// Secrets: the password lives in `this.config`, in memory only, and leaves
// only in the Authorization header of the request to the configured address.
// /data keeps, after a refusal, 8 bits of a salted hash of the credentials:
// nothing to find them back from, enough not to send refused credentials
// again by themselves after a restart.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createLogger } from '@gladysassistant/integration-sdk';
import { credentialsKey, normalizeConfig } from './config.js';
import {
  CONFIG_RETRY_MAX,
  CONFIG_RETRY_MIN,
  DATA_RETRY,
  FRESH_MAX,
  FRESH_MIN,
  HEARTBEAT,
  MINUTE,
  PAUSE_MAX,
  PAUSE_MIN,
  SECOND,
  SKEW,
} from './constants.js';
import { FIELD_KEYS, deviceOf, gatewayName, parseMac, statesOf } from './fields.js';
import { T, report, valuesLine } from './i18n.js';
import { SourceError, readGateway } from './meteobridge.js';
import { Store } from './store.js';

const defaultTimers = { setTimeout, clearTimeout };
const defaultClient = { read: readGateway };

/** After new credentials or a new address: the next read waits only this. */
export const MIN_GAP = 15 * SECOND;

const isTime = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** 8 bits of a salted hash of the credentials. */
export const tagOf = (salt, config) =>
  createHash('sha256')
    .update(`${salt}\u0000${credentialsKey(config)}`, 'utf8')
    .digest()[0];

/** A short printable name read back from /data. */
const cleanName = (value, max) =>
  typeof value === 'string' && /^[\x20-\x7e]*$/.test(value) ? value.trim().slice(0, max) : '';

export class MeteobridgeApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'meteobridge' }),
    now = Date.now,
    monotonic = () => performance.now(),
    timers = defaultTimers,
    dataDir = '/data',
    dataTimeout,
    fs,
    client = defaultClient,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.client = client;
    this.store = new Store({ dataDir, timers, timeout: dataTimeout, fs });
    this.config = normalizeConfig();
    this.credKey = undefined;
    this.credsChanged = false;
    this.state = undefined;
    this.generation = 0;
    this.lifecycle = Promise.resolve();
    this.reading = undefined;
    this.abort = undefined;
    this.readTimer = undefined;
    this.dataTimer = undefined;
    this.configTimer = undefined;
    this.configDelay = CONFIG_RETRY_MIN;
    this.readDueMono = undefined;
    // The pace in this process: the monotonic instants of the last attempt
    // and of the end of a pause (from /data's wall times at the first load only).
    this.attemptMono = undefined;
    this.pauseMono = undefined;
    this.soon = false;
    /** The last values read: { mac, values, mono, at } (memory only, never republished after a restart). */
    this.last = undefined;
    this.lastError = undefined;
    this.lastStatus = undefined;
    this.lastDiscovered = undefined;
  }

  // --- Lifecycle -------------------------------------------------------------

  /** The `connected` event: read the config, retried without end if it fails. */
  async connected() {
    // Gladys keeps the status and the Discovery list in memory only: after
    // its restart, both are said again.
    this.lastStatus = undefined;
    this.lastDiscovered = undefined;
    this.timers.clearTimeout(this.configTimer);
    this.configTimer = undefined;
    let raw;
    try {
      raw = await this.gladys.getConfig();
    } catch (err) {
      this.logger.warn(`Reading the configuration failed (${err?.name ?? 'Error'})`);
      await this.setStatus(false, T.configUnreadable);
      const delay = this.configDelay;
      this.configDelay = Math.min(CONFIG_RETRY_MAX, this.configDelay * 2);
      this.configTimer = this.timers.setTimeout(() => this.connected().catch(() => {}), delay);
      return;
    }
    this.configDelay = CONFIG_RETRY_MIN;
    await this.start(raw);
  }

  start(raw = {}) {
    return this.serialize(() => this.doStart(raw));
  }

  stop() {
    this.timers.clearTimeout(this.configTimer);
    this.configTimer = undefined;
    return this.serialize(() => this.doStop());
  }

  /** The container stops: the timers dropped, the state written (bounded). */
  shutdown() {
    return this.serialize(async () => {
      this.timers.clearTimeout(this.configTimer);
      this.configTimer = undefined;
      await this.doStop();
      if (this.state) {
        await this.store.save(this.persisted());
      }
    });
  }

  serialize(job) {
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  async doStart(raw) {
    await this.doStop();
    const generation = ++this.generation;
    const previousKey = this.credKey;
    this.config = normalizeConfig(raw);
    const key = credentialsKey(this.config);
    // New credentials or a new address in this process: always tried, soon
    // (a restart compares the 8-bit tag of /data instead).
    this.credsChanged = previousKey !== undefined && key !== previousKey;
    if (this.credsChanged) {
      this.soon = true;
      this.lastError = undefined;
      this.pauseMono = undefined;
      if (this.state) {
        this.state.refused = null;
        this.state.pause_until = 0;
        this.state.failures = 0;
      }
    }
    this.credKey = key;
    if (this.config.error) {
      await this.setStatus(false, T.configError(this.config.error));
      return;
    }
    await this.loadData(generation);
  }

  async doStop() {
    this.generation += 1;
    for (const key of ['readTimer', 'dataTimer']) {
      this.timers.clearTimeout(this[key]);
      this[key] = undefined;
    }
    this.readDueMono = undefined;
    this.abort?.abort();
    await this.reading?.catch(() => {});
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed (${err?.name ?? 'Error'})`));
  }

  // --- /data -------------------------------------------------------------------

  /** Load /data (once per process); unreadable: retried every DATA_RETRY, nothing read meanwhile. */
  async loadData(generation) {
    this.timers.clearTimeout(this.dataTimer);
    this.dataTimer = undefined;
    if (!this.state) {
      const result = await this.store.load();
      if (generation !== this.generation) {
        return;
      }
      if (!result.ok) {
        this.logger.warn('/data unreadable: trying again');
        await this.setStatus(false, T.dataUnreadable);
        if (generation === this.generation) {
          this.dataTimer = this.timers.setTimeout(() => this.loadData(generation), DATA_RETRY);
        }
        return;
      }
      this.state = this.sanitize(result.state, result.corrupt);
      // The wall times of /data become monotonic instants once per process:
      // later, the memory of this process is right even if the wall clock moved.
      const mono = this.monotonic();
      const wall = this.now();
      if (this.attemptMono === undefined && isTime(this.state.attempt_at)) {
        this.attemptMono = mono - Math.max(0, wall - this.state.attempt_at);
      }
      if (this.pauseMono === undefined && this.state.pause_until > wall) {
        this.pauseMono = mono + (this.state.pause_until - wall);
        this.lastError = 'busy';
      }
    } else if (
      this.state.refused &&
      tagOf(this.state.refused.salt, this.config) !== this.state.refused.tag
    ) {
      this.state.refused = null;
      this.soon = true;
    }
    await this.publishDiscovered();
    if (generation !== this.generation) {
      return;
    }
    this.scheduleRead();
    await this.updateStatus();
  }

  /** The state of /data, every field checked; a future date is invalid. */
  sanitize(raw, corrupt) {
    const wall = this.now();
    const state = {
      attempt_at: undefined,
      failures: 0,
      pause_until: 0,
      refused: null,
      gateway: null,
    };
    // Unknown last attempt: as if it were now (never a read too early).
    if (corrupt) {
      state.attempt_at = wall;
    }
    if (isTime(raw.attempt_at)) {
      state.attempt_at = raw.attempt_at > wall + SKEW ? wall : raw.attempt_at;
    }
    if (Number.isInteger(raw.failures) && raw.failures > 0) {
      state.failures = Math.min(raw.failures, 16);
    }
    if (isTime(raw.pause_until)) {
      // Never longer than the longest pause this module sets: beyond, invalid.
      state.pause_until = raw.pause_until > wall + PAUSE_MAX + SKEW ? 0 : raw.pause_until;
    }
    const refused = raw.refused;
    if (
      refused &&
      typeof refused.salt === 'string' &&
      /^[0-9a-f]{32}$/.test(refused.salt) &&
      Number.isInteger(refused.tag) &&
      refused.tag >= 0 &&
      refused.tag < 256
    ) {
      if (!this.credsChanged && tagOf(refused.salt, this.config) === refused.tag) {
        state.refused = { salt: refused.salt, tag: refused.tag };
      } else {
        // Other credentials than the refused ones: tried soon.
        this.soon = true;
      }
    }
    const gw = raw.gateway;
    const mac = parseMac(gw?.mac);
    if (mac) {
      state.gateway = {
        mac,
        platform: cleanName(gw.platform, 40),
        station: cleanName(gw.station, 60),
        fields: Array.isArray(gw.fields)
          ? [...new Set(gw.fields.filter((f) => typeof f === 'string' && FIELD_KEYS.has(f)))]
          : [],
      };
    }
    return state;
  }

  persisted() {
    const s = this.state;
    return {
      v: 1,
      attempt_at: s.attempt_at,
      failures: s.failures,
      pause_until: s.pause_until,
      refused: s.refused,
      gateway: s.gateway,
    };
  }

  // --- Pace -----------------------------------------------------------------------

  intervalMs() {
    return this.config.pollMinutes * MINUTE;
  }

  /** How long a reading is published as current. */
  freshMs() {
    return clamp(2 * this.intervalMs(), FRESH_MIN, FRESH_MAX);
  }

  /** Milliseconds before the next periodic read may leave (0: now; Infinity: never by itself). */
  readDelay() {
    const state = this.state;
    if (!state || state.refused || this.config.error) {
      return Infinity;
    }
    return this.manualDelay();
  }

  /** The same, a refusal aside (the test button may try refused credentials again). */
  manualDelay() {
    const mono = this.monotonic();
    let due = -Infinity;
    if (this.attemptMono !== undefined) {
      due = this.attemptMono + (this.soon ? MIN_GAP : this.intervalMs());
    }
    if (this.pauseMono !== undefined) {
      due = Math.max(due, this.pauseMono);
    }
    return Math.min(PAUSE_MAX + this.intervalMs(), Math.max(0, due - mono));
  }

  scheduleRead() {
    this.timers.clearTimeout(this.readTimer);
    this.readTimer = undefined;
    this.readDueMono = undefined;
    const delay = this.readDelay();
    if (!Number.isFinite(delay)) {
      return;
    }
    this.readDueMono = this.monotonic() + delay;
    const generation = this.generation;
    const fire = () => {
      this.readTimer = undefined;
      if (generation !== this.generation) {
        return;
      }
      const left = this.readDueMono - this.monotonic();
      if (left > 0) {
        // A timer that fired early: never a read before its time.
        this.readTimer = this.timers.setTimeout(fire, left);
        return;
      }
      if (this.reading) {
        // Due while a read still runs: never lost, scheduled again after it.
        this.reading.then(() => {
          if (generation === this.generation) {
            this.scheduleRead();
          }
        });
        return;
      }
      this.read(generation);
    };
    if (delay <= 0) {
      fire();
      return;
    }
    this.readTimer = this.timers.setTimeout(fire, delay);
  }

  // --- Reading ---------------------------------------------------------------------

  /** One read; single-flight. Resolves when done (never rejects). */
  read(generation = this.generation, { manual = false } = {}) {
    if (!this.reading) {
      this.reading = this.doRead(generation, manual)
        .catch((err) => this.logger.error(`Read failed (${err?.name ?? 'Error'})`))
        .finally(() => {
          this.reading = undefined;
        });
    }
    return this.reading;
  }

  async doRead(generation, manual) {
    const state = this.state;
    this.timers.clearTimeout(this.readTimer);
    this.readTimer = undefined;
    if (!state || this.config.error || generation !== this.generation) {
      return;
    }
    if (state.refused && !manual) {
      return;
    }
    // The attempt is on disk before the request (the pace survives a restart loop).
    const attemptAt = this.now();
    const saved = await this.store.save({ ...this.persisted(), attempt_at: attemptAt });
    if (generation !== this.generation) {
      return;
    }
    if (!saved) {
      this.logger.warn('/data not writable: the read waits');
      await this.setStatus(false, T.dataUnwritable);
      if (generation === this.generation) {
        this.readTimer = this.timers.setTimeout(() => this.read(generation), DATA_RETRY);
      }
      return;
    }
    state.attempt_at = attemptAt;
    this.attemptMono = this.monotonic();
    this.soon = false;
    const abort = new AbortController();
    this.abort = abort;
    const { address, username, password } = this.config;
    let answer;
    let error;
    try {
      answer = await this.client.read({ address, username, password, signal: abort.signal });
    } catch (err) {
      error = err instanceof SourceError ? err : new SourceError('failed');
    }
    if (this.abort === abort) {
      this.abort = undefined;
    }
    if (abort.signal.aborted || generation !== this.generation) {
      // Stopped (configuration saved, disconnection): neither a failure nor
      // a success, nothing published.
      return;
    }
    if (answer) {
      this.accept(answer);
    } else if (error.kind === 'refused') {
      const salt = randomBytes(16).toString('hex');
      state.refused = { salt, tag: tagOf(salt, this.config) };
      state.failures = 0;
      state.pause_until = 0;
      this.pauseMono = undefined;
      this.lastError = undefined;
      this.logger.warn('The Meteobridge refused the user name or the password');
    } else if (error.kind === 'busy') {
      state.failures = Math.min(16, state.failures + 1);
      const wait = clamp(
        error.retryAfterMs ?? PAUSE_MIN * 2 ** (state.failures - 1),
        PAUSE_MIN,
        PAUSE_MAX,
      );
      state.pause_until = this.now() + wait;
      this.pauseMono = this.monotonic() + wait;
      this.lastError = 'busy';
      this.logger.warn(
        `Meteobridge busy (${error.message}): paused ${Math.round(wait / SECOND)} s`,
      );
    } else {
      // A passing failure: tried again at the interval, no pause.
      this.lastError = error.kind;
      this.logger.warn(`Reading the Meteobridge failed (${error.message})`);
    }
    await this.publishDiscovered();
    if (generation !== this.generation) {
      return;
    }
    await this.publishStates();
    if (!(await this.store.save(this.persisted()))) {
      this.logger.warn('/data not writable: the state is kept in memory only');
    }
    if (generation !== this.generation) {
      return;
    }
    this.scheduleRead();
    await this.updateStatus();
  }

  /** A successful read: the credentials work, the gateway and its fields are known. */
  accept(answer) {
    const state = this.state;
    if (!state.gateway || state.gateway.mac !== answer.mac) {
      // A first read, or another gateway now answers at this address: it is
      // its own device, never the first one.
      state.gateway = { mac: answer.mac, platform: '', station: '', fields: [] };
    }
    const gw = state.gateway;
    gw.platform = answer.platform || gw.platform;
    gw.station = answer.station || gw.station;
    gw.fields = [...new Set([...gw.fields, ...Object.keys(answer.values)])];
    this.last = { mac: answer.mac, values: answer.values, mono: this.monotonic(), at: this.now() };
    state.refused = null;
    state.failures = 0;
    state.pause_until = 0;
    this.pauseMono = undefined;
    this.lastError = undefined;
  }

  /** The last reading, if it is current and of the gateway known. */
  fresh() {
    const last = this.last;
    if (!last || last.mac !== this.state?.gateway?.mac) {
      return undefined;
    }
    const age = this.monotonic() - last.mono;
    return age <= this.freshMs() ? { ...last, age } : undefined;
  }

  // --- Gladys devices and states --------------------------------------------------

  devices() {
    const gw = this.state?.gateway;
    if (!gw) {
      return [];
    }
    const device = deviceOf(this.gladys, {
      mac: gw.mac,
      name: gatewayName(gw),
      fields: new Set(gw.fields),
    });
    return device.features.length > 0 ? [device] : [];
  }

  /** The Discovery tab, published again only when it changed (or on a scan). */
  async publishDiscovered({ force = false } = {}) {
    if (this.config.error) {
      return;
    }
    const devices = this.devices();
    const key = JSON.stringify(devices);
    if (!force && key === this.lastDiscovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.lastDiscovered = key;
    } catch (err) {
      this.logger.warn(`Publishing the Discovery list failed (${err?.name ?? 'Error'})`);
    }
  }

  /**
   * The current values of the created features, only what changed (plus a
   * heartbeat). A reading older than a minute (a device created later) is
   * dated with its own time; one past freshMs() is never published.
   */
  async publishStates() {
    const reading = this.fresh();
    if (!reading) {
      return;
    }
    const created = new Set();
    for (const device of this.gladys.devices ?? []) {
      for (const feature of device.features ?? []) {
        created.add(feature.external_id);
      }
    }
    const states = statesOf(this.gladys, reading)
      .filter((s) => created.has(s.device_feature_external_id))
      .map((s) =>
        reading.age > MINUTE ? { ...s, created_at: new Date(reading.at).toISOString() } : s,
      );
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT });
    } catch (err) {
      this.logger.warn(`Publishing the values failed (${err?.name ?? 'Error'})`);
    }
  }

  // --- Status ------------------------------------------------------------------------

  currentStatus() {
    if (this.config.error) {
      return [false, T.configError(this.config.error)];
    }
    if (!this.state) {
      return [false, T.dataUnreadable];
    }
    if (this.state.refused) {
      return [false, T.refused];
    }
    const next = this.now() + this.manualDelay();
    if (this.lastError) {
      return [false, T.failed(this.lastError, next)];
    }
    const reading = this.fresh();
    if (reading) {
      const count = Object.keys(reading.values).length;
      if (count === 0) {
        return [false, T.noValue(next)];
      }
      return [
        true,
        T.ok({ name: gatewayName(this.state.gateway), count, minutes: this.config.pollMinutes }),
      ];
    }
    if (this.last) {
      return [false, T.noValue(next)];
    }
    return [false, T.waiting(next)];
  }

  async updateStatus() {
    const [connected, message] = this.currentStatus();
    await this.setStatus(connected, message);
  }

  /**
   * The configuration button. Paused: says until when. Otherwise reads only
   * if the interval allows it (refused credentials are then tried again, one
   * try per interval at most); the last values are shown.
   */
  async testConnection() {
    if (this.config.error) {
      return T.configError(this.config.error);
    }
    if (!this.state) {
      return T.dataUnreadable;
    }
    if (this.reading) {
      await this.reading;
    } else if (this.pauseMono !== undefined && this.monotonic() < this.pauseMono) {
      return report(T.paused(this.now() + (this.pauseMono - this.monotonic())), this.valuesText());
    } else if (this.manualDelay() > 0) {
      return report(T.tooSoon(this.now() + this.manualDelay()), this.valuesText());
    } else {
      await this.read(this.generation, { manual: true });
    }
    return report(this.currentStatus()[1], this.valuesText());
  }

  valuesText() {
    const reading = this.fresh();
    if (!reading) {
      return undefined;
    }
    const minutes = Math.max(0, Math.round(reading.age / MINUTE));
    const en = valuesLine(reading.values, minutes, 'en');
    const fr = valuesLine(reading.values, minutes, 'fr');
    return en ? { en, fr } : undefined;
  }
}
