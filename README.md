# gladys-meteobridge

Unofficial [Gladys Assistant](https://gladysassistant.com) integration for the
**weather station behind a Meteobridge gateway** (Davis, Ecowitt, Fine Offset,
WeatherFlow...), read locally through the template page of the gateway, no
cloud. Not affiliated with smartbedded (Meteobridge).

**Never tested with a real Meteobridge**: built from the official
[Meteobridge wiki](https://www.meteobridge.com/wiki/index.php/Templates).

User documentation: [English](docs/en.md) · [Français](docs/fr.md).

- One device per gateway (its MAC address): temperature, humidity, dew point,
  pressure, wind, rain, UV, solar radiation, PM2.5, extra sensors 1 to 8, low
  batteries.
- One GET per interval (1 to 60 minutes), HTTP Basic with the user name and
  password of the gateway web interface. Read only.
- A sensor not heard stays unknown, never 0; refused credentials are never sent
  again by themselves; a busy gateway gets a pause.

## Development

```bash
npm install
npm test
npm run lint && npm run format:check
```

See [CLAUDE.md](CLAUDE.md) for the architecture and the rules, and
[TODO.md](TODO.md) for what is left and the decisions taken.

## License

Apache-2.0, see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
