import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

const bucket = 'gyopo-live-portal-506019.firebasestorage.app';
const imageId = '00000000-0000-4000-8000-000000000001';
const objectName = `profiles/alice/gallery/${imageId}.jpg`;
const downloadToken = 'abcdef0123456789';
const otherToken = 'fedcba9876543210';
const claimId = `claim:${objectName}`;
const photoUrl = (uid = 'alice', token = downloadToken) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(`profiles/${uid}/gallery/${imageId}.jpg`)}?alt=media&token=${token}`;
const source = stripTypeScriptTypes(readFileSync(new URL('./route.ts', import.meta.url), 'utf8'));

function parseProfileGalleryUrl(value, uid, expectedBucket) {
  try {
    const url = new URL(value);
    const prefix = `/v0/b/${expectedBucket}/o/`;
    if (url.origin !== 'https://firebasestorage.googleapis.com' || !url.pathname.startsWith(prefix) || url.hash) return null;
    const name = decodeURIComponent(url.pathname.slice(prefix.length));
    const token = url.searchParams.get('token') || '';
    if (!new RegExp(`^profiles/${uid}/gallery/[a-f0-9-]{36}\\.jpg$`).test(name)
      || url.searchParams.get('alt') !== 'media' || !/^[A-Za-z0-9_-]{16,256}$/.test(token)) return null;
    return { objectName: name, downloadToken: token };
  } catch {
    return null;
  }
}

function decodeFirestoreValue(value) {
  if (value?.stringValue !== undefined) return value.stringValue;
  if (value?.arrayValue) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  return undefined;
}

function photoDocument(url) {
  return { fields: { profilePhotos: { arrayValue: { values: [{ stringValue: url }] } } } };
}

async function harness() {
  const state = {
    user: { uid: 'alice' }, events: [], requests: [], transactions: [], reads: [],
    documents: new Map(), claims: new Map(), deleteStatuses: [204],
    metadataStatus: 200,
    metadata: { name: objectName, bucket, generation: '17', metadata: { firebaseStorageDownloadTokens: `${otherToken},${downloadToken}` } },
    onMetadata: null, transactionFailure: false,
  };
  const context = createContext({
    Response, Request, URL, AbortSignal, TextEncoder,
    fetch: async (input, options = {}) => {
      const url = new URL(String(input));
      const method = options.method || 'GET';
      state.requests.push({ url, method, options });
      if (url.origin !== 'https://storage.googleapis.com') throw new Error(`Unexpected network request: ${url}`);
      if (method === 'DELETE') {
        state.events.push('delete');
        return new Response(null, { status: state.deleteStatuses.shift() ?? 204 });
      }
      if (method !== 'GET') throw new Error(`Unexpected method: ${method}`);
      state.events.push('metadata');
      await state.onMetadata?.();
      return state.metadataStatus === 404
        ? new Response(null, { status: 404 })
        : Response.json(state.metadata, { status: state.metadataStatus });
    },
  });
  const mock = (exports) => new SyntheticModule(Object.keys(exports), function () {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  }, { context });
  const modules = {
    '@/lib/apiSecurity': mock({
      authenticateRequest: async () => state.user,
      clientAddress: () => '127.0.0.1',
      consumeRateLimit: () => ({ allowed: true }),
      rateLimitResponse: () => Response.json({ error: 'rate limited' }, { status: 429 }),
      unauthorizedResponse: () => Response.json({ error: 'unauthorized' }, { status: 401 }),
    }),
    '@/lib/firebaseAdmin': mock({
      adminDocumentName: (projectId, collection, id) => `projects/${projectId}/documents/${collection}/${id}`,
      decodeFirestoreValue,
      getAdminDocument: async (collection, id) => {
        state.reads.push({ collection, id });
        return state.claims.get(id) || null;
      },
      serviceAccountAccessToken: async (scope) => {
        assert.equal(scope, 'https://www.googleapis.com/auth/devstorage.read_write');
        return 'offline-token';
      },
      runFirestoreTransaction: async (documents, plan) => {
        state.events.push('transaction');
        if (state.transactionFailure) throw new Error('Offline commit failure');
        const { writes } = plan({
          projectId: 'offline-project',
          get: ({ collection, id }) => collection === 'galleryDeletionClaims'
            ? state.claims.get(id) || null : state.documents.get(`${collection}/${id}`) || null,
        });
        state.transactions.push({ documents, writes });
        for (const write of writes) {
          assert.equal(write.currentDocument.exists, false);
          assert.equal(state.claims.has(claimId), false, 'claim must not be overwritten');
          state.claims.set(claimId, { fields: write.update.fields });
          state.events.push('claim');
        }
      },
    }),
    '@/lib/profilePhotos': mock({
      galleryDeletionClaimId: async (name) => `claim:${name}`,
      parseProfileGalleryUrl,
    }),
  };
  const route = new SourceTextModule(source, { context, identifier: new URL('./route.ts', import.meta.url).href });
  await route.link((specifier) => {
    assert.ok(modules[specifier], `Unexpected import: ${specifier}`);
    return modules[specifier];
  });
  await route.evaluate();
  const post = async (url = photoUrl()) => {
    const response = await route.namespace.POST(new Request('https://gyopo.test/api/profile-photos/delete', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ photoUrl: url }),
    }));
    return { response, body: await response.json() };
  };
  return { state, post };
}

test('authentication and ownership reject before storage or Firestore access', async () => {
  const { state, post } = await harness();
  state.user = null;
  assert.equal((await post()).response.status, 401);
  state.user = { uid: 'alice' };
  for (const url of [photoUrl('bob'), 'https://example.test/photo.jpg']) {
    assert.equal((await post(url)).response.status, 400);
  }
  assert.deepEqual(state.events, []);
  assert.equal(state.requests.length, 0);
  assert.equal(state.claims.size, 0);
});

test('any live profile reference blocks the claim and deletion', async (t) => {
  for (const collection of ['profiles', 'publicProfiles', 'verifiedProfilePhotos']) {
    await t.test(collection, async () => {
      const { state, post } = await harness();
      state.documents.set(`${collection}/alice`, photoDocument(photoUrl()));
      const { response } = await post();
      assert.equal(response.status, 409);
      assert.deepEqual(state.events, ['metadata', 'transaction']);
      assert.equal(state.claims.size, 0);
      assert.equal(state.transactions.length, 0, 'rejected transaction must not commit');
      assert.equal(state.requests.filter(({ method }) => method === 'DELETE').length, 0);
    });
  }
});

test('reference added after metadata lookup is seen by the transaction', async () => {
  const { state, post } = await harness();
  state.onMetadata = () => state.documents.set('publicProfiles/alice', photoDocument(photoUrl()));
  assert.equal((await post()).response.status, 409);
  assert.deepEqual(state.events, ['metadata', 'transaction']);
  assert.equal(state.claims.size, 0);
});

test('valid object is claimed before a generation-constrained GCS delete', async () => {
  const { state, post } = await harness();
  const { response, body } = await post();
  assert.equal(response.status, 200);
  assert.deepEqual(body, { deleted: true });
  assert.equal(response.headers.get('cache-control'), 'no-store, private');
  assert.deepEqual(state.events, ['metadata', 'transaction', 'claim', 'delete']);
  const [{ documents, writes }] = state.transactions;
  assert.deepEqual(Array.from(documents, ({ collection, id }) => `${collection}/${id}`), [
    'profiles/alice', 'publicProfiles/alice', 'verifiedProfilePhotos/alice', `galleryDeletionClaims/${claimId}`,
  ]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].currentDocument.exists, false);
  assert.equal(writes[0].update.fields.objectName.stringValue, objectName);
  assert.equal(writes[0].update.fields.downloadToken.stringValue, downloadToken);
  assert.equal(writes[0].update.fields.generation.stringValue, '17');
  const [lookup, deletion] = state.requests;
  assert.equal(lookup.url.pathname, `/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`);
  assert.equal(lookup.url.searchParams.get('fields'), 'name,bucket,generation,metadata');
  assert.equal(deletion.url.searchParams.get('ifGenerationMatch'), '17');
  assert.equal(deletion.method, 'DELETE');
  assert.equal(deletion.options.headers.authorization, 'Bearer offline-token');
});

test('untrusted metadata and noncanonical URLs never create a claim', async (t) => {
  for (const [name, mutate, url] of [
    ['object name', (state) => { state.metadata.name = 'profiles/bob/gallery/other.jpg'; }],
    ['bucket', (state) => { state.metadata.bucket = 'wrong-bucket'; }],
    ['generation', (state) => { state.metadata.generation = 'not-a-generation'; }],
    ['download token', (state) => { state.metadata.metadata.firebaseStorageDownloadTokens = otherToken; }],
    ['noncanonical URL', () => {}, photoUrl().replace('?alt=media&token=', '?token=') + '&alt=media'],
  ]) {
    await t.test(name, async () => {
      const { state, post } = await harness();
      mutate(state);
      assert.equal((await post(url)).response.status, 409);
      assert.deepEqual(state.events, ['metadata']);
      assert.equal(state.claims.size, 0);
    });
  }
});

test('GCS failure retains the claim, and retry uses it without another write', async () => {
  const { state, post } = await harness();
  state.deleteStatuses = [503, 204];
  assert.equal((await post()).response.status, 503);
  assert.equal(state.claims.size, 1);
  assert.equal((await post()).response.status, 200);
  assert.deepEqual(state.transactions.map(({ writes }) => writes.length), [1, 0]);
  assert.deepEqual(state.events, ['metadata', 'transaction', 'claim', 'delete', 'metadata', 'transaction', 'delete']);
  assert.deepEqual(state.requests.filter(({ method }) => method === 'DELETE').map(({ url }) => url.searchParams.get('ifGenerationMatch')), ['17', '17']);
});

test('a generation change after claiming returns conflict and cannot delete the replacement', async () => {
  const { state, post } = await harness();
  state.deleteStatuses = [412, 204];
  assert.equal((await post()).response.status, 409);
  assert.equal(state.claims.size, 1);
  state.metadata.generation = '18';
  assert.equal((await post()).response.status, 409);
  assert.deepEqual(state.events, ['metadata', 'transaction', 'claim', 'delete', 'metadata', 'transaction']);
  assert.equal(state.requests.filter(({ method }) => method === 'DELETE').length, 1);
});

test('missing object is idempotent only with a matching prior claim', async () => {
  const { state, post } = await harness();
  state.metadataStatus = 404;
  assert.equal((await post()).response.status, 409);
  state.claims.set(claimId, { fields: { objectName: { stringValue: objectName }, downloadToken: { stringValue: otherToken } } });
  assert.equal((await post()).response.status, 409);
  state.claims.get(claimId).fields.downloadToken.stringValue = downloadToken;
  assert.equal((await post()).response.status, 200);
  assert.deepEqual(state.events, ['metadata', 'metadata', 'metadata']);
  assert.deepEqual(state.reads.map(({ collection, id }) => `${collection}/${id}`), Array(3).fill(`galleryDeletionClaims/${claimId}`));
});

test('failed claim transaction never triggers deletion and can be retried', async () => {
  const { state, post } = await harness();
  state.transactionFailure = true;
  assert.equal((await post()).response.status, 503);
  assert.equal(state.claims.size, 0);
  assert.equal(state.requests.filter(({ method }) => method === 'DELETE').length, 0);
  state.transactionFailure = false;
  assert.equal((await post()).response.status, 200);
  assert.deepEqual(state.events, ['metadata', 'transaction', 'metadata', 'transaction', 'claim', 'delete']);
});
