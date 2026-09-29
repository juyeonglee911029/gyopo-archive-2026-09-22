import assert from 'node:assert/strict';
import test from 'node:test';
import { CALL_MEDIA_LEASE_MS, updateCallMediaLease } from './rtcSignaling.ts';

const base = 'https://firestore.googleapis.com/v1/projects/gyopo-live-portal-506019/databases/(default)/documents';

function createFirestore(fields = {}) {
  const state = { updateTime: 't1', fields: { callerId: { stringValue: 'alice' }, calleeId: { stringValue: 'bob' }, ...fields }, writes: [] };
  let version = 1;
  const fetcher = async (url, options = {}) => {
    if (url === `${base}/webrtcCalls/call`) {
      return new Response(JSON.stringify(structuredClone(state)), { status: 200 });
    }
    if (url === `${base}:commit`) {
      const write = JSON.parse(options.body).writes[0];
      state.writes.push(write);
      if (write.currentDocument.updateTime !== state.updateTime) {
        return new Response(JSON.stringify({ error: { status: 'FAILED_PRECONDITION' } }), { status: 400 });
      }
      const nextOwner = write.update.fields.mediaOwnerId?.stringValue || null;
      const currentOwner = state.fields.mediaOwnerId?.stringValue || null;
      const currentLeaseId = state.fields.mediaLeaseId?.stringValue || null;
      const nextLeaseId = write.update.fields.mediaLeaseId?.stringValue || null;
      const updatedAt = Date.parse(state.fields.mediaUpdatedAt?.timestampValue || '');
      const expired = !Number.isFinite(updatedAt) || updatedAt + CALL_MEDIA_LEASE_MS <= Date.now();
      if (nextOwner && currentOwner && !expired
        && (nextOwner !== currentOwner || nextLeaseId !== currentLeaseId)) {
        return new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED' } }), { status: 403 });
      }
      Object.assign(state.fields, write.update.fields);
      for (const transform of write.updateTransforms || []) {
        if (transform.setToServerValue === 'REQUEST_TIME') {
          state.fields[transform.fieldPath] = { timestampValue: new Date().toISOString() };
        }
      }
      state.updateTime = `t${++version}`;
      return new Response(JSON.stringify({ writeResults: [] }), { status: 200 });
    }
    throw new Error(`Unexpected Firestore request: ${url}`);
  };
  return { state, fetcher };
}

test('simultaneous screen-share claims have one atomic winner', async () => {
  const { state } = createFirestore();
  let reads = 0;
  let releaseReads;
  const bothRead = new Promise((resolve) => { releaseReads = resolve; });
  const fetcher = async (url, options = {}) => {
    if (url === `${base}/webrtcCalls/call`) {
      const snapshot = structuredClone(state);
      reads++;
      if (reads === 2) releaseReads();
      if (reads <= 2) await bothRead;
      return new Response(JSON.stringify(snapshot), { status: 200 });
    }
    if (url === `${base}:commit`) {
      const write = JSON.parse(options.body).writes[0];
      state.writes.push(write);
      if (write.currentDocument.updateTime !== state.updateTime) {
        return new Response(JSON.stringify({ error: { status: 'FAILED_PRECONDITION' } }), { status: 400 });
      }
      const nextOwner = write.update.fields.mediaOwnerId?.stringValue || null;
      const currentOwner = state.fields.mediaOwnerId?.stringValue || null;
      const currentLeaseId = state.fields.mediaLeaseId?.stringValue || null;
      const nextLeaseId = write.update.fields.mediaLeaseId?.stringValue || null;
      const updatedAt = Date.parse(state.fields.mediaUpdatedAt?.timestampValue || '');
      const expired = !Number.isFinite(updatedAt) || updatedAt + CALL_MEDIA_LEASE_MS <= Date.now();
      if (nextOwner && currentOwner && !expired
        && (nextOwner !== currentOwner || nextLeaseId !== currentLeaseId)) {
        return new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED' } }), { status: 403 });
      }
      Object.assign(state.fields, write.update.fields);
      for (const transform of write.updateTransforms || []) {
        if (transform.setToServerValue === 'REQUEST_TIME') {
          state.fields[transform.fieldPath] = { timestampValue: new Date().toISOString() };
        }
      }
      state.updateTime = `t${state.writes.length + 1}`;
      return new Response(JSON.stringify({ writeResults: [] }), { status: 200 });
    }
    throw new Error(`Unexpected Firestore request: ${url}`);
  };

  const results = await Promise.all([
    updateCallMediaLease('call', 'alice', 'token', 'screen', false, 'lease-a', fetcher),
    updateCallMediaLease('call', 'bob', 'token', 'screen', true, 'lease-b', fetcher),
  ]);

  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(state.writes.filter((write) => write.currentDocument.updateTime === 't1').length, 2);
  assert.ok(['alice', 'bob'].includes(state.fields.mediaOwnerId.stringValue));
  assert.ok(Date.parse(state.fields.mediaUpdatedAt.timestampValue) <= Date.now());
  assert.ok(state.writes.every((write) => write.updateTransforms[0].setToServerValue === 'REQUEST_TIME'));
});

test('active lease IDs prevent another tab from taking or releasing the share', async () => {
  const { state, fetcher } = createFirestore({
    mediaOwnerId: { stringValue: 'alice' },
    mediaLeaseId: { stringValue: 'active-lease' },
    mediaUpdatedAt: { timestampValue: new Date(Date.now() - 10_000).toISOString() },
  });

  assert.equal(await updateCallMediaLease('call', 'alice', 'token', 'screen', false, 'other-tab', fetcher), false);
  assert.equal(await updateCallMediaLease('call', 'alice', 'token', 'camera', false, 'other-tab', fetcher), false);
  assert.equal(state.writes.length, 1);
  assert.equal(state.fields.mediaLeaseId.stringValue, 'active-lease');
});

test('a lease owner can release its share and another participant can claim it', async () => {
  const { state, fetcher } = createFirestore();
  assert.equal(await updateCallMediaLease('call', 'alice', 'token', 'screen', true, 'lease-a', fetcher), true);
  assert.equal(state.fields.mediaOwnerId.stringValue, 'alice');
  assert.equal(state.fields.systemAudio.booleanValue, true);

  assert.equal(await updateCallMediaLease('call', 'alice', 'token', 'camera', false, 'lease-a', fetcher), true);
  assert.equal(state.fields.mediaOwnerId.nullValue, null);
  assert.equal(state.fields.mediaMode.stringValue, 'camera');

  assert.equal(await updateCallMediaLease('call', 'bob', 'token', 'screen', false, 'lease-b', fetcher), true);
  assert.equal(state.fields.mediaOwnerId.stringValue, 'bob');
  for (const write of state.writes) assert.ok(write.currentDocument.updateTime);
});

test('a pending heartbeat cannot reclaim a lease after its owner releases it', async () => {
  const { state, fetcher } = createFirestore();
  assert.equal(await updateCallMediaLease('call', 'alice', 'token', 'screen', false, 'lease-a', fetcher), true);

  let releaseRenewal;
  let renewalStarted;
  const started = new Promise((resolve) => { renewalStarted = resolve; });
  const holdRenewal = new Promise((resolve) => { releaseRenewal = resolve; });
  let held = false;
  const delayedFetcher = async (url, options) => {
    if (url === `${base}:commit` && !held && JSON.parse(options.body).writes[0].update.fields.mediaMode?.stringValue === 'screen') {
      held = true;
      renewalStarted();
      await holdRenewal;
    }
    return fetcher(url, options);
  };

  const renewal = updateCallMediaLease('call', 'alice', 'token', 'screen', false, 'lease-a', delayedFetcher);
  await started;
  assert.equal(await updateCallMediaLease('call', 'alice', 'token', 'camera', false, 'lease-a', fetcher), true);
  releaseRenewal();

  assert.equal(await renewal, false);
  assert.equal(state.fields.mediaOwnerId.nullValue, null);
  assert.equal(state.fields.mediaLeaseId.stringValue, 'lease-a');
});
