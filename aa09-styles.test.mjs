import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const core = [
  '3m0y9asyu_o2b.css',
  '0obc4wf2u8iey.css',
  '3p_9c1a7v-yp3.css',
  '38nmym_0ssd2g.css',
];
// These are hashes of copied served artifacts, not reconstructed source CSS.
const hashes = {
  '3m0y9asyu_o2b.css': '67d83efb2fe999ff9357bdffa5afc91a3229c99000e1e057abb9a998d6ecec25',
  '0obc4wf2u8iey.css': '20225cb0e50233b510024bbec6c73dc11b14d098a728f77845b426308d044be1',
  '3p_9c1a7v-yp3.css': 'a26da043be880ef166a6fcb3c7e3661bddee3c66aee83affe20dbd4c1821216d',
  '38nmym_0ssd2g.css': 'd5ee9609d0bb4551ead527bade769f0eb38a790681b356248928bf22155e9f37',
  '2a6ljh5jdhtlj.css': '7b8289eef8de73aa5d508f1d31cb13d61df4349abfd2cb7692e3f326fb89c647',
  '2haazg539gb52.css': '872702a3ba8897f038f6a03c6d6963598ecce075a68ef293d611a93c0e7ec759',
};

test('all six served stylesheets remain byte-identical and self-contained', () => {
  for (const [file, expected] of Object.entries(hashes)) {
    const css = readFileSync(join(root, 'public/styles/release-aa09', file));
    assert.equal(createHash('sha256').update(css).digest('hex'), expected, file);
    assert.doesNotMatch(css.toString(), /@import\b|@font-face\b|url\s*\(/i, file);
  }
});

test('root head owns exactly four core links in selected order', () => {
  const layout = read('src/app/layout.tsx');
  const head = layout.match(/<head>([\s\S]*?)<\/head>/)?.[1];
  assert.ok(head, 'explicit root head');
  const links = [...head.matchAll(/<link\s+rel="stylesheet"\s+href="\/styles\/release-aa09\/([^"/]+)"\s*\/>/g)];
  assert.deepEqual(links.map((match) => match[1]), core);
  assert.equal((head.match(/<link\b/g) || []).length, 4);
  assert.doesNotMatch(layout, /2a6ljh5jdhtlj|2haazg539gb52/);
});

test('page styles are route-owned, not persistent React stylesheet resources', () => {
  const component = read('src/components/layout/ReleaseRouteStyles.tsx');
  assert.match(component, /^'use client';/);
  assert.match(component, /page === 'home' \? '2a6ljh5jdhtlj\.css' : '2haazg539gb52\.css'/);
  assert.match(component, /<link\s+rel="stylesheet"/);
  assert.match(component, /onLoad=\{\(\) => \{\}\}/);
  assert.doesNotMatch(component, /\bprecedence=|createPortal|document\.head|useEffect/);
  assert.match(read('src/app/page.tsx'), /<ReleaseRouteStyles page="home"\s*\/>/);
  assert.match(read('src/app/games/layout.tsx'), /<ReleaseRouteStyles page="games"\s*\/>/);
  assert.match(read('src/app/apps/tetris/page.tsx'), /<ReleaseRouteStyles page="games"\s*\/>/);
  assert.doesNotMatch(read('src/components/layout/GlobalAppShell.tsx'), /ReleaseRouteStyles/);
});

test('superseded global CSS and Tailwind entry imports cannot return', () => {
  const banned = /(?:globals(?:final|fix)?|design-system|music-popover|route-experience|call-ui|home-refresh|game-workspace)\.css$/;
  const files = readdirSync(join(root, 'src'), { recursive: true });
  for (const file of files.filter((path) => /\.(?:tsx?|jsx?|mjs|cjs|css)$/.test(path))) {
    const source = read(join('src', file));
    for (const match of source.matchAll(/(?:\bimport\s+(?:[^;'"\n]*?\s+from\s*)?|\brequire\s*\(|@import\s*)['"]([^'"]+)['"]/g)) {
      assert.ok(!banned.test(match[1]), `${file}: competing import ${match[1]}`);
      assert.notEqual(match[1], 'tailwindcss', `${file}: regenerates frozen utilities`);
      assert.ok(!match[1].includes('Header.legacy'), `${file}: obsolete header entry`);
    }
  }
});

test('selected CSS retains the 128px sidebar and 80px flex-header contract', () => {
  const shell = read('public/styles/release-aa09/0obc4wf2u8iey.css');
  const routes = read('public/styles/release-aa09/38nmym_0ssd2g.css');
  assert.match(shell, /--sidebar-width:128px[;}]/);
  assert.match(shell, /\.global-header-wrap \.site-header-inner\{[^}]*display:flex/);
  assert.match(shell, /\.global-header-wrap \.site-header-inner\{[^}]*flex-direction:row[^}]*min-height:80px/);
  assert.match(shell, /\.global-header-secondary\{[^}]*display:flex/);
  assert.match(routes, /@media \(min-width:769px\)/);
  assert.match(routes, /@media \(max-width:768px\)/);
});

test('shared markup delegates geometry to the selected stylesheet', () => {
  const shell = read('src/components/layout/GlobalAppShell.tsx');
  assert.doesNotMatch(shell, /250px|max-w-\[1600px\]|lg:block|lg:grid-cols/);
  assert.match(shell, /className="global-sidebar"/);
  assert.match(shell, /has-right-rail/);
  const header = read('src/components/layout/Header.tsx');
  assert.match(header, /className="global-header-secondary"/);
  assert.match(header, /<MusicPlayer embedded\s*\/>/);
  assert.match(header, /ResizeObserver/);
  assert.doesNotMatch(header, /MessageCircle|PhoneCall|gyopo-friends-open/);
  assert.match(read('src/components/layout/MobileDrawer.tsx'), /min-width: 769px/);
});

test('sidebar friends action keeps guest navigation and signed-in dock behavior', () => {
  const sidebar = read('src/components/layout/GlobalSidebar.tsx');
  assert.match(sidebar, /className="global-friends-link"/);
  assert.match(sidebar, /if \(!user\)\s*\{[\s\S]*?router\.push\('\/users'\)/);
  assert.match(sidebar, /window\.dispatchEvent\(new Event\('gyopo-friends-open'\)\)/);
  assert.match(sidebar, /onNavigate\?\.\(\)/);
});
