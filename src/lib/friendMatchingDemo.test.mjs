import assert from 'node:assert/strict';
import test from 'node:test';
import { FRIEND_MATCHING_DEMO_COUNT, friendMatchingDemoProfiles } from './friendMatchingDemo.ts';

test('matching review data is synthetic, clearly named, and exactly 159 profiles', () => {
  assert.equal(friendMatchingDemoProfiles.length, FRIEND_MATCHING_DEMO_COUNT);
  assert.equal(FRIEND_MATCHING_DEMO_COUNT, 159);
  assert.equal(new Set(friendMatchingDemoProfiles.map((profile) => profile.id)).size, 159);
  assert.ok(friendMatchingDemoProfiles.every((profile) => profile.name.startsWith('테스트 회원 ')));
  assert.ok(friendMatchingDemoProfiles.every((profile) => profile.id.startsWith('demo-member-')));
  assert.ok(friendMatchingDemoProfiles.every((profile) => profile.image === ''));
});
