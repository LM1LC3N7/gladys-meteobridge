# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
v0.16, its only runtime dependency. It started from the official JavaScript
template. It reads the weather station behind a Meteobridge gateway, read only,
through the template page of the gateway (official wiki), on the local network.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
node scripts/mutants.mjs                  # mutation check of the guards (not in CI)
node scripts/cover.mjs cover.png          # draws cover.png with Node alone
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image.

## Architecture

```
index.js              SDK wiring only: handlers registered before connect()
src/app.js            MeteobridgeApp: pace, pauses, refusal, device, states, status, test button
src/meteobridge.js    the one GET to /cgi-bin/template.cgi, error kinds
src/fields.js         the template, the answer -> values in core units, device, states (pure)
src/http.js           fetch with timeout, no redirection, bounded body
src/store.js          /data/state.json, one operation at a time, each bounded
src/config.js         DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/i18n.js           status and test button texts (en, fr)
test/                 node --test, against the SDK's fake Gladys and a fake gateway
scripts/mutants.json  mutants of the guards, run by scripts/mutants.mjs
```

## Rules

- **Read only.** One page, GET only, never a setting of the gateway.
- **The password** leaves only in the Authorization header of the request to
  the configured address; never in a URL, a log, a status nor `/data` (only 8
  bits of a salted hash of refused credentials). A redirection is never
  followed. Never describe a secret field as "encrypted": Gladys keeps it in
  clear in its database.
- **401 = refusal**: stop, never retried by itself; lifted by new credentials
  or the test button. 403 is never a refusal.
- **Pace**: nothing reads sooner than the interval (button, restart,
  reconnection included); the attempt time is on disk before the request;
  decisions on the monotonic clock, wall time only for `/data` and texts.
- **Values**: `--`, text, empty or out of bounds = unknown, never 0; nothing
  stale republished; units only from `DEVICE_FEATURE_UNITS_BY_CATEGORY`.
- Feature keys (`temperature`, `rain_today`...) and the device type
  `gateway` are part of the external ids: never rename them.
- Docs (`docs/en.md`, `docs/fr.md`), README, TODO and i18n must match the code.
