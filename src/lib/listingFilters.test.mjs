import assert from 'node:assert/strict';
import test from 'node:test';
import { COUNTRY_LOCATIONS } from './locations.ts';
import { REGIONS } from './regions.ts';
import { COMMUNITY_FILTERS, EMPTY_JOB_FILTERS, communityTopic, createFilterLocations, jobDetailHref, listingLocation, matchesCommunityFilters, matchesJobFilters, paginateListings, parseSavedJobIds } from './listingFilters.ts';

const locations = createFilterLocations(COUNTRY_LOCATIONS, REGIONS);
const now = Date.parse('2026-09-14T12:00:00Z');
const chosen = { country: 'USA', city: 'los-angeles' };
const matchesJob = (job, filters = {}, location = chosen, savedIds = []) => matchesJobFilters(job, { ...EMPTY_JOB_FILTERS, ...filters }, location, locations, savedIds, now);

test('country aliases and the existing LA region resolve without substring guesses', () => {
  for (const country of ['USA', 'us', 'US', 'United States', '미국', '미국 전체']) {
    assert.deepEqual(listingLocation({ country }, locations), { country: 'USA' });
  }
  for (const country of ['UK', 'GB', 'UnitedKingdom', '영국']) {
    assert.deepEqual(listingLocation({ country }, locations), { country: 'UnitedKingdom' });
  }
  assert.deepEqual(listingLocation({ country: 'USA-LA' }, locations), chosen);
  assert.deepEqual(listingLocation({ country: 'Thailand' }, locations), { country: 'Thailand' });
  assert.deepEqual(listingLocation({ country: 'not-USA' }, locations), {});
});

test('recognized city attributes stay country-qualified and ambiguous cities stay global', () => {
  for (const field of ['city', 'citySlug', 'cityName', 'locationCity', 'location']) {
    assert.deepEqual(listingLocation({ country: 'USA', [field]: 'Los Angeles' }, locations), chosen);
  }
  assert.deepEqual(listingLocation({ country: 'USA', location: 'LA' }, locations), chosen);
  assert.deepEqual(listingLocation({ city: 'London' }, locations), { country: 'UnitedKingdom', city: 'london' });
  assert.deepEqual(listingLocation({ city: 'Valencia' }, locations), {});
  assert.deepEqual(listingLocation({ country: 'Spain', city: 'Valencia' }, locations), { country: 'Spain', city: 'valencia' });
  assert.deepEqual(listingLocation({ country: 'USA', city: 'London' }, locations), { country: 'USA' });
  assert.deepEqual(listingLocation({ country: 'USA', city: 'Seattle', citySlug: 'los-angeles' }, locations), { country: 'USA' });
  assert.deepEqual(listingLocation({ country: 'unknown', city: 'London' }, locations), {});
  assert.deepEqual(listingLocation({ location: 'Los Angeles office, near London' }, locations), {});
});

test('locationless records and publisher display fallbacks never qualify as local', () => {
  for (const post of [{}, { country: 'Global' }, { country: null }, { country: 'USA', sourceLocation: {} }]) {
    assert.deepEqual(listingLocation(post, locations), {});
    assert.equal(matchesCommunityFilters(post, 'all', null, chosen, locations), true);
    assert.equal(matchesCommunityFilters(post, 'country', null, chosen, locations), false);
    assert.equal(matchesCommunityFilters(post, 'city', null, chosen, locations), false);
    assert.equal(matchesJob({ id: 'kept', ...post }, { local: true }), false);
    assert.equal(matchesJob({ id: 'kept', ...post }), true);
  }
  assert.equal(matchesCommunityFilters({ country: 'USA' }, 'country', null, {}, locations), false);
  assert.equal(matchesCommunityFilters({ country: 'USA' }, 'city', null, { country: 'USA' }, locations), false);
});

test('all job filters combine with AND and preserve original IDs and order', () => {
  const complete = { id: 'original-job', country: 'USA', city: 'LA', createdAt: '2026-09-14T11:00:00Z', koreanRequired: true, isRemote: true, visaSupport: true };
  const allFilters = { local: true, recent: true, korean: true, remote: true, visa: true, saved: true };
  const jobs = [complete, { ...complete, id: 'not-saved' }, { ...complete, id: 'wrong-city', city: 'Seattle' }, { ...complete, id: 'no-visa', visaSupport: false }];
  const saved = ['original-job', 'wrong-city', 'no-visa', 'not-currently-loaded'];
  const result = jobs.filter((job) => matchesJob(job, allFilters, chosen, saved));
  assert.deepEqual(result.map((job) => job.id), ['original-job']);
  assert.equal(result[0], complete);
  assert.deepEqual(jobs.filter((job) => matchesJob(job)), jobs);
  assert.equal(matchesJob(complete, { local: true }, {}), false);
  assert.equal(matchesJob(complete, { local: true }, { country: 'USA' }), true);
});

test('native and imported job links point to their readable detail route', () => {
  assert.equal(jobDetailHref({ id: 'native-job' }), '/content/native-job?collection=jobs');
  assert.equal(jobDetailHref({ id: 'source-job', sourceContentId: 'imported job', sourceId: 'partner', sourceUrl: 'https://example.test/job?a=1&b=2' }), '/content/imported%20job?source=partner&category=jobs&url=https%3A%2F%2Fexample.test%2Fjob%3Fa%3D1%26b%3D2');
});

test('optional job flags fail closed; only exact affirmative tags or boolean true qualify', () => {
  for (const [filter, field, tag] of [['korean', 'koreanRequired', '한국어 필수'], ['remote', 'isRemote', '재택근무'], ['visa', 'visaSupport', '비자 지원']]) {
    for (const value of [undefined, null, false, 'false', 'true', 1, []]) {
      assert.equal(matchesJob({ id: 'a', [field]: value }, { [filter]: true }), false);
    }
    assert.equal(matchesJob({ id: 'a', [field]: true }, { [filter]: true }), true);
    assert.equal(matchesJob({ id: 'a', tag }, { [filter]: true }), true);
    assert.equal(matchesJob({ id: 'a', category: tag }, { [filter]: true }), true);
    assert.equal(matchesJob({ id: 'a', [field]: false, tag }, { [filter]: true }), false);
    assert.equal(matchesJob({ id: 'a', tag: `${tag} 불가` }, { [filter]: true }), false);
    assert.equal(matchesJob({ id: 'a', title: tag, body: tag }, { [filter]: true }), false);
  }
  assert.equal(matchesJob({ id: 'korean-text', tag: '정규직', title: '한국 회사 직원 모집' }, { korean: true }), false);
});

test('new jobs require real publication dates within seven days, never future or fetch dates', () => {
  const recent = { recent: true };
  assert.equal(matchesJob({ id: 'native', createdAt: '2026-09-07T12:00:00Z' }, recent), true);
  assert.equal(matchesJob({ id: 'native', createdAt: '2026-09-07T11:59:59Z' }, recent), false);
  for (const createdAt of [undefined, null, '', 'not-a-date', '2026-09-14T12:00:01Z']) {
    assert.equal(matchesJob({ id: 'native', createdAt }, recent), false);
  }
  for (const sourceFields of [{ sourceId: 'source' }, { sourceUrl: 'https://example.com/post' }, { sourceContentId: 'import' }, { sourceSnapshot: true }, { id: 'source-import' }]) {
    const imported = { id: 'import', createdAt: '2026-09-14T11:00:00Z', ...sourceFields };
    assert.equal(matchesJob(imported, recent), false);
    assert.equal(matchesJob({ ...imported, publishedAt: '2026-09-13T12:00:00Z' }, recent), true);
    assert.equal(matchesJob({ ...imported, publishedAt: '2026-01-01T12:00:00Z' }, recent), false);
  }
});

test('community filter labels are exact, with distinct life and information categories', () => {
  assert.deepEqual(COMMUNITY_FILTERS, ['전체', '내국가', '내도시', '질문', '생활', '정보', '후기', '자유']);
  for (const [category, expected] of [['question', '질문'], ['life', '생활'], ['info', '정보'], ['review', '후기'], ['freeboard', '자유']]) {
    assert.equal(communityTopic({ type: 'general', category }), expected);
    assert.equal(communityTopic({ tag: expected }), expected);
    assert.equal(communityTopic({ type: category }), expected);
  }
  assert.equal(communityTopic({ type: 'general' }), '자유');
  for (const post of [{}, { type: 'notice' }, { type: 'general', sourceId: 'source' }, { type: 'general', id: 'source-import' }, { type: 'general', sourceSnapshot: true }, { title: '생활 정보 후기 질문?' }]) {
    assert.equal(communityTopic(post), undefined);
  }
  assert.equal(matchesCommunityFilters({ category: 'life' }, 'all', '정보', chosen, locations), false);
  assert.equal(matchesCommunityFilters({ category: 'info' }, 'all', '생활', chosen, locations), false);
});

test('community location and topic filters combine without losing global posts from all', () => {
  const posts = [
    { id: 'la-life', country: 'USA', city: 'LA', category: '생활' },
    { id: 'la-info', country: 'USA', city: 'LA', category: '정보' },
    { id: 'seattle-life', country: 'USA', city: 'Seattle', category: '생활' },
    { id: 'global-life', category: '생활' },
  ];
  const filter = (scope, topic) => posts.filter((post) => matchesCommunityFilters(post, scope, topic, chosen, locations)).map((post) => post.id);
  assert.deepEqual(filter('city', '생활'), ['la-life']);
  assert.deepEqual(filter('country', '생활'), ['la-life', 'seattle-life']);
  assert.deepEqual(filter('all', '생활'), ['la-life', 'seattle-life', 'global-life']);
  assert.deepEqual(filter('all', null), posts.map((post) => post.id));
});

test('counts and page bounds come from the filtered collection and clamp after removal', () => {
  const jobs = Array.from({ length: 23 }, (_, i) => ({ id: `kept-${i}` }));
  const last = paginateListings(jobs, 3);
  assert.deepEqual([last.total, last.totalPages, last.page, last.from, last.to], [23, 3, 3, 21, 23]);
  assert.deepEqual(last.items, jobs.slice(20));
  const saved = jobs.filter((job) => matchesJob(job, { saved: true }, chosen, ['kept-22']));
  const shrunk = paginateListings(saved, 3);
  assert.deepEqual([shrunk.total, shrunk.totalPages, shrunk.page, shrunk.from, shrunk.to], [1, 1, 1, 1, 1]);
  assert.deepEqual(paginateListings([], 5), { items: [], total: 0, totalPages: 1, page: 1, from: 0, to: 0 });
  assert.equal(paginateListings(jobs, -4).page, 1);
  assert.equal(paginateListings(jobs, NaN).page, 1);
});

test('saved ID parsing preserves existing unloaded IDs and rejects unsafe data instead of resetting it', () => {
  assert.deepEqual(parseSavedJobIds(null), []);
  assert.deepEqual(parseSavedJobIds('["existing","source-import","not-loaded"]'), ['existing', 'source-import', 'not-loaded']);
  assert.deepEqual(parseSavedJobIds('["existing","existing"]'), ['existing', 'existing']);
  for (const raw of ['invalid-json', '{}', 'null', '[1]', '[""]', '[" "]', '["existing",{}]']) {
    assert.throws(() => parseSavedJobIds(raw));
  }
});
