import assert from 'node:assert/strict';
import test from 'node:test';
import { addMissingIncomingLikeCandidates, prioritizeIncomingLikes, sortOnlineUsersByLogin } from './friendMatching.ts';

test('incoming like profiles missing from the online list are included once', () => {
  const online = [{ id: 'online' }, { id: 'incoming-online' }];
  const incoming = [{ id: 'incoming-online' }, { id: 'incoming-offline' }, { id: 'incoming-offline' }];

  assert.deepEqual(
    addMissingIncomingLikeCandidates(online, incoming).map((candidate) => candidate.id),
    ['online', 'incoming-online', 'incoming-offline'],
  );
});

test('incoming likes are placed before other candidates without reordering either group', () => {
  const candidates = ['regular', 'incoming-a', 'outgoing', 'incoming-b'].map((id) => ({ id }));
  const connections = [
    { requesterId: 'incoming-a', addresseeId: 'viewer', status: 'pending' },
    { requesterId: 'viewer', addresseeId: 'outgoing', status: 'pending' },
    { requesterId: 'incoming-b', addresseeId: 'viewer', status: 'pending' },
    { requesterId: 'declined', addresseeId: 'viewer', status: 'declined' },
  ];

  assert.deepEqual(
    prioritizeIncomingLikes(candidates, connections, 'viewer').map((candidate) => candidate.id),
    ['incoming-a', 'incoming-b', 'regular', 'outgoing'],
  );
});

test('online members are ordered by login time, with activity as the fallback and tie-breaker', () => {
  const users = [
    { id: 'older-login', lastLoginAt: '2026-10-01T12:00:00.000Z', lastSeenAt: '2026-10-02T12:00:00.000Z' },
    { id: 'newer-login', lastLoginAt: '2026-10-02T11:00:00.000Z', lastSeenAt: '2026-10-02T11:10:00.000Z' },
    { id: 'login-fallback', lastSeenAt: '2026-10-02T10:00:00.000Z' },
    { id: 'same-login-recent-activity', lastLoginAt: '2026-10-02T09:00:00.000Z', lastSeenAt: '2026-10-02T09:10:00.000Z' },
    { id: 'same-login-older-activity', lastLoginAt: '2026-10-02T09:00:00.000Z', lastSeenAt: '2026-10-02T09:05:00.000Z' },
  ];

  assert.deepEqual(
    sortOnlineUsersByLogin(users).map((user) => user.id),
    ['newer-login', 'login-fallback', 'same-login-recent-activity', 'same-login-older-activity', 'older-login'],
  );
});
