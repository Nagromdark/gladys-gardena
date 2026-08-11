// -----------------------------------------------------------------------------
// A realistic `GET /v2/locations/{id}` payload, in the exact JSON:API shape the
// GARDENA smart system API returns: a flat `included` list of services, every
// attribute wrapped in `{ value, timestamp }`, and one service id per outlet.
//
// It covers the five products the integration supports, including the two
// tricky ones: a Smart Irrigation Control (several VALVE services on a single
// device) and a mains-powered device (no battery attribute at all).
// -----------------------------------------------------------------------------

export const LOCATION_ID = '753aecac-4c46-470e-aa96-d92436f11e77';

const timestamp = '2026-05-14T08:19:47.715+0000';

function attribute(value) {
  return { value, timestamp };
}

function common(id, { name, model, serial, battery, rfLevel, rfState = 'ONLINE' }) {
  const attributes = {
    name: attribute(name),
    modelType: attribute(model),
    serial: attribute(serial),
    rfLinkLevel: attribute(rfLevel),
    rfLinkState: attribute(rfState),
  };
  // Mains-powered devices report no battery at all.
  if (battery !== undefined) {
    attributes.batteryLevel = attribute(battery);
    attributes.batteryState = attribute('OK');
  }
  return { id, type: 'COMMON', attributes };
}

export const MOWER_ID = '7859acbd-b23e-dabf-bec6-62c1453fc44c';
export const WATER_CONTROL_ID = 'd6459669-8171-488c-ab8e-bcf3a06a58bf';
export const IRRIGATION_CONTROL_ID = '28c26146-d4c1-42d7-964a-89f5237550ce';
export const SENSOR_ID = 'a134596e-6127-4020-aaa5-b6d2f24d0d03';
export const POWER_SOCKET_ID = '7859acad-b23e-4abf-bec6-62c1453fc34c';

export function buildLocationPayload() {
  return {
    data: {
      id: LOCATION_ID,
      type: 'LOCATION',
      attributes: { name: 'My Garden' },
      relationships: { devices: { data: [] } },
    },
    included: [
      // --- Robotic mower ---
      { id: MOWER_ID, type: 'DEVICE' },
      common(MOWER_ID, {
        name: 'SILENO',
        model: 'GARDENA smart Mower',
        serial: '00003676',
        battery: 87,
        rfLevel: 95,
      }),
      {
        id: MOWER_ID,
        type: 'MOWER',
        attributes: {
          activity: attribute('OK_CUTTING'),
          state: attribute('OK'),
          operatingHours: attribute(412),
          lastErrorCode: attribute('NO_MESSAGE'),
        },
      },
      // --- Water Control: one valve, plus the valve set that groups it ---
      { id: WATER_CONTROL_ID, type: 'DEVICE' },
      common(WATER_CONTROL_ID, {
        name: 'Water Control',
        model: 'GARDENA smart Water Control',
        serial: '00019796',
        battery: 99,
        rfLevel: 70,
      }),
      {
        id: WATER_CONTROL_ID,
        type: 'VALVE',
        attributes: {
          name: attribute('Water Control'),
          activity: attribute('CLOSED'),
          state: attribute('OK'),
        },
      },
      {
        id: `${WATER_CONTROL_ID}:wc`,
        type: 'VALVE_SET',
        attributes: { state: attribute('OK') },
      },
      // --- Smart Irrigation Control: two valves here, six on real hardware ---
      { id: IRRIGATION_CONTROL_ID, type: 'DEVICE' },
      common(IRRIGATION_CONTROL_ID, {
        name: 'Irrigation Control',
        model: 'GARDENA smart Irrigation Control',
        serial: '00042424',
        rfLevel: 80,
      }),
      {
        id: `${IRRIGATION_CONTROL_ID}:vs`,
        type: 'VALVE_SET',
        attributes: { state: attribute('OK') },
      },
      {
        id: `${IRRIGATION_CONTROL_ID}:1`,
        type: 'VALVE',
        attributes: {
          name: attribute('Terrace'),
          activity: attribute('SCHEDULED_WATERING'),
          state: attribute('OK'),
          duration: attribute(1800),
        },
      },
      {
        id: `${IRRIGATION_CONTROL_ID}:2`,
        type: 'VALVE',
        attributes: {
          name: attribute('Vegetable garden'),
          activity: attribute('CLOSED'),
          state: attribute('OK'),
        },
      },
      // --- Smart Sensor ---
      { id: SENSOR_ID, type: 'DEVICE' },
      common(SENSOR_ID, {
        name: 'Sensor',
        model: 'GARDENA smart Sensor',
        serial: '00028462',
        battery: 93,
        rfLevel: 70,
      }),
      {
        id: SENSOR_ID,
        type: 'SENSOR',
        attributes: {
          soilHumidity: attribute(21),
          soilTemperature: attribute(17.4),
          ambientTemperature: attribute(22.4),
          lightIntensity: attribute(1200),
        },
      },
      // --- Power socket, mains-powered and out of radio range ---
      { id: POWER_SOCKET_ID, type: 'DEVICE' },
      common(POWER_SOCKET_ID, {
        name: 'Garden lights',
        model: 'GARDENA smart Power',
        serial: '00011122',
        rfLevel: 0,
        rfState: 'OFFLINE',
      }),
      {
        id: POWER_SOCKET_ID,
        type: 'POWER_SOCKET',
        attributes: {
          activity: attribute('OFF'),
          state: attribute('OK'),
          lastErrorCode: attribute('NO_MESSAGE'),
        },
      },
      // --- A service type the integration does not know: must be ignored ---
      {
        id: 'e6b7a3c2-0000-0000-0000-000000000000',
        type: 'FUTURE_GARDENA_SERVICE',
        attributes: { something: attribute('new') },
      },
    ],
  };
}
