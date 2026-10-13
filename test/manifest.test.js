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
import { WIDGET_KEYS } from '../src/widgets/index.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');

/** Minimum version of the `gladys_version` range, e.g. [5, 1, 0]. */
function minGladysVersion() {
  const [, major, minor, patch] = /^>=(\d+)\.(\d+)\.(\d+)/.exec(manifest.gladys_version) ?? [];
  assert.ok(major !== undefined, `unsupported gladys_version: ${manifest.gladys_version}`);
  return [Number(major), Number(minor), Number(patch)];
}

/** Is the version at least the floor? */
function atLeast([major, minor, patch], [minMajor, minMinor, minPatch]) {
  if (major !== minMajor) {
    return major > minMajor;
  }
  if (minor !== minMinor) {
    return minor > minMinor;
  }
  return patch >= minPatch;
}

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

// The catalog vocabulary of the store indexer (INTEGRATION_CATALOG_CATEGORIES).
// Unknown keys are dropped with a warning rather than rejected, so a typo would
// silently make the integration unlistable in that section — hence this list.
const CATALOG_CATEGORIES = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
];

test('the catalog categories are valid and require a Gladys that knows them', () => {
  const { categories } = manifest;
  assert.ok(Array.isArray(categories), 'categories must be declared');
  assert.ok(categories.length >= 1 && categories.length <= 3, '1 to 3 categories');
  assert.equal(new Set(categories).size, categories.length, 'no duplicate');
  for (const category of categories) {
    assert.ok(CATALOG_CATEGORIES.includes(category), `unknown catalog category "${category}"`);
  }
  // Older cores reject unknown top-level manifest fields: declaring categories
  // without raising the range turns the catalog filter into an install failure.
  assert.ok(atLeast(minGladysVersion(), [4, 86, 0]), 'categories require >=4.86.0');
});

test('declaring widgets requires a Gladys that knows them', () => {
  // Same rule as `categories`, one floor higher: a core older than 5.1 rejects
  // the whole manifest on the unknown `widgets` field.
  if (manifest.widgets) {
    assert.ok(atLeast(minGladysVersion(), [5, 1, 0]), 'widgets require >=5.1.0');
  }
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

// ---------------------------------------------------------------------------
// Dashboard widgets. A widget key is stored in the users' dashboards, exactly
// like an external id: the manifest and the code must never drift apart.
// ---------------------------------------------------------------------------

test('the declared widgets are the ones the code implements', () => {
  const declared = manifest.widgets.map((widget) => widget.key);
  assert.ok(declared.length >= 1 && declared.length <= 5, '1 to 5 widgets');
  assert.equal(new Set(declared).size, declared.length, 'no duplicate key');
  assert.deepEqual(declared.slice().sort(), WIDGET_KEYS.slice().sort());
  for (const key of declared) {
    assert.match(key, /^[a-z0-9_]{2,32}$/, `invalid widget key "${key}"`);
    assert.match(indexSource, new RegExp(`onWidgetGet\\('${key}'`), `${key}: no content handler`);
    assert.match(indexSource, new RegExp(`onWidgetAction\\('${key}'`), `${key}: no action handler`);
  }
});

test('widget labels and descriptions fit what the card can display', () => {
  for (const widget of manifest.widgets) {
    for (const language of ['en', 'fr']) {
      const label = widget.label[language];
      assert.ok(label, `${widget.key}: missing ${language} label`);
      // Code-enforced bounds, not in the JSON schema: French overflows easily.
      assert.ok(
        label.length >= 3 && label.length <= 30,
        `${widget.key}: ${language} label is ${label.length} characters`,
      );
      const description = widget.description?.[language];
      assert.ok(description, `${widget.key}: missing ${language} description`);
      assert.ok(description.length <= 100, `${widget.key}: ${language} description too long`);
    }
    if (widget.icon !== undefined) {
      assert.match(widget.icon, /^[a-z0-9-]{1,40}$/);
    }
    if (widget.action_timeout_seconds !== undefined) {
      assert.ok(widget.action_timeout_seconds >= 5 && widget.action_timeout_seconds <= 120);
    }
  }
});

test('widget settings never carry a secret and are not integration config', () => {
  // They live in the dashboard JSON, readable by every viewer of a public
  // dashboard — and they are per-instance, not integration-wide settings.
  const allowed = ['string', 'number', 'boolean', 'select', 'multi_select', 'section'];
  for (const widget of manifest.widgets) {
    const settings = widget.settings ?? [];
    assert.ok(settings.length <= 10, `${widget.key}: too many settings`);
    for (const field of settings) {
      assert.ok(allowed.includes(field.type), `${widget.key}.${field.key}: forbidden type`);
      assert.ok(
        !(field.key in DEFAULT_CONFIG),
        `${widget.key}.${field.key} is a dashboard setting, not an integration config key`,
      );
      assert.ok(field.label.en && field.label.fr, `${widget.key}.${field.key}: untranslated`);
      if (field.source !== undefined) {
        assert.equal(field.source, 'devices');
        assert.equal(field.options, undefined, 'source and options together reject the manifest');
      }
    }
  }
});
