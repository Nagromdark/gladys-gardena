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
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { GardenaService } from '../src/gardenaService.js';
import { WIDGET_KEYS } from '../src/widgets/index.js';
import { buildDevice } from '../src/devices/index.js';
import { parseLocation } from '../src/gardena/model.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { asCreatedDevice } from './helpers/createdDevices.js';
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
async function createService({ createdDevices = 'all', ...serviceOptions } = {}) {
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
    ...serviceOptions,
  });
  // Mirror the widget wiring of index.js: the handlers are registered before
  // connect(), exactly as in production.
  for (const key of WIDGET_KEYS) {
    gladys.onWidgetGet(key, (options) => service.getWidgetContent(key, options));
    gladys.onWidgetAction(key, (actionKey, params, options) =>
      service.runWidgetAction(key, actionKey, params, options),
    );
  }
  // A real GladysIntegration: `gladys.devices` is served by the in-memory
  // Gladys and loaded on connection, like in production.
  await gladys.connect();
  return { service, gladys, client, streams, discovered };
}

function publishedFor(gladys, suffix) {
  return gladys.fake.states.filter((entry) => entry.device_feature_external_id.endsWith(suffix));
}

/** How many times the integration published its discovery list. */
function discoveryCount(gladys) {
  return gladys.fake.requests.filter((request) => request.path === '/discovered_device').length;
}

test('starting publishes the devices, their states, their transports and the status', async () => {
  const { service, gladys, client, streams } = await createService();

  await service.start(CONFIG);

  assert.equal(discoveryCount(gladys), 1);
  assert.equal(gladys.fake.discoveredDevices.length, 5, 'the five GARDENA devices');
  assert.equal(client.locationCalls, 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);

  // One websocket per location, opened.
  assert.equal(streams.length, 1);
  assert.equal(streams[0].started, true);

  assert.equal(publishedFor(gladys, 'mower-0-on-off')[0].state, 1);
  assert.equal(publishedFor(gladys, 'mower-0-activity')[0].text, 'OK_CUTTING');
  assert.equal(publishedFor(gladys, 'common-battery').length, 3, 'the three battery devices');
});

test('an unconfigured integration reports why instead of hammering the API', async () => {
  const { service, gladys, streams } = await createService();

  await service.start(normalizeConfig({}));

  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /application key/);
  assert.equal(streams.length, 0);
  assert.equal(discoveryCount(gladys), 0);
});

test('states are published only for the devices the user created', async () => {
  const parsed = parseLocation(buildLocationPayload());
  const reference = createFakeGladys();
  const onlyMower = buildDevice(reference, parsed.get(MOWER_ID));
  const { service, gladys } = await createService({ createdDevices: [onlyMower] });

  await service.start(CONFIG);

  assert.ok(gladys.fake.states.length > 0);
  assert.equal(
    gladys.fake.states.every((entry) => entry.device_feature_external_id.includes(MOWER_ID)),
    true,
    'nothing is published for a device that exists in the garden but not in Gladys',
  );
});

test('publishing twice sends nothing the second time', async () => {
  const { service, gladys } = await createService();

  await service.start(CONFIG);
  const afterStart = gladys.fake.states.length;
  await service.publishAllStates();

  assert.equal(gladys.fake.states.length, afterStart, 'unchanged values are not re-published');
});

test('a device created in Gladys gets a full snapshot, not only the deltas', async () => {
  const { service, gladys } = await createService();
  await service.start(CONFIG);
  const afterStart = gladys.fake.states.length;

  // What onDeviceCreated triggers: the new device has no state yet, and its
  // GARDENA values did not change, so the delta cache must be bypassed.
  await service.publishSnapshot();

  assert.equal(gladys.fake.states.length, afterStart * 2);
});

test('the actions refuse to run before the credentials are filled in', async () => {
  const { service } = await createService();
  await service.start(normalizeConfig({}));

  await assert.rejects(() => service.testConnection(), /application key/);
  await assert.rejects(() => service.stopAllWatering('whatever'), /application key/);
});

test('a real-time message publishes only what changed', async () => {
  const { service, gladys, streams } = await createService();
  await service.start(CONFIG);
  const before = gladys.fake.states.length;

  streams[0].onMessage({
    id: MOWER_ID,
    type: 'MOWER',
    attributes: { activity: { value: 'PARKED_TIMER' } },
  });
  await Promise.resolve();
  await Promise.resolve();

  const published = gladys.fake.states.slice(before);
  assert.deepEqual(
    published.map((entry) => entry.device_feature_external_id.split(':').pop()).sort(),
    ['mower-0-activity', 'mower-0-on-off'],
    'the switch follows the activity, the untouched features stay quiet',
  );
  assert.equal(published.find((entry) => entry.state !== undefined).state, 0);
});

test('a device that fell off the radio link is flagged unreachable and degraded', async () => {
  const { service, gladys } = await createService();

  await service.start(CONFIG);

  const socket = gladys.fake.transports.find((entry) =>
    entry.device_external_id.endsWith(POWER_SOCKET_ID),
  );
  assert.equal(socket.transport, 'unreachable');
  assert.equal(socket.degraded, true);
  assert.match(socket.message.en, /radio link/);

  const mower = gladys.fake.transports.find((entry) => entry.device_external_id.endsWith(MOWER_ID));
  assert.equal(mower.transport, 'cloud');
  assert.equal(mower.degraded, undefined);

  // Unchanged transports are not re-published on every message.
  const count = gladys.fake.transports.length;
  await service.publishTransports();
  assert.equal(gladys.fake.transports.length, count);
});

test('switching a feature on sends the GARDENA command of the right service', async () => {
  const { service, client, discovered } = await createService();
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
  const { service, client } = await createService();
  await service.start(CONFIG);
  const callsBefore = client.locationCalls;

  await assert.rejects(
    () => service.onSetValue({}, { external_id: 'ext:test:gardena:nope:valve-0-on-off' }, 1),
    /Unknown GARDENA feature/,
  );
  assert.equal(client.locationCalls, callsBefore + 1, 'the garden was re-read before giving up');
});

test('stopping all watering targets the valve set of the chosen device', async () => {
  const { service, client, discovered } = await createService();
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
  const { service, client, discovered } = await createService();
  await service.start(CONFIG);
  const callsAfterStart = client.locationCalls;

  await Promise.all(discovered.map((device) => service.onPoll(device)));

  assert.equal(client.locationCalls, callsAfterStart, 'the fresh picture is shared');
});

// ---------------------------------------------------------------------------
// The GARDENA quota is counted per WEEK, not per second: a refresh that looks
// harmless in isolation ("every 15 minutes, surely that is fine") costs 672
// calls a week and blows a 1000-call budget on its own. These tests pin the
// arithmetic, because nothing else in the system will complain until the API
// starts answering 429 — days later.
// ---------------------------------------------------------------------------
const WEEK_SECONDS = 7 * 24 * 3600;

test('the refresh interval is honoured exactly, so the weekly cost is predictable', async () => {
  const { service, client } = await createService();
  await service.start(CONFIG);
  const callsAfterStart = client.locationCalls;

  // One hour by default: the picture is reused, whoever asks and however often.
  assert.equal(service.refreshIntervalMs(), 3600 * 1000);

  service.lastRefreshAt = Date.now() - 59 * 60 * 1000;
  await service.onPoll({ external_id: `ext:test:gardena:${MOWER_ID}` });
  assert.equal(client.locationCalls, callsAfterStart, 'still fresh: no API call');

  service.lastRefreshAt = Date.now() - 61 * 60 * 1000;
  await service.onPoll({ external_id: `ext:test:gardena:${MOWER_ID}` });
  assert.equal(client.locationCalls, callsAfterStart + 1, 'past the interval: one call');

  // The budget the documentation announces, from the code's own interval.
  const refreshesPerWeek = WEEK_SECONDS / (service.refreshIntervalMs() / 1000);
  assert.equal(refreshesPerWeek, 168);
  assert.ok(refreshesPerWeek < 200, 'the default must stay far below a 1000/week quota');
});

test('a websocket reconnection does not force a read, it follows the same interval', async () => {
  // GARDENA closes the stream every ~2 hours by design: a forced read on every
  // reconnection would silently add ~84 calls a week, on top of the refreshes.
  const { service, client, streams } = await createService();
  await service.start(CONFIG);
  const callsAfterStart = client.locationCalls;

  streams[0].onOpen();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(client.locationCalls, callsAfterStart, 'the fresh picture is reused');
});

test('a 429 suspends the REST refreshes instead of insisting', async () => {
  const { service, client } = await createService();
  await service.start(CONFIG);

  const throttled = new Error('Too Many Requests');
  throttled.status = 429;
  client.getLocation = async () => {
    client.locationCalls += 1;
    throw throttled;
  };

  await assert.rejects(() => service.refreshLocations({ maxAgeMs: 0 }));
  const callsAfterThrottle = client.locationCalls;
  assert.ok(service.throttledUntil > Date.now(), 'a pause is armed');

  // Even an explicit "refresh now" stays quiet during the pause.
  await service.refreshLocations({ maxAgeMs: 0 });
  assert.equal(client.locationCalls, callsAfterThrottle, 'no further call while throttled');
});

test('changing the credentials restarts the session, changing a duration does not', async () => {
  const { service, gladys, streams } = await createService();
  await service.start(CONFIG);

  await service.applyConfig({ ...CONFIG, default_duration: 45 }, false);
  assert.equal(streams.length, 1, 'no new stream');
  assert.equal(discoveryCount(gladys), 1, 'nothing published depends on a duration');
  assert.equal(service.config.default_duration, 45, 'the next command will use the new duration');

  await service.applyConfig({ ...CONFIG, application_key: 'other-key' }, true);
  assert.equal(streams[0].stopped, true, 'the old stream is closed');
  assert.equal(streams.length, 2, 'a new stream is opened');
});

test('a failing GARDENA API is reported in the Configuration screen', async () => {
  const { service, gladys } = await createService();
  service.createClient = () => ({
    async getLocations() {
      const error = new Error('Forbidden');
      error.status = 403;
      throw error;
    },
  });

  await assert.rejects(() => service.start(CONFIG));

  const status = gladys.fake.connectionStatus;
  assert.equal(status.connected, false);
  assert.match(status.message.en, /refused the credentials/);
});

test('stopping closes every real-time stream', async () => {
  const { service, streams } = await createService();
  await service.start(CONFIG);

  service.stop();

  assert.equal(streams[0].stopped, true);
});

// ---------------------------------------------------------------------------
// Dashboard widgets. The headline property is the one the whole integration is
// built around: showing a card must not spend a single GARDENA request.
// ---------------------------------------------------------------------------

test('showing the widgets costs zero GARDENA request', async () => {
  const { service, gladys, client } = await createService();
  await service.start(CONFIG);
  const restCalls = client.locationCalls;
  const wsCalls = client.websocketCalls;

  for (let i = 0; i < 5; i += 1) {
    for (const key of ['watering', 'mower']) {
      const ack = await gladys.fake.widgetGet(key, { language: 'fr' });
      assert.equal(ack.success, true, `${key}: the content was refused`);
      assert.deepEqual(validateWidgetContent(ack.data.content), [], `${key}: invalid content`);
    }
  }

  assert.equal(client.locationCalls, restCalls, 'a dashboard must not re-read the GARDENA API');
  assert.equal(client.websocketCalls, wsCalls);
});

test('the stop button closes every valve of the account', async () => {
  const { service, gladys, client } = await createService();
  await service.start(CONFIG);
  const before = client.commands.length;

  const ack = await gladys.fake.widgetAction('watering', 'stop_watering', {});

  assert.equal(ack.success, true);
  const sent = client.commands.slice(before);
  // The Water Control and the Irrigation Control each carry one valve set.
  assert.equal(sent.length, 2);
  for (const command of sent) {
    assert.equal(command.controlType, 'VALVE_SET_CONTROL');
    assert.equal(command.command, 'STOP_UNTIL_NEXT_TASK');
  }
  assert.match(ack.data.message.fr, /Arrosage arrêté/);
});

test('the watering form waters the chosen outlet for the typed duration', async () => {
  const { service, gladys, client } = await createService();
  await service.start(CONFIG);

  const ack = await gladys.fake.widgetAction(
    'watering',
    'start_watering',
    {},
    { values: { valve: `${IRRIGATION_CONTROL_ID}:1`, minutes: 20 } },
  );

  assert.equal(ack.success, true);
  assert.deepEqual(client.commands.at(-1), {
    serviceId: `${IRRIGATION_CONTROL_ID}:1`,
    controlType: 'VALVE_CONTROL',
    command: 'START_SECONDS_TO_OVERRIDE',
    attributes: { seconds: 1200 },
  });
});

test('a widget action on an outlet that no longer exists is refused', async () => {
  const { service, gladys, client } = await createService();
  await service.start(CONFIG);
  const before = client.commands.length;

  const ack = await gladys.fake.widgetAction(
    'watering',
    'start_watering',
    {},
    { values: { valve: 'gone', minutes: 5 } },
  );

  assert.equal(ack.success, false);
  assert.match(ack.error, /Unknown GARDENA valve/);
  assert.equal(client.commands.length, before, 'nothing was sent');
});

/**
 * A reader of the nudges sent from now on. `fake.widgetRefreshes` is a
 * read-only snapshot, so the tests measure deltas rather than resetting it.
 */
function sinceNudges(gladys) {
  const before = gladys.fake.widgetRefreshes.length;
  return () => gladys.fake.widgetRefreshes.slice(before);
}

/** Wait until a condition holds, instead of betting on a fixed delay. */
async function until(condition, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return condition();
}

test('a real-time change nudges only the card that shows it', async () => {
  // Window 0: this test is about ROUTING, not about the rate limit, so it must
  // not depend on a timer under a loaded test runner.
  const { service, gladys, streams } = await createService({ widgetNudgeWindowMs: 0 });
  await service.start(CONFIG);
  const nudges = sinceNudges(gladys);

  streams[0].onMessage({
    id: MOWER_ID,
    type: 'MOWER',
    attributes: { activity: { value: 'PAUSED' } },
  });
  await Promise.resolve();

  assert.deepEqual(nudges(), ['mower']);
});

test('a burst of messages is coalesced, and the last one is never swallowed', async () => {
  // The core accepts one nudge per 10 s and per widget. A naive limiter would
  // drop the END of a burst, i.e. the message carrying the final state.
  const WINDOW = 50;
  const { service, gladys, streams } = await createService({ widgetNudgeWindowMs: WINDOW });
  await service.start(CONFIG);
  // start() consumed the window: let it free up before measuring.
  await new Promise((resolve) => setTimeout(resolve, WINDOW * 3));
  const nudges = sinceNudges(gladys);

  for (const activity of ['OK_LEAVING', 'OK_CUTTING', 'OK_SEARCHING']) {
    streams[0].onMessage({
      id: MOWER_ID,
      type: 'MOWER',
      attributes: { activity: { value: activity } },
    });
  }
  assert.deepEqual(nudges(), ['mower'], 'the burst is coalesced into one nudge');

  assert.ok(await until(() => nudges().length === 2), 'the final state is sent after the window');
  assert.deepEqual(nudges(), ['mower', 'mower']);
});

test('a successful action does not nudge: the core already drops its cache', async () => {
  // Window 0: any nudge would show up immediately, so an empty delta is proof.
  const { service, gladys } = await createService({ widgetNudgeWindowMs: 0 });
  await service.start(CONFIG);
  const nudges = sinceNudges(gladys);

  await gladys.fake.widgetAction('watering', 'stop_watering', {});

  assert.deepEqual(nudges(), []);
});
