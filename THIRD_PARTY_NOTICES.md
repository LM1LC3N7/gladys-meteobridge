# Third-party notices

This integration is licensed under Apache-2.0 (see `LICENSE`). It embeds and
ports no third-party code: its only runtime dependency is
`@gladysassistant/integration-sdk` (Apache-2.0), installed by npm.

## Meteobridge documentation

The request (`/cgi-bin/template.cgi`, the `template` and `contenttype`
parameters, HTTP Basic authentication), the template syntax
(`[sensor-selector:replacement]`, the `act` and `sumday` selectors, the
`mbsystem-*` system variables), the sensor names and their units were read in
the official Meteobridge wiki by smartbedded:

- https://www.meteobridge.com/wiki/index.php/Add-On_Services
- https://www.meteobridge.com/wiki/index.php/Templates

(read on 2026-11-15). No text or code of the wiki is reproduced beyond the tag
names the gateway understands. Meteobridge is a product of smartbedded; this
integration is not affiliated with it.
