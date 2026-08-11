// -----------------------------------------------------------------------------
// Normalization of the GARDENA JSON:API payloads.
//
// The API describes a garden as a flat list of SERVICES, not as devices: one
// physical device (a Water Control, a mower, an Irrigation Control...) appears
// several times in the `included` array, once per service it exposes:
//
//   COMMON      -> name, serial, model, battery, radio link  (every device)
//   MOWER       -> activity, state, operating hours
//   VALVE       -> one per watering outlet (6 on an Irrigation Control)
//   VALVE_SET   -> the group of valves of a device ("stop everything")
//   POWER_SOCKET-> activity, state, duration
//   SENSOR      -> soil humidity/temperature, ambient temperature, light
//
// Every service id starts with the device id: `<deviceId>` for a single-service
// device, `<deviceId>:<suffix>` for the others (`:wc`, `:1` ... `:6`).
//
// This module turns all of that into ONE object per physical device, which is
// also what a Gladys device is. Attribute values are flattened: the API wraps
// them in `{ value, timestamp }`.
// -----------------------------------------------------------------------------

import { RF_LINK_STATE_ONLINE, SERVICE_TYPES, SUPPORTED_SERVICE_TYPES } from './constants.js';

/**
 * Extract the device id from any service id (`<deviceId>[:<suffix>]`).
 * @param {string} serviceId - Service id.
 * @returns {string} The device id.
 */
export function deviceIdOf(serviceId) {
  return String(serviceId).split(':')[0];
}

/**
 * Suffix identifying a service among the services of the same type on one
 * device (`:wc` on a Water Control, `:1`...`:6` on an Irrigation Control).
 * Returns `0` when the service id IS the device id, so feature keys stay stable
 * whatever the device layout.
 * @param {string} serviceId - Service id.
 * @returns {string} The suffix, sanitized for use in an external id.
 */
export function serviceSuffixOf(serviceId) {
  const [, suffix] = String(serviceId).split(':');
  return (suffix ?? '0').replace(/[^a-zA-Z0-9]/g, '');
}

/**
 * Flatten the `{ value, timestamp }` wrappers of a service payload.
 * @param {object} service - Raw JSON:API service.
 * @returns {Record<string, unknown>} Plain attribute values.
 */
export function flattenAttributes(service) {
  const attributes = {};
  for (const [key, wrapper] of Object.entries(service?.attributes ?? {})) {
    attributes[key] = wrapper && typeof wrapper === 'object' ? wrapper.value : wrapper;
  }
  return attributes;
}

/**
 * Build the devices of a location out of the raw `GET /locations/{id}` payload.
 * @param {object} payload - Raw JSON:API payload.
 * @param {string} [locationName] - Name of the location, kept for the logs.
 * @returns {Map<string, object>} Devices, keyed by device id.
 */
export function parseLocation(payload, locationName) {
  const locationId = payload?.data?.id;
  const devices = new Map();
  for (const service of payload?.included ?? []) {
    if (!SUPPORTED_SERVICE_TYPES.includes(service.type)) {
      continue;
    }
    const deviceId = deviceIdOf(service.id);
    if (!devices.has(deviceId)) {
      devices.set(deviceId, createDevice(deviceId, locationId, locationName));
    }
    applyService(devices.get(deviceId), service);
  }
  // A device with no COMMON service is not usable: no name, no radio state.
  for (const [deviceId, device] of devices) {
    if (!device.common) {
      devices.delete(deviceId);
    }
  }
  return devices;
}

/**
 * Apply a service payload (from the REST refresh or from the websocket) on a
 * device, MERGING its attributes: a websocket message carries only the
 * attributes that changed.
 * @param {object} device - Normalized device.
 * @param {object} service - Raw JSON:API service.
 * @returns {object} The same device, mutated.
 */
export function applyService(device, service) {
  const attributes = flattenAttributes(service);
  if (service.type === SERVICE_TYPES.COMMON) {
    device.common = { ...(device.common ?? {}), ...attributes };
    device.name = device.common.name ?? device.name;
    return device;
  }
  if (service.type === SERVICE_TYPES.DEVICE) {
    // The DEVICE service only carries relationships, nothing to merge.
    return device;
  }
  const list = device.services[service.type] ?? [];
  const existing = list.find((item) => item.id === service.id);
  if (existing) {
    existing.attributes = { ...existing.attributes, ...attributes };
  } else {
    list.push({ id: service.id, type: service.type, attributes });
    // Keep a stable order: the UI must not reshuffle the valves of an
    // Irrigation Control between two refreshes.
    list.sort((a, b) => a.id.localeCompare(b.id));
  }
  device.services[service.type] = list;
  return device;
}

/**
 * Apply a websocket message on a device map.
 * @param {Map<string, object>} devices - Devices, keyed by device id.
 * @param {object} message - Parsed websocket message (one JSON:API service).
 * @returns {object|undefined} The updated device, or undefined when unknown.
 */
export function applyWebsocketMessage(devices, message) {
  if (!message?.id || !SUPPORTED_SERVICE_TYPES.includes(message.type)) {
    return undefined;
  }
  const device = devices.get(deviceIdOf(message.id));
  if (!device) {
    // A device added in the GARDENA app while we were connected: a REST
    // refresh is needed to learn about it, the caller decides.
    return undefined;
  }
  return applyService(device, message);
}

function createDevice(deviceId, locationId, locationName) {
  return {
    id: deviceId,
    locationId,
    locationName,
    name: deviceId,
    common: null,
    services: {},
  };
}

/**
 * Services of a given type carried by a device (never undefined).
 * @param {object} device - Normalized device.
 * @param {string} type - Service type.
 * @returns {Array<object>} The services.
 */
export function servicesOfType(device, type) {
  return device.services[type] ?? [];
}

/**
 * Is the device answering on the GARDENA radio link?
 * @param {object} device - Normalized device.
 * @returns {boolean} True when `rfLinkState` is ONLINE.
 */
export function isOnline(device) {
  return device.common?.rfLinkState === RF_LINK_STATE_ONLINE;
}
