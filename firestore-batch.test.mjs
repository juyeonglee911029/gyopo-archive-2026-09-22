import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { createContext, SourceTextModule } from 'node:vm';

const source = stripTypeScriptTypes(readFileSync(new URL('./src/lib/firebaseAdmin.ts', import.meta.url), 'utf8'));
const module = new SourceTextModule(source, { context: createContext({ Response, Headers, TextEncoder, crypto, process }) });
await module.link(() => { throw new Error('Unexpected import'); });
await module.evaluate();
const { parseBatchGet } = module.namespace;
const names = ['projects/test/databases/(default)/documents/profiles/alice', 'projects/test/databases/(default)/documents/profiles/bob'];
const found = { found: { name: names[0], fields: { age: { integerValue: '28' } } } };
const missing = { missing: names[1] };

test('Firestore batchGet accepts streamed and array responses', () => {
  assert.deepEqual(structuredClone(parseBatchGet(`${JSON.stringify(missing)}\n${JSON.stringify(found)}\n`, names)), [missing, found]);
  assert.deepEqual(structuredClone(parseBatchGet(JSON.stringify([found, missing]), names)), [found, missing]);
});

test('Firestore batchGet fails closed on partial or unrelated documents', () => {
  for (const body of [JSON.stringify(found), `${JSON.stringify(found)}\n${JSON.stringify(found)}`,
    `${JSON.stringify(found)}\n${JSON.stringify({ missing: 'wrong' })}`, 'not-json']) {
    assert.throws(() => parseBatchGet(body, names));
  }
});

test('failed transaction plans roll back and conflicts retry with a fresh transaction', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = { project_id: 'test', client_email: 'demo@example.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
  const events = [];
  let conflict = false;
  const context = createContext({
    Response, Headers, TextEncoder, AbortSignal, URLSearchParams, crypto, btoa, atob,
    process: { env: { FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(account) } },
    fetch: async (input, options) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'demo-token' });
      if (url.endsWith(':beginTransaction')) { events.push('begin'); return Response.json({ transaction: `tx-${events.length}` }); }
      if (url.endsWith(':batchGet')) {
        events.push('read');
        return new Response(JSON.stringify({ missing: JSON.parse(options.body).documents[0] }));
      }
      if (url.endsWith(':rollback')) { events.push('rollback'); return Response.json({}); }
      if (url.endsWith(':commit')) {
        events.push('commit');
        if (conflict) { conflict = false; return Response.json({ error: { status: 'ABORTED' } }, { status: 409 }); }
        return Response.json({});
      }
      throw new Error(`Unexpected request ${url}`);
    },
  });
  const isolated = new SourceTextModule(source, { context });
  await isolated.link(() => { throw new Error('Unexpected import'); });
  await isolated.evaluate();
  const documents = [{ collection: 'profiles', id: 'alice' }];
  await assert.rejects(isolated.namespace.runFirestoreTransaction(documents, () => { throw new Error('Refused'); }), /Refused/);
  assert.equal(events.join(','), 'begin,read,rollback');
  events.length = 0;
  conflict = true;
  const result = await isolated.namespace.runFirestoreTransaction(documents, () => ({ writes: [], result: 'okay' }));
  assert.equal(result, 'okay');
  assert.equal(events.join(','), 'begin,read,commit,rollback,begin,read,commit');
});
