// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. Every handler is registered BEFORE connect(),
// and delegates to the MeteobridgeApp (src/app.js). Read only: no command
// handler.
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { MeteobridgeApp } from './src/app.js';
import { ACTION_TEST } from './src/constants.js';

const gladys = new GladysIntegration();
const app = new MeteobridgeApp({ gladys });

// --- Discovery: the gateway already read (no extra request) --------------------
gladys.onScanRequest(() => app.publishDiscovered({ force: true }));

// --- A device was created: its current values now, not at the next read -------
gladys.onDeviceCreated(() => app.publishStates());

// --- Configuration screen button ----------------------------------------------
gladys.onAction(ACTION_TEST, () => app.testConnection());

// --- Configuration changed by the user ----------------------------------------
gladys.onConfigUpdated((config) => {
  logger.info('Configuration updated: restarting');
  return app.start(config);
});

// --- Connection lifecycle ------------------------------------------------------
// Messages sent while disconnected are lost: re-read the config every time
// (retried without end when Gladys cannot answer). The reads keep their pace.
gladys.on('connected', () => {
  app.connected().catch((err) => logger.error(`Start failed (${err?.name ?? 'Error'})`));
});

gladys.on('disconnected', () => {
  app.stop().catch((err) => logger.error(`Stop failed (${err?.name ?? 'Error'})`));
});

gladys.handleShutdown(() => app.shutdown());

logger.info('Starting the Meteobridge integration...');
gladys.connect().catch((err) => {
  logger.error(`Initial connection failed (${err?.name ?? 'Error'})`);
  process.exit(1);
});
