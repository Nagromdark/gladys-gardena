// -----------------------------------------------------------------------------
// Widget registry.
//
// One module per card, the same shape as `src/devices/`: a pure `buildContent`
// that turns the in-memory garden into content, and — for the cards that need
// more than a device command — an action table.
//
// The actions receive an `api` object holding the service methods they are
// allowed to call, so a widget module never touches the GARDENA client, nor
// the network, nor Gladys.
// -----------------------------------------------------------------------------

import { SERVICE_TYPES } from '../gardena/constants.js';
import { servicesOfType } from '../gardena/model.js';
import { MOWER_ACTIONS, MOWER_WIDGET, mowerWidget } from './mower.js';
import { WATERING_ACTIONS, WATERING_WIDGET, wateringWidget } from './watering.js';

export { MOWER_WIDGET, WATERING_WIDGET };

/** The keys declared in the manifest. They are stored in the users' dashboards: never rename one. */
export const WIDGET_KEYS = [WATERING_WIDGET, MOWER_WIDGET];

const MODULES = {
  [WATERING_WIDGET]: wateringWidget,
  [MOWER_WIDGET]: mowerWidget,
};

// An older Gladys drops the `fields` of a button and runs the action anyway:
// the handler then receives no `values` and must refuse rather than guess a
// duration. A thrown message is a single string, not a multi-language object,
// so this one carries both languages at once.
const NEEDS_NEWER_GLADYS =
  'Update Gladys to use this button. / Mettez Gladys à jour pour utiliser ce bouton.';

/**
 * Build the content of one widget.
 * @param {string} key - Widget key.
 * @param {object} context - Context built by the service.
 * @returns {object} A widget content.
 */
export function buildWidgetContent(key, context) {
  const module = MODULES[key];
  if (!module) {
    throw new Error(`Unknown widget: ${key}`);
  }
  return module.buildContent(context);
}

/**
 * A positive number of minutes taken from the typed form of a button.
 * @param {object|undefined} values - The `values` of the action.
 * @returns {number} The number of minutes.
 */
function requireMinutes(values) {
  const minutes = Number(values?.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error(NEEDS_NEWER_GLADYS);
  }
  return minutes;
}

/**
 * Run a widget action.
 *
 * `params` were declared in the content we produced and are echoed back as is:
 * they are never user input. `values` is the typed form, which only exists
 * behind a tap — and only on a Gladys that knows action fields.
 * @param {string} key - Widget key.
 * @param {string} actionKey - Action key declared in the content.
 * @param {object} params - Params echoed back by the core.
 * @param {object} options - `{ values, api }`.
 * @returns {Promise<object>} The multi-language message shown to the user.
 */
export async function runWidgetAction(key, actionKey, params, { values, api }) {
  if (key === WATERING_WIDGET) {
    if (actionKey === WATERING_ACTIONS.STOP_WATERING) {
      // No params: a panic button stops whatever is open NOW, including an
      // outlet that opened since this card was rendered.
      return api.stopAllWateringEverywhere();
    }
    if (actionKey === WATERING_ACTIONS.START_WATERING) {
      const minutes = requireMinutes(values);
      return api.startValve(String(values.valve), minutes);
    }
  }
  if (key === MOWER_WIDGET) {
    if (actionKey === MOWER_ACTIONS.MOW_FOR) {
      const minutes = requireMinutes(values);
      return api.mowFor(String(params?.mower), minutes);
    }
    if (actionKey === MOWER_ACTIONS.PARK) {
      return api.parkMower(String(params?.mower));
    }
  }
  // Throwing acks the action as failed, and the message reaches the user.
  throw new Error(`Unknown widget action: ${key}.${actionKey}`);
}

/**
 * The widgets a real-time message about a device should refresh.
 *
 * Targeted on purpose: the refresh nudge is rate-limited PER KEY, so a burst
 * of valve messages must not burn the mower's window.
 * @param {string} serviceType - Type of the service that changed.
 * @param {object|undefined} device - The device it belongs to.
 * @returns {Array<string>} Widget keys to refresh.
 */
export function widgetKeysForService(serviceType, device) {
  if (serviceType === SERVICE_TYPES.MOWER) {
    return [MOWER_WIDGET];
  }
  if (
    serviceType === SERVICE_TYPES.VALVE ||
    serviceType === SERVICE_TYPES.VALVE_SET ||
    serviceType === SERVICE_TYPES.POWER_SOCKET ||
    serviceType === SERVICE_TYPES.SENSOR
  ) {
    return [WATERING_WIDGET];
  }
  if (serviceType === SERVICE_TYPES.COMMON && device) {
    // COMMON carries the battery and the radio link of ANY device: route it to
    // the card that actually shows that device.
    return servicesOfType(device, SERVICE_TYPES.MOWER).length > 0
      ? [MOWER_WIDGET]
      : [WATERING_WIDGET];
  }
  return [];
}

/**
 * Coalescing rate limiter for `requestWidgetRefresh`.
 *
 * The core accepts one nudge per 10 s and per widget, and silently drops the
 * rest — including everything sent while the WebSocket is down. A naive
 * leading-edge limiter would therefore swallow the LAST message of a burst,
 * which is exactly the one carrying the final state. This one fires
 * immediately when the window is free, and otherwise arms a trailing timer.
 */
export class WidgetNudger {
  /**
   * @param {object} gladys - The SDK instance.
   * @param {number} [windowMs] - Minimum delay between two nudges of a key.
   */
  constructor(gladys, windowMs = 11_000) {
    this.gladys = gladys;
    this.windowMs = windowMs;
    this.lastNudgeAt = new Map();
    this.timers = new Map();
  }

  /**
   * Ask the dashboards to re-pull a widget, at most once per window.
   * @param {string} key - Widget key.
   */
  nudge(key) {
    if (!WIDGET_KEYS.includes(key) || this.timers.has(key)) {
      return;
    }
    const elapsed = Date.now() - (this.lastNudgeAt.get(key) ?? 0);
    if (elapsed >= this.windowMs) {
      this.send(key);
      return;
    }
    const timer = setTimeout(() => {
      this.timers.delete(key);
      this.send(key);
    }, this.windowMs - elapsed);
    timer.unref?.();
    this.timers.set(key, timer);
  }

  /** Nudge every widget: used after a (re)connection or a full resynchronization. */
  nudgeAll() {
    for (const key of WIDGET_KEYS) {
      this.nudge(key);
    }
  }

  send(key) {
    this.lastNudgeAt.set(key, Date.now());
    // Fire-and-forget: it carries no data, and is dropped while disconnected.
    this.gladys.requestWidgetRefresh(key);
  }

  /** Drop the pending nudges (disconnection, shutdown). */
  stop() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
