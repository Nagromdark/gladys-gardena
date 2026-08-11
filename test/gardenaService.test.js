// -----------------------------------------------------------------------------
// The orchestrator, with a fake GARDENA API and a fake real-time stream.
//
// This is where the integration meets Gladys' constraints: publish the states
// of the devices the user created, publish only what changed (the host API caps
// states at 300/minute), translate a toggle into a GARDENA command, and tell the
// user when a device fell off the radio link.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GardenaService } from '../src/gardenaService.js';
import { buildDevice } from '../src/devices/index.js';
import { parseLocation } from '../src/gardena/model.js';
import { normalizeConfig } from '../src/config.js';
import { asCreatedDevice, createFakeGladys } from './helpers/fakeGladys.js';
import {
  IRRIGATION_CONTROL_ID,
  LOCATION_ID,
  MOWER_ID,
  POWER_SOCKET_ID,
  WATER_CONTROL_ID,
  buildLocationPayload,
} from './helpers/gardenaFixtures.js';

const CONFIG = normalizeConfig({
  application_key: 'app-key',
  application_secret: 'app-secret',
});

/** A GARDENA client that answers from the fixture and records the commands. */
function createFakeClient() {
  return {
    commands: [],
    locationCalls: 0,
    websocketCalls: 0,
    async getLocations() {
      return [{ id: LOCATION_ID, name: 'My Garden' }];
    },
    async getLocation() {
      this.locationCalls += 1;
      return buildLocationPayload();
    },
    async getWebsocketUrl() {
      this.websocketCalls += 1;
      return 'wss://gardena.example/ws';
    },
    async sendCommand(serviceId, controlType, command, attributes = {}) {
      this.commands.push({ serviceId, controlType, command, attributes });
    },
  };
}

/** A real-time stream that never opens a socket but exposes its callbacks. */
function createFakeRealtime(streams) {
  return (options) => {
    const stream = { ...options, started: false, stopped: false };
    stream.start = () => {
      stream.started = true;
    };
    stream.stop = () => {
      stream.stopped = true;
    };
    streams.push(stream);
    return stream;
  };
}

/**
 * A service wired to the fixture, with every device already created in Gladys
 * (which is what the user does after the discovery screen).
 */
function createService({ createdDevices = 'all' } = {}) {
  const parsed = parseLocation(buildLocationPayload(), 'My Garden');
  const reference = createFakeGladys();
  const discovered = [...parsed.values()].map((device) => buildDevice(reference, device));
  const devices =
    createdDevices === 'all'
      ? discovered.map(asCreatedDevice)
      : createdDevices.map(asCreatedDevice);
  const gladys = createFakeGladys({ devices });
  const client = createFakeClient();
  const streams = [];
  const service = new GardenaService(gladys, {
    createClient: () => client,
    createRealtime: createFakeRealtime(streams),
  });
  return { service, gladys, client, streams, discovered };
}

function publishedFor(gladys, suffix) {
  return gladys.published.filter((entry) => entry.featureExternalId.endsWith(suffix));
}

test('starting publishes the devices, their states, their transports and the status', async () => {
  const { service, gladys, client, streams } = createService();

  await service.start(CONFIG);

  assert.equal(gladys.discovered.length, 1);
  assert.equal(gladys.discovered[0].length, 5, 'the five GARDENA devices');
  assert.equal(client.locationCalls, 1);
  assert.deepEqual(gladys.connectionStatuses.at(-1), { connected: true, message: undefined });

  // One websocket per location, opened.
  assert.equal(streams.length, 1);
  assert.equal(streams[0].started, true);

  assert.equal(publishedFor(gladys, 'mower-0-on-off')[0].state, 1);
  assert.equal(publishedFor(gladys, 'mower-0-activity')[0].text, 'OK_CUTTING');
  assert.equal(publishedFor(gladys, 'common-battery').length, 3, 'the three battery devices');
});

test('an unconfigured integration reports why instead of hammering the API', async () => {
  const { service, gladys, streams } = createService();

  await service.start(normalizeConfig({}));

  assert.equal(gladys.connectionStatuses.at(-1).connected, false);
  assert.match(gladys.connectionStatuses.at(-1).message.en, /application key/);
  assert.equal(streams.length, 0);
  assert.equal(gladys.discovered.length, 0);
});

test('states are published only for the devices the user created', async () => {
  const parsed = parseLocation(buildLocationPayload());
  const reference = createFakeGladys();
  const onlyMower = buildDevice(reference, parsed.get(MOWER_ID));
  const { service, gladys } = createService({ createdDevices: [onlyMower] });

  await service.start(CONFIG);

  assert.ok(gladys.published.length > 0);
  assert.equal(
    gladys.published.every((entry) => entry.featureExternalId.includes(MOWER_ID)),
    true,
    'nothing is published for a device that exists in the garden but not in Gladys',
  );
});

test('publishing twice sends nothing the second time', async () => {
  const { service, gladys } = createService();

  await service.start(CONFIG);
  const afterStart = gladys.published.length;
  await service.publishAllStates();

  assert.equal(gladys.published.length, afterStart, 'unchanged values are not re-published');
});

test('a device created in Gladys gets a full snapshot, not only the deltas', async () => {
  const { service, gladys } = createService();
  await service.start(CONFIG);
  const afterStart = gladys.published.length;

  // What onDeviceCreated triggers: the new device has no state yet, and its
  // GARDENA values did not change, so the delta cache must be bypassed.
  await service.publishSnapshot();

  assert.equal(gladys.published.length, afterStart * 2);
});

test('the actions refuse to run before the credentials are filled in', async () => {
  const { service } = createService();
  await service.start(normalizeConfig({}));

  await assert.rejects(() => service.testConnection(), /application key/);
  await assert.rejects(() => service.stopAllWatering('whatever'), /application key/);
});

test('a real-time message publishes only what changed', async () => {
  const { service, gladys, streams } = createService();
  await service.start(CONFIG);
  const before = gladys.published.length;

  streams[0].onMessage({
    id: MOWER_ID,
    type: 'MOWER',
    attributes: { activity: { value: 'PARKED_TIMER' } },
  });
  await Promise.resolve();
  await Promise.resolve();

  const published = gladys.published.slice(before);
  assert.deepEqual(
    published.map((entry) => entry.featureExternalId.split(':').pop()).sort(),
    ['mower-0-activity', 'mower-0-on-off'],
    'the switch follows the activity, the untouched features stay quiet',
  );
  assert.equal(published.find((entry) => entry.state !== undefined).state, 0);
});

test('a device that fell off the radio link is flagged unreachable and degraded', async () => {
  const { service, gladys } = createService();

  await service.start(CONFIG);

  const socket = gladys.transports.find((entry) => entry.external_id.endsWith(POWER_SOCKET_ID));
  assert.equal(socket.transport, 'unreachable');
  assert.equal(socket.degraded, true);
  assert.match(socket.message.en, /radio link/);

  const mower = gladys.transports.find((entry) => entry.external_id.endsWith(MOWER_ID));
  assert.equal(mower.transport, 'cloud');
  assert.equal(mower.degraded, undefined);

  // Unchanged transports are not re-published on every message.
  const count = gladys.transports.length;
  await service.publishTransports();
  assert.equal(gladys.transports.length, count);
});

test('switching a feature on sends the GARDENA command of the right service', async () => {
  const { service, client, discovered } = createService();
  await service.start(CONFIG);

  const irrigation = discovered.find((device) =>
    device.external_id.endsWith(IRRIGATION_CONTROL_ID),
  );
  const terrace = irrigation.features.find((feature) =>
    feature.external_id.endsWith('valve-1-on-off'),
  );

  await service.onSetValue(irrigation, terrace, 1);

  assert.deepEqual(client.commands.at(-1), {
    serviceId: `${IRRIGATION_CONTROL_ID}:1`,
    controlType: 'VALVE_CONTROL',
    command: 'START_SECONDS_TO_OVERRIDE',
    attributes: { seconds: 30 * 60 },
  });
});

test('a command on an unknown feature refreshes once, then fails explicitly', async () => {
  const { service, client } = createService();
  await service.start(CONFIG);
  const callsBefore = client.locationCalls;

  await assert.rejects(
    () => service.onSetValue({}, { external_id: 'ext:test:gardena:nope:valve-0-on-off' }, 1),
    /Unknown GARDENA feature/,
  );
  assert.equal(client.locationCalls, callsBefore + 1, 'the garden was re-read before giving up');
});

test('stopping all watering targets the valve set of the chosen device', async () => {
  const { service, client, discovered } = createService();
  await service.start(CONFIG);

  const waterControl = discovered.find((device) => device.external_id.endsWith(WATER_CONTROL_ID));
  const message = await service.stopAllWatering(waterControl.external_id);

  assert.deepEqual(client.commands.at(-1), {
    serviceId: `${WATER_CONTROL_ID}:wc`,
    controlType: 'VALVE_SET_CONTROL',
    command: 'STOP_UNTIL_NEXT_TASK',
    attributes: {},
  });
  assert.match(message.en, /Watering stopped/);

  // A mower has no valve: say so instead of sending a meaningless command.
  const mower = discovered.find((device) => device.external_id.endsWith(MOWER_ID));
  const answer = await service.stopAllWatering(mower.external_id);
  assert.match(answer.en, /no valve/);
});

test('polling several devices costs a single API call', async () => {
  const { service, client, discovered } = createService();
  await service.start(CONFIG);
  const callsAfterStart = client.locationCalls;

  await Promise.all(discovered.map((device) => service.onPoll(device)));

  assert.equal(client.locationCalls, callsAfterStart, 'the fresh picture is shared');
});

test('changing the credentials restarts the session, changing a duration does not', async () => {
  const { service, gladys, streams } = createService();
  await service.start(CONFIG);

  await service.applyConfig({ ...CONFIG, default_duration: 45 }, false);
  assert.equal(streams.length, 1, 'no new stream');
  assert.equal(gladys.discovered.length, 1, 'nothing published depends on a duration');
  assert.equal(service.config.default_duration, 45, 'the next command will use the new duration');

  await service.applyConfig({ ...CONFIG, application_key: 'other-key' }, true);
  assert.equal(streams[0].stopped, true, 'the old stream is closed');
  assert.equal(streams.length, 2, 'a new stream is opened');
});

test('a failing GARDENA API is reported in the Configuration screen', async () => {
  const { service, gladys } = createService();
  service.createClient = () => ({
    async getLocations() {
      const error = new Error('Forbidden');
      error.status = 403;
      throw error;
    },
  });

  await assert.rejects(() => service.start(CONFIG));

  const status = gladys.connectionStatuses.at(-1);
  assert.equal(status.connected, false);
  assert.match(status.message.en, /refused the credentials/);
});

test('stopping closes every real-time stream', async () => {
  const { service, streams } = createService();
  await service.start(CONFIG);

  service.stop();

  assert.equal(streams[0].stopped, true);
});
