import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { friendLikeIntent } from './friendMatching.ts';

const usersPage = readFileSync(new URL('../app/users/page.tsx', import.meta.url), 'utf8');
const discoveryDeck = readFileSync(new URL('../components/friends/FriendDiscoveryDeck.tsx', import.meta.url), 'utf8');

test('a first like creates a pending connection', () => {
  assert.equal(friendLikeIntent(null, 'alice'), 'create');
});

test('a reciprocal like accepts the pending connection as a match', () => {
  assert.equal(friendLikeIntent({ requesterId: 'alice', addresseeId: 'bob', status: 'pending' }, 'bob'), 'matched');
  assert.equal(friendLikeIntent({ requesterId: 'alice', addresseeId: 'bob', status: 'pending' }, 'alice'), 'waiting');
});

test('existing matches stay matched and declined likes can restart', () => {
  assert.equal(friendLikeIntent({ requesterId: 'alice', addresseeId: 'bob', status: 'accepted' }, 'alice'), 'matched');
  assert.equal(friendLikeIntent({ requesterId: 'alice', addresseeId: 'bob', status: 'declined' }, 'bob'), 'create');
});

test('friend action failures render beside the discovery card', () => {
  assert.match(usersPage, /<FriendDiscoveryDeck[^>]*error=\{friendError\}/);
  assert.doesNotMatch(usersPage, /\{friendError\s*&&/);
});

test('discovery cards keep an explicit aspect ratio and responsive two-column layout', () => {
  assert.match(discoveryDeck, /aspectRatio: '4 \/ 5'/);
  assert.match(discoveryDeck, /repeat\(auto-fit, minmax\(min\(100%, 24rem\), 1fr\)\)/);
});
