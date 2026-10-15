// -----------------------------------------------------------------------------
// The dashboard widgets: content built from the in-memory garden.
//
// `validateWidgetContent` is the SDK's own checker — the same rules the core
// applies before rendering. It returns [] when the content is rendered exactly
// as sent: anything else means a text was truncated, a field was missing or a
// component was dropped. A widget that passes it is a widget that displays.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { WIDGET_BUDGET } from '../src/widgets/components.js';
import {
  WIDGET_KEYS,
  buildWidgetContent,
  runWidgetAction,
  widgetKeysForService,
} from '../src/widgets/index.js';
import {
  humanize,
  isPump,
  mowerActivityLabel,
  pumpActivityLabel,
  valveActivityLabel,
} from '../src/widgets/labels.js';
import { buildDevice, idsOf } from '../src/devices/index.js';
import { parseLocation } from '../src/gardena/model.js';
import { normalizeConfig } from '../src/config.js';
import { asCreatedDevice } from './helpers/createdDevices.js';
import {
  IRRIGATION_CONTROL_ID,
  MOWER_ID,
  SENSOR_ID,
  WATER_CONTROL_ID,
  buildLocationPayload,
} from './helpers/gardenaFixtures.js';

const gladys = createFakeGladys();
const CONFIG = normalizeConfig({ application_key: 'k', application_secret: 's' });

/**
 * A widget context over the fixture garden, with every device created in
 * Gladys unless stated otherwise.
 */
function createContext({ devices, created = 'all', settings = {}, configured = true } = {}) {
  const parsed = devices ?? [...parseLocation(buildLocationPayload(), 'My Garden').values()];
  const ids = (device) => idsOf(gladys, device);
  const createdIds =
    created === 'all'
      ? new Set(
          parsed.flatMap((device) =>
            asCreatedDevice(buildDevice(gladys, device)).features.map((f) => f.external_id),
          ),
        )
      : created;
  return { devices: parsed, config: CONFIG, settings, created: createdIds, ids, configured };
}

/** A garden of three soil sensors, named and ordered a, b, c. */
function threeSensors() {
  const parsed = [...parseLocation(buildLocationPayload()).values()];
  const sensor = parsed.find((device) => device.id === SENSOR_ID);
  return ['a', 'b', 'c'].map((suffix) => ({
    ...sensor,
    id: `${SENSOR_ID}-sensor-${suffix}`,
    name: `Sensor ${suffix}`,
    services: {
      SENSOR: sensor.services.SENSOR.map((service) => ({
        ...service,
        id: `${SENSOR_ID}-sensor-${suffix}`,
      })),
    },
  }));
}

/** Every `device_feature` referenced anywhere in a content. */
function boundFeatures(content) {
  const found = [];
  for (const component of content.components) {
    if (typeof component.device_feature === 'string') {
      found.push(component.device_feature);
    }
    for (const feature of component.device_features ?? []) {
      found.push(feature);
    }
  }
  return found;
}

function countByType(content, ...types) {
  return content.components.filter((component) => types.includes(component.type)).length;
}

test('both widgets produce content Gladys renders exactly as sent', () => {
  for (const key of WIDGET_KEYS) {
    const content = buildWidgetContent(key, createContext());
    assert.deepEqual(validateWidgetContent(content), [], `${key}: invalid content`);
    assert.ok(content.components.length > 0, `${key}: nothing to show on a full garden`);
  }
});

test('the content stays inside the budget the core enforces', () => {
  // A big garden: the Irrigation Control, the Water Control, the socket, the
  // sensor and the mower all at once.
  for (const key of WIDGET_KEYS) {
    const content = buildWidgetContent(key, createContext());
    assert.ok(content.components.length <= WIDGET_BUDGET.components, `${key}: too many components`);
    assert.ok(
      countByType(content, 'value', 'gauge') <= WIDGET_BUDGET.tiles,
      `${key}: too many tiles`,
    );
    assert.ok(countByType(content, 'button') <= WIDGET_BUDGET.buttons, `${key}: too many buttons`);
    assert.ok(countByType(content, 'status') <= WIDGET_BUDGET.status, `${key}: too many status`);
    assert.ok(countByType(content, 'text') <= WIDGET_BUDGET.texts, `${key}: too many texts`);
    assert.ok(
      countByType(content, 'chart', 'card-list', 'image') <= WIDGET_BUDGET.focal,
      `${key}: more than one focal component`,
    );
  }
});

test('a bound feature always belongs to a device the user created', () => {
  const context = createContext();
  for (const key of WIDGET_KEYS) {
    const content = buildWidgetContent(key, context);
    for (const feature of boundFeatures(content)) {
      assert.ok(context.created.has(feature), `${key}: ${feature} was never created in Gladys`);
    }
  }
});

test('nothing is bound when no device was created, and the card still works', () => {
  // The discovery screen lists devices the user has not created yet: binding
  // one of their features would render a dead tile and a dead button.
  const context = createContext({ created: new Set() });
  for (const key of WIDGET_KEYS) {
    const content = buildWidgetContent(key, context);
    assert.deepEqual(validateWidgetContent(content), [], `${key}: invalid content`);
    assert.deepEqual(boundFeatures(content), [], `${key}: bound to a feature nobody created`);
    assert.ok(content.components.length > 0, `${key}: computed fallback missing`);
  }
});

test('the watering card shows what is running, and how to stop it', () => {
  const content = buildWidgetContent('watering', createContext());

  const [first] = content.components;
  assert.equal(first.type, 'button', 'the emergency button survives any budget trim');
  assert.equal(first.action.key, 'stop_watering');
  assert.equal(first.style, 'danger');
  assert.equal(first.action.confirm, undefined, 'stopping the water must not ask twice');

  const status = content.components.find((component) => component.type === 'status');
  // The Terrace valve of the fixture is watering: it comes first.
  assert.equal(status.items[0].value.fr, 'Arrosage programmé');
  assert.equal(status.items[0].color, 'success');
  assert.ok(status.items.length <= 10);

  const form = content.components.find(
    (component) => component.type === 'button' && component.action?.key === 'start_watering',
  );
  assert.equal(form.action.fields.length, 2);
  assert.equal(form.action.fields[1].default, CONFIG.default_duration);
});

test('the mower card controls the mower, and asks before cancelling its schedule', () => {
  const content = buildWidgetContent('mower', createContext());

  const status = content.components.find((component) => component.type === 'status');
  assert.equal(status.items[0].value.en, 'Mowing');

  const park = content.components.find(
    (component) => component.type === 'button' && component.action?.key === 'park',
  );
  assert.equal(park.action.confirm, true, 'cancelling the schedule is sticky');

  const battery = content.components.find((component) => component.type === 'gauge');
  assert.ok(battery.device_feature.endsWith('common-battery'));
});

test('an offline device is reported rather than shown as fresh', () => {
  // The fixture power socket has rfLinkState OFFLINE.
  const content = buildWidgetContent('watering', createContext());
  const caption = content.components.find(
    (component) => component.type === 'text' && component.variant === 'caption',
  );
  assert.match(caption.text.fr, /hors ligne/);
});

test('the sensor setting pins the tiles to one sensor', () => {
  const parsed = [...parseLocation(buildLocationPayload(), 'My Garden').values()];
  const sensor = parsed.find((device) => device.id === SENSOR_ID);
  const settings = { sensor: idsOf(gladys, sensor).device };

  const content = buildWidgetContent('watering', createContext({ settings }));

  assert.deepEqual(validateWidgetContent(content), []);
  const tiles = content.components.filter((component) => component.type === 'value');
  assert.ok(tiles.length > 0);
  for (const sensorTile of tiles) {
    assert.ok(sensorTile.device_feature.includes(SENSOR_ID), 'a tile of another sensor slipped in');
  }
});

test('the empty states say why, instead of showing a blank card', () => {
  for (const key of WIDGET_KEYS) {
    const notConfigured = buildWidgetContent(key, createContext({ configured: false }));
    assert.deepEqual(validateWidgetContent(notConfigured), []);
    assert.equal(notConfigured.components.length, 1);
    assert.match(notConfigured.components[0].text.fr, /clé/);

    const starting = buildWidgetContent(key, createContext({ devices: [] }));
    assert.deepEqual(starting.components, [], 'an empty picture is a legitimate empty state');
  }

  // A garden without a mower: the watering card still works, the mower card
  // explains itself.
  const withoutMower = [...parseLocation(buildLocationPayload()).values()].filter(
    (device) => device.id !== MOWER_ID,
  );
  const content = buildWidgetContent('mower', createContext({ devices: withoutMower }));
  assert.equal(content.components.length, 1);
  assert.match(content.components[0].text.fr, /Aucune tondeuse/);
});

test('several mowers and no choice: list them, control none', () => {
  const parsed = [...parseLocation(buildLocationPayload()).values()];
  const mower = parsed.find((device) => device.id === MOWER_ID);
  const second = { ...mower, id: 'second-mower', name: 'SILENO 2' };
  const content = buildWidgetContent('mower', createContext({ devices: [mower, second] }));

  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(countByType(content, 'button'), 0, 'acting on "the first one" would be a bug');
  assert.match(
    content.components.find((component) => component.type === 'text').text.fr,
    /Choisissez une tondeuse/,
  );
});

test('a setting pointing at a device that is gone explains itself', () => {
  const content = buildWidgetContent('mower', createContext({ settings: { mower: 'ext:gone' } }));
  assert.equal(content.components.length, 1);
  assert.match(content.components[0].text.en, /not a GARDENA mower/);
});

test('building a card twice gives exactly the same content', () => {
  // The content is cached by the core per settings, language and units: a
  // builder that is not deterministic would make the cache lie.
  for (const key of WIDGET_KEYS) {
    assert.deepEqual(
      buildWidgetContent(key, createContext()),
      buildWidgetContent(key, createContext()),
    );
  }
});

test('every action declared in a content has a handler', async () => {
  const declared = new Set();
  for (const key of WIDGET_KEYS) {
    for (const component of buildWidgetContent(key, createContext()).components) {
      if (component.action?.key) {
        declared.add(`${key}.${component.action.key}`);
      }
    }
  }
  assert.ok(declared.size >= 3, 'the cards declare their actions');

  for (const entry of declared) {
    const [key, actionKey] = entry.split('.');
    const calls = [];
    const api = {
      stopAllWateringEverywhere: async () => calls.push('stop') && { en: 'ok', fr: 'ok' },
      startValve: async (...args) => calls.push(['valve', ...args]) && { en: 'ok', fr: 'ok' },
      mowFor: async (...args) => calls.push(['mow', ...args]) && { en: 'ok', fr: 'ok' },
      parkMower: async (...args) => calls.push(['park', ...args]) && { en: 'ok', fr: 'ok' },
    };
    await runWidgetAction(
      key,
      actionKey,
      { mower: MOWER_ID },
      { values: { minutes: 20, valve: `${IRRIGATION_CONTROL_ID}:1` }, api },
    );
    assert.equal(calls.length, 1, `${entry}: no handler ran`);
  }
});

test('an action refuses to guess when the typed form did not arrive', async () => {
  // An older Gladys drops the `fields` of a button and runs the action anyway.
  await assert.rejects(
    () => runWidgetAction('mower', 'mow_for', { mower: MOWER_ID }, { api: {} }),
    /Update Gladys/,
  );
  await assert.rejects(
    () => runWidgetAction('watering', 'start_watering', {}, { values: {}, api: {} }),
    /Update Gladys/,
  );
});

test('an unknown action is refused', async () => {
  await assert.rejects(
    () => runWidgetAction('watering', 'drop_database', {}, { api: {} }),
    /Unknown widget action/,
  );
});

test('a real-time message refreshes only the card that shows it', () => {
  const parsed = parseLocation(buildLocationPayload());
  const mower = parsed.get(MOWER_ID);
  const sensor = parsed.get(SENSOR_ID);

  assert.deepEqual(widgetKeysForService('MOWER', mower), ['mower']);
  assert.deepEqual(widgetKeysForService('VALVE', undefined), ['watering']);
  assert.deepEqual(widgetKeysForService('SENSOR', sensor), ['watering']);
  // COMMON carries the battery of ANY device: it routes to the right card.
  assert.deepEqual(widgetKeysForService('COMMON', mower), ['mower']);
  assert.deepEqual(widgetKeysForService('COMMON', sensor), ['watering']);
  assert.deepEqual(widgetKeysForService('FUTURE_SERVICE', mower), []);
});

test('an unknown GARDENA value is humanized, never shown raw or blank', () => {
  assert.equal(mowerActivityLabel('OK_CUTTING').fr, 'Tond');
  assert.equal(valveActivityLabel('CLOSED').fr, 'Fermée');
  assert.equal(humanize('SOME_NEW_STATE'), 'Some new state');
  assert.deepEqual(mowerActivityLabel('SOME_NEW_STATE'), {
    en: 'Some new state',
    fr: 'Some new state',
  });
  assert.equal(mowerActivityLabel(undefined), undefined);
});

test('the card draws the soil humidity of the week, bound to the history', () => {
  const content = buildWidgetContent('watering', createContext());

  const curve = content.components.find((component) => component.type === 'chart');
  assert.ok(curve, 'the focal slot carries the drying curve');
  assert.equal(curve.interval, 'last-week');
  assert.equal(curve.unit, '%');
  assert.ok(curve.device_features.length >= 1 && curve.device_features.length <= 4);
  for (const feature of curve.device_features) {
    assert.match(feature, /soil-humidity$/);
  }
  // On a crowded garden the tiles give up their slots to what earns them: the
  // emergency button, what is running, the curve, the forms, the warning.
  assert.equal(content.components.length, 8, 'the fixture garden fills the card');
  assert.equal(countByType(content, 'value'), 2);
  assert.ok(
    content.components.some(
      (component) => component.type === 'text' && component.variant === 'caption',
    ),
    'the offline warning survives: it matters more than a third tile',
  );
});

test('a small garden keeps a tile per sensor', () => {
  // The tiles take the room that is LEFT, they do not pay a fixed toll: a
  // garden with space must not lose a sensor to a blanket cap.
  const content = buildWidgetContent('watering', createContext({ devices: threeSensors() }));

  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(countByType(content, 'value'), 3, 'three sensors, three tiles');
  assert.equal(countByType(content, 'chart'), 1, 'and the curve too');
  assert.ok(content.components.length <= 8);
});

test('every sensor of the garden is drawn, capped at what the core keeps', () => {
  // Gladys labels each series after the FEATURE, so the curves of several
  // sensors all read "Soil humidity" — compared shapes are worth more than
  // that legend, but a fifth sensor would be dropped silently by the core.
  const sensors = [...threeSensors(), ...threeSensors()].map((sensor, index) => ({
    ...sensor,
    id: `${sensor.id}-${index}`,
    name: `Sensor ${index}`,
    services: {
      SENSOR: sensor.services.SENSOR.map((s) => ({ ...s, id: `${sensor.id}-${index}` })),
    },
  }));

  const content = buildWidgetContent('watering', createContext({ devices: sensors }));

  assert.deepEqual(validateWidgetContent(content), []);
  const curve = content.components.find((component) => component.type === 'chart');
  assert.equal(curve.device_features.length, 4, 'six sensors, the four the core draws');
  assert.equal(curve.title.fr, 'Humidité du sol', 'no sensor named: they share the legend');
});

test('a single curve carries the name of the sensor it draws', () => {
  // One series, one legend entry: the title is then free to say WHICH sensor
  // — the only place the card names it when a sensor is pinned.
  const content = buildWidgetContent(
    'watering',
    createContext({
      devices: threeSensors(),
      settings: { sensor: idsOf(gladys, threeSensors()[2]).device },
    }),
  );

  const curve = content.components.find((component) => component.type === 'chart');
  assert.equal(curve.device_features.length, 1);
  assert.ok(curve.device_features[0].includes('sensor-c'));
  assert.equal(curve.title.fr, 'Humidité du sol · Sensor c');
  assert.equal(curve.title.en, 'Soil humidity · Sensor c');
});

test('no chart without a created feature to draw from', () => {
  // An unbound chart would render an empty frame: better no chart at all.
  const content = buildWidgetContent('watering', createContext({ created: new Set() }));
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(countByType(content, 'chart'), 0);
  assert.ok(countByType(content, 'value') > 0, 'the tiles fall back to computed values');
});

test('a pressure pump is not spoken of as a tap', () => {
  // GARDENA exposes a pump as a VALVE service, so it inherits "CLOSED" —
  // right for a tap, wrong for a pump.
  const parsed = [...parseLocation(buildLocationPayload()).values()];
  const waterControl = parsed.find((device) => device.id === WATER_CONTROL_ID);
  const pump = {
    ...waterControl,
    name: 'Pompe',
    common: { ...waterControl.common, modelType: 'GARDENA smart Pressure Pump' },
    // The row is labelled with the name the GARDENA app gives the outlet.
    services: {
      ...waterControl.services,
      VALVE: waterControl.services.VALVE.map((service) => ({
        ...service,
        attributes: { ...service.attributes, name: 'Pompe' },
      })),
    },
  };

  const asPump = buildWidgetContent('watering', createContext({ devices: [pump] }));
  const pumpRow = asPump.components
    .find((component) => component.type === 'status')
    .items.find((item) => item.label.fr === 'Pompe');
  assert.equal(pumpRow.value.fr, 'À l’arrêt');
  assert.equal(pumpRow.value.en, 'Stopped');
  assert.equal(pumpRow.icon, 'zap');

  // A real tap keeps the watering vocabulary.
  const asValve = buildWidgetContent('watering', createContext({ devices: [waterControl] }));
  const valveRow = asValve.components.find((component) => component.type === 'status').items[0];
  assert.equal(valveRow.value.fr, 'Fermée');
  assert.equal(valveRow.icon, 'droplet');
});

test('pump and valve labels cover the same GARDENA values', () => {
  for (const activity of ['CLOSED', 'MANUAL_WATERING', 'SCHEDULED_WATERING']) {
    assert.ok(pumpActivityLabel(activity).fr, `${activity}: untranslated for a pump`);
    assert.ok(valveActivityLabel(activity).fr, `${activity}: untranslated for a valve`);
  }
  assert.equal(isPump({ common: { modelType: 'GARDENA smart Pressure Pump' } }), true);
  assert.equal(isPump({ common: { modelType: 'GARDENA smart Water Control' } }), false);
  assert.equal(isPump({}), false, 'a device without a model is not assumed to be a pump');
});
