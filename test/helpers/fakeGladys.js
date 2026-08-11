// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the only surface the integration relies on, and records every
// call so the tests can assert what was published — no Gladys server, no
// WebSocket, no network.
// -----------------------------------------------------------------------------

export function createFakeGladys({ devices = [] } = {}) {
  const published = [];
  const discovered = [];
  const transports = [];
  const connectionStatuses = [];

  return {
    // `gladys.devices` holds the devices the user created; the SDK keeps it up
    // to date. The integration uses it to avoid publishing states for a device
    // nobody created.
    devices,
    published,
    discovered,
    transports,
    connectionStatuses,

    externalIds(type, platformId) {
      const device = `ext:test:${type}:${platformId}`;
      return {
        device,
        feature: (key) => `${device}:${key}`,
      };
    },

    async publishDiscoveredDevices(list) {
      discovered.push(list);
    },

    async publishState(featureExternalId, state) {
      published.push({ featureExternalId, state });
    },

    async publishStates(states) {
      for (const state of states) {
        published.push({
          featureExternalId: state.device_feature_external_id,
          state: state.state,
          text: state.text,
        });
      }
    },

    async publishTransports(entries) {
      transports.push(...entries);
    },

    async setConnectionStatus(connected, message) {
      connectionStatuses.push({ connected, message });
    },
  };
}

/**
 * Build the `gladys.devices` entry of an already-created device, out of the
 * discovery payload the integration produced.
 * @param {object} discoveredDevice - A device built by `buildDevice()`.
 * @returns {object} The same device, as Gladys would return it.
 */
export function asCreatedDevice(discoveredDevice) {
  return {
    external_id: discoveredDevice.external_id,
    name: discoveredDevice.name,
    features: discoveredDevice.features.map((feature) => ({
      external_id: feature.external_id,
    })),
  };
}
