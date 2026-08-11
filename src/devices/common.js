// -----------------------------------------------------------------------------
// Service type: COMMON — carried by EVERY GARDENA device.
//
// It holds the identity (name, serial, model) and the two values that tell
// whether the device is healthy: the battery level and the quality of the
// GARDENA radio link.
//
// Mains-powered devices (Power Socket, Irrigation Control) report no battery:
// the feature is only created when the attribute exists, which is a permanent
// property of the model — not a value that comes and goes.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { numberState } from './helpers.js';

export const FEATURE_KEYS = {
  BATTERY: 'common-battery',
  SIGNAL: 'common-signal',
};

/**
 * Features derived from the COMMON service of a device.
 * @param {{feature: Function}} ids - Ids returned by `gladys.externalIds()`.
 * @param {object} device - Normalized GARDENA device.
 * @returns {Array<object>} Gladys features.
 */
export function buildCommonFeatures(ids, device) {
  const features = [];
  const common = device.common ?? {};

  if (common.batteryLevel !== undefined) {
    features.push({
      name: 'Battery',
      external_id: ids.feature(FEATURE_KEYS.BATTERY),
      category: DEVICE_FEATURE_CATEGORIES.BATTERY,
      type: DEVICE_FEATURE_TYPES.BATTERY.INTEGER,
      unit: DEVICE_FEATURE_UNITS.PERCENT,
      min: 0,
      max: 100,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    });
  }

  if (common.rfLinkLevel !== undefined) {
    features.push({
      name: 'Signal quality',
      external_id: ids.feature(FEATURE_KEYS.SIGNAL),
      category: DEVICE_FEATURE_CATEGORIES.SIGNAL,
      type: DEVICE_FEATURE_TYPES.SIGNAL.QUALITY,
      unit: DEVICE_FEATURE_UNITS.PERCENT,
      min: 0,
      max: 100,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    });
  }

  return features;
}

/**
 * States derived from the COMMON service of a device.
 * @param {{feature: Function}} ids - Ids returned by `gladys.externalIds()`.
 * @param {object} device - Normalized GARDENA device.
 * @returns {Array<object>} Entries for `publishStates`.
 */
export function buildCommonStates(ids, device) {
  const common = device.common ?? {};
  return [
    numberState(ids.feature(FEATURE_KEYS.BATTERY), common.batteryLevel),
    numberState(ids.feature(FEATURE_KEYS.SIGNAL), common.rfLinkLevel),
  ].filter(Boolean);
}
