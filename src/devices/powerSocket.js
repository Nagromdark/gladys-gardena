// -----------------------------------------------------------------------------
// Service type: POWER_SOCKET — the GARDENA smart Power outdoor socket.
//
// A plain relay, with the GARDENA twist: switching it ON can either power it
// for a fixed duration (the safe default — a socket forgotten in the ON state
// is a garden light burning all night) or forever, which is what the
// `power_socket_on_mode` configuration key chooses.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import {
  COMMANDS,
  CONTROL_TYPES,
  POWER_SOCKET_ACTIVE_ACTIVITIES,
  SERVICE_TYPES,
} from '../gardena/constants.js';
import {
  BINARY_BOUNDS,
  TEXT_BOUNDS,
  binaryState,
  featureId,
  minutesToSeconds,
  numberState,
  textState,
} from './helpers.js';

const FEATURE = {
  ON_OFF: 'on-off',
  ACTIVITY: 'activity',
  DURATION: 'duration',
};

/**
 * Is the socket currently powered?
 * @param {string|undefined} activity - GARDENA `activity` attribute.
 * @returns {boolean|undefined} True when powered, undefined when unknown.
 */
export function isPowered(activity) {
  if (activity === undefined) {
    return undefined;
  }
  return POWER_SOCKET_ACTIVE_ACTIVITIES.includes(activity);
}

export const powerSocket = {
  serviceType: SERVICE_TYPES.POWER_SOCKET,

  buildFeatures(ids, service) {
    return [
      {
        name: 'On/Off',
        external_id: featureId(ids, service, FEATURE.ON_OFF),
        category: DEVICE_FEATURE_CATEGORIES.SWITCH,
        type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
        ...BINARY_BOUNDS,
        read_only: false,
        has_feedback: true,
        keep_history: true,
      },
      {
        name: 'Activity',
        external_id: featureId(ids, service, FEATURE.ACTIVITY),
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
        ...TEXT_BOUNDS,
        read_only: true,
        has_feedback: false,
        keep_history: false,
      },
      {
        name: 'Time left',
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
      binaryState(featureId(ids, service, FEATURE.ON_OFF), isPowered(activity)),
      textState(featureId(ids, service, FEATURE.ACTIVITY), activity),
      numberState(featureId(ids, service, FEATURE.DURATION), duration),
    ].filter(Boolean);
  },

  buildCommands(ids, service) {
    return [
      {
        external_id: featureId(ids, service, FEATURE.ON_OFF),
        service_id: service.id,
        control_type: CONTROL_TYPES.POWER_SOCKET,
        resolve: (value, config) => {
          if (!value) {
            return { command: COMMANDS.POWER_SOCKET.STOP_UNTIL_NEXT_TASK, attributes: {} };
          }
          if (config.power_socket_on_mode === 'forever') {
            return { command: COMMANDS.POWER_SOCKET.START_OVERRIDE, attributes: {} };
          }
          return {
            command: COMMANDS.POWER_SOCKET.START_SECONDS_TO_OVERRIDE,
            attributes: { seconds: minutesToSeconds(config.default_duration) },
          };
        },
      },
    ];
  },
};
