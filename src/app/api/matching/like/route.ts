import { authenticateRequest, consumeRateLimit, rateLimitResponse, unauthorizedResponse } from '@/lib/apiSecurity';
import { adminDocumentName, decodeFirestoreValue, firestoreValue, runFirestoreTransaction, type AdminFirestoreDocument, type FirestoreWrite } from '@/lib/firebaseAdmin';
import { parseProfileGalleryUrl } from '@/lib/profilePhotos';

export const runtime = 'edge';

const bucket = 'gyopo-live-portal-506019.firebasestorage.app';
const uidPattern = /^[A-Za-z0-9_-]{1,128}$/;
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store, private' } });

class UnavailableMatch extends Error {}
class QuotaExceeded extends Error {}

function eligibleProfile(profile: AdminFirestoreDocument | null, publicProfile: AdminFirestoreDocument | null, verified: AdminFirestoreDocument | null, userId: string): boolean {
  const age = decodeFirestoreValue(profile?.fields?.age);
  const publicAge = decodeFirestoreValue(publicProfile?.fields?.age);
  const photos = decodeFirestoreValue(profile?.fields?.profilePhotos);
  const published = decodeFirestoreValue(publicProfile?.fields?.profilePhotos);
  const verifiedPhotos = decodeFirestoreValue(verified?.fields?.profilePhotos);
  return typeof age === 'number' && Number.isInteger(age) && age >= 18 && age <= 130
    && publicAge === age && decodeFirestoreValue(publicProfile?.fields?.isPublic) === true
    && Array.isArray(photos) && Array.isArray(published) && Array.isArray(verifiedPhotos)
    && photos.length >= 3 && photos.length <= 5 && photos.length === published.length && photos.length === verifiedPhotos.length
    && new Set(photos).size === photos.length
    && photos.every((photo: unknown, index: number) => {
      if (typeof photo !== 'string' || photo !== published[index] || photo !== verifiedPhotos[index]) return false;
      const object = parseProfileGalleryUrl(photo, userId, bucket);
      return object !== null && photo === `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(object.objectName)}?alt=media&token=${encodeURIComponent(object.downloadToken)}`;
    });
}

function allowedAccount(document: AdminFirestoreDocument | null): boolean {
  if (!document) return true;
  const status = decodeFirestoreValue(document.fields?.status);
  const until = decodeFirestoreValue(document.fields?.until);
  return status === 'active' || (status === 'suspended' && typeof until === 'string' && Date.parse(until) <= Date.now());
}

export async function POST(request: Request) {
  let user: Awaited<ReturnType<typeof authenticateRequest>>;
  try {
    user = await authenticateRequest(request);
  } catch (error) {
    return unauthorizedResponse(error);
  }
  if (!user || !uidPattern.test(user.uid)) return unauthorizedResponse(new Error('Login required.'));
  const rate = consumeRateLimit(`matching-like:${user.uid}`, 60, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterMs);

  if (Number(request.headers.get('content-length') || 0) > 1024) return json({ error: 'Request too large.' }, 413);
  let raw = '';
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ error: 'Invalid request.' }, 400);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) {
        await reader.cancel().catch(() => undefined);
        return json({ error: 'Request too large.' }, 413);
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  let targetUserId = '';
  let action: 'like' | 'accept' | 'decline' = 'like';
  try {
    const input: unknown = JSON.parse(raw);
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some((key) => key !== 'targetUserId' && key !== 'action')
      || typeof (input as { targetUserId?: unknown }).targetUserId !== 'string'
      || ((input as { action?: unknown }).action !== undefined && !['accept', 'decline'].includes(String((input as { action?: unknown }).action)))) throw new Error();
    targetUserId = (input as { targetUserId: string }).targetUserId;
    action = (input as { action?: 'accept' | 'decline' }).action || 'like';
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  const friendshipId = `friend-${[user.uid, targetUserId].sort().join('-')}`;
  const blocks = [{ ownerId: user.uid, blockedUserId: targetUserId }, { ownerId: targetUserId, blockedUserId: user.uid }];
  const blockIds = blocks.map(({ ownerId, blockedUserId }) => `${ownerId}-${blockedUserId}`);
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const dailyId = `${user.uid}-${day}`;
  if (!uidPattern.test(targetUserId) || targetUserId === user.uid
    || [friendshipId, dailyId, ...blockIds].some((id) => id.length > 128)) return json({ error: 'Invalid target.' }, 400);

  try {
    const canonical = { collection: 'friendships', id: friendshipId };
    const legacy = { collection: 'webrtcCalls', id: friendshipId };
    const daily = { collection: 'matchingLikeDaily', id: dailyId };
    const documents = action === 'decline' ? [canonical, legacy] : [canonical, legacy, daily,
      ...[user.uid, targetUserId].flatMap((id) => ['profiles', 'publicProfiles', 'verifiedProfilePhotos', 'accountModeration'].map((collection) => ({ collection, id }))),
      ...blockIds.map((id) => ({ collection: 'userBlocks', id }))];
    const result = await runFirestoreTransaction<{ matched: boolean; remaining: number } | { declined: boolean }>(documents, ({ projectId, get }) => {
      if (action === 'decline') {
        const primary = get(canonical);
        const connection = primary || get(legacy);
        if (!connection?.updateTime || decodeFirestoreValue(connection.fields?.requesterId) !== targetUserId
          || decodeFirestoreValue(connection.fields?.addresseeId) !== user.uid
          || decodeFirestoreValue(connection.fields?.status) !== 'pending') throw new UnavailableMatch();
        return { writes: [{ update: {
          name: adminDocumentName(projectId, primary ? canonical.collection : legacy.collection, friendshipId),
          fields: { ...connection.fields, status: firestoreValue('declined'), updatedAt: { timestampValue: new Date().toISOString() } },
        }, currentDocument: { updateTime: connection.updateTime } }], result: { declined: true } };
      }
      const ledger = get(daily);
      const used = ledger ? decodeFirestoreValue(ledger.fields?.count) : 0;
      if (typeof used !== 'number' || !Number.isSafeInteger(used) || used < 0
        || (ledger && (decodeFirestoreValue(ledger.fields?.userId) !== user.uid || decodeFirestoreValue(ledger.fields?.day) !== day))) throw new Error('Invalid quota ledger.');
      if (blocks.some(({ ownerId, blockedUserId }) => {
        const block = get({ collection: 'userBlocks', id: `${ownerId}-${blockedUserId}` });
        return block && decodeFirestoreValue(block.fields?.ownerId) === ownerId
          && decodeFirestoreValue(block.fields?.blockedUserId) === blockedUserId;
      }) || [user.uid, targetUserId].some((id) => !allowedAccount(get({ collection: 'accountModeration', id }))
        || !eligibleProfile(get({ collection: 'profiles', id }), get({ collection: 'publicProfiles', id }), get({ collection: 'verifiedProfilePhotos', id }), id))) {
        throw new UnavailableMatch();
      }

      const primary = get(canonical);
      const old = get(legacy);
      const connection = primary || old;
      if (action === 'accept' && (!connection || decodeFirestoreValue(connection.fields?.requesterId) !== targetUserId
        || decodeFirestoreValue(connection.fields?.addresseeId) !== user.uid
        || !['pending', 'accepted'].includes(String(decodeFirestoreValue(connection.fields?.status))))) throw new UnavailableMatch();
      if (connection) {
        const requester = decodeFirestoreValue(connection.fields?.requesterId);
        const addressee = decodeFirestoreValue(connection.fields?.addresseeId);
        const status = decodeFirestoreValue(connection.fields?.status);
        if (!((requester === user.uid && addressee === targetUserId) || (requester === targetUserId && addressee === user.uid))
          || !['pending', 'accepted', 'declined'].includes(String(status))) throw new UnavailableMatch();
        if (status === 'accepted') return { writes: primary ? [] : [{ update: {
          name: adminDocumentName(projectId, canonical.collection, friendshipId),
          fields: { requesterId: firestoreValue(requester), addresseeId: firestoreValue(addressee), status: firestoreValue('accepted'),
            createdAt: connection.fields?.createdAt || { timestampValue: new Date().toISOString() }, updatedAt: { timestampValue: new Date().toISOString() } },
        }, currentDocument: { exists: false } }], result: { matched: true, remaining: Math.max(0, 30 - used) } };
        if (status === 'pending' && requester === user.uid) return { writes: [], result: { matched: false, remaining: Math.max(0, 30 - used) } };
      }
      if (used >= 30) throw new QuotaExceeded();
      const now = new Date().toISOString();
      const writes: FirestoreWrite[] = [];
      if (connection?.fields && decodeFirestoreValue(connection.fields.status) === 'declined') {
        if (primary && !connection.updateTime) throw new Error('Invalid connection snapshot.');
        writes.push({ update: { name: adminDocumentName(projectId, canonical.collection, friendshipId), fields: {
          requesterId: firestoreValue(user.uid), addresseeId: firestoreValue(targetUserId), status: firestoreValue('pending'),
          createdAt: { timestampValue: now }, updatedAt: { timestampValue: now },
        } }, currentDocument: primary ? { updateTime: connection.updateTime } : { exists: false } });
      } else if (connection) {
        if (!connection.updateTime) throw new Error('Invalid connection snapshot.');
        writes.push({ update: { name: adminDocumentName(projectId, primary ? canonical.collection : legacy.collection, friendshipId),
          fields: { ...connection.fields, status: firestoreValue('accepted'), updatedAt: { timestampValue: now } } },
        currentDocument: { updateTime: connection.updateTime } });
        if (!primary) writes.push({ update: { name: adminDocumentName(projectId, canonical.collection, friendshipId), fields: {
          requesterId: firestoreValue(decodeFirestoreValue(connection.fields?.requesterId)),
          addresseeId: firestoreValue(decodeFirestoreValue(connection.fields?.addresseeId)),
          status: firestoreValue('accepted'),
          createdAt: connection.fields?.createdAt || { timestampValue: now }, updatedAt: { timestampValue: now },
        } }, currentDocument: { exists: false } });
      } else {
        writes.push({ update: { name: adminDocumentName(projectId, canonical.collection, friendshipId), fields: {
          requesterId: firestoreValue(user.uid), addresseeId: firestoreValue(targetUserId), status: firestoreValue('pending'),
          createdAt: { timestampValue: now }, updatedAt: { timestampValue: now },
        } }, currentDocument: { exists: false } });
      }
      writes.push({ update: { name: adminDocumentName(projectId, daily.collection, daily.id), fields: {
        userId: firestoreValue(user.uid), day: firestoreValue(day), count: firestoreValue(used + 1), updatedAt: { timestampValue: now },
      } }, currentDocument: ledger?.updateTime ? { updateTime: ledger.updateTime } : { exists: false } });
      return { writes, result: { matched: Boolean(connection && decodeFirestoreValue(connection.fields?.status) === 'pending'), remaining: 29 - used } };
    });
    return json(result);
  } catch (error) {
    if (error instanceof QuotaExceeded) return json({ error: 'Daily free like limit reached.', remaining: 0 }, 429);
    if (error instanceof UnavailableMatch) return json({ error: 'This match is unavailable.' }, 409);
    return json({ error: 'Could not complete the like. Please try again.' }, 503);
  }
}
