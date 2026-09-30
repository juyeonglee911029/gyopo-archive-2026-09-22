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
  const commit = (writes, uid) => request(`${documents}:commit`, 'POST', {
    writes: writes.map(({ path, data }) => ({
      update: { name: `projects/${projectId}/databases/(default)/documents/${path}`, fields: fields(data) },
      currentDocument: { exists: true },
    })),
  }, uid);
  const writeMedia = (path, data, uid) => {
    const media = Object.fromEntries(Object.entries(data).filter(([key]) => key.startsWith('media') || key === 'systemAudio'));
    delete media.mediaUpdatedAt;
    return request(`${documents}:commit`, 'POST', {
      writes: [{
        update: { name: `projects/${projectId}/databases/(default)/documents/${path}`, fields: fields(media) },
        updateMask: { fieldPaths: Object.keys(media) },
        updateTransforms: [{ fieldPath: 'mediaUpdatedAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: true },
      }],
    }, uid);
  };
  const remove = (path, uid) => request(`${documents}/${path}`, 'DELETE', undefined, uid);
  const read = (path, uid) => request(`${documents}/${path}`, 'GET', undefined, uid);
  const query = (collection, field, value, uid) => request(`${documents}:runQuery`, 'POST', {
    structuredQuery: { from: [{ collectionId: collection }], where: { fieldFilter: {
      field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value },
    } } },
  }, uid);
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
    const room = { hostId: 'host', title: 'Test room', status: 'live', updatedAt: new Date() };
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
    await seed('friendships/friend-alice-bob', { requesterId: 'alice', addresseeId: 'bob', status: 'accepted' });
    const callRequest = { callerId: 'alice', calleeId: 'bob', status: 'pending' };
    await allowed(write('friendCallRequests/friend-call', callRequest, 'alice'));
    await denied(write('friendCallRequests/not-a-friend', { ...callRequest, calleeId: 'stranger' }, 'alice'));
    await seed('userBlocks/alice-bob', { ownerId: 'alice', blockedUserId: 'bob', blockedName: 'Bob', createdAt: new Date() });
    await denied(write('friendCallRequests/blocked', callRequest, 'alice'));
    await denied(write('friendMessages/blocked', message, 'bob'));
    await allowed(remove('userBlocks/alice-bob', 'alice'));
    await seed('accountModeration/alice', { status: 'banned' });
    await denied(write('friendCallRequests/banned', callRequest, 'alice'));
    await denied(write('friendMessages/banned', message, 'alice'));
    await seed('accountModeration/alice', { status: 'active' });
    await allowed(remove('friendMessages/alice-message', 'bob'));
  });

  await t.test('WebRTC screen sharing is participant-bound, leased, and exclusive', async () => {
    await seed('profiles/alice', { age: 30 });
    await seed('profiles/bob', { age: 30 });
    await seed('profiles/stranger', { age: 30 });
    const call = { callId: 'media-call', callerId: 'alice', calleeId: 'bob', offer: { type: 'offer', sdp: 'offer' }, answer: null };
    const screenState = (ownerId, leaseId, systemAudio = false) => ({
      ...call,
      mediaOwnerId: ownerId,
      mediaLeaseId: leaseId,
      mediaMode: ownerId ? 'screen' : 'camera',
      systemAudio: ownerId ? systemAudio : false,
      mediaUpdatedAt: Date.now(),
    });

    await seed('webrtcCalls/media-call', call);
    await denied(write('webrtcCalls/extra-metadata', { ...call, callId: 'extra-metadata', injected: true }, 'alice'));
    await denied(writeMedia('webrtcCalls/media-call', screenState(null, 'alice-lease', true), 'alice'));
    await allowed(writeMedia('webrtcCalls/media-call', screenState('alice', 'alice-lease', true), 'alice'));
    await denied(writeMedia('webrtcCalls/media-call', {
      ...screenState('alice', 'alice-lease', true),
      mediaMode: 'camera',
    }, 'alice'));
    await denied(writeMedia('webrtcCalls/media-call', screenState('bob', 'bob-lease'), 'bob'));
    await denied(writeMedia('webrtcCalls/media-call', screenState(null, 'alice-lease'), 'bob'));
    await denied(writeMedia('webrtcCalls/media-call', screenState('stranger', 'stranger-lease'), 'stranger'));
    await allowed(writeMedia('webrtcCalls/media-call', screenState(null, 'alice-lease'), 'alice'));
    await denied(writeMedia('webrtcCalls/media-call', screenState('alice', 'alice-lease', true), 'alice'));
    await allowed(writeMedia('webrtcCalls/media-call', screenState('bob', 'bob-lease'), 'bob'));

    const expired = {
      ...call,
      callId: 'expired-media-call',
      ...screenState('alice', 'old-lease'),
      mediaUpdatedAt: new Date(Date.now() - 50_000),
    };
    await seed('webrtcCalls/expired-media-call', expired);
    await allowed(writeMedia('webrtcCalls/expired-media-call', {
      ...expired,
      ...screenState('bob', 'reclaimed-lease'),
    }, 'bob'));

    const ended = { ...call, callId: 'ended-media-call', status: 'ended' };
    await seed('webrtcCalls/ended-media-call', ended);
    await denied(writeMedia('webrtcCalls/ended-media-call', {
      ...ended,
      ...screenState('alice', 'late-lease'),
    }, 'alice'));
    await denied(write('webrtcCalls/media-call', { ...call, calleeId: 'stranger' }, 'alice'));
  });

  await t.test('suspended adult accounts cannot access existing call signaling or ICE', async () => {
    await seed('profiles/restricted', { age: 30 });
    await seed('accountModeration/restricted', { status: 'banned' });
    const call = { callId: 'restricted-call', callerId: 'restricted', calleeId: 'bob', offer: { type: 'offer', sdp: 'sdp' }, answer: null, status: 'offer' };
    await seed('webrtcCalls/restricted-call', call);
    await seed('webrtcCandidates/restricted-candidate', { callId: call.callId, fromUserId: 'bob', candidate: { candidate: 'candidate' } });

    await denied(write('webrtcCalls/new-restricted-call', { ...call, callId: 'new-restricted-call' }, 'restricted'));
    await denied(read('webrtcCalls/restricted-call', 'restricted'));
    await denied(write('webrtcCalls/restricted-call', { ...call, status: 'ended', endedAt: new Date() }, 'restricted'));
    await denied(read('webrtcCandidates/restricted-candidate', 'restricted'));
    await denied(write('webrtcCandidates/new-restricted-candidate', { callId: call.callId, fromUserId: 'restricted', candidate: { candidate: 'candidate' } }, 'restricted'));
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
    const profile = { name: 'Alice', email: 'alice@example.invalid', image: '', gender: 'female', country: 'Netherlands', age: 30, defaultAiWritingPrompt: 'Warm, concise style', usdtBalance: 0, usdBalance: 0, isSubscribed: false, updatedAt: new Date() };
    await seed('profiles/alice', profile);
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

  await t.test('public profile galleries require a server-verified Firebase Storage registry', async () => {
    const bucket = 'gyopo-live-portal-506019.firebasestorage.app';
    const photos = (userId, count) => Array.from({ length: count }, (_, index) => {
      const file = `profiles/${userId}/gallery/00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}.jpg`;
      return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(file)}?alt=media&token=gallerytoken_${String(index + 1).padStart(24, '0')}`;
    });
    const urls = photos('photo-member', 5);
    await seed('verifiedProfilePhotos/photo-member', { profilePhotos: urls, updatedAt: new Date() });
    const profile = {
      name: 'Photo Member', email: 'photo@example.invalid', image: 'https://photos.example/avatar.jpg', profilePhotos: urls,
      usdtBalance: 0, usdBalance: 0, isSubscribed: false, gender: 'female', country: 'Netherlands', age: 30, updatedAt: new Date(),
    };
    const publicProfile = {
      name: profile.name, image: profile.image, profilePhotos: urls, gender: profile.gender,
      country: profile.country, age: profile.age, isSubscribed: false, isPublic: true, updatedAt: new Date(),
    };
    await allowed(write('profiles/photo-member', profile, 'photo-member'));
    await allowed(write('publicProfiles/photo-member', publicProfile, 'photo-member'));
    await allowed(read('publicProfiles/photo-member'));
    await allowed(read('publicProfiles/photo-member', 'visitor'));
    await denied(read('verifiedProfilePhotos/photo-member', 'photo-member'));
    await denied(write('verifiedProfilePhotos/photo-member', { profilePhotos: urls, updatedAt: new Date() }, 'photo-member'));
    await denied(write('profiles/photo-member', { ...profile, profilePhotos: [...urls, photos('photo-member', 1)[0]] }, 'photo-member'));
    await denied(write('profiles/photo-member', { ...profile, profilePhotos: ['data:image/jpeg;base64,private-preview'] }, 'photo-member'));
    await denied(write('profiles/photo-member', { ...profile, profilePhotos: [...urls.slice(0, 2), urls[0]] }, 'photo-member'));
    await denied(write('profiles/photo-member', { ...profile, profilePhotos: ['http://photos.example/photo.jpg'] }, 'photo-member'));
    await denied(write('profiles/photo-member', { ...profile, profilePhotos: ['https://photos.example/copied.jpg'] }, 'photo-member'));
    await denied(write('profiles/photo-member', { ...profile, profilePhotos: [photos('another-member', 1)[0]] }, 'photo-member'));
    await denied(write('publicProfiles/photo-member', { ...publicProfile, profilePhotos: urls.slice(0, 4) }, 'photo-member'));
  });

  await t.test('friend and WebRTC matching require verified eligibility and reciprocal room membership', async () => {
    const bucket = 'gyopo-live-portal-506019.firebasestorage.app';
    const photos = (userId, count) => Array.from({ length: count }, (_, index) => {
      const file = `profiles/${userId}/gallery/00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}.jpg`;
      return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(file)}?alt=media&token=gallerytoken_${String(index + 1).padStart(24, '0')}`;
    });
    const publicProfile = (name, profilePhotos) => ({
      name, image: `https://photos.example/${name}.jpg`, profilePhotos, gender: 'female', country: 'Netherlands',
      age: 30, isSubscribed: false, isPublic: true, updatedAt: new Date(),
    });
    const seedGallery = async (userId, name, count) => {
      const gallery = photos(userId, count);
      await seed(`verifiedProfilePhotos/${userId}`, { profilePhotos: gallery, updatedAt: new Date() });
      await seed(`publicProfiles/${userId}`, publicProfile(name, gallery));
      return gallery;
    };
    await seed('profiles/alice', { age: 30 });
    await seed('profiles/bob', { age: 30 });
    await seed('profiles/carol', { age: 30 });
    await seedGallery('alice', 'Alice', 2);
    await seedGallery('bob', 'Bob', 2);
    await seedGallery('carol', 'Carol', 2);

    const friendship = { requesterId: 'alice', addresseeId: 'bob', status: 'pending', createdAt: new Date(), updatedAt: new Date() };
    await denied(write('friendships/friend-alice-bob', friendship, 'alice'));
    await seedGallery('alice', 'Alice', 3);
    await denied(write('friendships/friend-alice-bob', friendship, 'alice'));
    await seedGallery('bob', 'Bob', 3);
    await denied(write('friendships/friend-alice-bob', friendship, 'alice'));
    await seed('friendships/friend-alice-bob', friendship);
    await denied(write('friendships/friend-alice-bob', { ...friendship, status: 'accepted' }, 'alice'));
    await denied(write('friendships/friend-alice-bob', { ...friendship, status: 'accepted' }, 'bob'));
    await denied(remove('friendships/friend-alice-bob', 'alice'));
    await denied(write('friendships/fake-id', friendship, 'alice'));
    await denied(write('friendships/friend-alice-bob', { ...friendship, status: 'declined' }, 'bob'));

    const pendingCarol = { requesterId: 'alice', addresseeId: 'carol', status: 'pending', createdAt: new Date(), updatedAt: new Date() };
    await seed('friendships/friend-alice-carol', pendingCarol);
    await denied(write('friendships/friend-alice-carol', { ...pendingCarol, status: 'accepted' }, 'alice'));
    await denied(write('friendships/friend-alice-carol', { ...pendingCarol, status: 'accepted' }, 'carol'));
    await denied(write('friendships/friend-alice-carol', { ...pendingCarol, status: 'declined' }, 'carol'));

    const queueEntry = (userId, queueKind = 'random', targetUserId, gameType, gameRoomId) => ({
      userId, name: userId, image: '', age: 30, status: 'waiting', queueKind,
      ...(targetUserId ? { targetUserId } : {}),
      ...(gameType ? { gameType, gameRoomId } : {}),
    });
    await seed('profiles/dave', { age: 30 });
    await seedGallery('dave', 'Dave', 3);
    const legacyFriendship = { requesterId: 'alice', addresseeId: 'dave', status: 'pending', createdAt: new Date(), updatedAt: new Date() };
    await denied(write('webrtcCalls/friend-alice-dave', legacyFriendship, 'alice'));
    await seed('webrtcCalls/friend-alice-dave', legacyFriendship);
    await allowed(read('webrtcCalls/friend-alice-dave', 'dave'));
    await allowed(query('webrtcCalls', 'addresseeId', 'dave', 'dave'));
    await allowed(query('webrtcCalls', 'requesterId', 'alice', 'alice'));
    await denied(read('webrtcCalls/friend-alice-dave', 'stranger'));
    await denied(write('webrtcCalls/friend-alice-dave', { ...legacyFriendship, status: 'accepted' }, 'alice'));
    await denied(write('webrtcCalls/friend-alice-dave', { ...legacyFriendship, status: 'accepted' }, 'dave'));
    await denied(remove('webrtcCalls/friend-alice-dave', 'dave'));
    await seed('webrtcCalls/friend-alice-dave', { ...legacyFriendship, status: 'accepted' });
    await allowed(write('webrtcQueue/alice', queueEntry('alice', 'friend', 'dave'), 'alice'));
    await seed('friendships/friend-alice-dave', { ...legacyFriendship, status: 'pending' });
    await denied(write('webrtcQueue/alice', queueEntry('alice', 'friend', 'dave'), 'alice'));
    await allowed(remove('webrtcQueue/alice', 'alice'));
    await seedGallery('alice', 'Alice', 2);
    await denied(write('webrtcQueue/alice', queueEntry('alice'), 'alice'));
    await seedGallery('alice', 'Alice', 3);
    await allowed(write('webrtcQueue/alice', queueEntry('alice'), 'alice'));
    await allowed(write('webrtcQueue/bob', queueEntry('bob'), 'bob'));
    await denied(write('webrtcQueue/alice', {
      ...queueEntry('alice'), status: 'matched', matchedBy: 'alice', callId: 'self-match',
      opponent: { id: 'bob', name: 'Bob', image: '' },
    }, 'alice'));

    const matchRows = (callId, first, second) => [
      { path: `webrtcQueue/${first.userId}`, data: {
        ...first, status: 'matched', matchedBy: 'alice', callId,
        opponent: { id: second.userId, name: second.name, image: '' },
      } },
      { path: `webrtcQueue/${second.userId}`, data: {
        ...second, status: 'matched', matchedBy: 'alice', callId,
        opponent: { id: first.userId, name: first.name, image: '' },
      } },
    ];
    await seedGallery('bob', 'Bob', 2);
    await denied(commit(matchRows('photo-match', queueEntry('alice'), queueEntry('bob')), 'alice'));
    await seedGallery('bob', 'Bob', 3);
    const photoMatch = matchRows('photo-match', queueEntry('alice'), queueEntry('bob'));
    await allowed(commit(photoMatch, 'alice'));
    await allowed(write('webrtcCalls/photo-match', {
      callId: 'photo-match', callerId: 'alice', calleeId: 'bob', status: 'offer', offer: { type: 'offer', sdp: 'x' },
    }, 'alice'));
    await denied(write('webrtcCalls/unpaired-call', {
      callId: 'unpaired-call', callerId: 'alice', calleeId: 'bob', status: 'offer', offer: { type: 'offer', sdp: 'x' },
    }, 'alice'));

    await seedGallery('alice', 'Alice', 2);
    await seedGallery('bob', 'Bob', 2);
    await seed('friendships/friend-alice-bob', { ...friendship, status: 'accepted' });
    const aliceFriendQueue = queueEntry('alice', 'friend', 'bob');
    const bobFriendQueue = queueEntry('bob', 'friend', 'alice');
    await allowed(write('webrtcQueue/alice', aliceFriendQueue, 'alice'));
    await allowed(write('webrtcQueue/bob', bobFriendQueue, 'bob'));
    await allowed(commit(matchRows('friend-match', aliceFriendQueue, bobFriendQueue), 'alice'));

    await seed('tetrisRoomAccess/tetris-duel', {
      roomNumber: 1, matchId: 'tetris-duel', playerAId: 'alice', playerBId: 'bob', active: true, updatedAt: new Date(),
    });
    await seed('tetrisRooms/tetris-duel', { matchId: 'tetris-duel', playerAId: 'alice', playerBId: 'bob', phase: 'betting' });
    const aliceTetrisQueue = queueEntry('alice', 'game', 'bob', 'tetris', 'tetris-duel');
    const bobTetrisQueue = queueEntry('bob', 'game', 'alice', 'tetris', 'tetris-duel');
    await allowed(write('webrtcQueue/alice', aliceTetrisQueue, 'alice'));
    await allowed(write('webrtcQueue/bob', bobTetrisQueue, 'bob'));
    await seed('profiles/charlie', { age: 30 });
    await denied(write('webrtcQueue/charlie', queueEntry('charlie', 'game', 'bob', 'tetris', 'tetris-duel'), 'charlie'));
    await allowed(commit(matchRows('tetris-match', aliceTetrisQueue, bobTetrisQueue), 'alice'));
    await allowed(write('webrtcCalls/webrtc-end-game-tetris-duel', {
      callerId: 'alice', calleeId: 'bob', queueKind: 'game', targetUserId: 'bob',
      gameType: 'tetris', gameRoomId: 'tetris-duel', status: 'ended', endedAt: new Date(),
    }, 'alice'));

    await seed('brickBreakerRooms/brick-duel', { host: 'alice', guest: 'bob', status: 'playing' });
    const aliceBrickQueue = queueEntry('alice', 'game', 'bob', 'brickBreaker', 'brick-duel');
    const bobBrickQueue = queueEntry('bob', 'game', 'alice', 'brickBreaker', 'brick-duel');
    await allowed(write('webrtcQueue/alice', aliceBrickQueue, 'alice'));
    await allowed(write('webrtcQueue/bob', bobBrickQueue, 'bob'));
    await allowed(commit(matchRows('brick-match', aliceBrickQueue, bobBrickQueue), 'alice'));

    await seed('profiles/direct-caller', { age: 30 });
    await denied(write('webrtcQueue/direct-caller', queueEntry('direct-caller', 'friend', 'existing-friend'), 'direct-caller'));
    await denied(write('webrtcCalls/webrtc-end-friend-unrelated', {
      callerId: 'alice', calleeId: 'charlie', queueKind: 'friend', targetUserId: 'charlie', status: 'ended', endedAt: new Date(),
    }, 'alice'));
  });

  await t.test('matching daily quota cannot be read or changed by members and blocks use canonical IDs', async () => {
    await seed('matchingLikeDaily/alice-20260930', { userId: 'alice', day: '20260930', count: 30 });
    await denied(read('matchingLikeDaily/alice-20260930', 'alice'));
    await denied(write('matchingLikeDaily/alice-20260930', { userId: 'alice', day: '20260930', count: 0 }, 'alice'));
    await denied(remove('matchingLikeDaily/alice-20260930', 'alice'));
    const block = { ownerId: 'alice', blockedUserId: 'bob', blockedName: 'Bob', createdAt: new Date() };
    await denied(write('userBlocks/arbitrary', block, 'alice'));
    await allowed(write('userBlocks/alice-bob', block, 'alice'));
  });

  await t.test('Tetris room access requires the second player to join as themself', async () => {
    const access = { roomNumber: 2, matchId: 'joined-tetris', playerAId: 'alice', playerBId: null, active: true, updatedAt: new Date() };
    await allowed(write('tetrisRoomAccess/joined-tetris', access, 'alice'));
    await denied(write('tetrisRoomAccess/joined-tetris', { ...access, playerBId: 'bob' }, 'alice'));
    const joined = { ...access, playerBId: 'bob', updatedAt: new Date() };
    await allowed(write('tetrisRoomAccess/joined-tetris', joined, 'bob'));
    await denied(write('tetrisRoomAccess/joined-tetris', { ...joined, playerBId: 'charlie' }, 'alice'));
    await allowed(write('tetrisRoomAccess/joined-tetris', { ...joined, active: false }, 'bob'));
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
