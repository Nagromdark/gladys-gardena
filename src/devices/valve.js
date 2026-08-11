// -----------------------------------------------------------------------------
// Service type: VALVE — a watering outlet.
//
// The same service covers two very different products:
//   - the Water Control / Smart Watering: ONE valve on the tap;
//   - the Smart Irrigation Control: SIX valves in a single device.
// A Gladys device mirrors a physical device, so an Irrigation Control publishes
// six independent groups of features. Each valve carries the name given in the
// GARDENA app ("Terrace", "Vegetable garden"...), which is what makes the six
// groups tellable apart.
//
// Switching a valve ON starts a MANUAL watering of the configured duration:
// GARDENA has no "open forever" command on a valve, and that is a good thing —
// a bug in a home automation system must not flood a garden.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import {
  COMMANDS,
  CONTROL_TYPES,
  SERVICE_TYPES,
  VALVE_ACTIVE_ACTIVITIES,
} from '../gardena/constants.js';
import { binaryState, featureId, minutesToSeconds, numberState, textState } from './helpers.js';

const FEATURE = {
  ON_OFF: 'on-off',
  ACTIVITY: 'activity',
  DURATION: 'duration',
};

/**
 * Is water flowing through this valve?
 * @param {string|undefined} activity - GARDENA `activity` attribute.
 * @returns {boolean|undefined} True when watering, undefined when unknown.
 */
export function isWatering(activity) {
  if (activity === undefined) {
    return undefined;
  }
  return VALVE_ACTIVE_ACTIVITIES.includes(activity);
}

/**
 * Prefix of the feature names of a valve: the name given in the GARDENA app,
 * so the six outlets of an Irrigation Control stay readable in Gladys.
 * @param {object} service - VALVE service.
 * @returns {string} A prefix, empty for a single-valve device.
 */
function valveLabel(service) {
  const name = service.attributes?.name;
  return name ? `${name} ` : '';
}

export const valve = {
  serviceType: SERVICE_TYPES.VALVE,

  buildFeatures(ids, service) {
    const label = valveLabel(service);
    return [
      {
        name: `${label}Watering`.trim(),
        external_id: featureId(ids, service, FEATURE.ON_OFF),
        category: DEVICE_FEATURE_CATEGORIES.SWITCH,
        type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
        read_only: false,
        has_feedback: true,
        keep_history: true,
      },
      {
        name: `${label}Activity`.trim(),
        external_id: featureId(ids, service, FEATURE.ACTIVITY),
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
        read_only: true,
        has_feedback: false,
        keep_history: false,
      },
      {
        name: `${label}Watering time left`.trim(),
        external_id: featureId(ids, service, FEATURE.DURATION),
        category: DEVICE_FEATURE_CATEGORIES.DURATION,
        type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
        unit: DEVICE_FEATURE_UNITS.SECONDS,
        min: 0,
        max: 86400,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      },
    ];
  },

  buildStates(ids, service) {
    const { activity, duration } = service.attributes;
    return [
      binaryState(featureId(ids, service, FEATURE.ON_OFF), isWatering(activity)),
      textState(featureId(ids, service, FEATURE.ACTIVITY), activity),
      numberState(featureId(ids, service, FEATURE.DURATION), duration),
    ].filter(Boolean);
  },

  buildCommands(ids, service) {
    return [
      {
        external_id: featureId(ids, service, FEATURE.ON_OFF),
        service_id: service.id,
        control_type: CONTROL_TYPES.VALVE,
        resolve: (value, config) =>
          value
            ? {
                command: COMMANDS.VALVE.START_SECONDS_TO_OVERRIDE,
                attributes: { seconds: minutesToSeconds(config.default_duration) },
              }
            : { command: COMMANDS.VALVE.STOP_UNTIL_NEXT_TASK, attributes: {} },
      },
    ];
  },
};
