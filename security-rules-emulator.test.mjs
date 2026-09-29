import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Optional, real emulator suite. No Firebase account, CLI, or production network access.
// FIRESTORE_EMULATOR_JAR=/path/to/emulator.jar JAVA_BINARY=/path/to/java node --test security-rules-emulator.test.mjs
const emulatorJar = process.env.FIRESTORE_EMULATOR_JAR;
const projectId = 'demo-security-rules';
const rulesPath = fileURLToPath(new URL('./firestore.rules', import.meta.url));
const rules = readFileSync(rulesPath, 'utf8');

test('Firestore emulator authorization regressions', {
  skip: emulatorJar ? false : 'Set FIRESTORE_EMULATOR_JAR to run real emulator tests',
  timeout: 120_000,
}, async (t) => {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const documents = `${origin}/v1/projects/${projectId}/databases/(default)/documents`;
  const child = spawn(process.env.JAVA_BINARY || 'java', [
    '-jar', emulatorJar, '--host', '127.0.0.1', '--port', String(port),
    '--project_id', projectId, '--single_project_mode', 'true', '--rules', rulesPath,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  let spawnError;
  child.on('error', (error) => { spawnError = error; });
  child.stdout.on('data', (chunk) => { logs = (logs + chunk).slice(-24_000); });
  child.stderr.on('data', (chunk) => { logs = (logs + chunk).slice(-24_000); });
  const stopped = new Promise((resolve) => child.once('close', resolve));
  t.after(async () => {
    if (child.exitCode === null && !spawnError) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
      await stopped;
      clearTimeout(timer);
    }
  });

  function auth(uid) {
    if (uid === 'owner') return 'owner'; // Emulator-only seed access.
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      aud: projectId, iss: `https://securetoken.google.com/${projectId}`, sub: uid, user_id: uid,
      iat: now, exp: now + 3600, auth_time: now,
      email: uid === 'master' ? 'juyeonglee911029@gmail.com' : `${uid}@example.invalid`,
      firebase: { sign_in_provider: 'custom', identities: {} },
    };
    return `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
  }

  async function request(url, method, data, uid) {
    const response = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...(uid ? { authorization: `Bearer ${auth(uid)}` } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.text();
    return { status: response.status, body };
  }

  let ready = false;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (spawnError || child.exitCode !== null) assert.fail(`Emulator failed: ${spawnError || logs}`);
    try {
      const result = await request(`${documents}/_health/missing`, 'GET', undefined, 'owner');
      if ([400, 404].includes(result.status)) { ready = true; break; }
    } catch { /* Wait for the local emulator to bind. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, `Emulator startup timed out: ${logs}`);

  function value(data) {
    if (data === null) return { nullValue: null };
    if (data instanceof Date) return { timestampValue: data.toISOString() };
    if (Array.isArray(data)) return { arrayValue: { values: data.map(value) } };
    if (typeof data === 'string') return { stringValue: data };
    if (typeof data === 'boolean') return { booleanValue: data };
    if (typeof data === 'number') return Number.isInteger(data) ? { integerValue: String(data) } : { doubleValue: data };
    return { mapValue: { fields: fields(data) } };
  }
  const fields = (data) => Object.fromEntries(Object.entries(data).map(([key, data]) => [key, value(data)]));
  const write = (path, data, uid) => request(`${documents}/${path}`, 'PATCH', { fields: fields(data) }, uid);
  const remove = (path, uid) => request(`${documents}/${path}`, 'DELETE', undefined, uid);
  const read = (path, uid) => request(`${documents}/${path}`, 'GET', undefined, uid);
  async function allowed(result) {
    const response = await result;
    assert.ok(response.status >= 200 && response.status < 300, JSON.stringify(response));
  }
  async function denied(result) {
    const response = await result;
    assert.equal(response.status, 403, JSON.stringify(response));
    assert.equal(JSON.parse(response.body).error.status, 'PERMISSION_DENIED');
  }
  const seed = (path, data) => allowed(write(path, data, 'owner'));
  const loadRules = (content) => request(`${origin}/emulator/v1/projects/${projectId}:securityRules`, 'PUT', {
    rules: { files: [{ name: 'firestore.rules', content }] },
  }, 'owner');

  await t.test('actual rules compiler accepts the full file and rejects both original syntax errors', async () => {
    await allowed(loadRules(rules));
    const posts = rules.match(/match \/posts\/\{postId\}[\s\S]*?allow update: if[\s\S]*?;/)?.[0];
    assert.ok(posts?.endsWith('));'));
    const invalid = rules.replace(posts, posts.replace(/\);$/, ';'));
    const rejected = await loadRules(invalid);
    assert.equal(rejected.status, 400, JSON.stringify(rejected));
    const live = rules.match(/match \/liveRooms\/\{roomId\}[\s\S]*?allow update: if[\s\S]*?;/)?.[0];
    assert.ok(live);
    const extraClosing = await loadRules(rules.replace(live, live.replace(/;$/, ');')));
    assert.equal(extraClosing.status, 400, JSON.stringify(extraClosing));
    await allowed(loadRules(rules));
  });

  await t.test('commit API accepts document resource names and rejects full HTTPS document URLs', async () => {
    const name = `projects/${projectId}/databases/(default)/documents/paddlePayments/resource-check`;
    const commit = (name) => request(`${documents}:commit`, 'POST', {
      writes: [{ update: { name, fields: fields({ amountUsd: 12.34 }) }, currentDocument: { exists: false } }],
    }, 'owner');
    const invalid = await commit(`https://firestore.googleapis.com/v1/${name}`);
    assert.equal(invalid.status, 400, JSON.stringify(invalid));
    await allowed(commit(name));
    await allowed(read('paddlePayments/resource-check', 'owner'));
  });

  await t.test('posts preserve author, master, and authenticated views-only updates', async () => {
    const post = { authorId: 'alice', title: 'Original', views: 0 };
    await allowed(write('posts/post', post, 'alice'));
    await allowed(write('posts/post', { ...post, title: 'Author edit' }, 'alice'));
    await allowed(write('posts/post', { ...post, title: 'Author edit', views: 1 }, 'bob'));
    await denied(write('posts/post', { ...post, authorId: 'bob' }, 'bob'));
    await denied(write('posts/post', { ...post, title: 'Outsider edit' }, 'bob'));
    await denied(write('posts/post', { ...post, views: 2 }));
    await allowed(write('posts/post', { ...post, title: 'Master edit' }, 'master'));
    await allowed(remove('posts/post', 'alice'));
  });

  await t.test('live-room host, offline takeover, stale takeover, and master flows remain unchanged', async () => {
    const room = { hostId: 'host', status: 'live', updatedAt: new Date() };
    await allowed(write('liveRooms/lifecycle', room, 'host'));
    await allowed(write('liveRooms/lifecycle', { ...room, title: 'Host edit' }, 'host'));
    await denied(write('liveRooms/lifecycle', { ...room, hostId: 'stranger' }, 'stranger'));
    await denied(write('liveRooms/lifecycle', { ...room, hostId: null, status: 'offline' }, 'stranger'));
    await denied(write('liveRooms/lifecycle', room));
    await allowed(write('liveRooms/lifecycle', { ...room, hostId: null, status: 'offline' }, 'host'));
    await allowed(write('liveRooms/lifecycle', { ...room, hostId: 'next-host' }, 'next-host'));
    await allowed(write('liveRooms/lifecycle', { ...room, hostId: null, status: 'offline' }, 'master'));
    await seed('liveRooms/stale', { ...room, updatedAt: new Date(0) });
    await allowed(write('liveRooms/stale', { ...room, hostId: 'next-host' }, 'next-host'));
    await allowed(remove('liveRooms/stale', 'next-host'));
  });

  await t.test('viewer signaling preserves creation, heartbeat, host answer, reconnect, and cleanup', async () => {
    await seed('liveRooms/room', { hostId: 'host', status: 'live' });
    const viewer = { roomId: 'room', sessionId: 'session', viewerId: 'viewer', hostId: 'host', status: 'offer', offer: 'sdp', updatedAt: new Date() };
    await allowed(write('liveRoomViewers/signal', viewer, 'viewer'));
    await allowed(write('liveRoomViewers/signal', { ...viewer, status: 'answer', answer: 'sdp-answer' }, 'host'));
    await allowed(read('liveRoomViewers/signal', 'viewer'));
    await allowed(write('liveRoomViewers/signal', { ...viewer, status: 'connected' }, 'viewer'));
    await allowed(write('liveRoomViewers/signal', { ...viewer, status: 'offer', offer: 'new-sdp' }, 'viewer'));
    await allowed(write('liveRoomViewers/signal', { ...viewer, status: 'ended' }, 'viewer'));
    await allowed(write('liveRoomViewers/signal', { ...viewer, status: 'ended' }, 'master'));
    await allowed(remove('liveRoomViewers/signal', 'host'));
    await denied(write('liveRoomViewers/forged', { ...viewer, hostId: 'stranger' }, 'viewer'));
    await denied(write('liveRoomViewers/spoofed', viewer, 'stranger'));
  });

  await t.test('outsider cannot join an existing viewer signal by submitting their own membership', async () => {
    const viewer = { roomId: 'room', viewerId: 'viewer', hostId: 'host', status: 'offer' };
    await seed('liveRoomViewers/protected', viewer);
    await denied(write('liveRoomViewers/protected', { ...viewer, viewerId: 'stranger' }, 'stranger'));
    await denied(write('liveRoomViewers/protected', { ...viewer, hostId: 'stranger' }, 'stranger'));
    await denied(write('liveRoomViewers/protected', { ...viewer, viewerId: 'stranger', hostId: 'stranger' }, 'stranger'));
    await denied(write('liveRoomViewers/protected', viewer));
    await denied(read('liveRoomViewers/protected', 'stranger'));
    await denied(remove('liveRoomViewers/protected', 'stranger'));
  });

  await t.test('friend-message creation binds both participants to the stored accepted friendship', async () => {
    await seed('friendships/accepted', { requesterId: 'alice', addresseeId: 'bob', status: 'accepted' });
    await seed('friendships/pending', { requesterId: 'alice', addresseeId: 'bob', status: 'pending' });
    const message = { friendshipId: 'accepted', participants: ['alice', 'bob'], authorId: 'alice', text: 'hello', expiresAt: new Date(0) };
    await allowed(write('friendMessages/alice-message', message, 'alice'));
    await allowed(write('friendMessages/bob-message', { ...message, participants: ['bob', 'alice'], authorId: 'bob' }, 'bob'));
    await allowed(read('friendMessages/alice-message', 'bob'));
    await denied(read('friendMessages/alice-message', 'stranger'));
    await denied(write('friendMessages/injected', { ...message, participants: ['stranger', 'bob'], authorId: 'stranger' }, 'stranger'));
    await denied(write('friendMessages/substituted', { ...message, participants: ['alice', 'stranger'] }, 'alice'));
    await denied(write('friendMessages/duplicate', { ...message, participants: ['alice', 'alice'] }, 'alice'));
    await denied(write('friendMessages/oversized', { ...message, participants: ['alice', 'bob', 'stranger'] }, 'alice'));
    await denied(write('friendMessages/spoofed', message, 'bob'));
    await denied(write('friendMessages/pending', { ...message, friendshipId: 'pending' }, 'alice'));
    await denied(write('friendMessages/missing', { ...message, friendshipId: 'missing' }, 'alice'));
    await denied(write('friendMessages/guest', message));
    await denied(write('friendMessages/alice-message', { ...message, text: 'edited' }, 'alice'));
    await allowed(remove('friendMessages/alice-message', 'bob'));
  });

  await t.test('financial writes stay denied for members and master clients', async () => {
    for (const collection of ['transferRequests', 'walletLedger', 'paddlePayments', 'escrowOrders', 'gameStakes', 'gamePayouts', 'genderMatchStakes', 'premiumSubscriptions']) {
      const data = { userId: 'alice', senderId: 'alice', recipientId: 'bob', winnerId: 'alice', loserId: 'bob', buyerId: 'alice', sellerId: 'bob', amount: 10 };
      await seed(`${collection}/existing`, data);
      for (const uid of ['alice', 'master']) {
        await denied(write(`${collection}/new-${uid}`, data, uid));
        await denied(write(`${collection}/existing`, { ...data, amount: 1000 }, uid));
        await denied(remove(`${collection}/existing`, uid));
      }
    }
  });

  await t.test('ordinary profile edits remain valid; member balance and subscription changes are denied', async () => {
    const profile = { name: 'Alice', email: 'alice@example.invalid', image: '', defaultAiWritingPrompt: 'Warm, concise style', usdtBalance: 0, usdBalance: 0, isSubscribed: false, updatedAt: new Date() };
    await allowed(write('profiles/alice', profile, 'alice'));
    await allowed(write('profiles/alice', { ...profile, name: 'Alice updated' }, 'alice'));
    await allowed(write('profiles/alice', { ...profile, defaultAiWritingPrompt: 'Updated preference' }, 'alice'));
    for (const patch of [{ defaultAiWritingPrompt: 'x'.repeat(1201) }, { usdBalance: 100 }, { usdtBalance: 100 }, { isSubscribed: true }, { premiumExpiresAt: new Date() }, { lastTransferId: 'forged' }, { lastUsdOperationId: 'forged' }]) {
      await denied(write('profiles/alice', { ...profile, ...patch }, 'alice'));
    }
    const legacy = { ...profile };
    delete legacy.usdBalance;
    await seed('profiles/legacy', legacy);
    await allowed(write('profiles/legacy', profile, 'legacy'));
  });

  await t.test('existing Tetris members can sync but cannot create, change, or remove settlement fields', async () => {
    const room = { playerAId: 'alice', playerBId: 'bob', betAmount: 10, phase: 'betting' };
    await allowed(write('tetrisRooms/room', room, 'alice'));
    await allowed(write('tetrisRooms/room', { ...room, phase: 'holding' }, 'bob'));
    await denied(write('tetrisRooms/fractional-fee', { ...room, betAmount: 1.5 }, 'alice'));
    const freeRoom = { playerAId: 'alice', playerBId: 'bob', betAmount: 0, phase: 'betting', readyA: true };
    await allowed(write('tetrisRooms/free-room', freeRoom, 'alice'));
    await allowed(write('tetrisRooms/free-room', { ...freeRoom, readyB: true }, 'bob'));
    await denied(write('tetrisRooms/free-forged-stake', { ...freeRoom, stakeHeldA: true }, 'alice'));
    await denied(write('tetrisRooms/free-room', { ...freeRoom, betAmount: 1 }, 'alice'));
    await denied(write('tetrisRooms/forged', { ...room, stakeHeldA: true }, 'alice'));
    for (const patch of [{ stakeHeldA: true }, { stakeHeldB: true }, { payoutStatus: 'PAID' }, { payoutAmount: 20 }, { betAmount: 99 }]) {
      await denied(write('tetrisRooms/room', { ...room, ...patch }, 'alice'));
    }
    const settled = { ...room, stakeHeldA: true, stakeHeldB: true, payoutStatus: 'PAID', payoutAmount: 20 };
    await seed('tetrisRooms/settled', settled);
    await allowed(write('tetrisRooms/settled', { ...settled, phase: 'finished' }, 'bob'));
    await denied(write('tetrisRooms/settled', room, 'alice'));
    await denied(write('tetrisRooms/settled', { ...settled, payoutAmount: 999 }, 'alice'));
  });
});
