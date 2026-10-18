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
import { buildReleaseNotes, extractSection } from '../.github/scripts/release-notes.mjs';

const manifestText = await readFile(
  new URL('../gladys-assistant-integration.json', import.meta.url),
  'utf8',
);

const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

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

// ---------------------------------------------------------------------------
// The release body. Gladys links the installed version number to this
// repository's releases filtered on that version, so this text IS the
// changelog its users read: an empty or wrong section is user-facing.
// ---------------------------------------------------------------------------

test('a version section is taken whole, and stops at the next one', () => {
  const markdown = [
    '# Changelog',
    '',
    '## 1.2.0',
    '',
    'What changed.',
    '',
    '### Fixed',
    '',
    '- a thing',
    '',
    '## 1.1.0',
    '',
    'Older.',
  ].join('\n');

  assert.equal(extractSection(markdown, '1.2.0'), 'What changed.\n\n### Fixed\n\n- a thing');
  assert.equal(extractSection(markdown, '1.1.0'), 'Older.', 'the last section runs to the end');
  assert.equal(extractSection(markdown, '9.9.9'), null, 'an unreleased version has no section');
});

test('the usual ways of writing a version heading all work', () => {
  for (const heading of ['## 1.2.0', '## v1.2.0', '## [1.2.0] - 2026-10-18', '## 1.2.0 (2026)']) {
    assert.equal(extractSection(`${heading}\n\nBody.\n`, '1.2.0'), 'Body.', heading);
  }
  // Read as a whole token, never as a prefix: 1.2.10 is not 1.2.1.
  assert.equal(extractSection('## 1.2.10\n\nBody.\n', '1.2.1'), null);
  // A heading with nothing under it is no changelog at all.
  assert.equal(extractSection('## 1.2.0\n\n## 1.1.0\n\nBody.\n', '1.2.0'), null);
});

test('every version of the changelog carries something to read', () => {
  const versions = [...changelog.matchAll(/^##\s+v?(\d+\.\d+\.\d+)\s*$/gm)].map(
    (match) => match[1],
  );
  assert.ok(versions.length >= 1, 'the changelog lists no version');
  for (const version of versions) {
    const section = extractSection(changelog, version);
    assert.ok(section && section.length > 40, `the ${version} section says nothing`);
  }
});

test('the release body is the section, and never an empty page', () => {
  const sections = [{ heading: null, body: 'What changed.' }];
  assert.equal(buildReleaseNotes({ version: '1.2.0', sections }), 'What changed.');

  // Two changelogs (the French mirror) are published one after the other.
  assert.equal(
    buildReleaseNotes({
      version: '1.2.0',
      sections: [
        { heading: 'Français', body: 'Ce qui change.' },
        { heading: 'English', body: 'What changed.' },
      ],
    }),
    '## Français\n\nCe qui change.\n\n---\n\n## English\n\nWhat changed.',
  );

  // No section: a placeholder pointing at the changelog, because the version
  // number in Gladys links here and must not land on a blank release.
  const fallback = buildReleaseNotes({ version: '1.2.0', sections: [], repository: 'me/repo' });
  assert.match(fallback, /No changelog entry/);
  assert.match(fallback, /https:\/\/github\.com\/me\/repo\/blob\/v1\.2\.0\/CHANGELOG\.md/);
});
