import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

const source = stripTypeScriptTypes(readFileSync(new URL('./route.ts', import.meta.url), 'utf8'));
const bucket = 'gyopo-live-portal-506019.firebasestorage.app';
const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
const photo = (uid, index) => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(`profiles/${uid}/gallery/00000000-0000-4000-8000-${String(index).padStart(12, '0')}.jpg`)}?alt=media&token=abcdef0123456789`;
const field = (value) => typeof value === 'string' ? { stringValue: value }
  : typeof value === 'number' ? { integerValue: String(value) }
    : typeof value === 'boolean' ? { booleanValue: value }
      : { arrayValue: { values: value.map(field) } };
const decode = (value) => value?.stringValue ?? value?.booleanValue ?? (value?.integerValue === undefined ? value?.arrayValue?.values?.map(decode) : Number(value.integerValue));

async function harness() {
  const state = { user: { uid: 'alice' }, authError: null, lastAuthorization: '', documents: new Map(), transactions: [], failCommit: false };
  const put = (collection, id, data) => state.documents.set(`${collection}/${id}`, {
    updateTime: new Date().toISOString(), fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, field(value)])),
  });
  const gallery = (uid, count = 3, age = 30) => {
    const photos = Array.from({ length: count }, (_, index) => photo(uid, index + 1));
    put('profiles', uid, { age, profilePhotos: photos });
    put('publicProfiles', uid, { age, isPublic: true, profilePhotos: photos });
    put('verifiedProfilePhotos', uid, { profilePhotos: photos });
  };
  gallery('alice');
  gallery('bob');
  const context = createContext({ Request, Response, URL, TextDecoder, TextEncoder });
  const mock = (exports) => new SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context });
  const modules = {
    '@/lib/apiSecurity': mock({
      authenticateRequest: async (request) => {
        state.lastAuthorization = request.headers.get('authorization') || '';
        if (state.authError) throw state.authError;
        return state.user;
      },
      consumeRateLimit: () => ({ allowed: true }),
      rateLimitResponse: () => Response.json({ error: 'rate limited' }, { status: 429 }),
      unauthorizedResponse: (error) => Response.json({ error: 'unauthorized' }, { status: error?.status || 401 }),
    }),
    '@/lib/firebaseAdmin': mock({
      adminDocumentName: (projectId, collection, id) => `projects/${projectId}/databases/(default)/documents/${collection}/${id}`,
      decodeFirestoreValue: decode,
      firestoreValue: field,
      runFirestoreTransaction: async (documents, plan) => {
        assert.ok(documents.every(({ id }) => /^[A-Za-z0-9_-]{1,128}$/.test(id)));
        const snapshot = new Map(documents.map(({ collection, id }) => [`${collection}/${id}`, state.documents.get(`${collection}/${id}`) || null]));
        const { writes, result } = plan({ projectId: 'demo', get: ({ collection, id }) => snapshot.get(`${collection}/${id}`) || null });
        if (state.failCommit) throw new Error('Failed commit');
        state.transactions.push({ documents, writes });
        for (const write of writes) {
          const [, collection, id] = write.update.name.match(/\/documents\/([^/]+)\/([^/]+)$/) || [];
          assert.ok(collection && id, 'write uses a Firestore document resource name');
          const key = `${collection}/${id}`;
          const existing = state.documents.get(key);
          if (write.currentDocument?.exists === false) assert.equal(existing, undefined, 'create must not overwrite');
          if (write.currentDocument?.updateTime) assert.equal(existing?.updateTime, write.currentDocument.updateTime, 'update is conditional');
          state.documents.set(key, { updateTime: new Date().toISOString(), fields: write.update.fields });
        }
        return result;
      },
    }),
    '@/lib/profilePhotos': mock({
      parseProfileGalleryUrl: (url, uid, expectedBucket) => {
        const prefix = `profiles/${uid}/gallery/`;
        const parsed = new URL(url);
        const objectName = decodeURIComponent(parsed.pathname.split('/o/')[1] || '');
        if (expectedBucket !== bucket || !objectName.startsWith(prefix)) return null;
        return { objectName, downloadToken: parsed.searchParams.get('token') };
      },
    }),
  };
  const route = new SourceTextModule(source, { context, identifier: new URL('./route.ts', import.meta.url).href });
  await route.link((specifier) => { assert.ok(modules[specifier], specifier); return modules[specifier]; });
  await route.evaluate();
  const post = async (input = { targetUserId: 'bob' }) => {
    const response = await route.namespace.POST(new Request('https://gyopo.test/api/matching/like', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' }, body: typeof input === 'string' ? input : JSON.stringify(input),
    }));
    return { status: response.status, data: await response.json(), cache: response.headers.get('cache-control') };
  };
  return { state, put, gallery, post };
}

test('verified adults get a pending like, and identical retries spend no extra quota', async () => {
  const { state, post } = await harness();
  const first = await post();
  assert.equal(first.status, 200);
  assert.equal(state.lastAuthorization, 'Bearer test-token');
  assert.equal(first.data.matched, false);
  assert.equal(first.data.remaining, 29);
  assert.equal(first.cache, 'no-store, private');
  assert.equal((await post()).data.remaining, 29);
  assert.equal(state.documents.get(`matchingLikeDaily/alice-${day}`).fields.count.integerValue, '1');
  assert.equal(state.documents.get('friendships/friend-alice-bob').fields.status.stringValue, 'pending');
  assert.equal(state.transactions[1].writes.length, 0);
});

test('a temporarily unavailable identity verifier is not reported as a missing login', async () => {
  const { state, post } = await harness();
  state.authError = Object.assign(new Error('verification unavailable'), { status: 503 });
  const result = await post();
  assert.equal(result.status, 503);
  assert.equal(state.documents.has(`matchingLikeDaily/alice-${day}`), false);
});

test('the receiving member creates an accepted match and both directions are charged once', async () => {
  const { state, post } = await harness();
  await post();
  state.user = { uid: 'bob' };
  const result = await post({ targetUserId: 'alice' });
  assert.equal(result.status, 200);
  assert.equal(result.data.matched, true);
  assert.equal(state.documents.get(`matchingLikeDaily/bob-${day}`).fields.count.integerValue, '1');
  assert.equal(state.documents.get('friendships/friend-alice-bob').fields.status.stringValue, 'accepted');
  assert.equal((await post({ targetUserId: 'alice' })).data.remaining, 29);
});

test('30 likes are capped server-side, while an existing like is idempotent', async () => {
  const { state, put, gallery, post } = await harness();
  put('matchingLikeDaily', `alice-${day}`, { userId: 'alice', day, count: 29 });
  assert.equal((await post()).data.remaining, 0);
  gallery('charlie');
  const another = await post({ targetUserId: 'charlie' });
  assert.equal(another.status, 429);
  assert.equal((await post()).data.matched, false);
  assert.equal(state.documents.get(`matchingLikeDaily/alice-${day}`).fields.count.integerValue, '30');
});

test('decline is recipient-only and a later new like resumes with the current requester', async () => {
  const { state, post } = await harness();
  await post();
  assert.equal((await post({ targetUserId: 'bob', action: 'decline' })).status, 409);
  state.user = { uid: 'bob' };
  assert.equal((await post({ targetUserId: 'alice', action: 'decline' })).data.declined, true);
  assert.equal(state.documents.get('friendships/friend-alice-bob').fields.status.stringValue, 'declined');
  assert.equal((await post({ targetUserId: 'alice' })).data.matched, false);
  const connection = state.documents.get('friendships/friend-alice-bob').fields;
  assert.equal(connection.requesterId.stringValue, 'bob');
  assert.equal(connection.status.stringValue, 'pending');
  assert.equal(state.documents.get(`matchingLikeDaily/bob-${day}`).fields.count.integerValue, '1');
});

test('legacy pending matches migrate to canonical; a declined legacy request can restart', async () => {
  const { state, put, post } = await harness();
  put('webrtcCalls', 'friend-alice-bob', { requesterId: 'bob', addresseeId: 'alice', status: 'pending', createdAt: '2026-09-01T00:00:00Z' });
  assert.equal((await post()).data.matched, true);
  assert.equal(state.documents.get('friendships/friend-alice-bob').fields.status.stringValue, 'accepted');
  assert.equal(state.documents.get('webrtcCalls/friend-alice-bob').fields.status.stringValue, 'accepted');
  state.documents.delete('friendships/friend-alice-bob');
  put('webrtcCalls', 'friend-alice-bob', { requesterId: 'bob', addresseeId: 'alice', status: 'declined' });
  state.user = { uid: 'bob' };
  assert.equal((await post({ targetUserId: 'alice' })).data.matched, false);
  assert.equal(state.documents.get('friendships/friend-alice-bob').fields.status.stringValue, 'pending');
});

test('a removed friendship can restart only as a new request from the current member', async () => {
  const { state, put, post } = await harness();
  put('friendships', 'friend-alice-bob', { requesterId: 'bob', addresseeId: 'alice', status: 'removed' });
  const result = await post({ targetUserId: 'bob' });
  assert.equal(result.status, 200);
  assert.equal(result.data.matched, false);
  const relationship = state.documents.get('friendships/friend-alice-bob').fields;
  assert.equal(relationship.requesterId.stringValue, 'alice');
  assert.equal(relationship.addresseeId.stringValue, 'bob');
  assert.equal(relationship.status.stringValue, 'pending');
});

test('existing accepted legacy friendships migrate without another quota charge', async () => {
  const { state, put, post } = await harness();
  put('webrtcCalls', 'friend-alice-bob', { requesterId: 'bob', addresseeId: 'alice', status: 'accepted' });
  const result = await post();
  assert.equal(result.status, 200);
  assert.equal(result.data.matched, true);
  assert.equal(state.documents.get('friendships/friend-alice-bob').fields.status.stringValue, 'accepted');
  assert.equal(state.documents.has(`matchingLikeDaily/alice-${day}`), false);
  assert.equal(state.transactions[0].writes.length, 1);
});

test('stale accept cannot silently create a new like after the request was declined', async () => {
  const { state, post } = await harness();
  await post();
  state.user = { uid: 'bob' };
  assert.equal((await post({ targetUserId: 'alice', action: 'decline' })).status, 200);
  assert.equal((await post({ targetUserId: 'alice', action: 'accept' })).status, 409);
  assert.equal(state.documents.has(`matchingLikeDaily/bob-${day}`), false);
  assert.equal(state.documents.get('friendships/friend-alice-bob').fields.status.stringValue, 'declined');
  assert.equal((await post({ targetUserId: 'alice' })).data.matched, false);
  state.user = { uid: 'alice' };
  assert.equal((await post({ targetUserId: 'bob', action: 'accept' })).data.matched, true);
});

test('unverified, minors, bans, blocks, bad input and failed commits never charge a like', async () => {
  const { state, gallery, put, post } = await harness();
  state.documents.delete('verifiedProfilePhotos/bob');
  assert.equal((await post()).status, 409);
  gallery('bob', 3, 17);
  assert.equal((await post()).status, 409);
  gallery('bob');
  put('accountModeration', 'bob', { status: 'banned' });
  assert.equal((await post()).status, 409);
  state.documents.delete('accountModeration/bob');
  put('userBlocks', 'bob-alice', { ownerId: 'bob', blockedUserId: 'alice' });
  assert.equal((await post()).status, 409);
  state.documents.delete('userBlocks/bob-alice');
  for (const input of [{ targetUserId: 'bob', action: 'super' }, { targetUserId: 'bob', userId: 'alice' }, { targetUserId: 'bob/x' }, 'x'.repeat(1100)]) {
    assert.equal((await post(input)).status, 400 + (typeof input === 'string' ? 13 : 0));
  }
  state.user = null;
  assert.equal((await post()).status, 401);
  state.user = { uid: 'alice' };
  state.failCommit = true;
  assert.equal((await post()).status, 503);
  assert.equal(state.documents.has(`matchingLikeDaily/alice-${day}`), false);
});
