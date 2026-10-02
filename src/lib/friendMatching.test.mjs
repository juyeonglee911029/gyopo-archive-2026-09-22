import assert from 'node:assert/strict';
import test from 'node:test';
import { addMissingIncomingLikeCandidates, prioritizeIncomingLikes } from './friendMatching.ts';

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
