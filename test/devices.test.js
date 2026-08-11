// -----------------------------------------------------------------------------
// Mapping GARDENA services -> Gladys devices, features, states and commands.
//
// What matters here is the contract with Gladys: stable external ids, features
// the Gladys UI can render, states that reflect what GARDENA says (not what we
// asked for), and commands that translate a toggle into the right GARDENA verb.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { buildCommands, buildDevice, buildStates, valveSetIds } from '../src/devices/index.js';
import { isMowing } from '../src/devices/mower.js';
import { isWatering } from '../src/devices/valve.js';
import { isPowered } from '../src/devices/powerSocket.js';
import { minutesToSeconds } from '../src/devices/helpers.js';
import { parseLocation } from '../src/gardena/model.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import {
  IRRIGATION_CONTROL_ID,
  MOWER_ID,
  POWER_SOCKET_ID,
  SENSOR_ID,
  WATER_CONTROL_ID,
  buildLocationPayload,
} from './helpers/gardenaFixtures.js';

const gladys = createFakeGladys();
const devices = parseLocation(buildLocationPayload(), 'My Garden');
const config = { ...DEFAULT_CONFIG };

function featureOf(device, suffix) {
  return buildDevice(gladys, device).features.find((feature) =>
    feature.external_id.endsWith(suffix),
  );
}

function stateOf(device, suffix) {
  return buildStates(gladys, device).find((state) =>
    state.device_feature_external_id.endsWith(suffix),
  );
}

test('a device is published with the GARDENA name, the poll frequency and its identity params', () => {
  const device = buildDevice(gladys, devices.get(MOWER_ID));

  assert.equal(device.name, 'SILENO');
  assert.equal(device.external_id, `ext:test:gardena:${MOWER_ID}`);
  assert.deepEqual(
    device.params.find((param) => param.name === 'GARDENA_MODEL'),
    { name: 'GARDENA_MODEL', value: 'GARDENA smart Mower' },
  );
  assert.deepEqual(
    device.params.find((param) => param.name === 'GARDENA_LOCATION'),
    { name: 'GARDENA_LOCATION', value: 'My Garden' },
  );
});

test('every device gets its battery and signal features, mains-powered ones excepted', () => {
  const mower = buildDevice(gladys, devices.get(MOWER_ID));
  const socket = buildDevice(gladys, devices.get(POWER_SOCKET_ID));

  const battery = mower.features.find((feature) => feature.external_id.endsWith('common-battery'));
  assert.equal(battery.category, DEVICE_FEATURE_CATEGORIES.BATTERY);
  assert.equal(battery.unit, 'percent');
  assert.ok(mower.features.some((feature) => feature.external_id.endsWith('common-signal')));

  // The power socket is mains-powered: no battery attribute, hence no feature.
  assert.equal(
    socket.features.some((feature) => feature.external_id.endsWith('common-battery')),
    false,
  );
  assert.ok(socket.features.some((feature) => feature.external_id.endsWith('common-signal')));
});

test('the mower exposes a controllable switch whose state comes from the activity', () => {
  const mower = devices.get(MOWER_ID);
  const onOff = featureOf(mower, 'mower-0-on-off');

  assert.equal(onOff.category, DEVICE_FEATURE_CATEGORIES.SWITCH);
  assert.equal(onOff.type, DEVICE_FEATURE_TYPES.SWITCH.BINARY);
  assert.equal(onOff.read_only, false);
  assert.equal(onOff.has_feedback, true);

  // The fixture mower is cutting.
  assert.equal(stateOf(mower, 'mower-0-on-off').state, 1);
  assert.equal(stateOf(mower, 'mower-0-activity').text, 'OK_CUTTING');
  assert.equal(stateOf(mower, 'mower-0-operating-hours').state, 412);
});

test('mower activities are classified as mowing or not', () => {
  assert.equal(isMowing('OK_CUTTING'), true);
  assert.equal(isMowing('OK_SEARCHING'), true, 'on its way back, still out of the dock');
  assert.equal(isMowing('OK_CHARGING'), false);
  assert.equal(isMowing('PARKED_TIMER'), false);
  assert.equal(isMowing('PAUSED'), false);
  assert.equal(isMowing(undefined), undefined, 'unknown stays unknown, no state published');
});

test('the mower switch maps to the configured start and stop commands', () => {
  const [command] = buildCommands(gladys, devices.get(MOWER_ID));
  assert.equal(command.service_id, MOWER_ID);
  assert.equal(command.control_type, 'MOWER_CONTROL');

  assert.deepEqual(command.resolve(true, config), {
    command: 'START_DONT_OVERRIDE',
    attributes: {},
  });
  assert.deepEqual(command.resolve(false, config), {
    command: 'PARK_UNTIL_NEXT_TASK',
    attributes: {},
  });

  const overriding = { ...config, mower_start_mode: 'duration', mower_duration: 90 };
  assert.deepEqual(command.resolve(true, overriding), {
    command: 'START_SECONDS_TO_OVERRIDE',
    attributes: { seconds: 5400 },
  });
  assert.deepEqual(command.resolve(false, { ...config, mower_stop_mode: 'further_notice' }), {
    command: 'PARK_UNTIL_FURTHER_NOTICE',
    attributes: {},
  });
});

test('a Water Control exposes one valve, an Irrigation Control exposes one group per outlet', () => {
  const waterControl = buildDevice(gladys, devices.get(WATER_CONTROL_ID));
  const irrigation = buildDevice(gladys, devices.get(IRRIGATION_CONTROL_ID));

  assert.equal(
    waterControl.features.filter((feature) => feature.external_id.endsWith('on-off')).length,
    1,
  );

  const switches = irrigation.features.filter((feature) => feature.external_id.endsWith('on-off'));
  assert.equal(switches.length, 2, 'one switch per outlet');
  // The outlet name from the GARDENA app is what makes them tellable apart.
  assert.deepEqual(
    switches.map((feature) => feature.name),
    ['Terrace Watering', 'Vegetable garden Watering'],
  );
  // Distinct, stable ids derived from the service suffix.
  assert.equal(switches[0].external_id.endsWith('valve-1-on-off'), true);
  assert.equal(switches[1].external_id.endsWith('valve-2-on-off'), true);
});

test('a valve switched on starts a watering of the configured duration', () => {
  const commands = buildCommands(gladys, devices.get(IRRIGATION_CONTROL_ID));
  const terrace = commands.find((command) => command.service_id === `${IRRIGATION_CONTROL_ID}:1`);

  assert.equal(terrace.control_type, 'VALVE_CONTROL');
  assert.deepEqual(terrace.resolve(true, { ...config, default_duration: 20 }), {
    command: 'START_SECONDS_TO_OVERRIDE',
    attributes: { seconds: 1200 },
  });
  assert.deepEqual(terrace.resolve(false, config), {
    command: 'STOP_UNTIL_NEXT_TASK',
    attributes: {},
  });
});

test('watering activities are classified, and the remaining duration is published', () => {
  assert.equal(isWatering('MANUAL_WATERING'), true);
  assert.equal(isWatering('SCHEDULED_WATERING'), true);
  assert.equal(isWatering('CLOSED'), false);

  const irrigation = devices.get(IRRIGATION_CONTROL_ID);
  assert.equal(stateOf(irrigation, 'valve-1-on-off').state, 1);
  assert.equal(stateOf(irrigation, 'valve-1-duration').state, 1800);
  assert.equal(stateOf(irrigation, 'valve-2-on-off').state, 0);
  // The closed valve has no `duration` attribute: nothing must be published.
  assert.equal(stateOf(irrigation, 'valve-2-duration'), undefined);
});

test('a power socket honours the switch-on mode', () => {
  const [command] = buildCommands(gladys, devices.get(POWER_SOCKET_ID));

  assert.equal(command.control_type, 'POWER_SOCKET_CONTROL');
  assert.deepEqual(command.resolve(true, { ...config, default_duration: 45 }), {
    command: 'START_SECONDS_TO_OVERRIDE',
    attributes: { seconds: 2700 },
  });
  assert.deepEqual(command.resolve(true, { ...config, power_socket_on_mode: 'forever' }), {
    command: 'START_OVERRIDE',
    attributes: {},
  });
  assert.deepEqual(command.resolve(false, config), {
    command: 'STOP_UNTIL_NEXT_TASK',
    attributes: {},
  });
  assert.equal(isPowered('FOREVER_ON'), true);
  assert.equal(isPowered('TIME_LIMITED_ON'), true);
  assert.equal(isPowered('OFF'), false);
});

test('the sensor publishes only the measurements its model reports', () => {
  const sensorDevice = buildDevice(gladys, devices.get(SENSOR_ID));
  const keys = sensorDevice.features.map((feature) => feature.external_id.split(':').pop());

  assert.ok(keys.includes('sensor-0-soil-humidity'));
  assert.ok(keys.includes('sensor-0-soil-temperature'));
  assert.ok(keys.includes('sensor-0-ambient-temperature'));
  assert.ok(keys.includes('sensor-0-light-intensity'));

  const sensorStates = buildStates(gladys, devices.get(SENSOR_ID));
  const humidity = sensorStates.find((state) =>
    state.device_feature_external_id.endsWith('soil-humidity'),
  );
  assert.equal(humidity.state, 21);
  const temperature = sensorStates.find((state) =>
    state.device_feature_external_id.endsWith('soil-temperature'),
  );
  assert.equal(temperature.state, 17.4, 'decimals are preserved');
});

test('a sensor takes no command, and the valve sets of a device are listed for the stop action', () => {
  assert.deepEqual(buildCommands(gladys, devices.get(SENSOR_ID)), []);
  assert.deepEqual(valveSetIds(devices.get(WATER_CONTROL_ID)), [`${WATER_CONTROL_ID}:wc`]);
  assert.deepEqual(valveSetIds(devices.get(IRRIGATION_CONTROL_ID)), [
    `${IRRIGATION_CONTROL_ID}:vs`,
  ]);
  assert.deepEqual(valveSetIds(devices.get(MOWER_ID)), []);
});

test('a duration in minutes becomes the seconds GARDENA expects, and stays sane', () => {
  assert.equal(minutesToSeconds(30), 1800);
  assert.equal(minutesToSeconds('45'), 2700);
  assert.equal(minutesToSeconds(0), 1800, 'zero would be a no-op command');
  assert.equal(minutesToSeconds(undefined), 1800);
  assert.equal(minutesToSeconds(99999), 86400, 'clamped to a day');
});

// ---------------------------------------------------------------------------
// The publication contract enforced by the Gladys core. These values are NOT
// free-form, and the core rejects the whole batch when one field is off:
//   - `poll_frequency` is an enum in MILLISECONDS (DEVICE_POLL_FREQUENCIES in
//     server/utils/constants.js), not a number of seconds — anything else is
//     "invalid poll frequency" at publication time;
//   - `min` and `max` are NOT NULL on every feature (t_device_feature model),
//     including binary switches and text sensors — a missing one is only
//     rejected later, when the user creates the device.
// Both were real bugs; this test is what keeps them fixed.
// ---------------------------------------------------------------------------
const GLADYS_POLL_FREQUENCIES_MS = [1000, 2000, 10000, 15000, 30000, 60000];

test('every published device satisfies the Gladys core publication contract', () => {
  for (const gardenaDevice of devices.values()) {
    const device = buildDevice(gladys, gardenaDevice);

    assert.ok(
      GLADYS_POLL_FREQUENCIES_MS.includes(device.poll_frequency),
      `${device.name}: poll_frequency ${device.poll_frequency} is not a Gladys poll frequency`,
    );
    assert.ok(device.features.length > 0, `${device.name}: no feature`);

    for (const feature of device.features) {
      const where = `${device.name} / ${feature.name}`;
      assert.equal(typeof feature.name, 'string', `${where}: name required`);
      assert.ok(feature.name.length > 0, `${where}: name must not be empty`);
      assert.equal(typeof feature.min, 'number', `${where}: min is NOT NULL in Gladys`);
      assert.equal(typeof feature.max, 'number', `${where}: max is NOT NULL in Gladys`);
      assert.ok(feature.min <= feature.max, `${where}: min must not exceed max`);
      assert.equal(typeof feature.read_only, 'boolean', `${where}: read_only required`);
      assert.equal(typeof feature.has_feedback, 'boolean', `${where}: has_feedback required`);
      // Categories, types and units must exist in the Gladys catalog; the SDK
      // constants are a verbatim mirror of it.
      assert.ok(
        Object.values(DEVICE_FEATURE_CATEGORIES).includes(feature.category),
        `${where}: unknown category ${feature.category}`,
      );
      assert.ok(
        Object.values(DEVICE_FEATURE_TYPES)
          .flatMap((types) => Object.values(types))
          .includes(feature.type),
        `${where}: unknown type ${feature.type}`,
      );
      if (feature.unit !== undefined) {
        assert.ok(
          Object.values(DEVICE_FEATURE_UNITS).includes(feature.unit),
          `${where}: unknown unit ${feature.unit}`,
        );
      }
    }
  }
});

test('device params never use the GLADYS_ prefix, reserved by the core', () => {
  for (const gardenaDevice of devices.values()) {
    for (const param of buildDevice(gladys, gardenaDevice).params) {
      assert.equal(
        param.name.toUpperCase().startsWith('GLADYS_'),
        false,
        `${param.name}: the GLADYS_* namespace is reserved and rejects the publication`,
      );
      assert.equal(typeof param.value, 'string', `${param.name}: params store strings`);
    }
  }
});

test('external ids are stable across two independent builds', () => {
  const first = buildDevice(gladys, devices.get(IRRIGATION_CONTROL_ID));
  const second = buildDevice(createFakeGladys(), devices.get(IRRIGATION_CONTROL_ID));
  assert.deepEqual(
    first.features.map((feature) => feature.external_id),
    second.features.map((feature) => feature.external_id),
  );
});
