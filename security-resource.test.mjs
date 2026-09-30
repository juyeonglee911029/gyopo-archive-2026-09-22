import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const rules = read('./firestore.rules');
const storageRules = read('./storage.rules');
const adminSource = stripTypeScriptTypes(read('./src/lib/firebaseAdmin.ts'));
const { creditUsdBalance } = await import(`data:text/javascript;base64,${Buffer.from(adminSource).toString('base64')}`);
const projectId = 'demo-security-resource';
const resourceRoot = `projects/${projectId}/databases/(default)/documents`;
const httpRoot = `https://firestore.googleapis.com/v1/${resourceRoot}`;
const params = { userId: 'member_1', transactionId: 'txn_test-123', amountUsd: 12.34, currencyCode: 'USD' };
const updateTime = '2026-01-01T00:00:00.000000Z';
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

// Source-only delimiter check, not a Firestore parser or emulator substitute.
function assertBalancedDelimiters(source) {
  const stack = [];
  const openFor = { ')': '(', ']': '[', '}': '{' };
  let quote = null;
  let comment = null;
  let line = 1;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '\n') line += 1;
    if (comment === '//') {
      if (char === '\n') comment = null;
      continue;
    }
    if (comment === '/*') {
      if (char === '*' && source[i + 1] === '/') { comment = null; i += 1; }
      continue;
    }
    if (quote) {
      if (char === '\\') { i += 1; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && ['/', '*'].includes(source[i + 1])) {
      comment = source.slice(i, i + 2); i += 1; continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if ('([{'.includes(char)) stack.push({ char, line });
    if (openFor[char]) assert.equal(stack.pop()?.char, openFor[char], `Unbalanced ${char} at line ${line}`);
  }
  assert.equal(quote, null, 'Unterminated rules string');
  assert.notEqual(comment, '/*', 'Unterminated rules comment');
  assert.deepEqual(stack, [], 'Unclosed rules delimiters');
}

test('rules source has balanced delimiters outside comments and strings', () => {
  assertBalancedDelimiters(rules);
  assertBalancedDelimiters(storageRules);
});

test('gallery Storage rules deny client reads, overwrites and deletion', () => {
  assert.equal(JSON.parse(read('./firebase.json')).storage.rules, 'storage.rules');
  assert.match(storageRules, /bucket == 'gyopo-live-portal-506019\.firebasestorage\.app'/);
  assert.match(storageRules, /request\.auth\.uid == userId/);
  assert.match(storageRules, /match \/profiles\/\{userId\}\/gallery\/\{fileName\}/);
  assert.match(storageRules, /match \/profiles\/\{userId\}\/\{fileName\}/);
  assert.match(storageRules, /collection in \['posts', 'jobs'\]/);
  assert.equal((storageRules.match(/allow read, update, delete: if false;/g) || []).length, 3);
  assert.doesNotMatch(storageRules, /allow (?:read|update|delete): if (?!false)/);
  assert.match(storageRules, /match \/\{allPaths=\*\*\} \{\s*allow read, write: if false;/);
});

test('source checker catches missing posts-update parenthesis', () => {
  const start = rules.indexOf('match /posts/{postId}');
  const end = rules.indexOf('match /comments/{commentId}', start);
  const posts = rules.slice(start, end);
  const update = posts.match(/allow update: if[\s\S]*?;/)?.[0];
  assert.ok(update);
  assert.match(update, /\)\);$/);
  assert.throws(() => assertBalancedDelimiters(posts.replace(update, update.replace(/\);$/, ';'))), /Unbalanced/);
  assertBalancedDelimiters(`{ /* ) ] */ value('escaped\\\' ) [', "}"); // (\n }`);
});

test('financial collection write denials remain explicit (source regression)', () => {
  for (const collection of ['transferRequests', 'walletLedger', 'paddlePayments', 'escrowOrders', 'gameStakes', 'gamePayouts', 'genderMatchStakes', 'premiumSubscriptions']) {
    const block = rules.match(new RegExp(`match /${collection}/\\{\\w+\\} \\{([\\s\\S]*?)\\n\\s*\\}`))?.[1];
    assert.ok(block, `Missing ${collection} rule`);
    assert.match(block, /allow create, update, delete: if false;/);
    assert.equal((block.match(/allow /g) || []).length, 2, `Unexpected permission in ${collection}`);
  }
});

function mockAdmin(t, options = {}) {
  const saved = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    project_id: projectId, client_email: 'offline-test@example.invalid', private_key: privateKey,
  });
  t.after(() => {
    if (saved === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = saved;
  });
  const calls = [];
  const profile = options.profile ?? {
    name: `${resourceRoot}/profiles/${params.userId}`, updateTime,
    fields: { usdBalance: { doubleValue: 20.1 }, name: { stringValue: 'Existing member' } },
  };
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'offline-test-token' });
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer offline-test-token');
    if (url === `${httpRoot}/profiles/${params.userId}`) return Response.json(profile);
    if (url === `${httpRoot}/paddlePayments/${params.transactionId}`) {
      return options.payment ? Response.json(options.payment) : Response.json({}, { status: 404 });
    }
    if (url === `${httpRoot}:commit`) {
      assert.equal(init.method, 'POST');
      return new Response(options.commitBody || '{}', { status: options.commitStatus || 200 });
    }
    assert.fail(`Unexpected network request: ${url}`);
  });
  return calls;
}

test('credit commit uses document resource names; HTTP requests keep HTTPS URLs', async (t) => {
  const calls = mockAdmin(t);
  assert.deepEqual(await creditUsdBalance(params), { amountUsd: 12.34, alreadyCredited: false });
  const commits = calls.filter(({ url }) => url.endsWith(':commit'));
  assert.equal(commits.length, 1);
  const { writes } = JSON.parse(commits[0].init.body);
  assert.deepEqual(writes.map(({ update }) => update.name), [
    `${resourceRoot}/profiles/${params.userId}`,
    `${resourceRoot}/paddlePayments/${params.transactionId}`,
    `${resourceRoot}/walletLedger/paddle-${params.transactionId}`,
  ]);
  for (const { update } of writes) assert.match(update.name, /^projects\/[^/]+\/databases\/\(default\)\/documents\/[^/]+\/[^/]+$/);
  assert.deepEqual(writes.map(({ currentDocument }) => currentDocument), [
    { updateTime }, { exists: false }, { exists: false },
  ]);
  assert.deepEqual(writes[0].update.fields.usdBalance, { doubleValue: 32.44 });
  assert.deepEqual(writes[0].update.fields.name, { stringValue: 'Existing member' });
  assert.deepEqual(writes[1].update.fields.amountUsd, { doubleValue: 12.34 });
  assert.deepEqual(writes[2].update.fields.amount, { doubleValue: 12.34 });
  assert.equal(calls.filter(({ url }) => url.startsWith(httpRoot) && !url.endsWith(':commit')).length, 2);
});

test('existing payment returns without a second credit commit', async (t) => {
  const calls = mockAdmin(t, { payment: {
    name: `${resourceRoot}/paddlePayments/${params.transactionId}`, fields: { amountUsd: { doubleValue: 12.34 } },
  } });
  assert.deepEqual(await creditUsdBalance(params), { amountUsd: 12.34, alreadyCredited: true });
  assert.equal(calls.filter(({ url }) => url.endsWith(':commit')).length, 0);
});

test('invalid payment inputs fail before authentication or network access', async (t) => {
  const calls = mockAdmin(t);
  for (const patch of [
    { userId: '../member' }, { userId: 'member/other' }, { transactionId: 'txn/invalid' },
    { amountUsd: 0 }, { amountUsd: -1 }, { amountUsd: NaN }, { amountUsd: Infinity },
    { amountUsd: 1_000_001 }, { currencyCode: 'KRW' },
  ]) await assert.rejects(creditUsdBalance({ ...params, ...patch }));
  assert.equal(calls.length, 0);
});

test('invalid profile balance or missing snapshot precondition never commits', async (t) => {
  for (const profile of [
    { name: `${resourceRoot}/profiles/${params.userId}` },
    { name: `${resourceRoot}/profiles/${params.userId}`, updateTime, fields: { usdBalance: { doubleValue: -1 } } },
    { name: `${resourceRoot}/profiles/${params.userId}`, updateTime, fields: { usdBalance: { integerValue: 'invalid' } } },
  ]) await t.test(JSON.stringify(profile), async (t) => {
    const calls = mockAdmin(t, { profile });
    await assert.rejects(creditUsdBalance(params));
    assert.equal(calls.filter(({ url }) => url.endsWith(':commit')).length, 0);
  });
});

test('commit precondition failure rejects instead of an unsafe retry', async (t) => {
  const calls = mockAdmin(t, { commitStatus: 412, commitBody: '{"error":{"status":"FAILED_PRECONDITION"}}' });
  await assert.rejects(creditUsdBalance(params));
  assert.equal(calls.filter(({ url }) => url.endsWith(':commit')).length, 1);
});
