import assert from 'node:assert/strict';
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
