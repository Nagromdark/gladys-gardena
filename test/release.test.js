// -----------------------------------------------------------------------------
// The release helper that rewrites the manifest.
//
// A release that leaves the manifest unformatted turns the next CI run red, and
// one that rewrites the wrong value ships a manifest pointing at an image that
// does not exist. Both happened; this pins the behaviour.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bumpManifest } from '../.github/scripts/release.mjs';

const manifestText = await readFile(
  new URL('../gladys-assistant-integration.json', import.meta.url),
  'utf8',
);

test('the release rewrites the version and the image, and nothing else', () => {
  const result = bumpManifest(manifestText, '9.9.9', 'ghcr.io/owner/repo:9.9.9');
  const before = JSON.parse(manifestText);
  const after = JSON.parse(result);

  assert.equal(after.version, '9.9.9');
  assert.equal(after.docker_image, 'ghcr.io/owner/repo:9.9.9');
  assert.deepEqual(
    { ...after, version: before.version, docker_image: before.docker_image },
    before,
    'every other field is untouched',
  );
});

test('the release preserves the formatting of the file', () => {
  const result = bumpManifest(manifestText, '9.9.9', 'ghcr.io/owner/repo:9.9.9');

  // Only the two value lines may differ: jq used to reprint the whole file,
  // which expanded every array and failed `npm run format:check`.
  const changed = result
    .split('\n')
    .filter((line, index) => line !== manifestText.split('\n')[index]);
  assert.equal(changed.length, 2, 'exactly two lines change');
  assert.equal(result.split('\n').length, manifestText.split('\n').length);
});

test('a manifest without the expected keys fails loudly', () => {
  assert.throws(
    () => bumpManifest('{\n  "name": "x"\n}\n', '1.0.0', 'img:1.0.0'),
    /no top-level "version" string/,
  );
});
