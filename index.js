// -----------------------------------------------------------------------------
// Entry point of the PVOutput external integration.
//
// The solar systems of a PVOutput account (pvoutput.org), through the
// official API and the API key of the account:
//   - devices: one per system (power and energy produced, lifetime production,
//     and consumption, temperature and voltage when the system publishes
//     them), offered on the Discovery screen (see src/device.js);
//   - scene triggers: system silent / back by day, summary of the day, record
//     yield, key refused;
//   - scene actions: send a live status or the output of a day from values of
//     Gladys, read the day of a system;
//   - dashboard widgets: today at a system, its last 30 days.
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
//   TZ (the timezone of Gladys: the one of a system without its own)
// The SDK reads the first three: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
createApp(gladys);

// --- Startup -----------------------------------------------------------------------
logger.info(`Starting the PVOutput integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
