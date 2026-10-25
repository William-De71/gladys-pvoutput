# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.2.0] - 2026-10-25

### Added

- require Gladys 5.3 and declare catalog keywords ([bfdd5d3](https://github.com/William-De71/gladys-pvoutput/commit/bfdd5d3141bec9fae9e595cabd25932c0088abd6))

## [0.1.1] - 2026-10-24

### Security

- **security:** build the image on Node.js 24.22.1 or later ([0ffa51c](https://github.com/William-De71/gladys-pvoutput/commit/0ffa51cca3042c5f7a72da1fc72cbdc307b86193))

## [0.1.0] - 2026-10-23

### Added

- **systems:** follow up to five solar systems of a PVOutput account with its API key (a read only key reads; the standard key also sends), through the official API, the key and the System Id in request headers only
- **devices:** one device per system, named like it on PVOutput: power produced, energy produced today, lifetime production (a production index, for the history), and the power and energy consumed today, the temperature and the voltage when the system publishes them; a feature once found never disappears
- **quota:** the readings stay within the 60 requests an hour of the key (300 in donation mode, getstatistic 12 or 60) and keep a reserve for the scenes, follow the quota headers of PVOutput, pause until the reset when it is reached, stretch with the number of systems and slow down at night (sunrise and sunset computed at each system, in its own timezone)
- **scenes:** triggers when a system goes silent by day or publishes again, for the summary of the day an hour after sunset, for a record yield and when the key is refused; actions that send a live status (W, kWh or Wh, lifetime indexes, net data) or the output of a day (production, export, consumption, peak and off-peak import, temperatures, condition, comment) from values of Gladys, and that read the day of a system
- **widgets:** today at a system (power now, energy of the day, consumption or export, yield, the curve of the day, last status, requests left) and its last 30 days (bars, month, best day, average, record yield, lifetime production)
- **configuration:** a "Test the connection" button (name, size, status interval, timezone, requests left) and a "Diagnostic" button
- **i18n:** English, French, German and Spanish for the manifest, the runtime texts, the documentation and the README

[0.2.0]: https://github.com/William-De71/gladys-pvoutput/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/William-De71/gladys-pvoutput/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/William-De71/gladys-pvoutput/releases/tag/v0.1.0
