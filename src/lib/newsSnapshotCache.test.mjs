import assert from 'node:assert/strict';
import test from 'node:test';
import { hasCacheableNews, readLastGoodNews, resolveNewsSnapshots, writeLastGoodNews } from './newsSnapshotCache.ts';

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function snapshot(sourceId, title, fetchedAt = '2026-09-30T04:00:00.000Z') {
  return {
    id: sourceId,
    sourceId,
    sourceName: 'Regional news',
    region: 'USA',
    url: 'https://news.google.com/rss/search?q=USA',
    title: 'USA news',
    fetchedAt,
    items: title ? [{ title, url: `https://example.com/${sourceId}`, body: 'Cached article body'.repeat(100) }] : [],
  };
}

test('stores compact last-good news per region', () => {
  const storage = createStorage();
  assert.equal(writeLastGoodNews(storage, 'USA', [snapshot('regional-USA', 'A story')]), true);
  const cached = readLastGoodNews(storage, 'USA');
  assert.equal(cached.length, 1);
  assert.equal(cached[0].sourceId, 'regional-USA');
  assert.equal(cached[0].items[0].description.length, 800);
  assert.equal(cached[0].items[0].body, undefined);
  assert.deepEqual(readLastGoodNews(storage, 'Uruguay'), []);
});

test('does not overwrite a good cache with an empty response', () => {
  const storage = createStorage();
  writeLastGoodNews(storage, 'USA', [snapshot('regional-USA', 'Last good story')]);
  assert.equal(writeLastGoodNews(storage, 'USA', [snapshot('regional-USA', '')]), false);
  assert.equal(readLastGoodNews(storage, 'USA')[0].items[0].title, 'Last good story');
  assert.equal(hasCacheableNews(snapshot('regional-USA', 'Still good')), true);
  assert.equal(hasCacheableNews(snapshot('regional-USA', '')), false);
});

test('uses cached source on empty or failed live results and prefers fresh data', () => {
  const cached = snapshot('regional-USA', 'Last good story');
  const fresh = snapshot('naver-news', 'Fresh story', '2026-09-30T04:30:00.000Z');
  const resolved = resolveNewsSnapshots([
    { sourceId: 'regional-USA', snapshot: snapshot('regional-USA', '') },
    { sourceId: 'naver-news', snapshot: fresh },
    { sourceId: 'regional-Uruguay' },
  ], [cached], (item) => hasCacheableNews(item));

  assert.deepEqual(resolved.snapshots.map((item) => item.items[0]?.title), ['Last good story', 'Fresh story']);
  assert.deepEqual(resolved.cacheFallbacks.map((item) => item.sourceId), ['regional-USA']);
  assert.equal(resolved.hasFreshNews, true);
});

test('keeps an empty live result when no good cache exists', () => {
  const empty = snapshot('regional-USA', '');
  const resolved = resolveNewsSnapshots([{ sourceId: empty.sourceId, snapshot: empty }], [], hasCacheableNews);
  assert.deepEqual(resolved.snapshots, [empty]);
  assert.deepEqual(resolved.cacheFallbacks, []);
  assert.equal(resolved.hasFreshNews, false);
});

test('ignores invalid cache payloads', () => {
  const storage = createStorage();
  storage.setItem('gyopo-news-last-good-v1:USA', '{bad json');
  assert.deepEqual(readLastGoodNews(storage, 'USA'), []);
});
