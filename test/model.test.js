// -----------------------------------------------------------------------------
// Normalization of the GARDENA payloads: the flat list of services must become
// one object per physical device, and a websocket message must MERGE into it.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyWebsocketMessage,
  deviceIdOf,
  flattenAttributes,
  isOnline,
  parseLocation,
  serviceSuffixOf,
  servicesOfType,
} from '../src/gardena/model.js';
import {
  IRRIGATION_CONTROL_ID,
  MOWER_ID,
  POWER_SOCKET_ID,
  SENSOR_ID,
  WATER_CONTROL_ID,
  buildLocationPayload,
} from './helpers/gardenaFixtures.js';

test('a service id resolves to its device id and its suffix', () => {
  assert.equal(deviceIdOf('abc'), 'abc');
  assert.equal(deviceIdOf('abc:1'), 'abc');
  assert.equal(serviceSuffixOf('abc'), '0');
  assert.equal(serviceSuffixOf('abc:1'), '1');
  // The suffix ends up in an external id: keep it alphanumeric.
  assert.equal(serviceSuffixOf('abc:wc'), 'wc');
});

test('attributes are unwrapped from their { value, timestamp } envelope', () => {
  const flattened = flattenAttributes({
    attributes: { activity: { value: 'OK_CUTTING', timestamp: 'now' }, plain: 3 },
  });
  assert.deepEqual(flattened, { activity: 'OK_CUTTING', plain: 3 });
});

test('a location payload becomes one device per physical device', () => {
  const devices = parseLocation(buildLocationPayload(), 'My Garden');

  assert.equal(devices.size, 5, 'the five products of the fixture');
  assert.deepEqual(
    [...devices.keys()].sort(),
    [MOWER_ID, WATER_CONTROL_ID, IRRIGATION_CONTROL_ID, SENSOR_ID, POWER_SOCKET_ID].sort(),
  );

  const mower = devices.get(MOWER_ID);
  assert.equal(mower.name, 'SILENO');
  assert.equal(mower.common.batteryLevel, 87);
  assert.equal(mower.locationName, 'My Garden');
  assert.equal(servicesOfType(mower, 'MOWER')[0].attributes.activity, 'OK_CUTTING');
});

test('the several valves of an Irrigation Control stay in one device, in a stable order', () => {
  const devices = parseLocation(buildLocationPayload());
  const valves = servicesOfType(devices.get(IRRIGATION_CONTROL_ID), 'VALVE');

  assert.equal(valves.length, 2);
  assert.deepEqual(
    valves.map((valve) => valve.attributes.name),
    ['Terrace', 'Vegetable garden'],
  );
  assert.equal(servicesOfType(devices.get(IRRIGATION_CONTROL_ID), 'VALVE_SET').length, 1);
});

test('an unknown service type is ignored instead of creating a ghost device', () => {
  const devices = parseLocation(buildLocationPayload());
  assert.equal(devices.has('e6b7a3c2-0000-0000-0000-000000000000'), false);
});

test('the radio link state drives the online status', () => {
  const devices = parseLocation(buildLocationPayload());
  assert.equal(isOnline(devices.get(MOWER_ID)), true);
  assert.equal(isOnline(devices.get(POWER_SOCKET_ID)), false);
});

test('a websocket message merges into the device, keeping the untouched attributes', () => {
  const devices = parseLocation(buildLocationPayload());

  const updated = applyWebsocketMessage(devices, {
    id: MOWER_ID,
    type: 'MOWER',
    attributes: { activity: { value: 'PARKED_TIMER', timestamp: 'now' } },
  });

  const mowerService = servicesOfType(updated, 'MOWER')[0];
  assert.equal(mowerService.attributes.activity, 'PARKED_TIMER');
  // The message only carried `activity`: the rest must survive.
  assert.equal(mowerService.attributes.operatingHours, 412);
  assert.equal(mowerService.attributes.state, 'OK');
});

test('a websocket message targets the right valve of an Irrigation Control', () => {
  const devices = parseLocation(buildLocationPayload());

  applyWebsocketMessage(devices, {
    id: `${IRRIGATION_CONTROL_ID}:2`,
    type: 'VALVE',
    attributes: { activity: { value: 'MANUAL_WATERING' } },
  });

  const valves = servicesOfType(devices.get(IRRIGATION_CONTROL_ID), 'VALVE');
  assert.equal(valves[0].attributes.activity, 'SCHEDULED_WATERING', 'valve 1 untouched');
  assert.equal(valves[1].attributes.activity, 'MANUAL_WATERING');
});

test('a websocket message about an unknown device is reported, not applied blindly', () => {
  const devices = parseLocation(buildLocationPayload());
  const result = applyWebsocketMessage(devices, {
    id: 'a-device-added-while-we-were-running',
    type: 'VALVE',
    attributes: {},
  });
  assert.equal(result, undefined);
  assert.equal(devices.size, 5);
});

test('a COMMON message updates the device name', () => {
  const devices = parseLocation(buildLocationPayload());
  applyWebsocketMessage(devices, {
    id: MOWER_ID,
    type: 'COMMON',
    attributes: { name: { value: 'Renamed mower' }, batteryLevel: { value: 42 } },
  });
  assert.equal(devices.get(MOWER_ID).name, 'Renamed mower');
  assert.equal(devices.get(MOWER_ID).common.batteryLevel, 42);
  assert.equal(devices.get(MOWER_ID).common.serial, '00003676', 'other attributes survive');
});
