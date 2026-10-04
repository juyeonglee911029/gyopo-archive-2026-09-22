import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

const source = stripTypeScriptTypes(readFileSync(new URL('./route.ts', import.meta.url), 'utf8'));
const encode = (value) => value === null ? { nullValue: null }
  : typeof value === 'string' ? { stringValue: value }
    : typeof value === 'boolean' ? { booleanValue: value }
      : { integerValue: String(value) };
const decode = (value) => value?.stringValue ?? value?.booleanValue ?? (value?.nullValue === null ? null : undefined);

async function harness() {
  const state = { user: { uid: 'alice' }, documents: new Map(), transactions: [] };
  const put = (collection, id, data, updateTime = 'initial-v1') => state.documents.set(`${collection}/${id}`, {
    updateTime,
    fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)])),
  });
  const context = createContext({ Request, Response, TextEncoder, TextDecoder });
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
      adminDocumentName: (projectId, collection, id) => `projects/${projectId}/databases/(default)/documents/${collection}/${id}`,
      decodeFirestoreValue: decode,
      firestoreValue: encode,
      runFirestoreTransaction: async (documents, plan) => {
        const snapshot = new Map(documents.map(({ collection, id }) => [`${collection}/${id}`, state.documents.get(`${collection}/${id}`) || null]));
        const outcome = plan({ projectId: 'demo', get: ({ collection, id }) => snapshot.get(`${collection}/${id}`) || null });
        state.transactions.push({ documents, writes: outcome.writes });
        for (const write of outcome.writes) {
          const match = write.update.name.match(/\/documents\/([^/]+)\/([^/]+)$/);
          assert.ok(match, 'writes must use Firestore resource names');
          const [, collection, id] = match;
          const key = `${collection}/${id}`;
          const existing = state.documents.get(key);
          if (write.currentDocument?.exists === false) assert.equal(existing, undefined, 'create must not overwrite');
          if (write.currentDocument?.updateTime) assert.equal(existing?.updateTime, write.currentDocument.updateTime, 'updates must be conditional');
          state.documents.set(key, { updateTime: `committed-${state.transactions.length}`, fields: write.update.fields });
        }
        return outcome.result;
      },
    }),
  };
  const route = new SourceTextModule(source, { context, identifier: new URL('./route.ts', import.meta.url).href });
  await route.link((specifier) => {
    assert.ok(modules[specifier], `Unexpected import: ${specifier}`);
    return modules[specifier];
  });
  await route.evaluate();
  const post = async (body, user = state.user) => {
    state.user = user;
    const response = await route.namespace.POST(new Request('https://gyopo.test/api/matching/manage', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));
    return { status: response.status, data: await response.json() };
  };
  return { state, put, post };
}

test('friend removal changes only an accepted relationship in a conditional write', async () => {
  const { state, put, post } = await harness();
  put('friendships', 'friend-alice-bob', { requesterId: 'alice', addresseeId: 'bob', status: 'accepted' }, 'friend-v1');
  const result = await post({ targetUserId: 'bob', action: 'remove' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { removed: true, blocked: false });
  const relationship = state.documents.get('friendships/friend-alice-bob');
  assert.equal(decode(relationship.fields.status), 'removed');
  assert.ok(relationship.fields.updatedAt.timestampValue);
  assert.equal(state.transactions[0].writes[0].currentDocument.updateTime, 'friend-v1');
  assert.equal(state.documents.has('userBlocks/alice-bob'), false);
});

test('blocking creates the actor-owned block and removes the friend atomically', async () => {
  const { state, put, post } = await harness();
  put('friendships', 'friend-alice-bob', { requesterId: 'alice', addresseeId: 'bob', status: 'accepted' }, 'friend-v2');
  const result = await post({ targetUserId: 'alice', action: 'block', blockedName: 'Alice' }, { uid: 'bob' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { removed: true, blocked: true });
  assert.equal(decode(state.documents.get('friendships/friend-alice-bob').fields.status), 'removed');
  const block = state.documents.get('userBlocks/bob-alice');
  assert.equal(decode(block.fields.ownerId), 'bob');
  assert.equal(decode(block.fields.blockedUserId), 'alice');
  assert.equal(decode(block.fields.blockedName), 'Alice');
  assert.equal(decode(block.fields.callId), null);
  assert.ok(block.fields.createdAt.timestampValue);
  assert.equal(state.transactions[0].writes.length, 2);
  assert.equal(state.transactions[0].writes[1].currentDocument.exists, false);
});

test('missing or unrelated friendships cannot be removed', async () => {
  const { state, put, post } = await harness();
  assert.equal((await post({ targetUserId: 'bad/id', action: 'remove' })).status, 400);
  put('friendships', 'friend-alice-bob', { requesterId: 'alice', addresseeId: 'charlie', status: 'accepted' });
  assert.equal((await post({ targetUserId: 'bob', action: 'remove' })).status, 409);
  assert.equal(state.transactions.length, 0);
});
