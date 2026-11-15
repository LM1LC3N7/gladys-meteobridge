# TODO

## Before announcing

- [ ] Test on a real Gladys 5.1+ with a real Meteobridge (any model): the
      device of the Discovery tab, its values, the status, the test button,
      a wrong password. Never done yet.
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (at release only).

## To confirm on a real gateway

- [ ] The length of the template URL (~1.4 KB) is accepted by the web server
      of every model (NANO SD, PRO, PRO2, the software version).
- [ ] `mbsystem-mac` is filled on every model and firmware (the device id
      depends on it; without it the answer is refused as "not a Meteobridge").
- [ ] The `act` selector of the `*lowbat` sensors, and `rain0total-sumday`
      (documented, never seen).
- [ ] What the gateway answers to wrong credentials (401 expected) and while it
      restarts (5xx or no answer).
- [ ] Whether the value of `mbsystem-station` is a usable device name.

## Later

- [ ] Lightning (`lgt0dist`, `lgt0total`), sunshine minutes, evapotranspiration:
      the core lists no matching category or unit yet.
- [ ] Davis soil and leaf stations (th10 to th18): soil moisture in cbar and
      leaf wetness have no core unit.
- [ ] Several gateways in one integration (one today).
- [ ] HTTPS, if a model offers it.

## Decisions

- Version 0.1.0 written by hand (package.json, package-lock.json, manifest,
  `docker_image`); the Release workflow does it from now on.
- Source: the official wiki only (pages "Add-On Services" and "Templates");
  no third-party code. The Home Assistant world has no core Meteobridge
  integration to port; reading the template page is the documented way.
- One request per interval to `template.cgi`, never `livedata.cgi` (its format
  is not documented field by field) nor any setting page. GET only.
- Units: no converter in the template, the gateway gives its own fixed metric
  units (°C, %, hPa, m/s, mm, mm/h, W/m²); only the wind (m/s -> km/h) and the
  solar radiation (W/m² -> lux, as the approved WeatherLink module) are
  converted, to the units the core lists.
- Freshness: `act` values only (the gateway writes `--` past the hold time of a
  sensor); the rain of the day (`sumday`, which never goes invalid) is gated by
  `rain0total-act`. No source timestamp is read (one request, no `lasttime` per
  sensor): a reading is published for 2 intervals (5 min to 2 h), dated when it
  goes to a device created more than a minute after it, and never after a
  restart.
- Identity: the MAC address of the gateway (`mbsystem-mac`); another MAC at the
  same address is another device.
- Refusal (401 only, the one page read): stop, no automatic try; lifted by new
  credentials or address (tried 15 s later) or by the test button (one try per
  interval). /data keeps 8 bits of a salted SHA-256 of address, user and
  password while refused. 403 is not a refusal.
- 429 / 5xx: pause from Retry-After, else 1 min doubling, 1 to 30 min (a local
  device), persisted.
- At most 36 features per gateway and one read per minute at most: far under
  the 300 states per minute of the core, no extra budget code.
- No `keywords` in the manifest (Louis's rule); `countries` absent (worldwide);
  category `environment`.
- No `poll_frequency`: the module reads at its own pace (`should_poll: false`).
