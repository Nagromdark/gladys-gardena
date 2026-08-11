// -----------------------------------------------------------------------------
// Constants of the GARDENA smart system API (public API published by GARDENA /
// Husqvarna Group on https://developer.husqvarnagroup.cloud).
//
// Two hosts are involved:
//   - the Husqvarna authentication host, which issues the OAuth2 token;
//   - the GARDENA smart system host, which serves the devices and the commands.
//
// Everything the integration knows about the vendor protocol lives here, so the
// device modules never hard-code a magic string.
// -----------------------------------------------------------------------------

export const AUTHENTICATION_HOST = 'https://api.authentication.husqvarnagroup.dev';
export const SMART_HOST = 'https://api.smart.gardena.dev';

// The authentication API is versioned separately from the smart system API.
export const AUTH_API_VERSION = 'v1';
export const SMART_API_VERSION = 'v2';

// JSON:API media type expected by the smart system host on write requests.
export const JSON_API_CONTENT_TYPE = 'application/vnd.api+json';

// Service types (JSON:API resource types) returned in the `included` array of
// GET /locations/{id}, and pushed as-is by the real-time websocket.
export const SERVICE_TYPES = {
  DEVICE: 'DEVICE',
  COMMON: 'COMMON',
  MOWER: 'MOWER',
  VALVE: 'VALVE',
  VALVE_SET: 'VALVE_SET',
  POWER_SOCKET: 'POWER_SOCKET',
  SENSOR: 'SENSOR',
};

// Service types the integration knows how to interpret. Anything else is
// ignored (forward compatibility: GARDENA may add services).
export const SUPPORTED_SERVICE_TYPES = [
  SERVICE_TYPES.DEVICE,
  SERVICE_TYPES.COMMON,
  SERVICE_TYPES.MOWER,
  SERVICE_TYPES.VALVE,
  SERVICE_TYPES.VALVE_SET,
  SERVICE_TYPES.POWER_SOCKET,
  SERVICE_TYPES.SENSOR,
];

// Resource type of the command sent to PUT /command/{serviceId}: one per
// controllable service type.
export const CONTROL_TYPES = {
  MOWER: 'MOWER_CONTROL',
  VALVE: 'VALVE_CONTROL',
  VALVE_SET: 'VALVE_SET_CONTROL',
  POWER_SOCKET: 'POWER_SOCKET_CONTROL',
};

// Commands accepted by each control type.
export const COMMANDS = {
  MOWER: {
    // Start mowing for a given number of seconds, ignoring the schedule.
    START_SECONDS_TO_OVERRIDE: 'START_SECONDS_TO_OVERRIDE',
    // Start mowing, but keep obeying the schedule and the sensors.
    START_DONT_OVERRIDE: 'START_DONT_OVERRIDE',
    // Park, then resume at the next scheduled task.
    PARK_UNTIL_NEXT_TASK: 'PARK_UNTIL_NEXT_TASK',
    // Park and cancel the schedule until the user says otherwise.
    PARK_UNTIL_FURTHER_NOTICE: 'PARK_UNTIL_FURTHER_NOTICE',
  },
  VALVE: {
    START_SECONDS_TO_OVERRIDE: 'START_SECONDS_TO_OVERRIDE',
    STOP_UNTIL_NEXT_TASK: 'STOP_UNTIL_NEXT_TASK',
    PAUSE: 'PAUSE',
    UNPAUSE: 'UNPAUSE',
  },
  VALVE_SET: {
    // Stop every valve of the set (the "stop all watering" panic button).
    STOP_UNTIL_NEXT_TASK: 'STOP_UNTIL_NEXT_TASK',
  },
  POWER_SOCKET: {
    START_SECONDS_TO_OVERRIDE: 'START_SECONDS_TO_OVERRIDE',
    START_OVERRIDE: 'START_OVERRIDE',
    STOP_UNTIL_NEXT_TASK: 'STOP_UNTIL_NEXT_TASK',
    PAUSE: 'PAUSE',
    UNPAUSE: 'UNPAUSE',
  },
};

// MOWER `activity` values meaning "the mower is out of its dock and working".
// Everything else (PARKED_*, PAUSED, OK_CHARGING, NONE) is reported as OFF.
export const MOWER_ACTIVE_ACTIVITIES = [
  'OK_CUTTING',
  'OK_CUTTING_TIMER_OVERRIDDEN',
  'OK_SEARCHING',
  'OK_LEAVING',
];

// VALVE `activity` values meaning "water is flowing".
export const VALVE_ACTIVE_ACTIVITIES = ['MANUAL_WATERING', 'SCHEDULED_WATERING'];

// POWER_SOCKET `activity` values meaning "the socket is powered".
export const POWER_SOCKET_ACTIVE_ACTIVITIES = ['FOREVER_ON', 'TIME_LIMITED_ON'];

// `rfLinkState` value meaning the device answers on the GARDENA radio link.
export const RF_LINK_STATE_ONLINE = 'ONLINE';

// A GARDENA access token is valid for about a day; renew it slightly early so a
// long-running request never travels with an expired token.
export const TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000;

// The GARDENA API throttles aggressively (it is sized for a websocket-driven
// client, not for polling): never fire two REST calls closer than this.
export const MIN_REST_INTERVAL_MS = 1000;

// Timeout of a single REST call to the GARDENA API.
export const REQUEST_TIMEOUT_MS = 20 * 1000;

// The websocket is closed by GARDENA after ~2 hours: reconnect with a backoff
// instead of hammering the (rate-limited) websocket-url endpoint.
export const WEBSOCKET_RECONNECT_BASE_DELAY_MS = 15 * 1000;
export const WEBSOCKET_RECONNECT_MAX_DELAY_MS = 10 * 60 * 1000;

// GARDENA drops a websocket that stays silent: send a protocol ping well below
// the server timeout.
export const WEBSOCKET_PING_INTERVAL_MS = 100 * 1000;
