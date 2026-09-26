import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { SourceTextModule, createContext } from 'node:vm';

// Resolve the app's aliases without installing dependencies or contacting any provider.
const sourceRoot = new URL('../../../', import.meta.url);
const calls = { provider: 0, documents: 0, writes: 0 };
globalThis.__searchAssetTestCalls = calls;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/lib/firebaseAdmin') return { url: 'test:firebase-admin', shortCircuit: true };
    if (specifier.startsWith('@/')) return nextResolve(new URL(specifier.slice(2) + '.ts', sourceRoot).href, context);
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + '.ts', context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'test:firebase-admin') return { format: 'module', shortCircuit: true, source: `
      export async function listAdminJsonDocuments() { globalThis.__searchAssetTestCalls.documents++; return []; }
      export async function getAdminJsonDocument() { globalThis.__searchAssetTestCalls.documents++; return null; }
      export async function upsertAdminJsonDocument() { globalThis.__searchAssetTestCalls.writes++; throw new Error('Writes are forbidden in this test'); }
      export async function serviceAccountAccessToken() { throw new Error('Service account access is forbidden in this test'); }
    ` };
    return nextLoad(url, context);
  },
});

const candidates = await import('./route.ts');
const master = await import('../master/search-assets/route.ts');
const exposure = await import('../master/exposure/route.ts');
const documentRoute = await import('../../admin/growth/exposure/assets/route.ts');
const { signOut: portalSignOut } = await import('../../../lib/firebase.ts');
const token = (subject, expires = Math.floor(Date.now() / 1000) + 600) => 'fixture.' + Buffer.from(JSON.stringify({ sub: subject, exp: expires })).toString('base64url') + '.fixture';
const adminToken = token('master'), otherToken = token('other');
globalThis.fetch = async (input, options) => {
  const url = String(input);
  if (url.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:lookup?')) {
    const idToken = JSON.parse(options.body).idToken;
    if (![adminToken, otherToken].includes(idToken)) return Response.json({ error: 'Invalid test token' }, { status: 400 });
    return Response.json({ users: [{ localId: 'fixture-user', email: idToken === adminToken ? 'juyeonglee911029@gmail.com' : 'other@example.test' }] });
  }
  if (url.startsWith('https://www.googleapis.com/webmasters/v3/sites/')) {
    calls.provider++;
    return Response.json({ rows: [] });
  }
  throw new Error('Unexpected network call: ' + url);
};
process.env.GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN = 'offline-test-token';
const request = (path, bearer) => new Request('https://reconstruction.test' + path, { headers: bearer ? { authorization: 'Bearer ' + bearer } : {} });

const referenceDirectory = process.env.GYOPO_CANDIDATE_REFERENCE_DIR;
const reference = (name) => JSON.parse(readFileSync(resolve(referenceDirectory, name), 'utf8'));

test('captured public index matches every asset field, segment order, and summary contract', { skip: !referenceDirectory }, async () => {
  const expected = reference('candidates-0.txt');
  const actual = await candidates.GET(request('/api/keyword-candidates')).json();
  const differences = expected.assets.flatMap((asset, index) => {
    const current = actual.assets[index];
    return isDeepStrictEqual(current, asset) ? [] : [{ index, expected: asset, actual: current }];
  });
  assert.equal(actual.assets.length, expected.assets.length);
  assert.equal(differences.length, 0, JSON.stringify(differences.slice(0, 3)));
  assert.deepEqual(actual.segments, expected.segments);
  assert.deepEqual(actual.summary, { ...expected.summary, verifiedQueryCount: null });
  assert.equal(actual.referenceIndexGeneratedAt, expected.generatedAt);
  assert.ok(Number.isFinite(Date.parse(actual.generatedAt)));
});

test('captured US candidate text and metadata match without treating placeholder metrics as observations', { skip: !referenceDirectory }, async () => {
  const expected = reference('candidates-1.txt');
  const actual = await candidates.GET(request('/api/keyword-candidates?path=/us')).json();
  const normalized = expected.asset.keywordSlots.map((slot) => ({ ...slot, clicks: null, impressions: null, ctr: null, position: null }));
  assert.deepEqual(actual.asset, { ...expected.asset, keywordSlots: normalized });
  assert.equal(actual.source, 'selected_public_snapshot');
});

test('public candidate list is taxonomy-only and reports reconstruction provenance', async () => {
  const payload = await candidates.GET(request('/api/keyword-candidates')).json();
  assert.equal(payload.source, 'reference_aligned_taxonomy');
  assert.equal(payload.assets.length, 1074);
  assert.equal(payload.summary.candidateSlotCount, 85920);
  assert.equal(payload.summary.verifiedQueryCount, null);
  assert.equal(payload.segments.reduce((sum, row) => sum + row.total, 0), payload.assets.length);
  assert.equal(new Set(payload.assets.map((row) => row.targetPath)).size, payload.assets.length);
  assert.equal(calls.provider, 0);
  assert.equal(calls.documents, 0);
  for (const segment of payload.segments) {
    const asset = payload.assets.find((row) => row.sitemapSegment === segment.segment);
    const detail = await candidates.GET(request('/api/keyword-candidates?path=' + encodeURIComponent(asset.targetPath))).json();
    assert.equal(detail.source, asset.targetPath === '/us' ? 'selected_public_snapshot' : 'local_taxonomy_reconstruction');
    assert.equal(detail.asset.keywordSlots.length, 80);
    assert.equal(new Set(detail.asset.keywordSlots.map((slot) => slot.query)).size, 80);
    detail.asset.keywordSlots.forEach((slot, index) => {
      assert.equal(slot.slot, 'K' + String(index + 1).padStart(2, '0'));
      assert.equal(slot.verification, 'CANDIDATE');
      assert.equal(slot.source, 'taxonomy');
      for (const metric of ['clicks', 'impressions', 'ctr', 'position']) assert.equal(slot[metric], null);
    });
    assert.equal(detail.asset.plan, undefined);
  }
});

test('selected labels and UK display codes do not change the fallback generator or private registry', async () => {
  const list = await candidates.GET(request('/api/keyword-candidates')).json();
  const la = list.assets.find((asset) => asset.targetPath === '/us/los-angeles');
  assert.equal(la.primaryIntent, '미국 로스앤젤레스 한인 생활');
  const uk = await candidates.GET(request('/api/keyword-candidates?path=/uk/london')).json();
  assert.equal(uk.source, 'local_taxonomy_reconstruction');
  assert.equal(uk.asset.countryCode, 'UK');
  assert.ok(uk.asset.keywordSlots.some((slot) => slot.query.includes('런던')));
  const { buildSearchAssetRegistry } = await import('../../../lib/master/searchAssets.ts');
  assert.equal(buildSearchAssetRegistry().find((asset) => asset.targetPath === '/uk/london').countryCode, 'GB');
});

test('candidate detail validates internal paths, unknown URLs, and trailing slashes', async () => {
  for (const value of ['', 'https://elsewhere.test/us', '//elsewhere.test/us', '/us?x=1', '/us\\jobs', '/' + 'x'.repeat(401)]) {
    assert.equal(candidates.GET(request('/api/keyword-candidates?path=' + encodeURIComponent(value))).status, 400);
  }
  assert.equal(candidates.GET(request('/api/keyword-candidates?path=/unknown-test-path')).status, 404);
  const payload = await candidates.GET(request('/api/keyword-candidates?path=/us/')).json();
  assert.equal(payload.asset.targetPath, '/us');
});

test('master reads and writes still fail closed for missing, forged, and non-master tokens', async () => {
  const before = { ...calls };
  for (const bearer of [undefined, token('forged'), otherToken]) {
    assert.equal((await master.GET(request('/api/master/search-assets?candidateView=1', bearer))).status, 401);
    assert.equal((await master.GET(request('/api/master/search-assets', bearer))).status, 401);
    assert.equal((await exposure.GET(request('/api/master/exposure?days=90', bearer))).status, 401);
    assert.equal((await master.POST(request('/api/master/search-assets', bearer))).status, 401);
    assert.equal((await exposure.POST(request('/api/master/exposure', bearer))).status, 401);
  }
  assert.deepEqual(calls, before);
});

test('authenticated candidateView returns unknown index status without provider or database access', async () => {
  const before = { ...calls };
  const response = await master.GET(request('/api/master/search-assets?candidateView=1', adminToken));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(payload.source, 'not_checked');
  assert.equal(payload.assets.length, 1074);
  for (const asset of payload.assets) {
    assert.equal(asset.indexStatus, null);
    assert.equal(asset.indexCheckedAt, null);
    assert.equal(asset.indexSource, 'not_checked');
  }
  assert.deepEqual(calls, before);
});

test('existing master list and detail contracts remain available', async () => {
  const payload = await (await master.GET(request('/api/master/search-assets', adminToken))).json();
  assert.equal(payload.source, 'connected');
  assert.equal(payload.summary.targetCount, 1074);
  assert.ok(payload.priorityUrls.includes('/us'));
  const detail = await (await master.GET(request('/api/master/search-assets?path=/us', adminToken))).json();
  assert.equal(detail.asset.keywordSlots.length, 80);
  assert.equal(detail.asset.plan, null);
  assert.equal(calls.provider, 2);
  assert.equal(calls.documents, 2);
  assert.equal(calls.writes, 0);
});

test('standalone route serves one document with no shell, proxy, or write controls', async () => {
  const response = documentRoute.GET();
  const html = await response.text();
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal((html.match(/<html /g) || []).length, 1);
  assert.match(html, /GYOPO URL 키워드 자산/);
  assert.match(html, /@media\(max-width:760px\)/);
  assert.doesNotMatch(html, /aa09|pages\.dev|savePlan|queuePriorityUrls|editorial-candidates|method:\s*['"]POST/);
  assert.doesNotMatch(html, /firebasejs|initializeApp|getAuth|getIdToken|signInWithRedirect|securetoken|refreshToken|localStorage\.(setItem|removeItem)/);
});

const portalSession = (email = 'juyeonglee911029@gmail.com') => ({ idToken: token(email === 'juyeonglee911029@gmail.com' ? 'master' : 'other'), refreshToken: 'unused-fixture-refresh-token', user: { id: email === 'juyeonglee911029@gmail.com' ? 'master' : 'other', email } });

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key), clear: () => values.clear() };
}

async function clientHarness({ storage = memoryStorage(), initialSession } = {}) {
  if (initialSession) storage.setItem('gyopo-auth-session', JSON.stringify(initialSession));
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', value: '', disabled: false, open: false, addEventListener() {}, close() { this.open = false; }, showModal() { this.open = true; } });
    return elements.get(id);
  };
  const network = [];
  const provider = { source: 'not_configured', rows: [], status: 200, pending: null, bodyPending: null, detailPending: null };
  const listeners = new Map(), timers = new Map(), opened = [];
  const clock = { now: Date.now() };
  let timerId = 0;
  const addEventListener = (name, listener) => listeners.set(name, [...(listeners.get(name) || []), listener]);
  const emit = (name, event = {}) => { for (const listener of listeners.get(name) || []) listener(event); };
  const document = { getElementById: element, addEventListener, hidden: false };
  const window = {
    localStorage: storage, addEventListener,
    open: (...args) => { opened.push(args); return null; },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, at: clock.now + delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
  };
  const portal = {
    setSession(session) {
      const oldValue = storage.getItem('gyopo-auth-session'), newValue = JSON.stringify(session);
      storage.setItem('gyopo-auth-session', newValue);
      emit('storage', { key: 'gyopo-auth-session', oldValue, newValue, storageArea: storage });
    },
    logout({ notify = true, sameWindow = false } = {}) {
      const oldValue = storage.getItem('gyopo-auth-session'), previousWindow = globalThis.window, previousStorageEvent = globalThis.StorageEvent;
      globalThis.StorageEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
      globalThis.window = { localStorage: storage, dispatchEvent(event) { if (sameWindow) emit(event.type, event); return true; } };
      try { portalSignOut(); }
      finally {
        if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
        if (previousStorageEvent === undefined) delete globalThis.StorageEvent; else globalThis.StorageEvent = previousStorageEvent;
      }
      // Browsers deliver this event to the other tab, not to the portal tab itself.
      if (notify && !sameWindow) emit('storage', { key: 'gyopo-auth-session', oldValue, newValue: null, storageArea: storage });
    },
  };
  const context = createContext({
    document, window, location: { origin: 'https://reconstruction.test' }, AbortController, URL, atob,
    Date: class extends Date { static now() { return clock.now; } },
    fetch: async (path, options) => {
      network.push({ path, options });
      if (path.startsWith('/api/keyword-candidates')) {
        if (path.includes('?path=') && provider.detailPending) await provider.detailPending;
        return candidates.GET(request(path));
      }
      if (path.startsWith('/api/master/search-assets')) return Response.json({ assets: [{ targetPath: '/us', indexStatus: null }], sourceMessage: 'Index not inspected' });
      if (path.startsWith('/api/master/exposure')) {
        if (provider.pending) await provider.pending;
        return { ok: provider.status === 200, json: async () => {
          if (provider.bodyPending) await provider.bodyPending;
          return { sources: { searchConsole: provider.source }, rows: provider.rows, error: provider.status === 200 ? undefined : 'Provider failed' };
        } };
      }
      throw new Error('Unexpected client request');
    },
  });
  const html = await documentRoute.GET().text();
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const clientModule = new SourceTextModule(script + '\nexport {state, loadLive, openAsset, groupQueries};', {
    context,
    importModuleDynamically: (specifier) => {
      throw new Error('Unexpected SDK or external module: ' + specifier);
    },
  });
  await clientModule.link(() => {}); await clientModule.evaluate();
  await new Promise(setImmediate);
  return { ...clientModule.namespace, element, portal, storage, network, provider, emit, opened, document, advanceClock(ms) {
    clock.now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= clock.now) { timers.delete(id); timer.callback(); }
  } };
}

test('candidate browsing and auth do not automatically query Google or claim verification', async () => {
  const client = await clientHarness();
  assert.equal(client.state.data.assets.length, 1074);
  assert.equal(client.element('verified').textContent, '-');
  assert.equal(client.element('unverified').textContent, '1,074');
  assert.match(client.element('provenance').textContent, /\/us 후보만 캡처 원본/);
  assert.match(client.element('provenance').textContent, /2026-09-26T03:09:28.215Z/);
  await client.openAsset('/us');
  assert.equal(client.element('modal').open, true);
  assert.match(client.element('modal').innerHTML, /CANDIDATE/);
  assert.match(client.element('modal').innerHTML, /캡처한 \/us 후보 80개/);
  assert.match(client.element('modal').innerHTML, /미국 한인 업체 찾기 후기/);
  assert.doesNotMatch(client.element('modal').innerHTML, /VERIFIED_GSC/);
  await client.openAsset('/us/jobs');
  assert.match(client.element('modal').innerHTML, /원본 상세와 대조되지 않았습니다/);
  client.portal.setSession(portalSession('other@example.test')); await client.loadLive();
  const session = portalSession(); client.portal.setSession(session);
  assert.ok(client.network.every(({ path }) => path.startsWith('/api/keyword-candidates')));
  await client.loadLive();
  assert.equal(client.state.source, 'not_configured');
  assert.equal(client.element('verified').textContent, '-');
  assert.match(client.element('message').textContent, /미설정/);
  assert.ok(client.network.filter(({ path }) => path.startsWith('/api/master/')).every(({ options }) => options.headers.authorization === 'Bearer ' + session.idToken));
});

test('GSC mapping deduplicates real rows and keeps failures distinct from connected zero', async () => {
  const client = await clientHarness();
  client.portal.setSession(portalSession());
  client.provider.source = 'connected';
  client.provider.rows = [
    { page: 'https://gyopo.kr/us/', query: '<test query>', clicks: 1, impressions: 10, position: 2 },
    { page: 'https://www.gyopo.kr/us', query: '<TEST QUERY>', clicks: 2, impressions: 20, position: 5 },
    { page: 'https://elsewhere.test/us', query: 'not our site', clicks: 9, impressions: 90, position: 1 },
  ];
  await client.loadLive();
  const [row] = client.state.queries.get('/us');
  assert.equal(row.clicks, 3); assert.equal(row.impressions, 30); assert.equal(row.position, 4);
  assert.equal(client.element('verified').textContent, '1');
  await client.openAsset('/us');
  assert.match(client.element('modal').innerHTML, /&lt;test query&gt;/);
  assert.doesNotMatch(client.element('modal').innerHTML, /<test query>/);
  client.provider.rows = []; await client.loadLive();
  assert.equal(client.element('verified').textContent, '0');
  client.provider.status = 503; await client.loadLive();
  assert.equal(client.state.source, 'error');
  assert.equal(client.element('verified').textContent, '-');
});

test('auth changes clear private rows and ignore late responses from the old session', async () => {
  const client = await clientHarness();
  client.portal.setSession(portalSession());
  let finish;
  client.provider.pending = new Promise((resolve) => { finish = resolve; });
  client.provider.source = 'connected';
  client.provider.rows = [{ page: 'https://gyopo.kr/us', query: 'private query', impressions: 1, clicks: 1, position: 1 }];
  const pending = client.loadLive();
  await new Promise(setImmediate);
  client.portal.logout();
  assert.ok(client.network.filter(({ path }) => path.startsWith('/api/master/')).every(({ options }) => options.signal.aborted));
  finish(); await pending;
  assert.equal(client.state.queries.size, 0);
  assert.equal(client.state.live.size, 0);
  assert.equal(client.state.source, 'not_checked');
  assert.equal(client.element('verified').textContent, '-');
  assert.equal(client.element('modal').open, false);
});

function assertGuest(client) {
  assert.equal(client.state.user, null);
  assert.equal(client.state.sessionToken, '');
  assert.equal(client.state.queries.size, 0);
  assert.equal(client.state.live.size, 0);
  assert.equal(client.state.source, 'not_checked');
  assert.equal(client.element('verified').textContent, '-');
  assert.equal(client.element('modal').innerHTML, '');
  assert.equal(client.element('modal').open, false);
  assert.equal(client.element('login').textContent, '포털 Google 로그인');
}

test('login delegates to the existing portal flow without creating an SDK session', async () => {
  const client = await clientHarness();
  client.element('login').onclick();
  assert.deepEqual(client.opened, [['/login', '_blank', 'noopener,noreferrer']]);
  assert.equal(client.storage.getItem('gyopo-auth-session'), null);
  assert.ok(client.network.every(({ path }) => path.startsWith('/api/keyword-candidates')));
  client.portal.setSession(portalSession());
  assert.equal(client.state.user.email, 'juyeonglee911029@gmail.com');
  assert.ok(client.network.every(({ path }) => path.startsWith('/api/keyword-candidates')));
});

test('real portal logout clears displayed private data and reopening ignores legacy SDK persistence', async () => {
  const client = await clientHarness({ initialSession: portalSession() });
  const legacyKey = 'firebase:authUser:old-api-key:[DEFAULT]';
  client.storage.setItem(legacyKey, JSON.stringify({ email: 'juyeonglee911029@gmail.com', stsTokenManager: { accessToken: adminToken } }));
  client.provider.source = 'connected';
  client.provider.rows = [{ page: 'https://gyopo.kr/us', query: 'private-before-logout', impressions: 1, clicks: 1, position: 1 }];
  await client.loadLive(); await client.openAsset('/us');
  assert.match(client.element('modal').innerHTML, /private-before-logout/);
  client.portal.logout();
  assertGuest(client);
  assert.equal(client.storage.getItem('gyopo-auth-session'), null);
  assert.equal(client.state.data.assets.length, 1074);
  assert.doesNotMatch(client.element('rows').innerHTML, /GSC URL 매핑/);
  const reopened = await clientHarness({ storage: client.storage });
  assertGuest(reopened);
  await reopened.loadLive();
  assert.ok(reopened.network.every(({ path }) => path.startsWith('/api/keyword-candidates')));
});

test('same-window portal logout clears the document via its existing storage listener', async () => {
  const client = await clientHarness({ initialSession: portalSession() });
  client.provider.source = 'connected';
  client.provider.rows = [{ page: 'https://gyopo.kr/us', query: 'same-window-private-query', impressions: 1, clicks: 1, position: 1 }];
  await client.loadLive(); await client.openAsset('/us');
  assert.match(client.element('modal').innerHTML, /same-window-private-query/);
  client.portal.logout({ sameWindow: true, notify: false });
  assertGuest(client);
});

test('logout is rechecked after both response and JSON awaits even before its storage event arrives', async () => {
  for (const phase of ['pending', 'bodyPending']) {
    const client = await clientHarness({ initialSession: portalSession() });
    let finish;
    client.provider[phase] = new Promise((resolve) => { finish = resolve; });
    client.provider.source = 'connected';
    client.provider.rows = [{ page: 'https://gyopo.kr/us', query: 'late-private-result', impressions: 1, clicks: 1, position: 1 }];
    const pending = client.loadLive();
    await new Promise(setImmediate);
    client.portal.logout({ notify: false });
    finish(); await pending;
    assertGuest(client);
    assert.ok(client.network.filter(({ path }) => path.startsWith('/api/master/')).every(({ options }) => options.signal.aborted));
    assert.equal(client.storage.getItem('gyopo-auth-session'), null);
  }
});

test('logout invalidates a pending detail render containing private query annotations', async () => {
  const client = await clientHarness({ initialSession: portalSession() });
  client.provider.source = 'connected';
  client.provider.rows = [{ page: 'https://gyopo.kr/us', query: 'private-detail-query', impressions: 1, clicks: 1, position: 1 }];
  await client.loadLive();
  let finish;
  client.provider.detailPending = new Promise((resolve) => { finish = resolve; });
  const pending = client.openAsset('/us');
  client.portal.logout({ notify: false });
  finish(); await pending;
  assertGuest(client);
});

test('leaving the document scrubs private state and BFCache restore rechecks portal logout', async () => {
  const client = await clientHarness({ initialSession: portalSession() });
  client.provider.source = 'connected';
  client.provider.rows = [{ page: 'https://gyopo.kr/us', query: 'cached-private-query', impressions: 1, clicks: 1, position: 1 }];
  await client.loadLive(); await client.openAsset('/us');
  client.emit('pagehide', { persisted: true });
  assertGuest(client);
  client.portal.logout({ notify: false });
  client.emit('pageshow', { persisted: true });
  assertGuest(client);
  const before = client.network.length;
  await client.loadLive();
  assert.equal(client.network.length, before);
});

test('focus and visibility recovery honor logout when cross-tab events were missed', async () => {
  for (const event of ['focus', 'visibilitychange']) {
    const client = await clientHarness({ initialSession: portalSession() });
    client.portal.logout({ notify: false });
    client.emit(event);
    assertGuest(client);
  }
});

test('expired, malformed, mismatched and unavailable portal sessions fail closed', async () => {
  const expired = { ...portalSession(), idToken: token('master', Math.floor(Date.now() / 1000) - 1) };
  const mismatched = { ...portalSession(), idToken: token('other') };
  for (const raw of ['{', JSON.stringify(expired), JSON.stringify(mismatched), JSON.stringify({ ...portalSession(), idToken: 'not-a-token' })]) {
    const storage = memoryStorage(); storage.setItem('gyopo-auth-session', raw);
    const client = await clientHarness({ storage });
    assertGuest(client); await client.loadLive();
    assert.ok(client.network.every(({ path }) => path.startsWith('/api/keyword-candidates')));
  }
  const client = await clientHarness({ storage: { getItem() { throw new Error('Storage blocked'); } } });
  assertGuest(client);
});

test('token expiry clears private data and aborts outstanding work without refreshing credentials', async () => {
  const client = await clientHarness({ initialSession: portalSession() });
  let finish;
  client.provider.pending = new Promise((resolve) => { finish = resolve; });
  const pending = client.loadLive();
  client.advanceClock(601000);
  assertGuest(client);
  assert.ok(client.network.filter(({ path }) => path.startsWith('/api/master/')).every(({ options }) => options.signal.aborted));
  finish(); await pending;
  assertGuest(client);
  assert.ok(client.network.every(({ path }) => path.startsWith('/api/')));
});

test('account switching cancels an older master request instead of leaking into the new session', async () => {
  const client = await clientHarness({ initialSession: portalSession() });
  let finish;
  client.provider.pending = new Promise((resolve) => { finish = resolve; });
  client.provider.source = 'connected';
  client.provider.rows = [{ page: 'https://gyopo.kr/us', query: 'old-master-result', impressions: 1, clicks: 1, position: 1 }];
  const pending = client.loadLive();
  client.portal.setSession(portalSession('other@example.test'));
  finish(); await pending;
  assert.equal(client.state.user.email, 'other@example.test');
  assert.equal(client.state.queries.size, 0);
  assert.equal(client.element('verified').textContent, '-');
  assert.ok(client.network.filter(({ path }) => path.startsWith('/api/master/')).every(({ options }) => options.signal.aborted));
});
