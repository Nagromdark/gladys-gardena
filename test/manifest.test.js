// -----------------------------------------------------------------------------
// Consistency between `gladys-assistant-integration.json` and the code.
//
// The store indexer validates the manifest against its JSON Schema, but nothing
// there can know which handlers the code registers, nor which defaults the
// integration actually applies. These tests keep the two in sync — a mismatch
// there is a silent bug (a button that answers "not implemented", or a form
// default that differs from the value the code uses).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/config.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');

test('the manifest describes a device integration talking to a cloud API', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.deepEqual(manifest.transports, ['cloud'], 'GARDENA offers no local API');
  assert.ok(manifest.name.length <= 30, 'the catalog card title is capped at 30 characters');
  for (const [language, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${language} length`);
  }
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.match(manifest.docker_image, /:\d+\.\d+\.\d+$/, 'the image must carry an explicit tag');
  assert.equal(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    true,
    'the image tag and the manifest version must move together',
  );
});

test('every manifest action is registered in index.js', () => {
  for (const action of manifest.actions ?? []) {
    assert.match(
      indexSource,
      new RegExp(`onAction\\('${action.key}'`),
      `manifest action "${action.key}" has no handler`,
    );
  }
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} must match the manifest default`,
      );
    }
  }
});

test('every stored config key is known by the code, and vice versa', () => {
  const stored = manifest.config_schema
    .filter((field) => field.type !== 'section')
    .map((field) => field.key);
  for (const key of stored) {
    assert.ok(key in DEFAULT_CONFIG, `the code ignores the config key "${key}"`);
  }
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    assert.ok(stored.includes(key), `the config key "${key}" is not offered in the form`);
  }
});

test('the credentials are declared required, and the secret is a secret', () => {
  const byKey = Object.fromEntries(manifest.config_schema.map((field) => [field.key, field]));
  assert.equal(byKey.application_key.required, true);
  assert.equal(byKey.application_secret.required, true);
  // A `secret` field is stored encrypted and never sent back to the browser.
  assert.equal(byKey.application_secret.type, 'secret');
  assert.equal(byKey.application_secret.default, undefined, 'a secret takes no default');
});

test('select fields only offer values the code understands', () => {
  const byKey = Object.fromEntries(manifest.config_schema.map((field) => [field.key, field]));
  const expected = {
    power_socket_on_mode: ['duration', 'forever'],
    mower_start_mode: ['schedule', 'duration'],
    mower_stop_mode: ['next_task', 'further_notice'],
  };
  for (const [key, values] of Object.entries(expected)) {
    assert.deepEqual(
      byKey[key].options.map((option) => option.value),
      values,
    );
    assert.ok(values.includes(byKey[key].default), `${key} default must be one of its options`);
  }
});

test('the section block is purely presentational', () => {
  const sections = manifest.config_schema.filter((field) => field.type === 'section');
  assert.equal(sections.length, 1);
  for (const section of sections) {
    assert.equal(section.required, undefined, 'a section stores no value');
    assert.equal(section.default, undefined);
    assert.ok(section.label?.en && section.label?.fr);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('the stop_all_watering action targets a device through a dynamic select', () => {
  const action = manifest.actions.find((entry) => entry.key === 'stop_all_watering');
  const field = action.fields[0];
  // `source: devices` lets the Configuration screen fill the options with the
  // integration's own devices: the user never copies an identifier by hand.
  assert.equal(field.source, 'devices');
  assert.equal(field.options, undefined, 'source and options together reject the manifest');
  assert.equal(field.required, true);
});

test('every user-visible label is translated in both project languages', () => {
  const fields = [
    ...manifest.config_schema,
    ...manifest.actions,
    ...manifest.actions.flatMap((action) => action.fields ?? []),
  ];
  for (const field of fields) {
    assert.ok(field.label.en, `${field.key} needs an English label`);
    assert.ok(field.label.fr, `${field.key} needs a French label`);
    if (field.description) {
      assert.ok(field.description.en && field.description.fr, `${field.key} description`);
    }
  }
});
