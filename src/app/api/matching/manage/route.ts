import { authenticateRequest, clientAddress, consumeRateLimit, rateLimitResponse, unauthorizedResponse } from '@/lib/apiSecurity';
import { adminDocumentName, decodeFirestoreValue, firestoreValue, runFirestoreTransaction, type FirestoreWrite } from '@/lib/firebaseAdmin';

export const runtime = 'edge';

const uidPattern = /^[A-Za-z0-9_-]{1,128}$/;
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store, private' } });

class UnavailableFriend extends Error {}

export async function POST(request: Request) {
  let user: Awaited<ReturnType<typeof authenticateRequest>>;
  try {
    user = await authenticateRequest(request);
  } catch (error) {
    return unauthorizedResponse(error);
  }
  if (!user || !uidPattern.test(user.uid)) return unauthorizedResponse(new Error('Login required.'));
  const rate = consumeRateLimit(`matching-manage:${user.uid}:${clientAddress(request)}`, 12, 60_000);
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
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !['targetUserId', 'action', 'blockedName'].includes(key))) return json({ error: 'Invalid request.' }, 400);
  const body = input as { targetUserId?: unknown; action?: unknown; blockedName?: unknown };
  if (typeof body.targetUserId !== 'string' || !uidPattern.test(body.targetUserId) || body.targetUserId === user.uid
    || (body.action !== 'remove' && body.action !== 'block')
    || (body.blockedName !== undefined && (typeof body.blockedName !== 'string' || body.blockedName.length > 80))) {
    return json({ error: 'Invalid friend action.' }, 400);
  }

  const targetUserId = body.targetUserId;
  const action = body.action;
  const friendshipId = `friend-${[user.uid, targetUserId].sort().join('-')}`;
  const blockId = `${user.uid}-${targetUserId}`;
  if (friendshipId.length > 128 || blockId.length > 128) return json({ error: 'Invalid friend action.' }, 400);
  const canonical = { collection: 'friendships', id: friendshipId };
  const legacy = { collection: 'webrtcCalls', id: friendshipId };
  const block = { collection: 'userBlocks', id: blockId };

  try {
    const result = await runFirestoreTransaction<{ removed: boolean; blocked: boolean }>(
      [canonical, legacy, ...(action === 'block' ? [block] : [])],
      ({ projectId, get }) => {
        const primary = get(canonical);
        const connection = primary || get(legacy);
        const requesterId = decodeFirestoreValue(connection?.fields?.requesterId);
        const addresseeId = decodeFirestoreValue(connection?.fields?.addresseeId);
        const status = decodeFirestoreValue(connection?.fields?.status);
        if (!connection?.updateTime
          || !((requesterId === user.uid && addresseeId === targetUserId) || (requesterId === targetUserId && addresseeId === user.uid))) {
          throw new UnavailableFriend();
        }

        const writes: FirestoreWrite[] = [];
        if (status === 'accepted') {
          const now = new Date().toISOString();
          writes.push({ update: {
            name: adminDocumentName(projectId, primary ? canonical.collection : legacy.collection, friendshipId),
            fields: { ...(connection.fields || {}), status: firestoreValue('removed'), updatedAt: { timestampValue: now } },
          }, currentDocument: { updateTime: connection.updateTime } });
        } else if (status !== 'removed') {
          throw new UnavailableFriend();
        }

        if (action === 'block') {
          const existingBlock = get(block);
          if (existingBlock) {
            if (decodeFirestoreValue(existingBlock.fields?.ownerId) !== user.uid
              || decodeFirestoreValue(existingBlock.fields?.blockedUserId) !== targetUserId) throw new UnavailableFriend();
          } else {
            writes.push({ update: {
              name: adminDocumentName(projectId, block.collection, block.id),
              fields: {
                ownerId: firestoreValue(user.uid),
                blockedUserId: firestoreValue(targetUserId),
                blockedName: firestoreValue((body.blockedName as string | undefined)?.trim().slice(0, 80) || targetUserId),
                callId: firestoreValue(null),
                createdAt: { timestampValue: new Date().toISOString() },
              },
            }, currentDocument: { exists: false } });
          }
        }

        return { writes, result: { removed: true, blocked: action === 'block' } };
      },
    );
    return json(result);
  } catch (error) {
    if (error instanceof UnavailableFriend) return json({ error: 'This friend connection is no longer available.' }, 409);
    return json({ error: action === 'remove' ? 'Could not remove this friend.' : 'Could not block this friend.' }, 503);
  }
}
