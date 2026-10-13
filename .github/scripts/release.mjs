// -----------------------------------------------------------------------------
// Release helper: set the `version` and `docker_image` of the manifest.
//
// Why a script rather than `jq` in the workflow: jq reparses and reprints the
// whole file, which expands every array and object onto its own line. The
// result is valid JSON but not Prettier-formatted, so `npm run format:check`
// — a CI gate — failed on the very commit the release created. This rewrites
// the two values in place and leaves every other byte untouched.
//
// Usage: node .github/scripts/release.mjs <version> <docker-image>
// -----------------------------------------------------------------------------

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MANIFEST_FILE = 'gladys-assistant-integration.json';

/**
 * Set the top-level `version` and `docker_image` of a manifest, leaving the
 * formatting of the file untouched.
 * @param {string} text - Manifest content (Prettier-formatted JSON).
 * @param {string} version - Released version, e.g. 1.2.0.
 * @param {string} dockerImage - Image of that version, e.g. ghcr.io/me/repo:1.2.0.
 * @returns {string} The new manifest content.
 */
export function bumpManifest(text, version, dockerImage) {
  const manifest = JSON.parse(text);
  const updates = { version, docker_image: dockerImage };
  // In formatted JSON the first indented line is the first top-level key: its
  // indentation is what tells a top-level key from a nested one.
  const indent = /^[ \t]+(?=")/m.exec(text)?.[0];
  let result = text;
  for (const [key, value] of Object.entries(updates)) {
    const pattern = new RegExp(`^(${indent}"${key}":\\s*)"[^"]*"`, 'm');
    if (indent === undefined || !pattern.test(result)) {
      throw new Error(`${MANIFEST_FILE}: no top-level "${key}" string to update`);
    }
    result = result.replace(pattern, (_match, prefix) => prefix + JSON.stringify(value));
  }

  // Those two values changed, and nothing else did: a surgical replace must
  // never be trusted on its word.
  const expected = { ...manifest, ...updates };
  if (JSON.stringify(JSON.parse(result)) !== JSON.stringify(expected)) {
    throw new Error(`${MANIFEST_FILE}: the rewrite changed more than version and docker_image`);
  }
  return result;
}

// Entry point: skipped when the module is imported by the tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [version, dockerImage] = process.argv.slice(2);
  if (!version || !dockerImage) {
    console.error('usage: node .github/scripts/release.mjs <version> <docker-image>');
    process.exit(1);
  }
  const text = readFileSync(MANIFEST_FILE, 'utf8');
  writeFileSync(MANIFEST_FILE, bumpManifest(text, version, dockerImage));
  console.log(`${MANIFEST_FILE}: version ${version}, image ${dockerImage}`);
}
