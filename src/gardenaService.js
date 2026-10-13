// -----------------------------------------------------------------------------
// Orchestrator of the integration: everything that has state lives here.
//
// It owns the GARDENA session (client + one real-time stream per location), the
// in-memory picture of the garden, and the translation of that picture into what
// Gladys expects: discovered devices, states, transport badges.
//
// The flow, once configured:
//
//   start() ─▶ authenticate ─▶ list locations ─▶ read each location (REST)
//                                                      │
//                              publishDiscoveredDevices ├─▶ publishStates
//                                                      └─▶ publishTransports
//                                    │
//                                    ▼
//                          one websocket per location
//                                    │
//                     every change pushed by GARDENA ──▶ publishStates (deltas)
//
// REST is only used for the initial picture, the resynchronizations and the
// commands: the GARDENA API is rate-limited and the websocket is the supported
// way to follow a garden in real time.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { GardenaClient } from './gardena/client.js';
import { GardenaRealtime } from './gardena/realtime.js';
import { applyWebsocketMessage, isOnline, parseLocation, servicesOfType } from './gardena/model.js';
import { buildCommands, buildDevice, buildStates, idsOf, valveSetIds } from './devices/index.js';
import { minutesToSeconds } from './devices/helpers.js';
import { CONTROL_TYPES, COMMANDS, SERVICE_TYPES } from './gardena/constants.js';
import { isConfigured } from './config.js';
import {
  WidgetNudger,
  buildWidgetContent,
  runWidgetAction,
  widgetKeysForService,
} from './widgets/index.js';

const logger = createLogger({ name: 'gardena' });

// Grace period before re-reading the API after a command, when no real-time
// stream is available to confirm the new state by itself.
const COMMAND_CONFIRMATION_DELAY_MS = 5000;

// A websocket message about an unknown device means the garden changed: wait a
// bit (several messages arrive in a burst) then resynchronize over REST.
const UNKNOWN_DEVICE_REFRESH_DELAY_MS = 10 * 1000;

// GARDENA answered 429: how long REST refreshes are suspended. The quota is
// counted per week, so a wide pause costs nothing in freshness (the websocket
// keeps pushing) and protects what is left of the budget.
const THROTTLE_PAUSE_MS = 60 * 60 * 1000;

export class GardenaService {
  /**
   * @param {object} gladys - The Gladys SDK instance.
   * @param {object} [options] - Options.
   * @param {Function} [options.createClient] - Client factory (injected in tests).
   * @param {Function} [options.createRealtime] - Real-time stream factory (injected in tests).
   */
  constructor(gladys, { createClient, createRealtime, widgetNudgeWindowMs } = {}) {
    this.gladys = gladys;
    // Dashboards are told to re-pull a card when something really changed.
    this.widgets = new WidgetNudger(gladys, widgetNudgeWindowMs);
    this.createClient = createClient ?? ((options) => new GardenaClient(options));
    this.createRealtime = createRealtime ?? ((options) => new GardenaRealtime(options));
    this.config = null;
    this.client = null;
    this.streams = [];
    this.locations = [];
    /** @type {Map<string, object>} Normalized GARDENA devices, by device id. */
    this.devices = new Map();
    /** @type {Map<string, object>} Command descriptors, by feature external id. */
    this.commandIndex = new Map();
    /** @type {Map<string, number|string>} Last published value, by feature external id. */
    this.lastStates = new Map();
    /** @type {Map<string, string>} Last published transport, by device external id. */
    this.lastTransports = new Map();
    this.lastRefreshAt = 0;
    // Timestamp until which REST refreshes are suspended after a 429.
    this.throttledUntil = 0;
    this.pendingRefresh = null;
    this.unknownDeviceTimer = null;
    this.connectedStreams = 0;
    this.started = false;
  }

  // --- Lifecycle -------------------------------------------------------------

  /**
   * Open the GARDENA session and publish everything we know.
   * @param {object} config - Normalized configuration.
   * @returns {Promise<void>} Resolves once the first picture is published.
   */
  async start(config) {
    this.config = config;
    if (!isConfigured(config)) {
      logger.warn('No application key/secret configured yet: waiting for the configuration');
      await this.reportStatus(false, {
        en: 'Fill in your GARDENA application key and secret to connect.',
        fr: 'Renseignez votre clé et votre secret d’application GARDENA pour vous connecter.',
      });
      return;
    }
    this.client = this.createClient({
      applicationKey: config.application_key,
      applicationSecret: config.application_secret,
    });
    this.started = true;
    try {
      await this.loadLocations();
      await this.refreshLocations({ maxAgeMs: 0 });
      await this.publishDiscoveredDevices();
      await this.publishAllStates();
      await this.publishTransports();
      this.startRealtime();
      await this.reportStatus(true);
      // Nudges sent while the socket was down were dropped: re-sync the
      // dashboards that stayed open.
      this.widgets.nudgeAll();
      logger.info(
        `Connected to GARDENA: ${this.locations.length} location(s), ${this.devices.size} device(s)`,
      );
    } catch (err) {
      logger.error('Connection to the GARDENA API failed', err);
      await this.reportStatus(false, connectionErrorMessage(err));
      throw err;
    }
  }

  /** Close the real-time streams (configuration change, disconnection, exit). */
  stop() {
    this.started = false;
    this.widgets.stop();
    for (const stream of this.streams) {
      stream.stop();
    }
    this.streams = [];
    this.connectedStreams = 0;
    if (this.unknownDeviceTimer) {
      clearTimeout(this.unknownDeviceTimer);
      this.unknownDeviceTimer = null;
    }
  }

  /**
   * Apply a new configuration: restart the session when the credentials or the
   * location changed, otherwise just re-publish what depends on it.
   * @param {object} config - New normalized configuration.
   * @param {boolean} reconnect - Does the session have to be rebuilt?
   * @returns {Promise<void>} Resolves once applied.
   */
  async applyConfig(config, reconnect) {
    this.config = config;
    if (!reconnect) {
      // Durations and modes are read at command time, and the refresh interval
      // at the next poll: nothing published to Gladys depends on them. The
      // widgets do show them, though (the default of a "water for…" form).
      this.widgets.nudgeAll();
      return;
    }
    logger.info('Credentials or location changed: restarting the GARDENA session');
    this.stop();
    this.devices.clear();
    this.commandIndex.clear();
    this.lastStates.clear();
    this.lastTransports.clear();
    this.lastRefreshAt = 0;
    this.throttledUntil = 0;
    await this.start(config);
  }

  // --- Reading the garden ----------------------------------------------------

  /** Read the locations of the account, honouring the optional location filter. */
  async loadLocations() {
    const locations = await this.client.getLocations();
    const filter = this.config.location_id;
    this.locations = filter ? locations.filter((location) => location.id === filter) : locations;
    if (filter && this.locations.length === 0) {
      throw new Error(`Location "${filter}" not found on this GARDENA account`);
    }
    if (this.locations.length === 0) {
      throw new Error('This GARDENA account holds no location');
    }
  }

  /**
   * Re-read every location over REST, unless a recent enough picture is already
   * in memory. Concurrent callers share the same request: a garden with ten
   * devices polling at once still costs one call per location.
   * @param {{maxAgeMs?: number}} [options] - Freshness accepted by the caller.
   * @returns {Promise<void>} Resolves when the picture is up to date.
   */
  async refreshLocations({ maxAgeMs = 60_000 } = {}) {
    if (!this.client) {
      return;
    }
    if (maxAgeMs > 0 && Date.now() - this.lastRefreshAt < maxAgeMs) {
      return;
    }
    // GARDENA already said "too many requests": insisting only digs the hole,
    // and the websocket keeps feeding us in the meantime.
    if (Date.now() < this.throttledUntil) {
      logger.debug('Refresh skipped: the GARDENA API is throttling us');
      return;
    }
    if (this.pendingRefresh) {
      await this.pendingRefresh;
      return;
    }
    this.pendingRefresh = this.doRefreshLocations().finally(() => {
      this.pendingRefresh = null;
    });
    await this.pendingRefresh;
  }

  async doRefreshLocations() {
    const devices = new Map();
    try {
      for (const location of this.locations) {
        const payload = await this.client.getLocation(location.id);
        for (const [id, device] of parseLocation(payload, location.name)) {
          devices.set(id, device);
        }
      }
    } catch (err) {
      if (err.status === 429) {
        this.throttledUntil = Date.now() + THROTTLE_PAUSE_MS;
        logger.warn(
          `GARDENA is throttling the integration: REST refreshes paused for ${
            THROTTLE_PAUSE_MS / 60000
          } minutes (the real-time stream keeps running)`,
        );
      }
      throw err;
    }
    this.devices = devices;
    this.rebuildCommandIndex();
    this.lastRefreshAt = Date.now();
    // The safety net may have caught what the stream missed.
    this.widgets.nudgeAll();
    logger.debug(`Picture refreshed: ${this.devices.size} device(s)`);
  }

  /**
   * The user's refresh interval, in milliseconds.
   *
   * This is THE knob that spends the GARDENA weekly request quota: one full
   * read per interval, whatever the number of devices. It is applied as-is (no
   * safety margin shaving it down), so the number of calls a week is exactly
   * the one the documentation announces for the configured value.
   * @returns {number} Interval in ms.
   */
  refreshIntervalMs() {
    return this.config.poll_frequency * 1000;
  }

  rebuildCommandIndex() {
    this.commandIndex = new Map();
    for (const device of this.devices.values()) {
      for (const command of buildCommands(this.gladys, device)) {
        this.commandIndex.set(command.external_id, { ...command, deviceId: device.id });
      }
    }
  }

  // --- Real-time -------------------------------------------------------------

  /** Open one websocket per location and keep them open. */
  startRealtime() {
    this.stop();
    this.started = true;
    this.streams = this.locations.map((location) =>
      this.createRealtime({
        locationId: location.id,
        getUrl: () => this.client.getWebsocketUrl(location.id),
        onMessage: (message) => this.handleRealtimeMessage(message),
        onOpen: () => {
          this.connectedStreams += 1;
          // A reconnection means we were blind for a while, so resynchronize —
          // but GARDENA hangs up every ~2 hours by design, and a forced read on
          // every reconnection would silently double the weekly quota spending.
          // The normal refresh interval applies here too: the gap is a few
          // seconds, and anything missed lands at the next refresh.
          this.refreshLocations({ maxAgeMs: this.refreshIntervalMs() })
            .then(() => this.publishAllStates())
            .then(() => this.publishTransports())
            .catch((err) => logger.warn(`Resynchronization failed: ${err.message}`));
        },
        onClose: () => {
          this.connectedStreams = Math.max(this.connectedStreams - 1, 0);
        },
      }),
    );
    for (const stream of this.streams) {
      stream.start();
    }
  }

  /**
   * Apply a message pushed by GARDENA and publish what actually changed.
   * @param {object} message - One JSON:API service, with partial attributes.
   */
  handleRealtimeMessage(message) {
    const device = applyWebsocketMessage(this.devices, message);
    if (!device) {
      this.scheduleUnknownDeviceRefresh(message);
      return;
    }
    this.publishDeviceStates(device).catch((err) =>
      logger.warn(`Publishing a real-time state failed: ${err.message}`),
    );
    // Bound tiles follow the published states on their own; the computed parts
    // of a card (activities, contextual buttons) need a re-pull.
    for (const key of widgetKeysForService(message.type, device)) {
      this.widgets.nudge(key);
    }
    this.publishTransports().catch((err) =>
      logger.warn(`Publishing the transports failed: ${err.message}`),
    );
  }

  /**
   * A message about a device we do not know: the garden changed (a device was
   * added or replaced in the GARDENA app). Resynchronize, once, after a delay.
   * @param {object} message - The unknown message.
   */
  scheduleUnknownDeviceRefresh(message) {
    if (!message?.id || this.unknownDeviceTimer || !this.started) {
      return;
    }
    logger.info('Real-time message about an unknown device: resynchronizing');
    this.unknownDeviceTimer = setTimeout(() => {
      this.unknownDeviceTimer = null;
      this.refreshLocations({ maxAgeMs: 0 })
        .then(() => this.publishDiscoveredDevices())
        .then(() => this.publishAllStates())
        .catch((err) => logger.warn(`Resynchronization failed: ${err.message}`));
    }, UNKNOWN_DEVICE_REFRESH_DELAY_MS);
    this.unknownDeviceTimer.unref?.();
  }

  // --- Publishing to Gladys --------------------------------------------------

  /** Publish the complete list of GARDENA devices to the discovery screen. */
  async publishDiscoveredDevices() {
    const devices = [...this.devices.values()].map((device) => buildDevice(this.gladys, device));
    await this.gladys.publishDiscoveredDevices(devices);
  }

  /**
   * Publish a full snapshot, ignoring the "only what changed" cache.
   *
   * Used when a device appears in Gladys: it has no state yet, and its current
   * values may not have changed since the last refresh — without this, the
   * brand new device would stay empty until GARDENA reports something.
   * @returns {Promise<void>} Resolves once published.
   */
  async publishSnapshot() {
    this.lastStates.clear();
    this.lastTransports.clear();
    await this.publishAllStates();
    await this.publishTransports();
  }

  /** Publish every state of every device the user created. */
  async publishAllStates() {
    const states = [];
    for (const device of this.devices.values()) {
      states.push(...buildStates(this.gladys, device));
    }
    await this.publishStates(states);
  }

  /**
   * Publish the states of one device.
   * @param {object} device - Normalized GARDENA device.
   * @returns {Promise<void>} Resolves once published.
   */
  async publishDeviceStates(device) {
    await this.publishStates(buildStates(this.gladys, device));
  }

  /**
   * Publish state entries, keeping only what changed and what belongs to a
   * device the user actually created.
   *
   * The host API accepts 300 states per minute: a full garden snapshot on every
   * websocket message would burn that budget in seconds, and Gladys does not
   * want a history full of identical values either.
   * @param {Array<object>} entries - Entries built by the device modules.
   * @returns {Promise<void>} Resolves once published.
   */
  async publishStates(entries) {
    const created = this.createdFeatureIds();
    const changed = [];
    for (const entry of entries) {
      const id = entry.device_feature_external_id;
      if (created && !created.has(id)) {
        continue;
      }
      const value = entry.text ?? entry.state;
      if (this.lastStates.get(id) === value) {
        continue;
      }
      this.lastStates.set(id, value);
      changed.push(entry);
    }
    if (changed.length === 0) {
      return;
    }
    // The host API caps a batch at 100 states.
    for (let i = 0; i < changed.length; i += 100) {
      await this.gladys.publishStates(changed.slice(i, i + 100));
    }
  }

  /**
   * Publish the per-device transport badge. GARDENA is a cloud-only API, so the
   * badge really answers "does the gateway still see this device?": a mower out
   * of radio range shows as unreachable instead of silently freezing on its last
   * known state.
   * @returns {Promise<void>} Resolves once published.
   */
  async publishTransports() {
    const entries = [];
    for (const device of this.devices.values()) {
      const externalId = idsOf(this.gladys, device).device;
      const online = isOnline(device);
      const transport = online ? DEVICE_TRANSPORTS.CLOUD : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.lastTransports.get(externalId) === transport) {
        continue;
      }
      this.lastTransports.set(externalId, transport);
      entries.push(
        online
          ? { external_id: externalId, transport }
          : {
              external_id: externalId,
              transport,
              degraded: true,
              message: {
                en: 'The GARDENA gateway does not see this device (radio link offline).',
                fr: 'La passerelle GARDENA ne voit plus cet appareil (liaison radio hors ligne).',
              },
            },
      );
    }
    if (entries.length > 0) {
      await this.gladys.publishTransports(entries);
    }
  }

  /**
   * External ids of the features of the devices the user created in Gladys, or
   * null when the list is unknown. Publishing a state for a device nobody
   * created would be refused by the host API.
   * @returns {Set<string>|null} The known feature ids.
   */
  createdFeatureIds() {
    const devices = this.gladys.devices;
    if (!Array.isArray(devices)) {
      return null;
    }
    const ids = new Set();
    for (const device of devices) {
      for (const feature of device.features ?? []) {
        ids.add(feature.external_id);
      }
    }
    return ids;
  }

  // --- Commands --------------------------------------------------------------

  /**
   * Run a command asked by the user on a controllable feature.
   * @param {object} device - The Gladys device.
   * @param {object} feature - The Gladys feature.
   * @param {number} value - The requested value.
   * @returns {Promise<void>} Resolves once GARDENA accepted the command.
   */
  async onSetValue(device, feature, value) {
    let command = this.commandIndex.get(feature.external_id);
    if (!command) {
      // The device may have been added after our last refresh: look again with
      // a fresh picture before giving up.
      await this.refreshLocations({ maxAgeMs: 0 });
      command = this.commandIndex.get(feature.external_id);
    }
    if (!command) {
      throw new Error(`Unknown GARDENA feature: ${feature.external_id}`);
    }
    const { command: name, attributes } = command.resolve(Number(value) === 1, this.config);
    await this.client.sendCommand(command.service_id, command.control_type, name, attributes);
    // GARDENA confirms through the websocket. Without a stream (starting up, or
    // network trouble), read the result back so the UI does not stay stuck on
    // the old value of a `has_feedback` feature.
    if (this.connectedStreams === 0) {
      setTimeout(() => {
        this.refreshLocations({ maxAgeMs: 0 })
          .then(() => this.publishAllStates())
          .catch((err) => logger.warn(`Reading the command result failed: ${err.message}`));
      }, COMMAND_CONFIRMATION_DELAY_MS).unref?.();
    }
  }

  /**
   * Refresh one device on Gladys' demand (`onPoll`). The picture is shared, so
   * polling ten devices costs one API call.
   * @param {object} gladysDevice - The Gladys device being polled.
   * @returns {Promise<void>} Resolves once the states are published.
   */
  async onPoll(gladysDevice) {
    if (!this.client) {
      return;
    }
    await this.refreshLocations({ maxAgeMs: this.refreshIntervalMs() });
    const device = [...this.devices.values()].find(
      (candidate) => idsOf(this.gladys, candidate).device === gladysDevice.external_id,
    );
    if (!device) {
      logger.warn(`Polled device unknown on the GARDENA account: ${gladysDevice.external_id}`);
      return;
    }
    await this.publishDeviceStates(device);
    await this.publishTransports();
  }

  // --- Manifest actions ------------------------------------------------------

  /**
   * Check the credentials and report what the account holds.
   * @returns {Promise<object>} A multi-language message for the UI.
   */
  async testConnection() {
    this.requireConfig();
    const client = this.createClient({
      applicationKey: this.config.application_key,
      applicationSecret: this.config.application_secret,
    });
    const locations = await client.getLocations();
    const names = locations.map((location) => location.name).join(', ');
    return {
      en: `Connection successful: ${locations.length} location(s) found (${names}).`,
      fr: `Connexion réussie : ${locations.length} emplacement(s) trouvé(s) (${names}).`,
    };
  }

  /**
   * Force a full resynchronization and re-publish the discovered devices.
   * @returns {Promise<object>} A multi-language message for the UI.
   */
  async refreshDevices() {
    if (!this.client) {
      throw new Error('The integration is not connected to GARDENA yet');
    }
    await this.loadLocations();
    await this.refreshLocations({ maxAgeMs: 0 });
    await this.publishDiscoveredDevices();
    await this.publishAllStates();
    await this.publishTransports();
    return {
      en: `${this.devices.size} GARDENA device(s) refreshed.`,
      fr: `${this.devices.size} appareil(s) GARDENA rafraîchi(s).`,
    };
  }

  /**
   * Stop every valve of a device at once (the "I need to stop watering NOW"
   * button). GARDENA exposes it as a command on the VALVE_SET service, which is
   * the group of outlets of the device.
   * @param {string} deviceExternalId - External id chosen in the action form.
   * @returns {Promise<object>} A multi-language message for the UI.
   */
  async stopAllWatering(deviceExternalId) {
    this.requireConfig();
    if (!this.client) {
      throw new Error('The integration is not connected to GARDENA yet');
    }
    const device = [...this.devices.values()].find(
      (candidate) => idsOf(this.gladys, candidate).device === deviceExternalId,
    );
    if (!device) {
      throw new Error(`Unknown GARDENA device: ${deviceExternalId}`);
    }
    const stopped = await this.stopValveSets([device]);
    if (stopped === 0) {
      return {
        en: `${device.name} has no valve to stop.`,
        fr: `${device.name} n’a aucune vanne à arrêter.`,
      };
    }
    return {
      en: `Watering stopped on ${device.name}.`,
      fr: `Arrosage arrêté sur ${device.name}.`,
    };
  }

  /**
   * Close every valve of the given devices, until their next scheduled task.
   * @param {Array<object>} devices - Normalized GARDENA devices.
   * @returns {Promise<number>} The number of valve sets stopped.
   */
  async stopValveSets(devices) {
    let stopped = 0;
    for (const device of devices) {
      for (const setId of valveSetIds(device)) {
        await this.client.sendCommand(
          setId,
          CONTROL_TYPES.VALVE_SET,
          COMMANDS.VALVE_SET.STOP_UNTIL_NEXT_TASK,
        );
        stopped += 1;
      }
    }
    return stopped;
  }

  // --- Commands used by the dashboard widgets --------------------------------

  /**
   * Stop the watering everywhere in the account — the panic button.
   *
   * It reads the live picture rather than a device chosen when the card was
   * rendered: what must stop is whatever is open NOW.
   * @returns {Promise<object>} A multi-language message for the user.
   */
  async stopAllWateringEverywhere() {
    this.requireConfig();
    this.requireClient();
    const devices = [...this.devices.values()].filter((device) => valveSetIds(device).length > 0);
    const stopped = await this.stopValveSets(devices);
    if (stopped === 0) {
      return {
        en: 'No GARDENA valve to stop on this account.',
        fr: 'Aucune vanne GARDENA à arrêter sur ce compte.',
      };
    }
    return {
      en: `Watering stopped on ${devices.length} device(s).`,
      fr: `Arrosage arrêté sur ${devices.length} appareil(s).`,
    };
  }

  /**
   * Water through one outlet for a number of minutes.
   * @param {string} serviceId - Id of the VALVE service.
   * @param {number} minutes - Duration in minutes.
   * @returns {Promise<object>} A multi-language message for the user.
   */
  async startValve(serviceId, minutes) {
    this.requireConfig();
    this.requireClient();
    const service = this.findService(SERVICE_TYPES.VALVE, serviceId);
    await this.client.sendCommand(
      service.id,
      CONTROL_TYPES.VALVE,
      COMMANDS.VALVE.START_SECONDS_TO_OVERRIDE,
      { seconds: minutesToSeconds(minutes) },
    );
    const name = service.attributes?.name ?? 'the outlet';
    return {
      en: `Watering ${name} for ${minutes} min.`,
      fr: `Arrosage de ${name} pendant ${minutes} min.`,
    };
  }

  /**
   * Send a mower out for a number of minutes, overriding its schedule.
   * @param {string} serviceId - Id of the MOWER service.
   * @param {number} minutes - Duration in minutes.
   * @returns {Promise<object>} A multi-language message for the user.
   */
  async mowFor(serviceId, minutes) {
    this.requireConfig();
    this.requireClient();
    const service = this.findService(SERVICE_TYPES.MOWER, serviceId);
    await this.client.sendCommand(
      service.id,
      CONTROL_TYPES.MOWER,
      COMMANDS.MOWER.START_SECONDS_TO_OVERRIDE,
      { seconds: minutesToSeconds(minutes) },
    );
    return {
      en: `Mowing for ${minutes} min.`,
      fr: `Tonte pendant ${minutes} min.`,
    };
  }

  /**
   * Park a mower and cancel its schedule until someone starts it again.
   * @param {string} serviceId - Id of the MOWER service.
   * @returns {Promise<object>} A multi-language message for the user.
   */
  async parkMower(serviceId) {
    this.requireConfig();
    this.requireClient();
    const service = this.findService(SERVICE_TYPES.MOWER, serviceId);
    await this.client.sendCommand(
      service.id,
      CONTROL_TYPES.MOWER,
      COMMANDS.MOWER.PARK_UNTIL_FURTHER_NOTICE,
    );
    return {
      en: 'Mower parked until further notice.',
      fr: 'Tondeuse garée jusqu’à nouvel ordre.',
    };
  }

  /**
   * Find a service of a given type in the live picture.
   *
   * The widget echoes back an id IT declared, but the garden may have changed
   * since: acting on an id nobody recognizes would be worse than refusing.
   * @param {string} type - Service type.
   * @param {string} serviceId - Service id.
   * @returns {object} The service.
   */
  findService(type, serviceId) {
    for (const device of this.devices.values()) {
      const found = servicesOfType(device, type).find((service) => service.id === serviceId);
      if (found) {
        return found;
      }
    }
    throw new Error(`Unknown GARDENA ${type.toLowerCase()}: ${serviceId}`);
  }

  // --- Dashboard widgets -----------------------------------------------------

  /**
   * Everything a widget module needs, read from memory: building a card costs
   * no GARDENA request, whatever the weekly quota left.
   * @param {object} [options] - `{ settings, language, units }` from the core.
   * @returns {object} The widget context.
   */
  widgetContext({ settings, language, units } = {}) {
    return {
      devices: [...this.devices.values()],
      config: this.config ?? {},
      settings: settings ?? {},
      language,
      units,
      created: this.createdFeatureIds(),
      ids: (device) => idsOf(this.gladys, device),
      configured: Boolean(this.config) && isConfigured(this.config),
    };
  }

  /**
   * Build the content of a dashboard widget.
   * @param {string} key - Widget key.
   * @param {object} [options] - `{ settings, language, units }` from the core.
   * @returns {object} A widget content.
   */
  getWidgetContent(key, options) {
    return buildWidgetContent(key, this.widgetContext(options));
  }

  /**
   * Run a widget action (a tap on one of the card buttons).
   * @param {string} key - Widget key.
   * @param {string} actionKey - Action key declared in the content.
   * @param {object} params - Params echoed back by the core.
   * @param {object} [options] - `{ values }` from the typed form.
   * @returns {Promise<object>} A multi-language message for the user.
   */
  async runWidgetAction(key, actionKey, params, { values } = {}) {
    logger.info(`onWidgetAction <- ${key}.${actionKey}`);
    return runWidgetAction(key, actionKey, params, { values, api: this });
  }

  /**
   * Guard the actions that need a configuration: they are buttons, and a button
   * clicked one second after the container started must say why nothing
   * happened rather than throw a TypeError.
   */
  requireClient() {
    if (!this.client) {
      throw new Error('The integration is not connected to GARDENA yet');
    }
  }

  requireConfig() {
    if (!this.config || !isConfigured(this.config)) {
      throw new Error('Fill in the GARDENA application key and secret first');
    }
  }

  /** Report the application-level status shown in the Configuration screen. */
  async reportStatus(connected, message) {
    await this.gladys.setConnectionStatus(connected, message).catch(() => {});
  }
}

/** Turn an API failure into a message the user can act on. */
function connectionErrorMessage(err) {
  if (err.status === 401 || err.status === 403) {
    return {
      en: 'GARDENA refused the credentials: check the application key/secret and that the GARDENA smart system API is connected to your application.',
      fr: 'GARDENA a refusé les identifiants : vérifiez la clé/le secret et que l’API GARDENA smart system est bien connectée à votre application.',
    };
  }
  if (err.status === 429) {
    return {
      en: 'GARDENA is rate-limiting the integration, it will retry later.',
      fr: 'GARDENA limite le débit de l’intégration, une nouvelle tentative aura lieu plus tard.',
    };
  }
  return {
    en: `Connection to GARDENA failed: ${err.message}`,
    fr: `La connexion à GARDENA a échoué : ${err.message}`,
  };
}
