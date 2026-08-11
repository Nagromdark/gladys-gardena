// -----------------------------------------------------------------------------
// Integration configuration.
//
// The values are filled in by the user in Gladys, from the `config_schema` of
// `gladys-assistant-integration.json`. The SDK fetches them (`getConfig()`) and
// notifies every change (`onConfigUpdated()`).
//
// This module only holds the defaults and normalizes the received object, so
// the rest of the code never deals with `undefined` — nor with a number that
// arrived as a string from an HTML form.
// -----------------------------------------------------------------------------

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (a test enforces it).
export const DEFAULT_CONFIG = {
  // Credentials of the application created on the Husqvarna developer portal.
  // No default: the integration cannot run without them.
  application_key: '',
  application_secret: '',
  // Empty: every location (garden) of the account is used.
  location_id: '',
  // Seconds. The websocket carries the real-time changes, so this is only the
  // safety net: the GARDENA API is rate-limited, do not go below 5 minutes.
  poll_frequency: 900,
  // Minutes. Applied when a valve or a power socket is switched ON.
  default_duration: 30,
  // 'duration' (switch off automatically) | 'forever' (stay on).
  power_socket_on_mode: 'duration',
  // 'schedule' (obey the mower calendar) | 'duration' (override it).
  mower_start_mode: 'schedule',
  // Minutes, used when mower_start_mode is 'duration'.
  mower_duration: 180,
  // 'next_task' (keep the schedule) | 'further_notice' (cancel it).
  mower_stop_mode: 'next_task',
};

/**
 * Merge the user configuration with the defaults and force the types.
 * @param {Record<string, unknown>} [raw] - Configuration returned by the SDK.
 * @returns {object} A complete, typed configuration.
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    application_key: trim(raw.application_key),
    application_secret: trim(raw.application_secret),
    location_id: trim(raw.location_id),
    poll_frequency: numberOr(raw.poll_frequency, DEFAULT_CONFIG.poll_frequency),
    default_duration: numberOr(raw.default_duration, DEFAULT_CONFIG.default_duration),
    mower_duration: numberOr(raw.mower_duration, DEFAULT_CONFIG.mower_duration),
  };
}

/**
 * Can the integration talk to GARDENA with this configuration?
 * @param {object} config - Normalized configuration.
 * @returns {boolean} True when both credentials are filled in.
 */
export function isConfigured(config) {
  return Boolean(config.application_key && config.application_secret);
}

/**
 * Did a configuration change require reconnecting to GARDENA?
 *
 * Changing a duration only affects the next command; changing the credentials
 * or the location means the whole session must be rebuilt.
 * @param {object} previous - Previous configuration.
 * @param {object} next - New configuration.
 * @returns {boolean} True when the connection must be restarted.
 */
export function needsReconnect(previous, next) {
  return (
    previous.application_key !== next.application_key ||
    previous.application_secret !== next.application_secret ||
    previous.location_id !== next.location_id
  );
}

function trim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
