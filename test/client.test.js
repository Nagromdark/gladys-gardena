// -----------------------------------------------------------------------------
// The GARDENA HTTP client, against a fake `fetch`.
//
// The things that break integrations in production are tested here: the exact
// headers GARDENA requires, the token lifecycle, the replay after a 401, and
// the shape of a command body — a typo in any of them fails silently at 2 am,
// not at review time.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GardenaClient } from '../src/gardena/client.js';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

/** A fake `fetch` replaying queued answers and recording every call. */
function createFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) {
      throw new Error(`Unexpected request: ${url}`);
    }
    return typeof next === 'function' ? next(url, init) : next;
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const TOKEN = jsonResponse({ access_token: 'token-1', expires_in: 86400 });

function createClient(fetchImpl, now = () => 1000) {
  return new GardenaClient({
    applicationKey: 'app-key',
    applicationSecret: 'app-secret',
    fetchImpl,
    now,
    // The production spacing (1 s between calls) is exercised by its own test
    // below; the others must not spend a second per request waiting for it.
    minIntervalMs: 0,
  });
}

test('authentication posts client_credentials on the Husqvarna authentication host', async () => {
  const fetchImpl = createFetch([TOKEN, jsonResponse({ data: [] })]);
  const client = createClient(fetchImpl);

  await client.getLocations();

  const auth = fetchImpl.calls[0];
  assert.equal(auth.url, 'https://api.authentication.husqvarnagroup.dev/v1/oauth2/token');
  assert.equal(auth.init.method, 'POST');
  assert.equal(auth.init.body.get('grant_type'), 'client_credentials');
  assert.equal(auth.init.body.get('client_id'), 'app-key');
  assert.equal(auth.init.body.get('client_secret'), 'app-secret');
});

test('smart system requests carry the three headers GARDENA requires', async () => {
  const fetchImpl = createFetch([TOKEN, jsonResponse({ data: [] })]);
  const client = createClient(fetchImpl);

  await client.getLocations();

  const call = fetchImpl.calls[1];
  assert.equal(call.url, 'https://api.smart.gardena.dev/v2/locations');
  assert.equal(call.init.headers.Authorization, 'Bearer token-1');
  assert.equal(call.init.headers['Authorization-Provider'], 'husqvarna');
  // The application key doubles as the API key: without it GARDENA answers 403.
  assert.equal(call.init.headers['X-Api-Key'], 'app-key');
});

test('the token is reused until it expires, then renewed', async () => {
  let now = 1000;
  const fetchImpl = createFetch([
    jsonResponse({ access_token: 'token-1', expires_in: 600 }),
    jsonResponse({ data: [] }),
    jsonResponse({ data: [] }),
    jsonResponse({ access_token: 'token-2', expires_in: 600 }),
    jsonResponse({ data: [] }),
  ]);
  const client = createClient(fetchImpl, () => now);

  await client.getLocations();
  await client.getLocations();
  assert.equal(fetchImpl.calls.length, 3, 'one authentication, two reads');

  // 600 s minus the 5-minute safety margin: the token is considered dead.
  now += 400 * 1000;
  await client.getLocations();
  assert.equal(fetchImpl.calls.length, 5);
  assert.equal(fetchImpl.calls[4].init.headers.Authorization, 'Bearer token-2');
});

test('a token refused mid-session triggers one re-authentication and a replay', async () => {
  const fetchImpl = createFetch([
    TOKEN,
    jsonResponse({ errors: [{ title: 'Unauthorized' }] }, 401),
    jsonResponse({ access_token: 'token-2', expires_in: 86400 }),
    jsonResponse({ data: [{ id: 'loc-1', attributes: { name: 'Garden' } }] }),
  ]);
  const client = createClient(fetchImpl);

  const locations = await client.getLocations();

  assert.deepEqual(locations, [{ id: 'loc-1', name: 'Garden' }]);
  assert.equal(fetchImpl.calls.length, 4);
  assert.equal(fetchImpl.calls[3].init.headers.Authorization, 'Bearer token-2');
});

test('an API error surfaces the GARDENA message and its HTTP status', async () => {
  const fetchImpl = createFetch([
    TOKEN,
    jsonResponse(
      { errors: [{ title: 'Forbidden', detail: 'The API is not connected to the application' }] },
      403,
    ),
  ]);
  const client = createClient(fetchImpl);

  await assert.rejects(() => client.getLocations(), {
    status: 403,
    message: /Forbidden - The API is not connected to the application/,
  });
});

test('a command targets the service and carries the GARDENA control payload', async () => {
  const fetchImpl = createFetch([TOKEN, jsonResponse({}, 202)]);
  const client = createClient(fetchImpl);

  await client.sendCommand('valve-1:2', 'VALVE_CONTROL', 'START_SECONDS_TO_OVERRIDE', {
    seconds: 1800,
  });

  const call = fetchImpl.calls[1];
  assert.equal(call.url, 'https://api.smart.gardena.dev/v2/command/valve-1%3A2');
  assert.equal(call.init.method, 'PUT');
  assert.equal(call.init.headers['Content-Type'], 'application/vnd.api+json');
  const body = JSON.parse(call.init.body);
  assert.equal(body.data.type, 'VALVE_CONTROL');
  assert.equal(body.data.attributes.command, 'START_SECONDS_TO_OVERRIDE');
  assert.equal(body.data.attributes.seconds, 1800);
});

test('the websocket URL is requested for one location and validated', async () => {
  const fetchImpl = createFetch([
    TOKEN,
    jsonResponse({ data: { attributes: { url: 'wss://gardena.example/ws' } } }),
    TOKEN,
    jsonResponse({ data: { attributes: {} } }),
  ]);
  const client = createClient(fetchImpl);

  assert.equal(await client.getWebsocketUrl('loc-1'), 'wss://gardena.example/ws');
  const body = JSON.parse(fetchImpl.calls[1].init.body);
  assert.equal(body.data.type, 'WEBSOCKET');
  assert.equal(body.data.attributes.locationId, 'loc-1');

  const other = createClient(createFetch([TOKEN, jsonResponse({ data: { attributes: {} } })]));
  await assert.rejects(() => other.getWebsocketUrl('loc-1'), /no websocket URL/);
});

test('requests are serialized and spaced out, whatever the concurrency', async () => {
  // GARDENA throttles bursts: ten devices polling at once must not fire ten
  // simultaneous calls. The clock is fake, so the test does not actually wait.
  let now = 0;
  const startedAt = [];
  const fetchImpl = createFetch(
    Array.from({ length: 4 }, () => () => {
      startedAt.push(now);
      now += 10;
      return jsonResponse({ data: [] });
    }),
  );
  const client = new GardenaClient({
    applicationKey: 'app-key',
    applicationSecret: 'app-secret',
    fetchImpl,
    now: () => now,
    minIntervalMs: 0,
  });
  client.accessToken = 'token-1';
  client.tokenExpiresAt = Number.MAX_SAFE_INTEGER;

  await Promise.all([
    client.getLocations(),
    client.getLocations(),
    client.getLocations(),
    client.getLocations(),
  ]);

  assert.deepEqual(startedAt, [0, 10, 20, 30], 'one call at a time, never in parallel');
});

test('missing credentials fail fast instead of hitting the API', async () => {
  const fetchImpl = createFetch([]);
  const client = new GardenaClient({ applicationKey: '', applicationSecret: '', fetchImpl });

  assert.equal(client.hasCredentials(), false);
  await assert.rejects(() => client.getLocations(), { status: 401 });
  assert.equal(fetchImpl.calls.length, 0);
});
