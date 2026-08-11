// -----------------------------------------------------------------------------
// Service type: SENSOR — the GARDENA smart Sensor and smart Soil Sensor.
//
// Read-only measurements. The two products share the service type but not the
// attributes: the soil-only sensor reports soil humidity and soil temperature,
// the full sensor adds ambient temperature and light intensity. Features are
// therefore created from the attributes actually present — a permanent property
// of the model, not a value that comes and goes.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { SERVICE_TYPES } from '../gardena/constants.js';
import { featureId, numberState } from './helpers.js';

// One descriptor per measurement: the GARDENA attribute it reads, and the
// Gladys feature it produces.
const MEASUREMENTS = [
  {
    attribute: 'soilHumidity',
    key: 'soil-humidity',
    name: 'Soil humidity',
    category: DEVICE_FEATURE_CATEGORIES.SOIL_MOISTURE_SENSOR,
    // Gladys only renders `soil-moisture-sensor` as a DECIMAL: published as an
    // integer, the feature shows up as a blank chip with no icon and no label.
    type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.PERCENT,
    min: 0,
    max: 100,
  },
  {
    attribute: 'soilTemperature',
    key: 'soil-temperature',
    name: 'Soil temperature',
    category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.CELSIUS,
    min: -50,
    max: 100,
  },
  {
    attribute: 'ambientTemperature',
    key: 'ambient-temperature',
    name: 'Ambient temperature',
    category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.CELSIUS,
    min: -50,
    max: 100,
  },
  {
    attribute: 'lightIntensity',
    key: 'light-intensity',
    name: 'Light intensity',
    category: DEVICE_FEATURE_CATEGORIES.LIGHT_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    unit: DEVICE_FEATURE_UNITS.LUX,
    min: 0,
    max: 200000,
  },
];

export const sensor = {
  serviceType: SERVICE_TYPES.SENSOR,

  buildFeatures(ids, service) {
    return MEASUREMENTS.filter(
      (measurement) => service.attributes?.[measurement.attribute] !== undefined,
    ).map((measurement) => ({
      name: measurement.name,
      external_id: featureId(ids, service, measurement.key),
      category: measurement.category,
      type: measurement.type,
      unit: measurement.unit,
      min: measurement.min,
      max: measurement.max,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    }));
  },

  buildStates(ids, service) {
    return MEASUREMENTS.map((measurement) =>
      numberState(
        featureId(ids, service, measurement.key),
        service.attributes?.[measurement.attribute],
      ),
    ).filter(Boolean);
  },

  // A sensor takes no command.
  buildCommands() {
    return [];
  },
};
