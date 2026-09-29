import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvedGooglePlaceId } from './directoryMaps.ts';

test('a valid Places ID is retained for directory details', () => {
  assert.equal(resolvedGooglePlaceId('ChIJ12345', 'https://www.google.com/maps/place/?q=place_id:ChIJother'), 'ChIJ12345');
});

test('a Google Maps place ID is recovered when the direct field is absent', () => {
  assert.equal(resolvedGooglePlaceId('', 'https://www.google.com/maps/place/?q=place_id:ChIJ12345'), 'ChIJ12345');
});

test('untrusted place IDs and URLs are ignored', () => {
  assert.equal(resolvedGooglePlaceId('bad id', 'https://example.com/maps?q=place_id:ChIJ12345'), undefined);
  assert.equal(resolvedGooglePlaceId('x'.repeat(201)), undefined);
});
