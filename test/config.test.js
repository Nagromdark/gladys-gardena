// -----------------------------------------------------------------------------
// Configuration: defaults, typing (a form sends strings) and what a change
// actually implies for the GARDENA session.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, isConfigured, needsReconnect, normalizeConfig } from '../src/config.js';

test('an empty configuration falls back to the defaults', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig(undefined), DEFAULT_CONFIG);
});

test('numbers arriving as strings from the form are typed back', () => {
  const config = normalizeConfig({ poll_frequency: '600', default_duration: '15' });
  assert.equal(config.poll_frequency, 600);
  assert.equal(config.default_duration, 15);
});

test('an unusable number falls back to the default instead of breaking the polling', () => {
  const config = normalizeConfig({
    poll_frequency: '',
    default_duration: 'abc',
    mower_duration: 0,
  });
  assert.equal(config.poll_frequency, DEFAULT_CONFIG.poll_frequency);
  assert.equal(config.default_duration, DEFAULT_CONFIG.default_duration);
  assert.equal(config.mower_duration, DEFAULT_CONFIG.mower_duration);
});

test('credentials are trimmed: a copy-paste often carries a trailing space', () => {
  const config = normalizeConfig({
    application_key: '  key  ',
    application_secret: 'secret\n',
    location_id: ' ',
  });
  assert.equal(config.application_key, 'key');
  assert.equal(config.application_secret, 'secret');
  assert.equal(config.location_id, '', 'a blank location means "every location"');
});

test('the integration is configured only when both credentials are there', () => {
  assert.equal(isConfigured(normalizeConfig({})), false);
  assert.equal(isConfigured(normalizeConfig({ application_key: 'k' })), false);
  assert.equal(
    isConfigured(normalizeConfig({ application_key: 'k', application_secret: 's' })),
    true,
  );
});

test('only the credentials and the location require rebuilding the session', () => {
  const base = normalizeConfig({ application_key: 'k', application_secret: 's' });

  assert.equal(needsReconnect(base, { ...base, default_duration: 45 }), false);
  assert.equal(needsReconnect(base, { ...base, mower_stop_mode: 'further_notice' }), false);
  assert.equal(needsReconnect(base, { ...base, application_secret: 's2' }), true);
  assert.equal(needsReconnect(base, { ...base, location_id: 'loc-2' }), true);
});
