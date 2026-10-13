// -----------------------------------------------------------------------------
// Widget: MOWER — the robotic mowers.
//
// What a gardener checks: is it out, is it charged, and can I send it out or
// bring it home right now. Everything comes from the in-memory picture, so
// showing the card costs no GARDENA request.
//
// The start/park button goes through `device_feature` + `value`, i.e. the very
// `onSetValue` path the device card uses: it inherits the `mower_start_mode`
// and `mower_stop_mode` settings instead of duplicating that decision here.
// -----------------------------------------------------------------------------

import { SERVICE_TYPES } from '../gardena/constants.js';
import { isOnline, servicesOfType } from '../gardena/model.js';
import { featureId } from '../devices/helpers.js';
import { isMowing } from '../devices/mower.js';
import {
  actionButton,
  clip,
  emptyState,
  featureButton,
  gauge,
  status,
  statusRow,
  text,
  tile,
  withinBudget,
} from './components.js';
import { mowerActivityLabel, stateLabel } from './labels.js';

export const MOWER_WIDGET = 'mower';

export const MOWER_ACTIONS = {
  MOW_FOR: 'mow_for',
  PARK: 'park',
};

// GARDENA reports this when nothing is wrong.
const NO_ERROR = 'NO_MESSAGE';

/** Devices carrying a MOWER service. */
export function mowerDevices(devices) {
  return devices.filter((device) => servicesOfType(device, SERVICE_TYPES.MOWER).length > 0);
}

function stateColor(state) {
  if (state === 'OK') {
    return 'success';
  }
  if (state === 'WARNING') {
    return 'warning';
  }
  return state === undefined ? 'neutral' : 'danger';
}

export const mowerWidget = {
  key: MOWER_WIDGET,

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

    const mowers = mowerDevices(devices);
    if (mowers.length === 0) {
      return emptyState({
        en: 'No GARDENA mower on this account.',
        fr: 'Aucune tondeuse GARDENA sur ce compte.',
      });
    }

    // A card carrying action buttons must never guess which mower it acts on.
    const pinned = settings?.mower
      ? mowers.find((device) => ids(device).device === settings.mower)
      : undefined;
    if (settings?.mower && !pinned) {
      return emptyState({
        en: 'The device chosen in this widget settings is not a GARDENA mower any more.',
        fr: "L'appareil choisi dans les réglages de ce widget n'est plus une tondeuse GARDENA.",
      });
    }
    const mower = pinned ?? (mowers.length === 1 ? mowers[0] : undefined);

    if (!mower) {
      // Several mowers and none chosen: show them all, control none.
      return {
        ttl_seconds: 60,
        components: withinBudget([
          status(
            mowers.map((device) => {
              const [service] = servicesOfType(device, SERVICE_TYPES.MOWER);
              return statusRow({
                label: { en: clip(device.name, 40), fr: clip(device.name, 40) },
                value: mowerActivityLabel(service.attributes?.activity) ?? {
                  en: 'Unknown',
                  fr: 'Inconnu',
                },
                icon: 'activity',
                color: isMowing(service.attributes?.activity) ? 'success' : 'neutral',
              });
            }),
          ),
          text(
            {
              en: 'Pick a mower in this widget settings to control it.',
              fr: 'Choisissez une tondeuse dans les réglages du widget pour la piloter.',
            },
            'caption',
          ),
        ]),
      };
    }

    const [service] = servicesOfType(mower, SERVICE_TYPES.MOWER);
    const attributes = service.attributes ?? {};
    const deviceIds = ids(mower);
    const mowing = isMowing(attributes.activity) === true;
    const components = [];

    const rows = [
      statusRow({
        label: { en: 'Activity', fr: 'Activité' },
        value: mowerActivityLabel(attributes.activity) ?? { en: 'Unknown', fr: 'Inconnu' },
        icon: 'activity',
        color: mowing ? 'success' : 'neutral',
      }),
      statusRow({
        label: { en: 'State', fr: 'État' },
        value: stateLabel(attributes.state) ?? { en: 'Unknown', fr: 'Inconnu' },
        icon: 'check-circle',
        color: stateColor(attributes.state),
      }),
    ];
    if (attributes.lastErrorCode && attributes.lastErrorCode !== NO_ERROR) {
      rows.push(
        statusRow({
          label: { en: 'Last error', fr: 'Dernière erreur' },
          value: attributes.lastErrorCode,
          icon: 'alert-triangle',
          color: 'danger',
        }),
      );
    }
    if (!isOnline(mower)) {
      rows.push(
        statusRow({
          label: { en: 'Radio link', fr: 'Liaison radio' },
          value: { en: 'Offline', fr: 'Hors ligne' },
          icon: 'wifi-off',
          color: 'warning',
        }),
      );
    }
    components.push(status(rows));

    const batteryLevel = mower.common?.batteryLevel;
    if (batteryLevel !== undefined) {
      const batteryId = deviceIds.feature('common-battery');
      components.push(
        gauge({
          label: { en: 'Battery', fr: 'Batterie' },
          deviceFeature: created && created.has(batteryId) ? batteryId : undefined,
          value: Number(batteryLevel),
          min: 0,
          max: 100,
          unit: 'percent',
          color: batteryLevel < 20 ? 'danger' : batteryLevel < 40 ? 'warning' : 'success',
        }),
      );
    }

    if (attributes.operatingHours !== undefined) {
      const hoursId = featureId(deviceIds, service, 'operating-hours');
      components.push(
        tile({
          label: { en: 'Operating hours', fr: 'Heures de tonte' },
          deviceFeature: created && created.has(hoursId) ? hoursId : undefined,
          value: Number(attributes.operatingHours),
          unit: 'hours',
          icon: 'clock',
        }),
      );
    }

    // Contextual start/stop, through the device command path.
    const onOffId = featureId(deviceIds, service, 'on-off');
    if (created && created.has(onOffId)) {
      components.push(
        featureButton({
          label: mowing ? { en: 'Park', fr: 'Rentrer' } : { en: 'Mow now', fr: 'Tondre' },
          deviceFeature: onOffId,
          value: mowing ? 0 : 1,
          style: mowing ? 'secondary' : 'primary',
          icon: mowing ? 'home' : 'play',
        }),
      );
    }

    components.push(
      actionButton({
        label: { en: 'Mow for…', fr: 'Tondre…' },
        actionKey: MOWER_ACTIONS.MOW_FOR,
        params: { mower: service.id },
        style: 'primary',
        icon: 'clock',
        fields: [
          {
            key: 'minutes',
            type: 'number',
            label: { en: 'Minutes', fr: 'Minutes' },
            required: true,
            default: config.mower_duration,
            min: 15,
            max: 1440,
          },
        ],
      }),
    );

    // PARK_UNTIL_FURTHER_NOTICE cancels the schedule until a human restarts
    // the mower: sticky enough to deserve a confirmation.
    components.push(
      actionButton({
        label: { en: 'Park, no schedule', fr: 'Garer, sans calendrier' },
        actionKey: MOWER_ACTIONS.PARK,
        params: { mower: service.id },
        style: 'secondary',
        icon: 'pause',
        confirm: true,
      }),
    );

    return { ttl_seconds: 60, components: withinBudget(components) };
  },
};
