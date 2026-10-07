import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('./') && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(specifier + '.ts', context);
    }
    return nextResolve(specifier, context);
  },
});

const { heartbeatWebrtcQueue, uploadStorageFile } = await import('./firebase.ts');
const page = readFileSync(new URL('../app/webrtc/page.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const token = (userId) => `fixture.${Buffer.from(JSON.stringify({ sub: userId })).toString('base64url')}.fixture`;
const queueDocument = (status) => ({
  name: 'projects/gyopo-live-portal-506019/databases/(default)/documents/webrtcQueue/alice',
  updateTime: '2026-10-04T00:00:00.000000Z',
  fields: { userId: { stringValue: 'alice' }, status: { stringValue: status }, lastSeenAt: { timestampValue: '2026-10-04T00:00:00.000000Z' } },
});

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing section start: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section end: ${end}`);
  return source.slice(from, to);
}

test('page heartbeats only in the waiting branch, not for matched or active calls', () => {
  const poll = section(page, 'const poll = async () => {', 'const stop = startSerialPoll(poll, 700);');
  const queueBranch = section(poll, "if (ownQueue?.status === 'matched' && ownQueue.callId && ownQueue.opponent) {", 'if (!nextCall) {');
  const matchedBranch = section(queueBranch, "if (ownQueue?.status === 'matched' && ownQueue.callId && ownQueue.opponent) {", '} else {');
  const activeCallBranch = section(poll, 'const connection = ensureConnection(current);', 'const now = Date.now();');

  assert.equal((queueBranch.match(/heartbeatWebrtcQueue\(user\.id, token\)/g) || []).length, 1);
  assert.doesNotMatch(matchedBranch, /heartbeatWebrtcQueue|mergeDocument\('webrtcQueue', user\.id, \{ lastSeenAt:/);
  assert.doesNotMatch(activeCallBranch, /heartbeatWebrtcQueue|mergeDocument\('webrtcQueue', user\.id, \{ lastSeenAt:/);
});

test('camera mirroring is toggled from both video tiles, and the homepage keeps its discovery controls', () => {
  assert.equal((page.match(/<ArrowLeftRight/g) || []).length, 2);
  assert.doesNotMatch(page, /type="checkbox" checked=\{flip\}/);
  assert.match(home, /<section className=\{styles\.hero\} aria-label="GYOPO 시작">/);
  assert.match(home, /GlobalRegionSelectors/);
  assert.match(home, /<form role="search"/);
  assert.match(home, /className=\{styles\.matchCard\}/);
  assert.match(home, /<MarketTicker\s*\/>/);
  assert.doesNotMatch(home, /YOUR (?:GLOBAL|LOCAL) CONNECTION|세계 어디서나/);
});

test('waiting queue heartbeat conditionally updates only lastSeenAt', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    requests.push({ url: String(input), init });
    if (requests.length === 1) return Response.json(queueDocument('waiting'));
    return Response.json({ writeResults: [] });
  };
  try {
    assert.equal(await heartbeatWebrtcQueue('alice', token('alice')), true);
    assert.equal(requests.length, 2);
    const write = JSON.parse(requests[1].init.body).writes[0];
    assert.deepEqual(write.updateMask.fieldPaths, ['lastSeenAt']);
    assert.equal(write.currentDocument.updateTime, queueDocument('waiting').updateTime);
    assert.ok(write.update.fields.lastSeenAt.timestampValue);
    assert.deepEqual(Object.keys(write.update.fields), ['lastSeenAt']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('matched queue heartbeat performs no write, and another account cannot refresh it', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json(queueDocument('matched'));
  };
  try {
    assert.equal(await heartbeatWebrtcQueue('alice', token('alice')), false);
    assert.equal(calls, 1, 'matched queues are read but never written');
    assert.equal(await heartbeatWebrtcQueue('alice', token('bob')), false);
    assert.equal(calls, 1, 'owner mismatch is rejected before any request');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stale heartbeat compare-and-swap conflicts are retryable', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? Response.json(queueDocument('waiting'))
      : Response.json({ error: { status: 'FAILED_PRECONDITION' } }, { status: 400 });
  };
  try {
    assert.equal(await heartbeatWebrtcQueue('alice', token('alice')), false);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a rule denial caused by a simultaneous match is treated as a completed race', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return Response.json(queueDocument('waiting'));
    if (calls === 2) return Response.json({ error: { message: 'PERMISSION_DENIED' } }, { status: 403 });
    return Response.json({ ...queueDocument('matched'), updateTime: '2026-10-04T00:00:01.000000Z' });
  };
  try {
    assert.equal(await heartbeatWebrtcQueue('alice', token('alice')), false);
    assert.equal(calls, 3, 'a rejected stale write re-reads the queue state');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('storage upload refreshes an expired owner token once and rejects another owner', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const oldToken = token('alice');
  const freshToken = `fixture.${Buffer.from(JSON.stringify({ sub: 'alice', issued: 'refreshed' })).toString('base64url')}.fresh`;
  const session = { idToken: oldToken, refreshToken: 'refresh-token', user: { id: 'alice' } };
  const storage = new Map([['gyopo-auth-session', JSON.stringify(session)]]);
  const objectName = 'profiles/alice/gallery/00000000-0000-4000-8000-000000000001.jpg';
  const requests = [];
  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.startsWith('https://securetoken.googleapis.com/')) {
      return Response.json({ id_token: freshToken, refresh_token: 'next-refresh-token' });
    }
    if (!url.startsWith('https://firebasestorage.googleapis.com/')) throw new Error(`Unexpected request: ${url}`);
    if (init.headers.Authorization === `Firebase ${oldToken}`) {
      return Response.json({ error: { message: 'Unauthenticated' } }, { status: 403 });
    }
    return Response.json({ name: objectName, downloadTokens: 'download-token' });
  };
  try {
    const file = new Blob(['jpeg'], { type: 'image/jpeg' });
    const url = await uploadStorageFile(file, objectName, oldToken);
    assert.match(url, /token=download-token$/);
    assert.equal(requests.length, 3);
    assert.equal(requests[0].init.headers.Authorization, `Firebase ${oldToken}`);
    assert.equal(requests[2].init.headers.Authorization, `Firebase ${freshToken}`);
    await assert.rejects(uploadStorageFile(file, objectName.replace('/alice/', '/bob/'), oldToken), /계정과 파일 저장 경로가 일치하지 않습니다/);
    assert.equal(requests.length, 3, 'wrong-owner paths are rejected without a request');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
