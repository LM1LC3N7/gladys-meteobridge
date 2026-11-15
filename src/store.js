// -----------------------------------------------------------------------------
// /data/state.json: the time of the last read attempt, the pause after a
// 429 / 5xx, the 8-bit tag of refused credentials and the gateway met (MAC,
// names, the fields it gave: nothing secret).
//
// One operation at a time; each one bounded in time. An unreadable /data is
// not an empty one: `load()` says so and the caller retries on its own timer.
// -----------------------------------------------------------------------------

import * as fsp from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_TIMEOUT } from './constants.js';

const FILE = 'state.json';

function bounded(promise, ms, timers) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = timers.setTimeout(() => reject(new Error('/data too slow')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => timers.clearTimeout(timer));
}

export class Store {
  /** `fs` (mkdir, readFile, writeFile, rename) is replaced by the tests only. */
  constructor({ dataDir, timers, timeout = DATA_TIMEOUT, fs = fsp }) {
    this.fs = fs;
    this.dataDir = dataDir;
    this.timers = timers;
    this.timeout = timeout;
    this.queue = Promise.resolve();
  }

  run(job) {
    const result = this.queue.then(job, job);
    this.queue = result.catch(() => {});
    return result;
  }

  /**
   * `{ ok: true, state }` (an empty object when there is no file yet, and
   * `corrupt: true` when the file is not JSON), or `{ ok: false, error }`
   * when /data cannot be read.
   */
  load() {
    return this.run(async () => {
      let text;
      try {
        text = await bounded(
          this.fs.readFile(join(this.dataDir, FILE), 'utf8'),
          this.timeout,
          this.timers,
        );
      } catch (err) {
        if (err.code === 'ENOENT') {
          return { ok: true, state: {} };
        }
        return { ok: false, error: err };
      }
      try {
        const state = JSON.parse(text);
        if (state && typeof state === 'object' && !Array.isArray(state)) {
          return { ok: true, state };
        }
      } catch {
        // fall through
      }
      return { ok: true, state: {}, corrupt: true };
    });
  }

  /** Write the state (temporary file then rename). Resolves true on success. */
  save(state) {
    const text = JSON.stringify(state);
    return this.run(async () => {
      // A write that outlived its bound is still running: never start another
      // one that it could overwrite afterwards.
      if (this.slowWrite) {
        return false;
      }
      const path = join(this.dataDir, FILE);
      const work = (async () => {
        await this.fs.mkdir(this.dataDir, { recursive: true });
        await this.fs.writeFile(`${path}.tmp`, text);
        await this.fs.rename(`${path}.tmp`, path);
      })();
      try {
        await bounded(work, this.timeout, this.timers);
        return true;
      } catch {
        this.slowWrite = work
          .catch(() => {})
          .finally(() => {
            this.slowWrite = undefined;
          });
        return false;
      }
    });
  }
}
