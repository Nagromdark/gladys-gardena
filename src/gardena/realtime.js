// -----------------------------------------------------------------------------
// Real-time stream of a GARDENA location.
//
// GARDENA pushes every state change over a websocket, which is the ONLY sane way
// to follow a garden: the REST API is rate-limited and sized for occasional
// reads, not for polling a mower every 30 seconds.
//
// The lifecycle GARDENA imposes:
//   - the websocket URL is obtained through the REST API, is single use and
//     short-lived: a new one is requested for every (re)connection;
//   - the server closes the connection after about two hours, on purpose;
//   - a silent connection is dropped, so we send a protocol ping regularly.
//
// This class therefore owns a reconnection loop with exponential backoff, and
// re-announces every reconnection so the caller can resynchronize over REST.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import WebSocket from 'ws';
import {
  WEBSOCKET_PING_INTERVAL_MS,
  WEBSOCKET_RECONNECT_BASE_DELAY_MS,
  WEBSOCKET_RECONNECT_MAX_DELAY_MS,
} from './constants.js';

const logger = createLogger({ name: 'gardena-realtime' });

export class GardenaRealtime {
  /**
   * @param {object} options - Stream options.
   * @param {string} options.locationId - Location to subscribe to.
   * @param {Function} options.getUrl - `() => Promise<string>` websocket URL provider.
   * @param {Function} options.onMessage - `(message) => void`, one JSON:API service.
   * @param {Function} [options.onOpen] - Called on every (re)connection.
   * @param {Function} [options.onClose] - Called whenever the connection drops.
   * @param {Function} [options.createSocket] - Socket factory (injected in tests).
   */
  constructor({ locationId, getUrl, onMessage, onOpen, onClose, createSocket }) {
    this.locationId = locationId;
    this.getUrl = getUrl;
    this.onMessage = onMessage;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.createSocket = createSocket ?? ((url) => new WebSocket(url));
    this.socket = null;
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.attempts = 0;
    this.stopped = false;
  }

  /** Open the stream and keep it open for the life of the integration. */
  start() {
    this.stopped = false;
    this.connect();
  }

  /** Close the stream for good (configuration change, shutdown). */
  stop() {
    this.stopped = true;
    this.clearTimers();
    if (this.socket) {
      // Drop the handlers first: this close is wanted, it must not reconnect.
      this.socket.removeAllListeners?.();
      try {
        this.socket.close();
      } catch (err) {
        logger.debug(`Closing the websocket failed: ${err.message}`);
      }
      this.socket = null;
    }
  }

  async connect() {
    if (this.stopped) {
      return;
    }
    try {
      const url = await this.getUrl();
      if (this.stopped) {
        return;
      }
      logger.info(`Opening the real-time stream of location ${this.locationId}`);
      const socket = this.createSocket(url);
      this.socket = socket;

      socket.on('open', () => {
        this.attempts = 0;
        this.startPing();
        logger.info(`Real-time stream connected (location ${this.locationId})`);
        this.onOpen?.();
      });

      socket.on('message', (data) => {
        let message;
        try {
          message = JSON.parse(typeof data === 'string' ? data : data.toString());
        } catch {
          logger.warn('Ignoring a non-JSON websocket message');
          return;
        }
        try {
          this.onMessage(message);
        } catch (err) {
          logger.error('Handling a websocket message failed', err);
        }
      });

      socket.on('error', (err) => {
        logger.warn(`Websocket error (location ${this.locationId}): ${err.message}`);
      });

      socket.on('close', (code) => {
        this.clearTimers();
        this.socket = null;
        // GARDENA closes the socket every ~2 hours: an expected, healthy event.
        logger.info(`Real-time stream closed (location ${this.locationId}, code ${code})`);
        this.onClose?.();
        this.scheduleReconnect();
      });
    } catch (err) {
      logger.warn(`Cannot open the real-time stream: ${err.message}`);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) {
      return;
    }
    const delay = Math.min(
      WEBSOCKET_RECONNECT_BASE_DELAY_MS * 2 ** this.attempts,
      WEBSOCKET_RECONNECT_MAX_DELAY_MS,
    );
    this.attempts += 1;
    logger.info(`Reconnecting the real-time stream in ${Math.round(delay / 1000)}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      try {
        this.socket?.ping?.();
      } catch (err) {
        logger.debug(`Ping failed: ${err.message}`);
      }
    }, WEBSOCKET_PING_INTERVAL_MS);
    this.pingTimer.unref?.();
  }

  stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  clearTimers() {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
