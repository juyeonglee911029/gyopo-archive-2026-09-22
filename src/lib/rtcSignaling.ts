export const RTC_INITIAL_TIMEOUT = 60_000;
export const RTC_DISCONNECT_GRACE = 12_000;
export const RTC_RESTART_TIMEOUT = 45_000;
export const CALL_MEDIA_LEASE_MS = 45_000;

const FIRESTORE_PROJECT_ID = 'gyopo-live-portal-506019';

// The updateTime precondition makes competing share requests resolve atomically.
export async function updateCallMediaLease(
  callId: string,
  userId: string,
  token: string,
  mediaMode: 'camera' | 'screen',
  systemAudio: boolean,
  leaseId: string,
  fetcher: typeof fetch = fetch,
) {
  if (!callId || !userId || !token || !leaseId) return false;
  const base = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents`;
  const documentUrl = `${base}/webrtcCalls/${encodeURIComponent(callId)}`;
  const documentName = `projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/webrtcCalls/${callId}`;
  const fieldPaths = ['mediaOwnerId', 'mediaLeaseId', 'mediaMode', 'systemAudio'];

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetcher(documentUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`Firestore call media read failed (${response.status})`);
    const document = await response.json() as {
      updateTime?: string;
      fields?: Record<string, { stringValue?: string; timestampValue?: string; nullValue?: null }>;
    };
    const fields = document.fields || {};
    const callerId = fields.callerId?.stringValue;
    const calleeId = fields.calleeId?.stringValue;
    const ownerId = fields.mediaOwnerId?.stringValue || null;
    const currentLeaseId = fields.mediaLeaseId?.stringValue || null;
    if ((callerId !== userId && calleeId !== userId) || fields.status?.stringValue === 'ended' || !document.updateTime) return false;
    if (mediaMode === 'camera' && (ownerId !== userId || currentLeaseId !== leaseId)) return false;
    // A released lease ID is fenced out so an in-flight heartbeat cannot reacquire it.
    if (mediaMode === 'screen' && currentLeaseId === leaseId && ownerId !== userId) return false;

    const write = await fetcher(`${base}:commit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        writes: [{
          update: {
            name: documentName,
            fields: {
              mediaOwnerId: mediaMode === 'screen' ? { stringValue: userId } : { nullValue: null },
              mediaLeaseId: { stringValue: leaseId },
              mediaMode: { stringValue: mediaMode },
              systemAudio: { booleanValue: mediaMode === 'screen' && systemAudio },
            },
          },
          updateMask: { fieldPaths },
          updateTransforms: [{ fieldPath: 'mediaUpdatedAt', setToServerValue: 'REQUEST_TIME' }],
          currentDocument: { updateTime: document.updateTime },
        }],
      }),
    });
    if (write.ok) return true;
    if (write.status === 403) return false;
    const error = await write.json().catch(() => null) as { error?: { status?: string; message?: string } } | null;
    if (write.status === 409 || error?.error?.status === 'ABORTED' || error?.error?.status === 'FAILED_PRECONDITION') continue;
    throw new Error(error?.error?.message || `Firestore call media update failed (${write.status})`);
  }
  return false;
}

export type RtcDescription = RTCSessionDescriptionInit & { offerKey?: string; restartRequested?: boolean };
export type RtcSignal = { offer?: RtcDescription; answer?: RtcDescription | null };

export function descriptionKey(description?: RTCSessionDescriptionInit | null) {
  return description?.sdp?.split(/\r?\n/).filter((line) => line.startsWith('o=') || line.startsWith('a=ice-ufrag:')).join('|') || '';
}

export async function gatheredDescription(peer: RTCPeerConnection, alive: () => boolean, timeout = 12_000): Promise<RTCSessionDescriptionInit> {
  if (peer.iceGatheringState !== 'complete') await new Promise<void>((resolve) => {
    const finish = () => { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', changed); resolve(); };
    const changed = () => { if (peer.iceGatheringState === 'complete' || !alive()) finish(); };
    const timer = setTimeout(finish, timeout);
    peer.addEventListener('icegatheringstatechange', changed);
    changed();
  });
  if (!alive() || !peer.localDescription) throw new Error('RTC_CANCELLED');
  // createOffer/createAnswer are snapshots from BEFORE candidate gathering.
  return { type: peer.localDescription.type, sdp: peer.localDescription.sdp };
}

export function createCandidateQueue() {
  const pending = new Map<string, RTCIceCandidateInit>();
  const applied = new Set<string>();
  return {
    enqueue(id: string, candidate: RTCIceCandidateInit) { if (!applied.has(id)) pending.set(id, candidate); },
    async flush(peer: RTCPeerConnection, alive: () => boolean) {
      if (!peer.remoteDescription) return;
      const ufrags = [...(peer.remoteDescription.sdp || '').matchAll(/a=ice-ufrag:([^\r\n]+)/g)].map((match) => match[1]);
      for (const [id, candidate] of pending) {
        if (!alive()) return;
        // Keep future-generation candidates until their restart offer arrives.
        if (candidate.usernameFragment && !ufrags.includes(candidate.usernameFragment)) continue;
        try {
          await peer.addIceCandidate(candidate);
          if (!alive()) return;
          applied.add(id);
          pending.delete(id);
        } catch { /* A transient failure is retried, never marked as applied. */ }
      }
    },
  };
}

export function createRtcSignaling(peer: RTCPeerConnection, initiator: boolean, write: (signal: RtcSignal) => Promise<void>, alive: () => boolean) {
  let pending: RtcSignal | null = null;
  let appliedOffer = '';
  let appliedAnswer = '';
  let restartCount = 0;
  const publish = async () => {
    if (!alive()) return;
    if (pending) { await write(pending); if (alive()) pending = null; }
  };
  return {
    async sync(signal: RtcSignal, restart = false) {
      await publish();
      if (!alive()) return;
      if (initiator) {
        const needsRestart = restart || Boolean(signal.answer?.restartRequested && signal.answer.offerKey === descriptionKey(peer.localDescription));
        if (!peer.localDescription || (needsRestart && peer.signalingState === 'stable' && restartCount < 2)) {
          const restarting = Boolean(peer.localDescription);
          const offer = await peer.createOffer(restarting ? { iceRestart: true } : undefined);
          if (!alive()) return;
          await peer.setLocalDescription(offer);
          if (restarting) restartCount++;
          pending = { offer: await gatheredDescription(peer, alive), answer: null };
          await publish();
          return;
        }
        const answer = signal.answer;
        if (answer?.sdp && !answer.restartRequested && peer.signalingState === 'have-local-offer'
          && (answer.offerKey === descriptionKey(peer.localDescription) || (!answer.offerKey && restartCount === 0))
          && answer.sdp !== appliedAnswer) {
          await peer.setRemoteDescription({ type: answer.type, sdp: answer.sdp });
          if (alive()) appliedAnswer = answer.sdp;
        }
      } else if (signal.offer?.sdp && signal.offer.sdp !== appliedOffer) {
        await peer.setRemoteDescription({ type: signal.offer.type, sdp: signal.offer.sdp });
        if (!alive()) return;
        const answer = await peer.createAnswer();
        if (!alive()) return;
        await peer.setLocalDescription(answer);
        pending = { answer: { ...await gatheredDescription(peer, alive), offerKey: descriptionKey(signal.offer) } };
        appliedOffer = signal.offer.sdp;
        await publish();
      } else if (restart && peer.localDescription && restartCount < 2) {
        restartCount++;
        pending = { answer: { type: peer.localDescription.type, sdp: peer.localDescription.sdp, offerKey: descriptionKey(peer.remoteDescription), restartRequested: true } };
        await publish();
      }
    },
  };
}

export function startSerialPoll(task: () => Promise<void>, delay: number) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    try { if (!stopped) await task(); }
    catch { /* A failed request must not kill the poll or create an unhandled rejection. */ }
    finally { if (!stopped) timer = setTimeout(() => void run(), delay); }
  };
  void run();
  return () => { stopped = true; clearTimeout(timer); };
}
