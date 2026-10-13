// -----------------------------------------------------------------------------
// GARDENA enumerations -> text a gardener can read.
//
// The API answers in SCREAMING_SNAKE_CASE (`OK_CUTTING`, `SCHEDULED_WATERING`).
// That is fine inside a text device feature, where the raw value is the honest
// one to store, but a dashboard card showing "OK_CUTTING" is jargon.
//
// GARDENA adds values over time, so every map falls back to a humanized form of
// the raw value rather than to an empty string: an unknown activity shows up as
// "Ok cutting", never as a blank row.
// -----------------------------------------------------------------------------

const MOWER_ACTIVITIES = {
  OK_CUTTING: { en: 'Mowing', fr: 'Tond' },
  OK_CUTTING_TIMER_OVERRIDDEN: { en: 'Mowing (manual)', fr: 'Tond (manuel)' },
  OK_SEARCHING: { en: 'Heading home', fr: 'Rentre' },
  OK_LEAVING: { en: 'Leaving the dock', fr: 'Sort de la base' },
  OK_CHARGING: { en: 'Charging', fr: 'En charge' },
  PARKED_TIMER: { en: 'Parked (schedule)', fr: 'Garée (calendrier)' },
  PARKED_PARK_SELECTED: { en: 'Parked', fr: 'Garée' },
  PARKED_AUTOTIMER: { en: 'Parked (sensor)', fr: 'Garée (capteur)' },
  PAUSED: { en: 'Paused', fr: 'En pause' },
  NONE: { en: 'Idle', fr: 'Inactive' },
};

const VALVE_ACTIVITIES = {
  CLOSED: { en: 'Closed', fr: 'Fermée' },
  MANUAL_WATERING: { en: 'Manual watering', fr: 'Arrosage manuel' },
  SCHEDULED_WATERING: { en: 'Scheduled watering', fr: 'Arrosage programmé' },
};

const POWER_SOCKET_ACTIVITIES = {
  OFF: { en: 'Off', fr: 'Éteinte' },
  FOREVER_ON: { en: 'On', fr: 'Allumée' },
  TIME_LIMITED_ON: { en: 'On (timed)', fr: 'Allumée (minutée)' },
  UNKNOWN: { en: 'Unknown', fr: 'Inconnu' },
};

const STATES = {
  OK: { en: 'OK', fr: 'OK' },
  WARNING: { en: 'Warning', fr: 'Avertissement' },
  ERROR: { en: 'Error', fr: 'Erreur' },
  UNAVAILABLE: { en: 'Unavailable', fr: 'Indisponible' },
};

/**
 * Turn a raw GARDENA enumeration into readable text: `OK_CUTTING` -> `Ok cutting`.
 * @param {string} value - Raw value.
 * @returns {string} A readable fallback, used in both languages.
 */
export function humanize(value) {
  const words = String(value).toLowerCase().replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function translate(map, value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const known = map[value];
  if (known) {
    return { ...known };
  }
  const fallback = humanize(value);
  return { en: fallback, fr: fallback };
}

/**
 * Readable label of a mower activity.
 * @param {string|undefined} activity - GARDENA `activity`.
 * @returns {{en: string, fr: string}|undefined} The label.
 */
export function mowerActivityLabel(activity) {
  return translate(MOWER_ACTIVITIES, activity);
}

/**
 * Readable label of a valve activity.
 * @param {string|undefined} activity - GARDENA `activity`.
 * @returns {{en: string, fr: string}|undefined} The label.
 */
export function valveActivityLabel(activity) {
  return translate(VALVE_ACTIVITIES, activity);
}

/**
 * Readable label of a power socket activity.
 * @param {string|undefined} activity - GARDENA `activity`.
 * @returns {{en: string, fr: string}|undefined} The label.
 */
export function powerSocketActivityLabel(activity) {
  return translate(POWER_SOCKET_ACTIVITIES, activity);
}

/**
 * Readable label of a service `state` (OK / WARNING / ERROR / UNAVAILABLE).
 * @param {string|undefined} state - GARDENA `state`.
 * @returns {{en: string, fr: string}|undefined} The label.
 */
export function stateLabel(state) {
  return translate(STATES, state);
}
