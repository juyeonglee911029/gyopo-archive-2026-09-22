import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(join(root, path), 'utf8');

test('life essentials are surfaced as a button grid in Community, not the sidebar', () => {
  const sidebar = read('src/components/layout/GlobalSidebar.tsx');
  const community = read('src/app/community/page.tsx');

  assert.doesNotMatch(sidebar, /LIFE ESSENTIALS|id: 'immigration'|id: 'tax-finance'/);
  assert.match(community, /LIFE_ESSENTIAL_TABS/);
  assert.match(community, /grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4/);
  assert.match(community, /focus-visible:outline-cyan-200/);
});

test('mobile navigation puts Search in the center and replaces Regions with Directory', () => {
  const navigation = read('src/components/layout/MobileBottomNav.tsx');
  const home = navigation.indexOf("href: '/', label: '홈'");
  const directory = navigation.indexOf("href: '/directory', label: '업소록'");
  const search = navigation.indexOf("href: '/search', label: '검색'");
  const community = navigation.indexOf("label: '커뮤니티'");
  const friends = navigation.indexOf("href: '/users', label: '친구'");

  assert.ok(home < directory && directory < search && search < community && community < friends);
  assert.doesNotMatch(navigation, /href: '\/regions', label: '지역'/);
});

test('friend matching is visible in the sidebar and opens the existing member flow', () => {
  const sidebar = read('src/components/layout/GlobalSidebar.tsx');
  const members = read('src/app/users/page.tsx');
  const discovery = read('src/components/friends/FriendDiscoveryDeck.tsx');

  assert.match(sidebar, /id: 'friends', href: '\/users', label: '친구 매칭'/);
  assert.match(members, /<h1[^>]*>\{t\('친구 매칭', 'Friend matching'\)\}<\/h1>/);
  assert.doesNotMatch(members, /friendMatchingDemo|demo-member-|159개 검수용/);
  assert.doesNotMatch(members, /랜덤 화상 매칭|online now|users-mobile-online/);
  assert.doesNotMatch(discovery, /demoMode|onEnterDemo|159개 검수용/);
  assert.match(members, /sendFriendRequest/);
  assert.match(members, /respondToFriendRequest/);
});

test('desktop live lounge reaches the viewport bottom at a narrower width', () => {
  const styles = read('src/app/experience-refinements.css');
  const lounge = styles.slice(styles.indexOf('.global-lounge {'), styles.indexOf('.global-lounge-header'));

  assert.match(lounge, /top: var\(--header-height, 96px\) !important/);
  assert.match(lounge, /right: 0 !important/);
  assert.match(lounge, /bottom: 0 !important/);
  assert.match(lounge, /width: min\(18rem,/);
  assert.match(styles, /\.global-header-search\s*\{\s*display: none !important;/);
});
