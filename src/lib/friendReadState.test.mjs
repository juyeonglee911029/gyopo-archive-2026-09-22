import assert from 'node:assert/strict';
import test from 'node:test';
import { isUnreadFriendMessage } from './friendReadState.ts';

const readAt = '2026-09-30T12:00:00.000Z';

test('a newer message from the friend is unread', () => {
  assert.equal(isUnreadFriendMessage({ authorId: 'friend', createdAt: '2026-09-30T12:01:00.000Z' }, 'member', readAt), true);
});

test('own, already-read, equal-time, and invalid messages do not create unread badges', () => {
  assert.equal(isUnreadFriendMessage({ authorId: 'member', createdAt: '2026-09-30T12:01:00.000Z' }, 'member', readAt), false);
  assert.equal(isUnreadFriendMessage({ authorId: 'friend', createdAt: '2026-09-30T11:59:00.000Z' }, 'member', readAt), false);
  assert.equal(isUnreadFriendMessage({ authorId: 'friend', createdAt: readAt }, 'member', readAt), false);
  assert.equal(isUnreadFriendMessage({ authorId: 'friend', createdAt: 'not-a-date' }, 'member', readAt), false);
});

test('a missing receipt treats an incoming latest message as unread until it is initialized', () => {
  assert.equal(isUnreadFriendMessage({ authorId: 'friend', createdAt: '2026-09-30T11:59:00.000Z' }, 'member'), true);
  assert.equal(isUnreadFriendMessage(null, 'member'), false);
});
