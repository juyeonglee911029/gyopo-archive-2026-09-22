import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeMusicMetadata, MUSIC_TRACKS } from './music.ts';

test('unavailable metadata preserves the known title and artist', () => {
  const track = MUSIC_TRACKS[0];
  assert.deepEqual(mergeMusicMetadata(track, { title: '', artist: '  ', views: undefined }), track);
});

test('metadata updates only nonempty presentation fields, not track identity', () => {
  const track = MUSIC_TRACKS[0];
  const updated = mergeMusicMetadata(track, { title: ' Official title ', artist: 'Artist', id: 'bad', videoId: 'bad', keywords: [] });
  assert.equal(updated.title, 'Official title');
  assert.equal(updated.artist, 'Artist');
  assert.equal(updated.id, track.id);
  assert.equal(updated.videoId, track.videoId);
  assert.deepEqual(updated.keywords, track.keywords);
  assert.equal(track.title, 'like JENNIE');
});
