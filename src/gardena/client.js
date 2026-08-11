// -----------------------------------------------------------------------------
// HTTP client of the GARDENA smart system API.
//
// Responsibilities:
//   - OAuth2 `client_credentials` authentication (Application key / secret
//     created on the Husqvarna developer portal) and token renewal;
//   - the three REST calls the integration needs: list the locations, read a
//     location with all its devices, ask for a real-time websocket URL;
//   - sending a command to a service (PUT /command/{serviceId}).
//
// Two behaviours matter more than the endpoints themselves:
//   - the API is heavily rate-limited, so every request goes through a serial
//     queue that spaces the calls out (MIN_REST_INTERVAL_MS);
//   - a 401 means the token died before its announced expiry: we re-authenticate
//     once and replay the request, instead of surfacing a transient failure.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  AUTHENTICATION_HOST,
  AUTH_API_VERSION,
  JSON_API_CONTENT_TYPE,
  MIN_REST_INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
  SMART_API_VERSION,
  SMART_HOST,
  TOKEN_EXPIRY_MARGIN_MS,
} from './constants.js';

const logger = createLogger({ name: 'gardena-client' });

/** Error carrying the HTTP status, so callers can react to 401/403/429. */
export class GardenaApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GardenaApiError';
    this.status = status;
  }
}

export class GardenaClient {
  /**
   * @param {object} options - Client options.
   * @param {string} options.applicationKey - Application key (also sent as X-Api-Key).
   * @param {string} options.applicationSecret - Application secret.
   * @param {Function} [options.fetchImpl] - `fetch` implementation (injected in tests).
   * @param {Function} [options.now] - Clock, in ms (injected in tests).
   * @param {number} [options.minIntervalMs] - Minimum delay between two calls.
   */
  constructor({
    applicationKey,
    applicationSecret,
    fetchImpl = fetch,
    now = Date.now,
    minIntervalMs = MIN_REST_INTERVAL_MS,
  } = {}) {
    this.applicationKey = applicationKey;
    this.applicationSecret = applicationSecret;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.minIntervalMs = minIntervalMs;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    // In-flight authentication, shared: several requests starting at the same
    // time must not each burn a token request on a rate-limited API.
    this.pendingToken = null;
    // Serial queue: the API rejects bursts, so requests are spaced out.
    this.queue = Promise.resolve();
    this.lastRequestAt = 0;
  }

  /** True when credentials are filled in — nothing can be attempted otherwise. */
  hasCredentials() {
    return Boolean(this.applicationKey && this.applicationSecret);
  }

  /**
   * Get a valid access token, authenticating (or re-authenticating) if needed.
   * @param {boolean} [force] - Ignore the cached token and authenticate again.
   * @returns {Promise<string>} A valid access token.
   */
  async getAccessToken(force = false) {
    if (!this.hasCredentials()) {
      throw new GardenaApiError('Missing application key or application secret', 401);
    }
    if (!force && this.accessToken && this.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }
    if (this.pendingToken) {
      return this.pendingToken;
    }
    this.pendingToken = this.authenticate().finally(() => {
      this.pendingToken = null;
    });
    return this.pendingToken;
  }

  /** Actually run the OAuth2 `client_credentials` exchange. */
  async authenticate() {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.applicationKey,
      client_secret: this.applicationSecret,
    });
    const url = `${AUTHENTICATION_HOST}/${AUTH_API_VERSION}/oauth2/token`;
    logger.debug('Requesting a new access token');
    const response = await this.rawRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new GardenaApiError(
        `Authentication failed: ${describeError(payload, response.status)}`,
        response.status,
      );
    }
    this.accessToken = payload.access_token;
    // `expires_in` is in seconds; renew a few minutes before the real expiry.
    const expiresInMs = Number(payload.expires_in ?? 0) * 1000;
    this.tokenExpiresAt = this.now() + Math.max(expiresInMs - TOKEN_EXPIRY_MARGIN_MS, 0);
    logger.info(
      `Authenticated on the GARDENA API (token valid ${Math.round(expiresInMs / 1000)}s)`,
    );
    return this.accessToken;
  }

  /** Forget the current token (used when the credentials change). */
  reset() {
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.pendingToken = null;
  }

  /**
   * List the locations (gardens) of the account.
   * @returns {Promise<Array<{id: string, name: string}>>} The locations.
   */
  async getLocations() {
    const payload = await this.request(`/${SMART_API_VERSION}/locations`);
    return (payload.data ?? []).map((location) => ({
      id: location.id,
      name: location.attributes?.name ?? location.id,
    }));
  }

  /**
   * Read one location with every device and service it contains.
   * @param {string} locationId - Location id.
   * @returns {Promise<object>} The raw JSON:API payload (`data` + `included`).
   */
  async getLocation(locationId) {
    return this.request(`/${SMART_API_VERSION}/locations/${encodeURIComponent(locationId)}`);
  }

  /**
   * Ask for a real-time websocket URL for a location. The URL is single use and
   * short-lived: request a new one for every (re)connection.
   * @param {string} locationId - Location id.
   * @returns {Promise<string>} The websocket URL.
   */
  async getWebsocketUrl(locationId) {
    const payload = await this.request(`/${SMART_API_VERSION}/websocket`, {
      method: 'POST',
      body: {
        data: {
          type: 'WEBSOCKET',
          // The id is mandatory but never interpreted by the API.
          id: `gladys-${locationId}`,
          attributes: { locationId },
        },
      },
    });
    const url = payload?.data?.attributes?.url;
    if (!url) {
      throw new GardenaApiError('The GARDENA API returned no websocket URL', 502);
    }
    return url;
  }

  /**
   * Send a command to a service (a valve, a mower, a power socket...).
   * @param {string} serviceId - Id of the TARGET SERVICE, not of the device.
   * @param {string} controlType - Resource type, e.g. `VALVE_CONTROL`.
   * @param {string} command - Command name, e.g. `START_SECONDS_TO_OVERRIDE`.
   * @param {object} [attributes] - Extra command attributes, e.g. `{ seconds }`.
   * @returns {Promise<void>} Resolves once the API accepted the command (202).
   */
  async sendCommand(serviceId, controlType, command, attributes = {}) {
    logger.info(`Command ${command} -> ${controlType} ${serviceId}`);
    await this.request(`/${SMART_API_VERSION}/command/${encodeURIComponent(serviceId)}`, {
      method: 'PUT',
      body: {
        data: {
          id: `gladys-${command}`,
          type: controlType,
          attributes: { command, ...attributes },
        },
      },
    });
  }

  /**
   * Authenticated request against the smart system host, with one automatic
   * retry after a re-authentication when the token is refused.
   * @param {string} path - Path starting with a slash.
   * @param {{method?: string, body?: object}} [options] - Request options.
   * @returns {Promise<object>} The parsed JSON body (`{}` for an empty answer).
   */
  async request(path, { method = 'GET', body } = {}) {
    let response = await this.authenticatedRequest(path, { method, body });
    if (response.status === 401) {
      logger.warn('Access token refused, re-authenticating');
      await this.getAccessToken(true);
      response = await this.authenticatedRequest(path, { method, body });
    }
    const payload = await readJson(response);
    if (!response.ok) {
      throw new GardenaApiError(
        `${method} ${path} failed: ${describeError(payload, response.status)}`,
        response.status,
      );
    }
    return payload;
  }

  /** One authenticated attempt (no retry), token fetched or reused as needed. */
  async authenticatedRequest(path, { method, body }) {
    const token = await this.getAccessToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      'Authorization-Provider': 'husqvarna',
      'X-Api-Key': this.applicationKey,
    };
    if (body !== undefined) {
      headers['Content-Type'] = JSON_API_CONTENT_TYPE;
    }
    return this.rawRequest(`${SMART_HOST}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /**
   * Perform a single HTTP call through the serial, rate-limited queue.
   * @param {string} url - Absolute URL.
   * @param {object} init - `fetch` init object.
   * @returns {Promise<Response>} The raw response.
   */
  rawRequest(url, init) {
    // Chain on the queue: the calls never overlap and are spaced out, whatever
    // the number of devices polling at the same time.
    const run = this.queue.then(async () => {
      const wait = this.lastRequestAt + this.minIntervalMs - this.now();
      if (wait > 0) {
        await sleep(wait);
      }
      this.lastRequestAt = this.now();
      logger.debug(`${init.method ?? 'GET'} ${url}`);
      return this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    });
    // Keep the queue alive even when a request rejects.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

/** Parse a JSON body, tolerating an empty or non-JSON answer (202, 5xx page). */
async function readJson(response) {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/** Build a readable message out of a JSON:API error payload. */
function describeError(payload, status) {
  const error = payload?.errors?.[0];
  if (error) {
    return [error.title, error.detail].filter(Boolean).join(' - ') || `HTTP ${status}`;
  }
  if (payload?.message) {
    return payload.message;
  }
  if (payload?.error_description) {
    return payload.error_description;
  }
  return `HTTP ${status}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
