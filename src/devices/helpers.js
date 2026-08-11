// -----------------------------------------------------------------------------
// Shared helpers of the device modules.
//
// The external ids MUST be stable across restarts: they are what links a Gladys
// device to its GARDENA counterpart. They are derived from the GARDENA service
// id (a server-side uuid), never from a name the user can change.
// -----------------------------------------------------------------------------

import { serviceSuffixOf } from '../gardena/model.js';

/**
 * External id of a feature carried by a service.
 *
 * The key embeds the service type and its suffix, so the six valves of an
 * Irrigation Control get six distinct, stable ids (`valve-1-on-off`...).
 * @param {{feature: Function}} ids - Ids returned by `gladys.externalIds()`.
 * @param {{id: string, type: string}} service - GARDENA service.
 * @param {string} name - Feature name, e.g. `on-off`.
 * @returns {string} The feature external id.
 */
export function featureId(ids, service, name) {
  return ids.feature(`${service.type.toLowerCase()}-${serviceSuffixOf(service.id)}-${name}`);
}

/**
 * A state entry for `publishStates`, or null when the value is unknown.
 *
 * The GARDENA API omits an attribute it has nothing to say about (a valve that
 * never watered has no `duration`): publishing `undefined` would push a bogus
 * `null` state into the history.
 * @param {string} externalId - Feature external id.
 * @param {number|undefined} value - Numeric value.
 * @returns {{device_feature_external_id: string, state: number}|null} The entry.
 */
export function numberState(externalId, value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return null;
  }
  return { device_feature_external_id: externalId, state: Number(value) };
}

/**
 * A text state entry (`activity`, `state`, error codes...), or null when unknown.
 * @param {string} externalId - Feature external id.
 * @param {string|undefined} value - Text value.
 * @returns {{device_feature_external_id: string, text: string}|null} The entry.
 */
export function textState(externalId, value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return { device_feature_external_id: externalId, text: String(value) };
}

/**
 * A binary state entry (0/1), or null when the source value is unknown.
 * @param {string} externalId - Feature external id.
 * @param {boolean|undefined} value - Boolean value.
 * @returns {{device_feature_external_id: string, state: number}|null} The entry.
 */
export function binaryState(externalId, value) {
  if (value === undefined || value === null) {
    return null;
  }
  return { device_feature_external_id: externalId, state: value ? 1 : 0 };
}

/**
 * Turn a duration in minutes coming from the configuration into the seconds the
 * GARDENA API expects, clamped to what the API accepts.
 * @param {number} minutes - Duration in minutes.
 * @returns {number} Duration in seconds, a multiple of 60.
 */
export function minutesToSeconds(minutes) {
  const value = Number(minutes);
  const safe = Number.isFinite(value) && value > 0 ? value : 30;
  return Math.round(Math.min(safe, 1440)) * 60;
}
