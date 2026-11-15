# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-11-15

### Added

- The weather station behind your Meteobridge gateway in Gladys, read only, on
  your local network: one request per interval (1 minute by default) to the
  template page of the gateway, with its user name and password (HTTP Basic).
  One device per gateway with temperature, humidity, dew point, pressure, wind,
  rain, UV, solar radiation, PM2.5, extra sensors 1 to 8 and low batteries. A
  sensor not heard stays unknown, never 0. Refused credentials are never sent
  again by themselves; a busy gateway gets a pause. Never tested with a real
  Meteobridge yet.

[Unreleased]: https://github.com/LM1LC3N7/gladys-meteobridge/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-meteobridge/releases/tag/v0.1.1
