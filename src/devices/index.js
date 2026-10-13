// -----------------------------------------------------------------------------
// Device registry: GARDENA services -> Gladys devices.
//
// One Gladys device per PHYSICAL GARDENA device (what the user sees in the
// garden and in the GARDENA app), whatever the number of services behind it: a
// Smart Irrigation Control is one device with six valves, not six devices.
//
// Each service module (mower, valve, power socket, sensor) exposes the same
// three builders, so adding a future GARDENA service type is a matter of
// writing one file and adding it to SERVICE_MODULES:
//   - buildFeatures(ids, service) -> the Gladys features of the service;
//   - buildStates(ids, service)   -> the states to publish for the service;
//   - buildCommands(ids, service) -> the controllable features and the GARDENA
//                                    command each one maps to.
// -----------------------------------------------------------------------------

import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import { SERVICE_TYPES } from '../gardena/constants.js';
import { servicesOfType } from '../gardena/model.js';
import { buildCommonFeatures, buildCommonStates } from './common.js';
import { mower } from './mower.js';
import { powerSocket } from './powerSocket.js';
import { sensor } from './sensor.js';
import { valve } from './valve.js';

// The GARDENA "device type" used to build the external ids. Changing this
// string would orphan every device already created by the users.
export const DEVICE_TYPE = 'gardena';

// Gladys polls a device only when it is published with BOTH `should_poll: true`
// and a `poll_frequency` — a device missing the flag is simply never polled,
// silently (see device.add.js in the core). And `poll_frequency` is NOT a free
// number of seconds: it is an enum in MILLISECONDS (1 s, 2 s, 10 s, 15 s, 30 s,
// 60 s — DEVICE_POLL_FREQUENCIES), anything else being rejected with "invalid
// poll frequency". One minute is the slowest Gladys offers.
//
// That is NOT the rate at which GARDENA is called: `onPoll` answers from the
// shared in-memory picture, and only re-reads the GARDENA API when it is older
// than the user's `poll_frequency` configuration (in seconds). Gladys ticks
// every minute, GARDENA is read every hour by default.
//
// Both fields are read when the user CREATES the device: changing them in a
// later publication does not affect a device already created.
export const GLADYS_POLL_FREQUENCY_MS = DEVICE_POLL_FREQUENCIES.EVERY_MINUTES;

export const SERVICE_MODULES = [mower, valve, powerSocket, sensor];

/**
 * Ids of a GARDENA device, in the Gladys format.
 * @param {object} gladys - The SDK instance.
 * @param {object} device - Normalized GARDENA device.
 * @returns {{device: string, feature: Function}} The external ids.
 */
export function idsOf(gladys, device) {
  return gladys.externalIds(DEVICE_TYPE, device.id);
}

/**
 * Build the Gladys device published to the discovery screen.
 * @param {object} gladys - The SDK instance.
 * @param {object} device - Normalized GARDENA device.
 * @returns {object} A Gladys device.
 */
export function buildDevice(gladys, device) {
  const ids = idsOf(gladys, device);
  const features = [...buildCommonFeatures(ids, device)];
  for (const module of SERVICE_MODULES) {
    for (const service of servicesOfType(device, module.serviceType)) {
      features.push(...module.buildFeatures(ids, service));
    }
  }
  return {
    name: device.name,
    external_id: ids.device,
    // The websocket carries the real-time changes; polling is the safety net
    // for a missed message or a websocket the network keeps cutting. Without
    // `should_poll`, Gladys never calls onPoll and that safety net never arms.
    // The GARDENA API is not hit at this rate — see GLADYS_POLL_FREQUENCY_MS.
    should_poll: true,
    poll_frequency: GLADYS_POLL_FREQUENCY_MS,
    features,
    params: buildParams(device),
  };
}

/**
 * Build every state of a device, ready for `publishStates`.
 * @param {object} gladys - The SDK instance.
 * @param {object} device - Normalized GARDENA device.
 * @returns {Array<object>} Entries for `publishStates`.
 */
export function buildStates(gladys, device) {
  const ids = idsOf(gladys, device);
  const states = [...buildCommonStates(ids, device)];
  for (const module of SERVICE_MODULES) {
    for (const service of servicesOfType(device, module.serviceType)) {
      states.push(...module.buildStates(ids, service));
    }
  }
  return states;
}

/**
 * Build the command index of a device: the controllable features, and for each
 * one the GARDENA service and command to send.
 * @param {object} gladys - The SDK instance.
 * @param {object} device - Normalized GARDENA device.
 * @returns {Array<object>} Command descriptors.
 */
export function buildCommands(gladys, device) {
  const ids = idsOf(gladys, device);
  const commands = [];
  for (const module of SERVICE_MODULES) {
    for (const service of servicesOfType(device, module.serviceType)) {
      commands.push(...module.buildCommands(ids, service));
    }
  }
  return commands;
}

/**
 * Ids of the VALVE_SET services of a device — the groups of valves that can be
 * stopped in one call ("stop all watering").
 * @param {object} device - Normalized GARDENA device.
 * @returns {Array<string>} Service ids.
 */
export function valveSetIds(device) {
  return servicesOfType(device, SERVICE_TYPES.VALVE_SET).map((service) => service.id);
}

/**
 * Device params: the GARDENA identity, shown in the Gladys device screen. They
 * are upserted on every re-publication, so a device renamed or upgraded in the
 * GARDENA app stays accurate without the user doing anything.
 * @param {object} device - Normalized GARDENA device.
 * @returns {Array<{name: string, value: string}>} Params.
 */
function buildParams(device) {
  const params = [
    { name: 'GARDENA_DEVICE_ID', value: device.id },
    { name: 'GARDENA_MODEL', value: device.common?.modelType },
    { name: 'GARDENA_SERIAL', value: device.common?.serial },
    { name: 'GARDENA_LOCATION', value: device.locationName ?? device.locationId },
  ];
  return params
    .filter((param) => param.value !== undefined && param.value !== null)
    .map((param) => ({ name: param.name, value: String(param.value) }));
}
