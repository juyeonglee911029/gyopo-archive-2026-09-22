import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT_SOURCES, contentSourceMatchesRegion } from './contentSources.ts';

test('region-scoped global sources load only for their listed regions', () => {
  const uruguay = CONTENT_SOURCES.find((source) => source.id === 'uruguay-korean-embassy');
  assert.ok(uruguay);
  assert.equal(contentSourceMatchesRegion(uruguay, 'Uruguay'), true);
  assert.equal(contentSourceMatchesRegion(uruguay, 'USA'), false);
  assert.equal(contentSourceMatchesRegion(uruguay, 'Global'), true);
});

test('unscoped global sources and matching regional sources remain available', () => {
  const global = CONTENT_SOURCES.find((source) => source.id === 'naver-news');
  const brazil = CONTENT_SOURCES.find((source) => source.id === 'hanintoday-brazil');
  assert.ok(global);
  assert.ok(brazil);
  assert.equal(contentSourceMatchesRegion(global, 'USA'), true);
  assert.equal(contentSourceMatchesRegion(brazil, 'Brazil'), true);
  assert.equal(contentSourceMatchesRegion(brazil, 'USA'), false);
  assert.equal(contentSourceMatchesRegion(brazil, 'Global'), true);
});
