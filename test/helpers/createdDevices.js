// -----------------------------------------------------------------------------
// Test helpers around the devices the user created in Gladys.
//
// The fake Gladys itself comes from the SDK
// (`@gladysassistant/integration-sdk/testing`): a real GladysIntegration bound
// to an in-memory Gladys that validates every payload like the host API does.
// A hand-written stand-in accepts anything — which is exactly how a device
// published without `should_poll` went unnoticed.
// -----------------------------------------------------------------------------

/**
 * Turn a discovery payload into the device Gladys serves once the user created
 * it (`gladys.devices`): the integration only publishes states for those.
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
