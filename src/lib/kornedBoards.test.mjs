import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { KORNED_GROUPS, KORNED_LINKS_VERIFIED_ON, KORNED_ORIGIN } from './kornedBoards.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const links = KORNED_GROUPS.flatMap((group) => group.links);

test('Korned directory contains the verified public sections without copying posts', () => {
  assert.equal(KORNED_LINKS_VERIFIED_ON, '2026-09-30');
  assert.deepEqual(links.map((link) => link.id), [
    'freeboard', 'jobseekers', 'market', 'jobs-hub', 'employer-guide', 'newsletter', 'notices', 'community-guide',
  ]);
  assert.ok(links.every((link) => link.description.length > 0));
  assert.ok(links.every((link) => !('content' in link) && !('summary' in link)));
});

test('Korned external links are fixed to the inspected HTTP origin', () => {
  for (const link of links) {
    const url = new URL(link.href);
    assert.equal(url.origin, KORNED_ORIGIN);
    assert.equal(url.protocol, 'http:');
    assert.equal(url.username, '');
    assert.equal(url.password, '');
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
  }
});

test('Korned directory is discoverable and flags its insecure external transport', () => {
  const sidebar = read('src/components/layout/GlobalSidebar.tsx');
  const sitemap = read('src/lib/sitemapXml.ts');
  const page = read('src/app/korned/page.tsx');

  assert.match(sidebar, /id: 'korned', href: '\/korned'/);
  assert.match(sitemap, /'\/korned'/);
  assert.match(page, /rel="noopener noreferrer"/);
  assert.match(page, /HTTPS 연결은 오류를 반환했습니다/);
  assert.doesNotMatch(page, /<main\b/);
});
