// -----------------------------------------------------------------------------
// Entry point of the GARDENA smart system integration for Gladys Assistant.
//
// Role of this file: wire the Gladys SDK to the GARDENA service. It holds no
// GARDENA logic — the session, the real-time stream and the device mapping live
// in `src/`. Here we only:
//   1. instantiate the SDK (connection, auth, reconnection: handled for us);
//   2. register the event handlers BEFORE connect();
//   3. connect, then open the GARDENA session with the user configuration.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { isConfigured, needsReconnect, normalizeConfig } from './src/config.js';
import { GardenaService } from './src/gardenaService.js';

const gladys = new GladysIntegration();
const gardena = new GardenaService(gladys);

let config = normalizeConfig();

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> refreshing the GARDENA account');
  if (!isConfigured(config)) {
    throw new Error('The GARDENA application key and secret are not configured yet');
  }
  await gardena.refreshLocations({ maxAgeMs: 30_000 });
  await gardena.publishDiscoveredDevices();
});

// --- Command: the user acts on a controllable feature ------------------------
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  // Throwing sends a success:false acknowledgement back to Gladys, which is
  // what makes the UI show the command as failed instead of pretending.
  await gardena.onSetValue(device, feature, value);
});

// --- Polling: the safety net behind the real-time stream ---------------------
gladys.onPoll(async (device) => {
  await gardena.onPoll(device);
});

// --- A device was created: publish its current values right away -------------
// A brand new device has no state, and its GARDENA values may not have changed
// since the last refresh: publish a full snapshot so its card is never empty.
gladys.onDeviceCreated(async () => {
  await gardena.publishSnapshot();
});

// --- Manifest actions: buttons in the Configuration screen -------------------
gladys.onAction('test_connection', () => gardena.testConnection());
gladys.onAction('refresh_devices', () => gardena.refreshDevices());
gladys.onAction('stop_all_watering', (fields) => gardena.stopAllWatering(fields.device));

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  const previous = config;
  config = normalizeConfig(newConfig);
  try {
    await gardena.applyConfig(config, needsReconnect(previous, config));
  } catch (err) {
    // Wrong credentials are the usual case here: the reason is already shown in
    // the Configuration screen by the service, no need to fail the save too.
    logger.error('Applying the new configuration failed', err);
  }
});

// --- Connection lifecycle ----------------------------------------------------
// The SDK logs the WebSocket lifecycle itself (under the `gladys-sdk` name);
// these handlers only run the integration's own (re)initialization.
gladys.on('connected', async () => {
  try {
    config = normalizeConfig(await gladys.getConfig());
    await gardena.start(config);
  } catch (err) {
    // start() already reported the failure in the Configuration screen; the
    // GARDENA session will be retried on the next reconnection or config save.
    logger.error('GARDENA initialization failed', err);
  }
});

gladys.on('disconnected', () => {
  // Nothing to publish while Gladys is unreachable: close the GARDENA streams
  // instead of accumulating states nobody listens to.
  gardena.stop();
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  gardena.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the GARDENA smart system integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
