// -----------------------------------------------------------------------------
// Service type: MOWER — the GARDENA robotic mowers (SILENO & co).
//
// A mower is exposed as:
//   - a controllable ON/OFF switch: ON sends the mower out, OFF parks it. What
//     "out" and "parked" mean exactly is a user choice (respect the schedule or
//     override it), hence the four configuration modes below;
//   - three read-only text/number sensors mirroring what the GARDENA app shows:
//     the activity, the health state and the operating hours.
//
// The ON/OFF state is NOT the requested value: it is recomputed from the
// `activity` pushed back by GARDENA, so a mower stopped by rain, by its own
// schedule or from the GARDENA app shows up correctly in Gladys.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import {
  COMMANDS,
  CONTROL_TYPES,
  MOWER_ACTIVE_ACTIVITIES,
  SERVICE_TYPES,
} from '../gardena/constants.js';
import { binaryState, featureId, minutesToSeconds, numberState, textState } from './helpers.js';

const FEATURE = {
  ON_OFF: 'on-off',
  ACTIVITY: 'activity',
  STATE: 'state',
  OPERATING_HOURS: 'operating-hours',
  ERROR: 'error',
};

/**
 * Is the mower currently out of its dock and working?
 * @param {string|undefined} activity - GARDENA `activity` attribute.
 * @returns {boolean|undefined} True when mowing, undefined when unknown.
 */
export function isMowing(activity) {
  if (activity === undefined) {
    return undefined;
  }
  return MOWER_ACTIVE_ACTIVITIES.includes(activity);
}

export const mower = {
  serviceType: SERVICE_TYPES.MOWER,

  buildFeatures(ids, service) {
    return [
      {
        name: 'Mowing',
        external_id: featureId(ids, service, FEATURE.ON_OFF),
        category: DEVICE_FEATURE_CATEGORIES.SWITCH,
        type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
        read_only: false,
        // The confirmation comes from GARDENA (websocket), not from the command.
        has_feedback: true,
        keep_history: true,
      },
      {
        name: 'Activity',
        external_id: featureId(ids, service, FEATURE.ACTIVITY),
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
        read_only: true,
        has_feedback: false,
        keep_history: false,
      },
      {
        name: 'State',
        external_id: featureId(ids, service, FEATURE.STATE),
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
        read_only: true,
        has_feedback: false,
        keep_history: false,
      },
      {
        name: 'Last error',
        external_id: featureId(ids, service, FEATURE.ERROR),
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
        read_only: true,
        has_feedback: false,
        keep_history: false,
      },
      {
        name: 'Operating hours',
        external_id: featureId(ids, service, FEATURE.OPERATING_HOURS),
        category: DEVICE_FEATURE_CATEGORIES.DURATION,
        type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
        unit: DEVICE_FEATURE_UNITS.HOURS,
        min: 0,
        max: 100000,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      },
    ];
  },

  buildStates(ids, service) {
    const { activity, state, operatingHours, lastErrorCode } = service.attributes;
    return [
      binaryState(featureId(ids, service, FEATURE.ON_OFF), isMowing(activity)),
      textState(featureId(ids, service, FEATURE.ACTIVITY), activity),
      textState(featureId(ids, service, FEATURE.STATE), state),
      textState(featureId(ids, service, FEATURE.ERROR), lastErrorCode),
      numberState(featureId(ids, service, FEATURE.OPERATING_HOURS), operatingHours),
    ].filter(Boolean);
  },

  buildCommands(ids, service) {
    return [
      {
        external_id: featureId(ids, service, FEATURE.ON_OFF),
        service_id: service.id,
        control_type: CONTROL_TYPES.MOWER,
        resolve: (value, config) => (value ? startCommand(config) : stopCommand(config)),
      },
    ];
  },
};

/**
 * Command sent when the user switches the mower ON.
 *
 * `duration` overrides the schedule for a fixed time (a one-off mow), while
 * `schedule` asks the mower to work but keeps its calendar and its sensors in
 * charge — the mower may go back to the dock on its own, which is what most
 * users expect from a simple ON.
 * @param {object} config - Integration configuration.
 * @returns {{command: string, attributes: object}} The GARDENA command.
 */
function startCommand(config) {
  if (config.mower_start_mode === 'duration') {
    return {
      command: COMMANDS.MOWER.START_SECONDS_TO_OVERRIDE,
      attributes: { seconds: minutesToSeconds(config.mower_duration) },
    };
  }
  return { command: COMMANDS.MOWER.START_DONT_OVERRIDE, attributes: {} };
}

/**
 * Command sent when the user switches the mower OFF.
 *
 * `next_task` parks the mower but keeps its schedule (it will leave again at
 * the next scheduled slot); `further_notice` cancels the schedule until someone
 * starts the mower again — the "I am working in the garden this week" mode.
 * @param {object} config - Integration configuration.
 * @returns {{command: string, attributes: object}} The GARDENA command.
 */
function stopCommand(config) {
  if (config.mower_stop_mode === 'further_notice') {
    return { command: COMMANDS.MOWER.PARK_UNTIL_FURTHER_NOTICE, attributes: {} };
  }
  return { command: COMMANDS.MOWER.PARK_UNTIL_NEXT_TASK, attributes: {} };
}
