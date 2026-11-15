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
      (documented, never seen). The rain of the day is gated by
      `rain0rate-act` (the wiki reads the cumulative `rain0total` with sum
      selectors only): check that a gauge out of range writes `--` there.
- [ ] `wind0wind`: the wiki says "wind speed"; shown as the gust (the average
      is `wind0avgwind`). `air0pm`: the wiki says "pollution in µg/m³"; shown
      as PM2.5. The extra sensors `th1` to `th8` are not in the wiki table
      (it lists `t0temp`); confirm their names on a gateway with extra sensors.
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

## Review r1, minor points left (low stakes, behaviour kept)

- [ ] Tests for: the error body cancelled on an HTTP error, the /data
      sanitizing (pause bound, `failures` bound, salt, unknown fields), the
      30-minute heartbeat, the pause kept after a refusal, the status not
      sent twice, a /data write that outlives its bound.

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
  `rain0rate-act` (review r1: `act` is not a selector of the cumulative
  `rain0total`). No source timestamp is read (one request, no `lasttime` per
  sensor): a reading is published for 2 intervals (5 min to 2 h), dated when it
  goes to a device created more than a minute after it, and never after a
  restart.
- Outdoor temperature, dew point, wind chill and the extra sensors are
  `probe` (out of the room temperature average of the core); only the indoor
  temperature is `decimal` (review r1).
- Humidity 0 % is left out (a console without a sensor); a wind direction of
  0 is north, kept.
- Addresses: validated through the WHATWG URL parser (what fetch uses); only
  the canonical dotted IPv4 form is accepted, never 0.0.0.0/8, multicast nor
  broadcast (hex and integer forms included).
- `connected()`: an epoch ended by stop(), shutdown() and a saved
  configuration; a late `getConfig()` neither starts the module nor arms a
  retry.
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
- [ ] r2 mineurs : tests pour shutdown() sans endEpoch() et endEpoch() sans clearTimeout.
