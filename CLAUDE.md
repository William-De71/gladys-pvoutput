# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for [PVOutput](https://pvoutput.org),
the free service where owners of solar systems share their production: a
Node.js service (Node 22+, ESM, no build step) in its own sandboxed Docker
container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency, and to the official PVOutput API
(<https://pvoutput.org/help/api_specification.html>) with the user's own key,
for up to five systems of one account. `type: "device"`, Gladys 5.1.0+
(widgets, scenes), `transports: ["cloud"]`. Not affiliated with PVOutput.
**Never tested with a real account**: the answers come from the
specification; only the refusal of a wrong key was checked live
("Unauthorized 401: Missing, invalid or inactive api key information
(X-Pvoutput-Apikey)", HTTP 401).

## Commands

```bash
npm install
npm test                                  # node --test; a fake PVOutput HTTP server on 127.0.0.1
node --test test/app.test.js              # one file
UPDATE_BASELINE=1 npm test                # rewrite test/fixtures/discovery.baseline.json (on purpose only)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js               SDK wiring only (new GladysIntegration + createApp)
src/app.js             every handler; the timer (what is due per system, within the budget),
                       devices and states, scene events, scene actions, widgets, status
src/pvoutput-api.js    HTTP client: key and System Id in headers, GET reads / POST writes,
                       X-Rate-Limit: 1, one request at a time, error kinds from the messages
src/parse.js           the CSV answers (`,` fields, `;` records, NaN = absent)
src/budget.js          quota of the key (60 or 300 an hour, getstatistic 12 or 60), reserve
                       for the scenes, pause until the reset, intervals stretched per system
src/sun.js             sunrise and sunset (NOAA equations): night, silence window, summary time
src/time.js            local dates and times of each system (Intl only, changes of time)
src/device.js          one device per system, its features and states
src/events.js          triggers (silence by day, summary, record), payloads, get_today outputs
src/actions.js         fields of send_status / send_daily_output -> addstatus / addoutput
src/widgets.js         production and days widgets
src/store.js           /data/pvoutput.json
src/config.js          key, System Ids, donation, language
src/i18n.js            runtime texts, en / fr / de / es
test/helpers/fake-pvoutput.js   the fake PVOutput (answers, quota headers, refusals)
.github/scripts/release.mjs     version, changelog, bump (tested in test/)
```

## Rules

- **External ids are forever**, and so is every key users store:
  `ext:<selector>:system:<System Id>`, features `…:<key>` (`power`,
  `energy_today`, `lifetime_energy`, `consumption_power`, `consumption_today`,
  `temperature`, `voltage`), feature `category` / `type` / `unit` / `min` /
  `max`, the keys of `config_schema` and `actions`, `last_language`, widgets
  and settings, triggers (fields, variables), scene actions (fields, option
  values, outputs). `test/structure.test.js` compares them to
  `test/fixtures/discovery.baseline.json`: never update it to make a test pass
  without a documented migration. The max of `power` / `energy_today` follows
  the size of the system: a size changed on PVOutput shows "Update".
- **Features never flap.** Consumption, temperature, voltage and lifetime
  appear once PVOutput gave a value, kept in /data, never removed. No
  `daily-consumption` (Gladys would price it), no export feature (no daily
  type), no yield feature (no unit).
- **The quota.** Every request goes through the budget: readings never use
  the reserve; a 403 "Exceeded" pauses everything until the reset; the quota
  headers win over the local log. Never a request from a widget handler, a
  `get_today` action, or at startup before its time. The curve of the day only
  while a production widget is shown.
- **`should_poll` stays false**: the integration has its own timer.
- **The key** is a `secret`: never logged, never in /data, only in request
  headers (never in a URL), stripped from messages.
- **Times**: PVOutput dates are local to the system: its getsystem timezone,
  else TZ, else UTC. Never `new Date().getHours()`.
- **Scene events** once per transition, never at the first reading, never
  from a scene action; silence only by day (sun up, an hour after sunrise to
  an hour before sunset); one summary a day.
- **Scene action values are `string` fields**: only those take `{{…}}` in the
  scene editor of Gladys 5.1.0+. 10 fields at most per action.
- **The container rootfs is read-only.** Write only under `/data`.
- **Four languages.** Every user-facing text (manifest, `src/i18n.js`,
  `docs/*.md`, README) exists in en, fr, de, es; `test/i18n.test.js` checks it.
  German says "du", Spanish "usted".
- **Widget images.** After any change to a widget content, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
  Below 1.0.0 until the maintainer runs Release with `release-as: 1.0.0`.
- **Changelog.** Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Commits and PR titles** follow Conventional Commits, in English.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

## Pitfalls

- getsystem: the name may hold a comma — fields are read from the end.
- getstatus without a date returns the last status of the last 7 days, or
  "Bad request 400: No status found" (not an error).
- `0` may mean "not reported" for the export and the consumption of an
  output: a feature needs a value above 0 once.
- The hour repeated when the clocks go back: the history is ordered, the
  second pass gets one hour more (`parse.js`).
- `node --test` also runs `test/helpers/`: nothing starts on import.
- The validator of the Gladys core creates `gladys-development.duckdb` in the
  current folder: run it from elsewhere.
