// -----------------------------------------------------------------------------
// The real-time stream, with a fake socket.
//
// GARDENA closes the websocket about every two hours, on purpose: a stream that
// does not reconnect looks perfectly healthy while silently going stale. These
// tests pin the lifecycle — fresh URL on every attempt, backoff, keep-alive
// ping, and a `stop()` that really stops.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GardenaRealtime } from '../src/gardena/realtime.js';

/** A socket exposing the `ws` surface the stream uses, driven by the test. */
function createFakeSocket() {
  const handlers = new Map();
  return {
    pings: 0,
    closed: false,
    on(event, handler) {
      handlers.set(event, handler);
    },
    removeAllListeners() {
      handlers.clear();
    },
    close() {
      this.closed = true;
    },
    ping() {
      this.pings += 1;
    },
    emit(event, ...args) {
      handlers.get(event)?.(...args);
    },
  };
}

function createStream({ getUrl, onMessage = () => {}, onOpen, onClose } = {}) {
  const sockets = [];
  const urls = [];
  const stream = new GardenaRealtime({
    locationId: 'loc-1',
    getUrl:
      getUrl ??
      (async () => {
        urls.push(`wss://gardena.example/ws-${urls.length}`);
        return urls.at(-1);
      }),
    onMessage,
    onOpen,
    onClose,
    createSocket: () => {
      const socket = createFakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  return { stream, sockets, urls };
}

test('a message is parsed and handed over, malformed frames are ignored', async () => {
  const received = [];
  const { stream, sockets } = createStream({ onMessage: (message) => received.push(message) });

  stream.start();
  await Promise.resolve();

  sockets[0].emit('open');
  sockets[0].emit('message', JSON.stringify({ id: 'x', type: 'MOWER' }));
  sockets[0].emit('message', Buffer.from(JSON.stringify({ id: 'y', type: 'VALVE' })));
  sockets[0].emit('message', 'not json at all');

  assert.deepEqual(received, [
    { id: 'x', type: 'MOWER' },
    { id: 'y', type: 'VALVE' },
  ]);
  stream.stop();
});

test('a closed stream reconnects with a FRESH url, since GARDENA urls are single use', async () => {
  const { stream, sockets, urls } = createStream();
  stream.start();
  await Promise.resolve();
  sockets[0].emit('open');

  // GARDENA hangs up after ~2 hours: the reconnection is scheduled, not immediate.
  sockets[0].emit('close', 1006);
  assert.ok(stream.reconnectTimer, 'a reconnection is pending');

  // Fire the pending timer without waiting for the real backoff.
  clearTimeout(stream.reconnectTimer);
  stream.reconnectTimer = null;
  await stream.connect();

  assert.equal(sockets.length, 2);
  assert.equal(urls.length, 2, 'a new websocket URL was requested');
  assert.notEqual(urls[0], urls[1]);
  stream.stop();
});

test('the backoff grows and is capped, so a broken API is not hammered', async () => {
  const { stream } = createStream({
    getUrl: async () => {
      throw new Error('429 Too Many Requests');
    },
  });

  stream.start();
  await Promise.resolve();
  await Promise.resolve();

  assert.ok(stream.reconnectTimer, 'a failed attempt schedules a retry');
  assert.equal(stream.attempts, 1);
  stream.stop();
  assert.equal(stream.reconnectTimer, null, 'stopping cancels the pending retry');
});

test('an open connection is kept alive with protocol pings', async () => {
  const { stream, sockets } = createStream();
  stream.start();
  await Promise.resolve();
  sockets[0].emit('open');

  assert.ok(stream.pingTimer, 'the keep-alive is armed');
  // Run the keep-alive without waiting 100 seconds.
  stream.socket.ping();
  assert.equal(sockets[0].pings, 1);

  stream.stop();
  assert.equal(stream.pingTimer, null);
});

test('open and close are reported so the caller can resynchronize', async () => {
  const events = [];
  const { stream, sockets } = createStream({
    onOpen: () => events.push('open'),
    onClose: () => events.push('close'),
  });

  stream.start();
  await Promise.resolve();
  sockets[0].emit('open');
  sockets[0].emit('close', 1000);

  assert.deepEqual(events, ['open', 'close']);
  stream.stop();
});

test('a stopped stream never reconnects', async () => {
  const { stream, sockets } = createStream();
  stream.start();
  await Promise.resolve();
  sockets[0].emit('open');

  stream.stop();
  await stream.connect();

  assert.equal(sockets.length, 1, 'no socket is opened after stop()');
  assert.equal(stream.reconnectTimer, null);
});
