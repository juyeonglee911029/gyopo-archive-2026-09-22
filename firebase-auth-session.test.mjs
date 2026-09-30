import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { SourceTextModule, createContext } from 'node:vm';

const source = stripTypeScriptTypes(readFileSync(new URL('./src/lib/firebase.ts', import.meta.url), 'utf8'));
const profilePhotosSource = stripTypeScriptTypes(readFileSync(new URL('./src/lib/profilePhotos.ts', import.meta.url), 'utf8'));
const friendMatchingSource = stripTypeScriptTypes(readFileSync(new URL('./src/lib/friendMatching.ts', import.meta.url), 'utf8'));
const key = 'gyopo-auth-session';
const jwt = (id, version, valid = true) => 'fixture.' + Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + (valid ? 3600 : -60), version })).toString('base64url') + '.fixture';
const session = (id = 'a', version = 'original', valid = false) => ({ idToken: jwt(id, version, valid), refreshToken: `refresh-${id}-${version}`, user: { id, email: `${id}@example.test`, name: `User ${id}`, isSubscribed: false } });
const refreshBody = (id = 'a', version = 'refreshed') => ({ id_token: jwt(id, version), refresh_token: `refresh-${id}-${version}` });
const profileBody = (id = 'a', name = 'Fetched profile') => ({ name: `projects/test/databases/(default)/documents/profiles/${id}`, fields: { name: { stringValue: name } } });
const tick = () => new Promise(setImmediate);
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function harness(initial = session(), fetchHandler) {
  const values = new Map([[key, JSON.stringify(initial)]]), requests = [], events = [];
  const storage = { getItem: (name) => values.get(name) ?? null, setItem: (name, value) => values.set(name, value), removeItem: (name) => values.delete(name) };
  const defaultFetch = (url, options = {}) => {
    assert.match(String(url), /^https:\/\/(securetoken|firestore)\.googleapis\.com\//);
    if (String(url).includes('/profiles/')) assert.match(String(url), /\/profiles\/[ab]$/);
    const pending = deferred();
    requests.push({ url: String(url), options, ...pending });
    return pending.promise;
  };
  const context = createContext({
    atob, URLSearchParams, AbortSignal,
    StorageEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    window: { localStorage: storage, location: { origin: 'https://reconstruction.test' }, dispatchEvent(event) {
      assert.equal(storage.getItem(key), null, 'Logout notification must follow removal');
      events.push(event); return true;
    } },
    fetch: fetchHandler ? (url, options = {}) => fetchHandler(String(url), options) : defaultFetch,
  });
  const sourceModule = new SourceTextModule(source, { context });
  await sourceModule.link((specifier) => {
    if (specifier === './profilePhotos') return new SourceTextModule(profilePhotosSource, { context });
    if (specifier === '@/lib/friendMatching') return new SourceTextModule(friendMatchingSource, { context });
    throw new Error(`Unexpected source import: ${specifier}`);
  });
  await sourceModule.evaluate();
  return { api: sourceModule.namespace, requests, events, storage,
    read: () => JSON.parse(storage.getItem(key) || 'null'),
    replace: (value) => storage.setItem(key, JSON.stringify(value)),
  };
}

test('valid tokens do not refresh; concurrent refreshes of one login share a request', async () => {
  const h = await harness(session('a', 'valid', true));
  assert.equal(await h.api.getFreshSessionToken(), h.read().idToken);
  assert.equal(h.requests.length, 0);
  const first = h.api.getFreshSessionToken(true), second = h.api.getFreshSessionToken(true);
  assert.equal(h.requests.length, 1);
  const updated = h.read(); updated.user.name = 'Edited while refreshing'; h.replace(updated);
  const result = refreshBody(); h.requests[0].resolve(Response.json(result));
  assert.deepEqual(await Promise.all([first, second]), [result.id_token, result.id_token]);
  assert.equal(h.read().idToken, result.id_token);
  assert.equal(h.read().refreshToken, result.refresh_token);
  assert.equal(h.read().user.name, 'Edited while refreshing');
});

test('logout during either refresh await cannot recreate the session or return a token', async () => {
  for (const phase of ['response', 'body']) {
    const h = await harness();
    const pending = h.api.getFreshSessionToken();
    let body;
    if (phase === 'body') {
      body = deferred();
      h.requests[0].resolve({ ok: true, json: () => body.promise });
      await tick();
    }
    h.api.signOut();
    if (body) body.resolve(refreshBody()); else h.requests[0].resolve(Response.json(refreshBody()));
    assert.equal(await pending, undefined);
    assert.equal(h.read(), null);
    assert.equal(h.events.length, 1);
  }
});

test('logout also invalidates old work when identical credentials are subsequently restored', async () => {
  const original = session(), h = await harness(original);
  const old = h.api.getFreshSessionToken();
  h.api.signOut(); h.replace(original);
  const current = h.api.getFreshSessionToken();
  assert.equal(h.requests.length, 2);
  h.requests[0].resolve(Response.json(refreshBody('a', 'old-result')));
  assert.equal(await old, undefined);
  const valid = refreshBody('a', 'current-result'); h.requests[1].resolve(Response.json(valid));
  assert.equal(await current, valid.id_token);
  assert.equal(h.read().idToken, valid.id_token);
});

test('a new account never joins an old login refresh, regardless of completion order', async () => {
  for (const firstToFinish of ['old', 'new']) {
    const h = await harness();
    const old = h.api.getFreshSessionToken();
    h.replace(session('b'));
    const current = h.api.getFreshSessionToken();
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[1].options.body.get('refresh_token'), 'refresh-b-original');
    const next = refreshBody('b');
    if (firstToFinish === 'old') {
      h.requests[0].resolve(Response.json(refreshBody('a')));
      assert.equal(await old, undefined);
      const joined = h.api.getFreshSessionToken();
      assert.equal(h.requests.length, 2, 'Old cleanup must not erase the new in-flight request');
      h.requests[1].resolve(Response.json(next));
      assert.equal(await joined, next.id_token);
    } else {
      h.requests[1].resolve(Response.json(next));
      assert.equal(await current, next.id_token);
      h.requests[0].resolve(Response.json(refreshBody('a')));
    }
    assert.equal(await old, undefined);
    assert.equal(await current, next.id_token);
    assert.equal(h.read().user.id, 'b');
    assert.equal(h.read().idToken, next.id_token);
    assert.equal(h.events.length, 0);
  }
});

test('replacement of either credential for the same user invalidates an old refresh', async () => {
  for (const field of ['idToken', 'refreshToken']) {
    const h = await harness();
    const pending = h.api.getFreshSessionToken();
    const replacement = h.read(); replacement[field] = session('a', 'new-login', true)[field]; h.replace(replacement);
    h.requests[0].resolve(Response.json(refreshBody()));
    assert.equal(await pending, undefined);
    assert.deepEqual(h.read(), replacement);
  }
});

test('credential ownership is checked again after the shared refresh promise resolves', async () => {
  const h = await harness(), result = refreshBody();
  const replacement = { ...session('a', 'replacement'), idToken: result.id_token };
  const setItem = h.storage.setItem;
  h.storage.setItem = (name, value) => {
    setItem(name, value);
    if (name === key && JSON.parse(value).idToken === result.id_token) setItem(key, JSON.stringify(replacement));
  };
  const pending = h.api.getFreshSessionToken();
  h.requests[0].resolve(Response.json(result));
  assert.equal(await pending, undefined);
  assert.deepEqual(h.read(), replacement);
});

test('failure of an old user refresh leaves the new account concurrent refresh intact', async () => {
  const h = await harness();
  const oldUser = h.api.refreshStoredUser();
  h.replace(session('b'));
  const current = h.api.getFreshSessionToken();
  h.requests[0].resolve(new Response('', { status: 401 }));
  assert.equal(await oldUser, null);
  const joined = h.api.getFreshSessionToken();
  assert.equal(h.requests.length, 2);
  assert.equal(h.events.length, 0);
  const refreshed = refreshBody('b'); h.requests[1].resolve(Response.json(refreshed));
  assert.equal(await current, refreshed.id_token);
  assert.equal(await joined, refreshed.id_token);
  assert.equal(h.read().user.id, 'b');
});

test('a failed old refresh cannot sign out a replacement account or a same-user replacement login', async () => {
  for (const id of ['a', 'b']) {
    const h = await harness();
    const pending = h.api.refreshStoredUser();
    const replacement = session(id, 'new-login', true); h.replace(replacement);
    h.requests[0].resolve(new Response('', { status: 401 }));
    assert.equal(await pending, null);
    assert.deepEqual(h.read(), replacement);
    assert.equal(h.events.length, 0);
  }
});

test('failed refresh signs out only the unchanged original login', async () => {
  const h = await harness();
  const pending = h.api.refreshStoredUser();
  h.requests[0].reject(new Error('Offline mock'));
  assert.equal(await pending, null);
  assert.equal(h.read(), null);
  assert.equal(h.events.length, 1);
});

test('logout during user token refresh does not initiate a profile fetch or repeat logout', async () => {
  const h = await harness();
  const pending = h.api.refreshStoredUser();
  h.api.signOut(); h.requests[0].resolve(Response.json(refreshBody()));
  assert.equal(await pending, null);
  assert.equal(h.requests.length, 1);
  assert.equal(h.read(), null);
  assert.equal(h.events.length, 1);
});

test('logout or account replacement during profile lookup never restores or returns the old user', async () => {
  for (const change of ['logout', 'switch', 'same-user-new-login']) {
    for (const response of ['profile', 'missing', 'failure', 'delayed-body']) {
      const h = await harness(session('a', 'valid', true));
      const pending = h.api.refreshStoredUser(); await tick();
      assert.match(h.requests[0].url, /\/profiles\/a$/);
      let body;
      if (response === 'delayed-body') {
        body = deferred(); h.requests[0].resolve({ ok: true, status: 200, json: () => body.promise }); await tick();
      }
      const replacement = session(change === 'switch' ? 'b' : 'a', 'replacement', true);
      if (change === 'logout') h.api.signOut(); else h.replace(replacement);
      if (body) body.resolve(profileBody());
      else if (response === 'missing') h.requests[0].resolve(new Response('', { status: 404 }));
      else if (response === 'failure') h.requests[0].reject(new Error('Mock profile failure'));
      else h.requests[0].resolve(Response.json(profileBody()));
      assert.equal(await pending, null);
      assert.deepEqual(h.read(), change === 'logout' ? null : replacement);
      assert.equal(h.events.length, change === 'logout' ? 1 : 0);
    }
  }
});

test('normal token refresh followed by profile hydration retains refreshed credentials', async () => {
  const h = await harness();
  const pending = h.api.refreshStoredUser();
  const refreshed = refreshBody(); h.requests[0].resolve(Response.json(refreshed)); await tick();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].options.headers.Authorization, 'Bearer ' + refreshed.id_token);
  h.requests[1].resolve(Response.json(profileBody()));
  const user = await pending;
  assert.equal(user.id, 'a'); assert.equal(user.name, 'Fetched profile');
  assert.equal(h.read().user.name, 'Fetched profile');
  assert.equal(h.read().idToken, refreshed.id_token);
  assert.equal(h.read().refreshToken, refreshed.refresh_token);
  assert.equal(h.events.length, 0);
});

test('unchanged login retains its cached profile when the profile document is missing', async () => {
  const original = session('a', 'valid', true), h = await harness(original);
  const pending = h.api.refreshStoredUser(); await tick();
  h.requests[0].resolve(new Response('', { status: 404 }));
  const user = await pending;
  assert.equal(user.id, original.user.id); assert.equal(user.name, original.user.name);
  assert.deepEqual(h.read(), original);
});

test('a 401 retry shares the guarded refresh with getFreshSessionToken for the same login', async () => {
  const original = session('a', 'valid', true), h = await harness(original);
  const pending = h.api.getDocument('profiles', 'a', original.idToken);
  h.requests[0].resolve(new Response('Expired token', { status: 401 })); await tick();
  assert.equal(h.requests.length, 2);
  const joined = h.api.getFreshSessionToken(true);
  assert.equal(h.requests.length, 2);
  const refreshed = refreshBody(); h.requests[1].resolve(Response.json(refreshed)); await tick();
  assert.equal(await joined, refreshed.id_token);
  assert.equal(h.requests.length, 3);
  assert.equal(h.requests[2].options.headers.Authorization, 'Bearer ' + refreshed.id_token);
  h.requests[2].resolve(Response.json(profileBody()));
  assert.equal((await pending).name, 'Fetched profile');
});

test('a late 401 never refreshes or retries an old request as the replacement account', async () => {
  const original = session('a', 'valid', true), h = await harness(original);
  const pending = h.api.getDocument('profiles', 'a', original.idToken).catch((error) => error);
  const replacement = session('b'); h.replace(replacement);
  h.requests[0].resolve(new Response('Old request denied', { status: 401 }));
  assert.equal((await pending).message, 'Old request denied');
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.read(), replacement);
});

test('logout or switch during a 401 refresh prevents retry with any old or new token', async () => {
  for (const change of ['logout', 'switch']) {
    const original = session('a', 'valid', true), h = await harness(original);
    const pending = h.api.getDocument('profiles', 'a', original.idToken).catch((error) => error);
    h.requests[0].resolve(new Response('Old request denied', { status: 401 })); await tick();
    if (change === 'logout') h.api.signOut(); else h.replace(session('b'));
    h.requests[1].resolve(Response.json(refreshBody()));
    assert.equal((await pending).message, 'Old request denied');
    assert.equal(h.requests.length, 2);
    assert.equal(h.read()?.user.id ?? null, change === 'logout' ? null : 'b');
  }
});

test('a token response for another user is rejected without changing the current session', async () => {
  const original = session(), h = await harness(original);
  const pending = h.api.getFreshSessionToken();
  h.requests[0].resolve(Response.json(refreshBody('b')));
  assert.equal(await pending, undefined);
  assert.deepEqual(h.read(), original);
});

test('logout notifies existing same-window session listeners after removing only the auth key', async () => {
  const h = await harness(); h.storage.setItem('portal-theme', 'dark');
  h.api.signOut();
  assert.equal(h.read(), null);
  assert.equal(h.storage.getItem('portal-theme'), 'dark');
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].type, 'storage');
  assert.equal(h.events[0].key, key);
  assert.equal(h.events[0].newValue, null);
  assert.equal(h.events[0].storageArea, h.storage);
});

test('Google sign-in keeps a saved AI writing preference when it rewrites the profile', async () => {
  const preference = 'Keep drafts concise';
  let profileWrite;
  const profileDocument = {
    name: 'projects/test/databases/(default)/documents/profiles/a',
    updateTime: '2026-01-01T00:00:00.000000Z',
    fields: {
      name: { stringValue: 'Saved Name' },
      email: { stringValue: 'a@example.test' },
      defaultAiWritingPrompt: { stringValue: preference },
    },
  };
  const h = await harness(session(), async (url, options) => {
    if (url.includes('/accounts:signInWithIdp?')) {
      return Response.json({ localId: 'a', email: 'a@example.test', idToken: 'signed-in-token', refreshToken: 'signed-in-refresh' });
    }
    if (url.endsWith('/documents/profiles/a') && !options.method) return Response.json(profileDocument);
    if (url.includes('/documents/profiles?documentId=a') && options.method === 'POST') {
      profileWrite = JSON.parse(options.body);
      return new Response('{}', { status: 200 });
    }
    throw new Error(`Unexpected sign-in request: ${url}`);
  });

  const user = await h.api.signInWithGoogleCredential('google-credential');
  assert.equal(user.defaultAiWritingPrompt, preference);
  assert.equal(profileWrite.fields.defaultAiWritingPrompt.stringValue, preference);
});

test('Google sign-in does not rewrite a profile when its read fails', async () => {
  let profileWrites = 0;
  const h = await harness(session(), async (url, options) => {
    if (url.includes('/accounts:signInWithIdp?')) {
      return Response.json({ localId: 'a', email: 'a@example.test', idToken: 'signed-in-token', refreshToken: 'signed-in-refresh' });
    }
    if (url.endsWith('/documents/profiles/a') && !options.method) return new Response('Offline', { status: 503 });
    if (url.includes('/documents/profiles?documentId=a') && options.method === 'POST') {
      profileWrites++;
      return new Response('{}', { status: 200 });
    }
    throw new Error(`Unexpected sign-in request: ${url}`);
  });

  const user = await h.api.signInWithGoogleCredential('google-credential');
  assert.equal(user.id, 'a');
  assert.equal(profileWrites, 0);
});

test('saveProfile keeps a saved AI writing preference when the user object is stale', async () => {
  const preference = 'Keep drafts concise';
  let profileWrite;
  const profileDocument = {
    name: 'projects/test/databases/(default)/documents/profiles/a',
    fields: {
      name: { stringValue: 'Saved Name' },
      email: { stringValue: 'a@example.test' },
      defaultAiWritingPrompt: { stringValue: preference },
      gender: { stringValue: 'female' },
      age: { integerValue: '34' },
      country: { stringValue: 'US' },
      usdtBalance: { integerValue: '0' },
      usdBalance: { integerValue: '0' },
      isSubscribed: { booleanValue: false },
    },
  };
  const publicProfileDocument = {
    name: 'projects/test/databases/(default)/documents/publicProfiles/a',
    updateTime: '2026-01-01T00:00:00.000000Z',
    fields: { name: { stringValue: 'Saved Name' }, image: { stringValue: '' }, gender: { stringValue: 'female' }, country: { stringValue: 'US' }, age: { integerValue: '34' }, isSubscribed: { booleanValue: false }, isPublic: { booleanValue: true } },
  };
  const h = await harness(session(), async (url, options) => {
    if (url.endsWith('/documents/profiles/a') && !options.method) return Response.json(profileDocument);
    if (url.endsWith('/documents/publicProfiles/a') && !options.method) return Response.json(publicProfileDocument);
    if (url.includes('/documents/profiles?documentId=a') && options.method === 'POST') return new Response('Already exists', { status: 409 });
    if (url.endsWith('/documents:commit') && options.method === 'POST') {
      const write = JSON.parse(options.body).writes[0];
      if (write.update.name.endsWith('/documents/profiles/a')) profileWrite = write;
      return new Response('{}', { status: 200 });
    }
    throw new Error(`Unexpected profile request: ${url}`);
  });

  await h.api.saveProfile({ ...session().user, gender: 'female', age: 34, country: 'US' }, 'test-token');
  assert.equal(profileWrite.update.fields.defaultAiWritingPrompt.stringValue, preference);
  assert.equal(h.read().user.defaultAiWritingPrompt, preference);
});

test('free Tetris countdown starts without stake flags, but paid rooms still require both holds', async () => {
  const documentName = (id) => `projects/gyopo-live-portal-506019/databases/(default)/documents/tetrisRooms/${id}`;
  const roomDocument = (id, betAmount, extraFields = {}) => ({
    name: documentName(id),
    updateTime: 'update-1',
    fields: {
      phase: { stringValue: 'holding' },
      readyA: { booleanValue: true },
      readyB: { booleanValue: true },
      betAmount: { integerValue: String(betAmount) },
      ...extraFields,
    },
  });

  const free = await harness();
  const freeStart = free.api.startTetrisCountdown('free-room', 'test-token');
  await tick();
  free.requests[0].resolve(Response.json(roomDocument('free-room', 0)));
  await tick();
  assert.equal(free.requests.length, 2);
  const freeWrite = JSON.parse(free.requests[1].options.body).writes[0];
  assert.equal(freeWrite.update.fields.phase.stringValue, 'countdown');
  assert.equal(freeWrite.update.fields.stakeHeldA, undefined);
  assert.equal(freeWrite.update.fields.stakeHeldB, undefined);
  free.requests[1].resolve(new Response(null, { status: 200 }));
  assert.ok(Number.isFinite(Date.parse(await freeStart)));

  const paid = await harness();
  const paidStart = paid.api.startTetrisCountdown('paid-room', 'test-token');
  await tick();
  paid.requests[0].resolve(Response.json(roomDocument('paid-room', 5)));
  assert.equal(await paidStart, null);
  assert.equal(paid.requests.length, 1);
});
