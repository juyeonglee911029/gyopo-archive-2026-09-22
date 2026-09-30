import assert from 'node:assert/strict';
import test from 'node:test';
import { canPhotoMatch, getVisibleMatchPhotos, normalizeProfilePhotos, parseProfileGalleryUrl } from './profilePhotos.ts';

const photos = (count) => Array.from({ length: count }, (_, index) => `https://photos.example/${index + 1}.jpg`);

test('normalizes unique non-empty photo URLs and caps the gallery at five', () => {
  assert.deepEqual(normalizeProfilePhotos([' first ', '', null, 'first', 'second', 'third', 'fourth', 'fifth', 'sixth']), [
    'first', 'second', 'third', 'fourth', 'fifth',
  ]);
  assert.deepEqual(normalizeProfilePhotos(undefined), []);
});

test('requires three uploaded photos for a new match', () => {
  assert.equal(canPhotoMatch(photos(0)), false);
  assert.equal(canPhotoMatch(photos(2)), false);
  assert.equal(canPhotoMatch(photos(3)), true);
  assert.equal(canPhotoMatch(photos(5)), true);
});

test('reveals three counterpart photos to viewers with three or four photos', () => {
  assert.deepEqual(getVisibleMatchPhotos(photos(3), photos(5)), photos(3));
  assert.deepEqual(getVisibleMatchPhotos(photos(4), photos(5)), photos(3));
});

test('reveals the full counterpart gallery only to a five-photo viewer', () => {
  assert.deepEqual(getVisibleMatchPhotos(photos(5), photos(5)), photos(5));
});

test('a viewer below the minimum receives no match gallery', () => {
  assert.deepEqual(getVisibleMatchPhotos(photos(2), photos(5)), []);
});

test('accepts only tokenized gallery URLs owned by the profile user', () => {
  const bucket = 'gyopo-live-portal-506019.firebasestorage.app';
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/profiles%2Falice%2Fgallery%2F00000000-0000-4000-8000-000000000001.jpg?alt=media&token=abcdef0123456789`;
  assert.deepEqual(parseProfileGalleryUrl(url, 'alice', bucket), {
    objectName: 'profiles/alice/gallery/00000000-0000-4000-8000-000000000001.jpg',
    downloadToken: 'abcdef0123456789',
  });
  assert.equal(parseProfileGalleryUrl(url, 'bob', bucket), null);
  assert.equal(parseProfileGalleryUrl('https://images.example/photo.jpg', 'alice', bucket), null);
  assert.equal(parseProfileGalleryUrl(url.replace('&token=abcdef0123456789', ''), 'alice', bucket), null);
  assert.equal(parseProfileGalleryUrl(url.replace('.jpg?', '.png?'), 'alice', bucket), null);
});
