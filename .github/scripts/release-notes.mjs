// -----------------------------------------------------------------------------
// Release helper: the body of the GitHub release, taken from the changelog.
//
// Gladys turns the installed version number of an external integration into a
// link to this repository's releases, filtered on that version: the body of
// the release IS the changelog its users read. A tag without a release leaves
// them on "no releases found", so the release workflow creates it, with the
// section this script extracts.
//
// Usage: node .github/scripts/release-notes.mjs <version> <output-file>
// Exit codes: 0 the section was found, 3 it was not (a placeholder body is
// written anyway, so the link never lands on an empty page).
// -----------------------------------------------------------------------------

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// The changelog the release body is taken from. The French mirror exists for
// readers of the repository; the releases published so far carry the English
// text alone, so that is what this writes. To publish both, add
// `{ file: 'CHANGELOG.fr.md', heading: 'Français' }` before this entry and
// give this one a heading too.
const CHANGELOGS = [{ file: 'CHANGELOG.md', heading: null }];

/**
 * The body of the `## <version>` section of a changelog, heading excluded.
 * @param {string} markdown - Changelog content.
 * @param {string} version - Released version, e.g. 1.2.0.
 * @returns {string|null} The section body, or null when there is none.
 */
export function extractSection(markdown, version) {
  const lines = markdown.split('\n');
  const isHeading = (line) => /^##\s/.test(line);
  // The version a `##` heading is about, whichever form it is written in:
  // `## 1.2.0`, `## v1.2.0`, `## [1.2.0] - 2026-10-18`, `## 1.2.0 (2026-10-18)`.
  // Its FIRST token only, so `## 1.2.10` is never read as `1.2.1`.
  const headingVersion = (line) =>
    line
      .replace(/^##\s+/, '')
      .trim()
      .split(/[\s,]+/)[0]
      .replace(/^\[|\]$/g, '')
      .replace(/^v/, '');
  const start = lines.findIndex((line) => isHeading(line) && headingVersion(line) === version);
  if (start === -1) {
    return null;
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(isHeading);
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
  return body.length > 0 ? body : null;
}

/**
 * The release body: the changelog sections of this version, or a placeholder
 * pointing at the changelog when the version has no section yet.
 * @param {object} options - Options.
 * @param {string} options.version - Released version.
 * @param {Array<{heading: string|null, body: string}>} options.sections - Sections found.
 * @param {string} [options.repository] - `owner/repo`, for the placeholder link.
 * @returns {string} The release body.
 */
export function buildReleaseNotes({ version, sections, repository }) {
  if (sections.length === 0) {
    const url = repository
      ? `https://github.com/${repository}/blob/v${version}/CHANGELOG.md`
      : 'CHANGELOG.md';
    return `No changelog entry was written for ${version}. See the changelog: ${url}`;
  }
  return sections
    .map(({ heading, body }) => (heading ? `## ${heading}\n\n${body}` : body))
    .join('\n\n---\n\n');
}

// Entry point: skipped when the module is imported by the tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [version, outputFile] = process.argv.slice(2);
  if (!version || !outputFile) {
    console.error('usage: node .github/scripts/release-notes.mjs <version> <output-file>');
    process.exit(1);
  }
  const sections = [];
  for (const { file, heading } of CHANGELOGS) {
    let body = null;
    try {
      body = extractSection(readFileSync(file, 'utf8'), version);
    } catch {
      console.error(`${file}: unreadable, skipped`);
    }
    if (body) {
      sections.push({ heading, body });
    }
  }
  const notes = buildReleaseNotes({
    version,
    sections,
    repository: process.env.GITHUB_REPOSITORY,
  });
  writeFileSync(outputFile, `${notes}\n`);
  if (sections.length === 0) {
    console.error(`No "## ${version}" section in ${CHANGELOGS.map((c) => c.file).join(', ')}`);
    process.exit(3);
  }
  console.log(`${outputFile}: release notes of ${version}, ${notes.length} characters`);
}
