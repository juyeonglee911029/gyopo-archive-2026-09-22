import assert from 'node:assert/strict';
import test from 'node:test';
import { googlePlace } from './directoryPlaces.ts';

function mockPlace(payload, onRequest = () => {}) {
  globalThis.fetch = async (input, init) => {
    onRequest(String(input), new Headers(init?.headers));
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

test('Google Place details fall back to regular hours and expose safe website metadata', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GOOGLE_PLACES_API_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = originalKey;
  });
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';

  let requestUrl = '';
  let fieldMask = '';
  mockPlace({
    id: 'ChIJ12345',
    displayName: { text: 'Seoul Kitchen' },
    formattedAddress: '10 Main Street',
    businessStatus: 'OPERATIONAL',
    websiteUri: 'https://restaurant.example/menu',
    currentOpeningHours: { openNow: true },
    regularOpeningHours: { weekdayDescriptions: ['Monday: 10:00 AM-8:00 PM'] },
    photos: [{ name: 'places/ChIJ12345/photos/photo_1', authorAttributions: [{ displayName: 'Photo Author', uri: 'https://maps.google.com/profile' }] }],
    reviews: [{ authorAttribution: { displayName: 'Reviewer' }, rating: 5, text: { text: 'Good food' }, relativePublishTimeDescription: '2 weeks ago' }],
  }, (url, headers) => {
    requestUrl = url;
    fieldMask = headers.get('X-Goog-FieldMask') || '';
  });

  const place = await googlePlace('ChIJ12345');
  assert.match(requestUrl, /places\/ChIJ12345$/);
  assert.match(fieldMask, /websiteUri/);
  assert.match(fieldMask, /regularOpeningHours/);
  assert.deepEqual(place.hours, ['Monday: 10:00 AM-8:00 PM']);
  assert.equal(place.hoursSource, 'regular');
  assert.equal(place.openNow, true);
  assert.equal(place.websiteUrl, 'https://restaurant.example/menu');
  assert.equal(place.images[0], '/api/directory/photo?name=places%2FChIJ12345%2Fphotos%2Fphoto_1');
  assert.equal(place.photoAttributions[0].displayName, 'Photo Author');
  assert.equal(place.recentReviews[0].text, 'Good food');
});

test('current Google hours take precedence and non-HTTPS websites are omitted', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GOOGLE_PLACES_API_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = originalKey;
  });
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';
  mockPlace({
    id: 'ChIJ67890',
    displayName: { text: 'Han Cafe' },
    formattedAddress: '20 Main Street',
    businessStatus: 'OPERATIONAL',
    websiteUri: 'http://unsafe.example',
    currentOpeningHours: { weekdayDescriptions: ['Monday: Open 24 hours'], openNow: false },
    regularOpeningHours: { weekdayDescriptions: ['Monday: 9:00 AM-6:00 PM'] },
  });

  const place = await googlePlace('ChIJ67890');
  assert.deepEqual(place.hours, ['Monday: Open 24 hours']);
  assert.equal(place.hoursSource, 'current');
  assert.equal(place.openNow, false);
  assert.equal(place.websiteUrl, undefined);
});
