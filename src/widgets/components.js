// -----------------------------------------------------------------------------
// Builders for the widget content vocabulary.
//
// The core truncates texts, caps arrays and DROPS components beyond the budget
// — in content order, silently. Rather than let it cut mid-word or drop the
// last thing we sent, we clip and cap here, deliberately.
//
// Budget enforced by the core (per widget content):
//   8 components, of which 1 focal (chart), 6 tiles (value|gauge),
//   2 texts (1 of them `body`), 1 status, 4 buttons.
// -----------------------------------------------------------------------------

export const WIDGET_BUDGET = {
  components: 8,
  focal: 1,
  tiles: 6,
  texts: 2,
  status: 1,
  buttons: 4,
};

// Per-field bounds of the content vocabulary.
const MAX = {
  heading: 40,
  body: 300,
  caption: 80,
  tileValue: 12,
  tileLabel: 24,
  unit: 6,
  statusLabel: 40,
  statusValue: 40,
  buttonLabel: 24,
};

// The SDK unit names are words (`percent`, `celsius`); a tile unit is 6
// characters, so it takes the symbol.
const UNIT_SYMBOLS = {
  percent: '%',
  celsius: '°C',
  fahrenheit: '°F',
  lux: 'lx',
  hours: 'h',
  seconds: 's',
  minutes: 'min',
};

/**
 * Truncate a string to a bound, with an ellipsis: a GARDENA valve named
 * "Vegetable garden — north row" must not be cut mid-word by the core.
 * @param {string} text - Text to clip.
 * @param {number} max - Maximum length.
 * @returns {string} The clipped text.
 */
export function clip(text, max) {
  const value = String(text ?? '').trim();
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The symbol of a Gladys unit, short enough for a tile.
 * @param {string|undefined} unit - A DEVICE_FEATURE_UNITS value.
 * @returns {string|undefined} The symbol, or undefined when there is none.
 */
export function unitSymbol(unit) {
  const symbol = UNIT_SYMBOLS[unit];
  return symbol === undefined ? undefined : clip(symbol, MAX.unit);
}

/**
 * A `text` component.
 * @param {object} message - Multi-language text.
 * @param {string} [variant] - 'heading' | 'body' | 'caption'.
 * @returns {object} The component.
 */
export function text(message, variant = 'body') {
  const max = MAX[variant] ?? MAX.body;
  return {
    type: 'text',
    variant,
    text: { en: clip(message.en, max), fr: clip(message.fr, max) },
  };
}

/**
 * A `value` tile, bound to a device feature when Gladys knows it.
 *
 * A bound tile follows the published states live, with no pull and no cache:
 * it is both cheaper and fresher. It only works for a feature of a device the
 * user actually created, hence the fallback to a computed value.
 * @param {object} options - Tile options.
 * @param {object} options.label - Multi-language label.
 * @param {string} [options.deviceFeature] - Feature external id, when bindable.
 * @param {number} [options.value] - Computed value, used when not bound.
 * @param {string} [options.unit] - Gladys unit of the computed value.
 * @param {string} [options.icon] - Feather icon name.
 * @returns {object} The component.
 */
export function tile({ label, deviceFeature, value, unit, icon }) {
  const component = {
    type: 'value',
    label: { en: clip(label.en, MAX.tileLabel), fr: clip(label.fr, MAX.tileLabel) },
  };
  if (icon) {
    component.icon = icon;
  }
  if (deviceFeature) {
    // `value` and `unit` are ignored on a bound tile: the core fills them.
    component.device_feature = deviceFeature;
    return component;
  }
  component.value = typeof value === 'number' ? value : clip(value, MAX.tileValue);
  const symbol = unitSymbol(unit);
  if (symbol) {
    component.unit = symbol;
  }
  return component;
}

/**
 * A `gauge` component (a radial tile), bound or computed like `tile`.
 * @param {object} options - Gauge options.
 * @param {object} options.label - Multi-language label.
 * @param {string} [options.deviceFeature] - Feature external id, when bindable.
 * @param {number} [options.value] - Computed value.
 * @param {number} options.min - Lower bound.
 * @param {number} options.max - Upper bound.
 * @param {string} [options.unit] - Gladys unit.
 * @param {string} [options.color] - Widget color.
 * @returns {object} The component.
 */
export function gauge({ label, deviceFeature, value, min, max, unit, color }) {
  const component = {
    type: 'gauge',
    label: { en: clip(label.en, MAX.tileLabel), fr: clip(label.fr, MAX.tileLabel) },
    min,
    max,
  };
  if (color) {
    component.color = color;
  }
  if (deviceFeature) {
    component.device_feature = deviceFeature;
    return component;
  }
  component.value = value;
  const symbol = unitSymbol(unit);
  if (symbol) {
    component.unit = symbol;
  }
  return component;
}

/**
 * A `chart` component following published features over time.
 *
 * Bound to device features rather than to inline points: the core reads the
 * history it already stores, so the card costs nothing to draw and shows more
 * than the integration keeps in memory.
 * @param {object} options - Chart options.
 * @param {object} options.title - Multi-language title.
 * @param {Array<string>} options.deviceFeatures - 1 to 4 feature external ids.
 * @param {string} [options.interval] - A chart interval, e.g. 'last-week'.
 * @param {string} [options.chartType] - 'line' | 'area' | 'bar' | 'stepline'.
 * @param {string} [options.unit] - Gladys unit of the series.
 * @returns {object} The component.
 */
export function chart({ title, deviceFeatures, interval = 'last-week', chartType = 'area', unit }) {
  const component = {
    type: 'chart',
    title: { en: clip(title.en, MAX.heading), fr: clip(title.fr, MAX.heading) },
    device_features: deviceFeatures.slice(0, 4),
    interval,
    chart_type: chartType,
  };
  const symbol = unitSymbol(unit);
  if (symbol) {
    component.unit = symbol;
  }
  return component;
}

/**
 * One row of a `status` component.
 * @param {object} options - Row options.
 * @param {object} options.label - Multi-language label.
 * @param {object|string|number} options.value - Multi-language or plain value.
 * @param {string} [options.icon] - Feather icon name.
 * @param {string} [options.color] - Widget color.
 * @returns {object} The row.
 */
export function statusRow({ label, value, icon, color }) {
  const row = {
    label: { en: clip(label.en, MAX.statusLabel), fr: clip(label.fr, MAX.statusLabel) },
    value:
      typeof value === 'object'
        ? { en: clip(value.en, MAX.statusValue), fr: clip(value.fr, MAX.statusValue) }
        : clip(value, MAX.statusValue),
  };
  if (icon) {
    row.icon = icon;
  }
  if (color) {
    row.color = color;
  }
  return row;
}

/**
 * A `status` component out of rows (at most 10, the vocabulary cap).
 * @param {Array<object>} rows - Rows built by `statusRow`.
 * @returns {object} The component.
 */
export function status(rows) {
  return { type: 'status', items: rows.slice(0, 10) };
}

/**
 * A button that runs a declared widget action.
 * @param {object} options - Button options.
 * @param {object} options.label - Multi-language label.
 * @param {string} options.actionKey - Action key, handled by onWidgetAction.
 * @param {object} [options.params] - Params echoed back to the handler.
 * @param {Array<object>} [options.fields] - Typed form shown before running.
 * @param {boolean} [options.confirm] - Ask for a confirmation first.
 * @param {string} [options.style] - 'primary' | 'secondary' | 'danger'.
 * @param {string} [options.icon] - Feather icon name.
 * @returns {object} The component.
 */
export function actionButton({ label, actionKey, params, fields, confirm, style, icon }) {
  const action = { key: actionKey };
  if (params) {
    action.params = params;
  }
  if (fields) {
    // `confirm` is ignored by the core on a button with fields: the form IS
    // the confirmation.
    action.fields = fields;
  } else if (confirm) {
    action.confirm = true;
  }
  return {
    type: 'button',
    label: { en: clip(label.en, MAX.buttonLabel), fr: clip(label.fr, MAX.buttonLabel) },
    ...(icon ? { icon } : {}),
    ...(style ? { style } : {}),
    action,
  };
}

/**
 * A button that sets a device feature, routed by the core to `onSetValue` —
 * the command path the device cards already use, with no handler to write.
 * @param {object} options - Button options.
 * @param {object} options.label - Multi-language label.
 * @param {string} options.deviceFeature - Feature external id.
 * @param {number} options.value - Value to set.
 * @param {string} [options.style] - 'primary' | 'secondary' | 'danger'.
 * @param {string} [options.icon] - Feather icon name.
 * @returns {object} The component.
 */
export function featureButton({ label, deviceFeature, value, style, icon }) {
  return {
    type: 'button',
    label: { en: clip(label.en, MAX.buttonLabel), fr: clip(label.fr, MAX.buttonLabel) },
    ...(icon ? { icon } : {}),
    ...(style ? { style } : {}),
    device_feature: deviceFeature,
    value,
  };
}

/**
 * A content holding a single explanatory text: the honest answer to "there is
 * nothing to show", instead of a blank card.
 * @param {object} message - Multi-language text.
 * @param {number} [ttlSeconds] - Freshness of that answer.
 * @returns {object} A widget content.
 */
export function emptyState(message, ttlSeconds = 300) {
  return { ttl_seconds: ttlSeconds, components: [text(message, 'body')] };
}

/**
 * Keep a component list inside the budget, dropping from the END so the
 * caller's priority order decides what survives — the core would drop the same
 * way, but silently and without knowing which tile matters.
 * @param {Array<object>} components - Components, most important first.
 * @returns {Array<object>} The kept components.
 */
export function withinBudget(components) {
  const counts = { components: 0, focal: 0, tiles: 0, texts: 0, status: 0, buttons: 0 };
  const slotOf = {
    chart: 'focal',
    'card-list': 'focal',
    image: 'focal',
    value: 'tiles',
    gauge: 'tiles',
    text: 'texts',
    status: 'status',
    button: 'buttons',
  };
  const kept = [];
  for (const component of components) {
    const slot = slotOf[component.type];
    if (counts.components >= WIDGET_BUDGET.components) {
      break;
    }
    if (slot && counts[slot] >= WIDGET_BUDGET[slot]) {
      continue;
    }
    kept.push(component);
    counts.components += 1;
    if (slot) {
      counts[slot] += 1;
    }
  }
  return kept;
}
