// -----------------------------------------------------------------------------
// Widget: WATERING — valves, the outdoor socket and the soil sensors.
//
// The question this card answers, in one glance: is water running right now,
// and is the soil dry? Plus the one button that matters when the answer to the
// first question is "yes, and it should not be".
//
// It reads ONLY the in-memory picture the websocket keeps live: showing this
// card costs zero GARDENA request, whatever the weekly quota left. Tapping an
// action button costs one, like any command.
// -----------------------------------------------------------------------------

import { SERVICE_TYPES } from '../gardena/constants.js';
import { isOnline, servicesOfType } from '../gardena/model.js';
import { MEASUREMENTS } from '../devices/sensor.js';
import { featureId } from '../devices/helpers.js';
import { isWatering } from '../devices/valve.js';
import { isPowered } from '../devices/powerSocket.js';
import {
  WIDGET_BUDGET,
  actionButton,
  chart,
  clip,
  emptyState,
  featureButton,
  status,
  statusRow,
  text,
  tile,
  withinBudget,
} from './components.js';
import {
  isPump,
  powerSocketActivityLabel,
  pumpActivityLabel,
  valveActivityLabel,
} from './labels.js';

export const WATERING_WIDGET = 'watering';

export const WATERING_ACTIONS = {
  STOP_WATERING: 'stop_watering',
  START_WATERING: 'start_watering',
};

// Soil humidity first: it is what tells a gardener whether to water at all.
// The French name and the icon are presentation, so they live here rather than
// in the device layer; everything else comes from the shared descriptors.
const TILE_PRIORITY = [
  { attribute: 'soilHumidity', fr: 'Humidité du sol', icon: 'droplet' },
  { attribute: 'soilTemperature', fr: 'Température du sol', icon: 'thermometer' },
  { attribute: 'ambientTemperature', fr: 'Température ambiante', icon: 'thermometer' },
  { attribute: 'lightIntensity', fr: 'Luminosité', icon: 'sun' },
];
// Tiles are the flexible part of the card: everything else earns its slot
// (the emergency button, what is running, the curve, the forms, the offline
// warning). So they take whatever room is left rather than a fixed share — a
// blanket cap would drop a sensor on a small garden that had plenty of space.
const MAX_TILES = 3;
const MAX_STATUS_ROWS = 10;
// Room left for the sensor name in the chart title, whose bound is 40: the
// longest prefix is the French one, "Humidité du sol · ".
const SENSOR_NAME_IN_TITLE = 20;

/** Devices carrying at least one valve or power socket. */
function wateringDevices(devices) {
  return devices.filter(
    (device) =>
      servicesOfType(device, SERVICE_TYPES.VALVE).length > 0 ||
      servicesOfType(device, SERVICE_TYPES.POWER_SOCKET).length > 0,
  );
}

/** Sensors, optionally narrowed to the one pinned in the widget settings. */
function sensorDevices(devices, ids, pinned) {
  const sensors = devices.filter(
    (device) => servicesOfType(device, SERVICE_TYPES.SENSOR).length > 0,
  );
  if (!pinned) {
    return sensors;
  }
  const chosen = sensors.filter((device) => ids(device).device === pinned);
  return chosen.length > 0 ? chosen : sensors;
}

/**
 * One status row per watering outlet, open ones first so the 10-row cap never
 * hides the valve that is actually running.
 */
function buildStatusRows({ devices }) {
  const rows = [];
  for (const device of devices) {
    const offline = !isOnline(device);
    // A pressure pump is a VALVE service too: same values, different words.
    const label = isPump(device) ? pumpActivityLabel : valveActivityLabel;
    for (const service of servicesOfType(device, SERVICE_TYPES.VALVE)) {
      const { name, activity } = service.attributes;
      rows.push({
        open: isWatering(activity) === true,
        offline,
        row: statusRow({
          label: { en: clip(name ?? device.name, 40), fr: clip(name ?? device.name, 40) },
          value: label(activity) ?? { en: 'Unknown', fr: 'Inconnu' },
          icon: isPump(device) ? 'zap' : 'droplet',
          color: isWatering(activity) ? 'success' : offline ? 'warning' : 'neutral',
        }),
      });
    }
    for (const service of servicesOfType(device, SERVICE_TYPES.POWER_SOCKET)) {
      const { activity } = service.attributes;
      rows.push({
        open: isPowered(activity) === true,
        offline,
        row: statusRow({
          label: { en: clip(device.name, 40), fr: clip(device.name, 40) },
          value: powerSocketActivityLabel(activity) ?? { en: 'Unknown', fr: 'Inconnu' },
          icon: 'power',
          color: isPowered(activity) ? 'success' : offline ? 'warning' : 'neutral',
        }),
      });
    }
  }
  rows.sort((a, b) => Number(b.open) - Number(a.open));
  if (rows.length <= MAX_STATUS_ROWS) {
    return rows.map((entry) => entry.row);
  }
  // Say how many were left out rather than letting the core cut blind.
  const kept = rows.slice(0, MAX_STATUS_ROWS - 1).map((entry) => entry.row);
  const hidden = rows.length - kept.length;
  kept.push(
    statusRow({
      label: { en: 'Other outlets', fr: 'Autres sorties' },
      value: `+${hidden}`,
    }),
  );
  return kept;
}

/** Sensor tiles, bound to the published features whenever Gladys knows them. */
function buildTiles({ sensors, ids, created, maxTiles }) {
  const tiles = [];
  for (const measurement of TILE_PRIORITY) {
    const descriptor = MEASUREMENTS.find((entry) => entry.attribute === measurement.attribute);
    for (const device of sensors) {
      if (tiles.length >= maxTiles) {
        return tiles;
      }
      const [service] = servicesOfType(device, SERVICE_TYPES.SENSOR);
      const value = service?.attributes?.[measurement.attribute];
      if (!descriptor || value === undefined) {
        continue;
      }
      const externalId = featureId(ids(device), service, descriptor.key);
      // With several sensors the device name is what tells the tiles apart;
      // with one, the measurement name is more useful.
      const label =
        sensors.length > 1
          ? { en: clip(device.name, 24), fr: clip(device.name, 24) }
          : { en: descriptor.name, fr: measurement.fr };
      tiles.push(
        tile({
          label,
          deviceFeature: created && created.has(externalId) ? externalId : undefined,
          value: Math.round(Number(value) * 10) / 10,
          unit: descriptor.unit,
          icon: measurement.icon,
        }),
      );
    }
  }
  return tiles;
}

/**
 * The soil-humidity curves: one per sensor, with the sensor each one reads.
 *
 * Gladys names the series of a device-bound chart after the FEATURE, and
 * never falls back to the device (`WidgetComponents.jsx`) the way the regular
 * chart box does: several soil sensors come back as several curves all
 * labelled "Soil humidity". Drawing them anyway is a deliberate trade — the
 * shapes compared side by side say more than one named curve, and the title
 * names the sensor whenever there is only one to name.
 *
 * Only created features: a chart bound to a feature Gladys does not know
 * would draw an empty frame.
 */
function soilHumidityCurves({ sensors, ids, created }) {
  const descriptor = MEASUREMENTS.find((entry) => entry.attribute === 'soilHumidity');
  if (!descriptor || !created) {
    return [];
  }
  const curves = [];
  for (const device of sensors) {
    const [service] = servicesOfType(device, SERVICE_TYPES.SENSOR);
    if (service?.attributes?.soilHumidity === undefined) {
      continue;
    }
    const externalId = featureId(ids(device), service, descriptor.key);
    if (created.has(externalId)) {
      curves.push({ externalId, sensorName: device.name });
    }
  }
  // `chart()` caps the series at the four the core keeps.
  return curves;
}

/** The outlets the "water for N minutes" form can choose from. */
export function wateringOptions(devices) {
  const options = [];
  for (const device of devices) {
    for (const service of servicesOfType(device, SERVICE_TYPES.VALVE)) {
      const name = service.attributes?.name ?? device.name;
      options.push({
        value: service.id,
        label: { en: clip(name, 40), fr: clip(name, 40) },
      });
    }
  }
  return options;
}

export const wateringWidget = {
  key: WATERING_WIDGET,

  /**
   * Build the card content from the live picture.
   * @param {object} context - Widget context built by the service.
   * @returns {object} A widget content.
   */
  buildContent(context) {
    const { devices, config, settings, created, ids, configured } = context;

    if (!configured) {
      return emptyState({
        en: 'Fill in your GARDENA application key and secret in the integration settings.',
        fr: "Renseignez votre clé et votre secret d'application GARDENA dans la configuration.",
      });
    }
    if (devices.length === 0) {
      return { ttl_seconds: 60, components: [] };
    }

    const watering = wateringDevices(devices);
    const sensors = sensorDevices(devices, ids, settings?.sensor);
    if (watering.length === 0 && sensors.length === 0) {
      return emptyState({
        en: 'No GARDENA valve, socket or sensor on this account.',
        fr: 'Aucune vanne, prise ou capteur GARDENA sur ce compte.',
      });
    }

    // Everything that is not a tile, built first: the tiles then take the slots
    // that are actually left. `head` comes before them in content order and
    // `tail` after, which is what decides who survives a budget overflow.
    const head = [];
    const tail = [];

    // The emergency button first: if anything ever overflows the budget, the
    // one that stops a flood is the one that must survive.
    if (watering.some((device) => servicesOfType(device, SERVICE_TYPES.VALVE).length > 0)) {
      head.push(
        actionButton({
          label: { en: 'Stop watering', fr: "Arrêter l'arrosage" },
          actionKey: WATERING_ACTIONS.STOP_WATERING,
          style: 'danger',
          icon: 'x-octagon',
        }),
      );
    }

    const rows = buildStatusRows({ devices: watering });
    if (rows.length > 0) {
      head.push(status(rows));
    }

    // The focal slot: how the soil dried over the week. Bound to published
    // features, so the core draws from the history it already keeps — nothing
    // to compute, nothing to store, and more than the picture holds in memory.
    const curves = soilHumidityCurves({ sensors, ids, created });
    if (curves.length > 0) {
      // A single curve gets its sensor named in the title, since the legend
      // only ever says "Soil humidity"; several curves share that legend, so
      // naming one of them in the title would point at the wrong one.
      const only = curves.length === 1 ? clip(curves[0].sensorName, SENSOR_NAME_IN_TITLE) : null;
      tail.push(
        chart({
          title: only
            ? { en: `Soil humidity · ${only}`, fr: `Humidité du sol · ${only}` }
            : { en: 'Soil humidity', fr: 'Humidité du sol' },
          deviceFeatures: curves.map((curve) => curve.externalId),
          interval: 'last-week',
          chartType: 'area',
          unit: 'percent',
        }),
      );
    }

    const options = wateringOptions(watering);
    if (options.length > 0) {
      tail.push(
        actionButton({
          label: { en: 'Water for…', fr: 'Arroser…' },
          actionKey: WATERING_ACTIONS.START_WATERING,
          style: 'primary',
          icon: 'droplet',
          fields: [
            {
              key: 'valve',
              type: 'select',
              label: { en: 'Outlet', fr: 'Sortie' },
              required: true,
              options,
            },
            {
              key: 'minutes',
              type: 'number',
              label: { en: 'Minutes', fr: 'Minutes' },
              required: true,
              default: config.default_duration,
              min: 1,
              max: 1440,
            },
          ],
        }),
      );
    }

    // The socket button mirrors the current state: the content is rebuilt on
    // every change, so a single contextual button never goes stale.
    const socketDevice = watering.find(
      (device) => servicesOfType(device, SERVICE_TYPES.POWER_SOCKET).length > 0,
    );
    if (socketDevice) {
      const [service] = servicesOfType(socketDevice, SERVICE_TYPES.POWER_SOCKET);
      const externalId = featureId(ids(socketDevice), service, 'on-off');
      if (created && created.has(externalId)) {
        const powered = isPowered(service.attributes?.activity) === true;
        tail.push(
          featureButton({
            label: powered
              ? { en: 'Switch the socket off', fr: 'Éteindre la prise' }
              : { en: 'Switch the socket on', fr: 'Allumer la prise' },
            deviceFeature: externalId,
            value: powered ? 0 : 1,
            style: powered ? 'secondary' : 'primary',
            icon: 'power',
          }),
        );
      }
    }

    const offline = devices.filter((device) => !isOnline(device));
    if (offline.length > 0) {
      tail.push(
        text(
          {
            en: `${offline.length} device(s) offline: the GARDENA gateway does not see them.`,
            fr: `${offline.length} appareil(s) hors ligne : la passerelle GARDENA ne les voit plus.`,
          },
          'caption',
        ),
      );
    }

    const room = WIDGET_BUDGET.components - head.length - tail.length;
    const tiles = buildTiles({
      sensors,
      ids,
      created,
      maxTiles: Math.min(MAX_TILES, Math.max(room, 0)),
    });

    return { ttl_seconds: 60, components: withinBudget([...head, ...tiles, ...tail]) };
  },
};
