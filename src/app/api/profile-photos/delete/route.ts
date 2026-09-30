import { authenticateRequest, clientAddress, consumeRateLimit, rateLimitResponse, unauthorizedResponse } from '@/lib/apiSecurity';
import { adminDocumentName, decodeFirestoreValue, getAdminDocument, runFirestoreTransaction, serviceAccountAccessToken, type AdminFirestoreDocument } from '@/lib/firebaseAdmin';
import { galleryDeletionClaimId, parseProfileGalleryUrl } from '@/lib/profilePhotos';

export const runtime = 'edge';

const bucket = 'gyopo-live-portal-506019.firebasestorage.app';
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store, private' } });

class ReferencedPhotoError extends Error {}
class InvalidPhotoError extends Error {}

function referencesObject(document: AdminFirestoreDocument | null, objectName: string, userId: string): boolean {
  const photos = decodeFirestoreValue(document?.fields?.profilePhotos);
  return Array.isArray(photos) && photos.some((photo) => typeof photo === 'string'
    && parseProfileGalleryUrl(photo, userId, bucket)?.objectName === objectName);
}

export async function POST(request: Request) {
  let user: Awaited<ReturnType<typeof authenticateRequest>>;
  try {
    user = await authenticateRequest(request);
  } catch (error) {
    return unauthorizedResponse(error);
  }
  if (!user) return unauthorizedResponse(new Error('로그인 세션이 필요합니다.'));
  const rate = consumeRateLimit(`profile-gallery-delete:${user.uid}:${clientAddress(request)}`, 20, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterMs);

  if (Number(request.headers.get('content-length') || 0) > 4096) return json({ error: '요청 크기가 너무 큽니다.' }, 413);
  let photoUrl: string;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 4096) return json({ error: '요청 크기가 너무 큽니다.' }, 413);
    const input = JSON.parse(raw);
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length !== 1 || typeof input.photoUrl !== 'string') throw new Error();
    photoUrl = input.photoUrl;
  } catch {
    return json({ error: '사진 삭제 요청이 올바르지 않습니다.' }, 400);
  }
  const object = parseProfileGalleryUrl(photoUrl, user.uid, bucket);
  if (!object) return json({ error: '본인 공개 사진만 삭제할 수 있습니다.' }, 400);

  try {
    const claimId = await galleryDeletionClaimId(object.objectName);
    const token = await serviceAccountAccessToken('https://www.googleapis.com/auth/devstorage.read_write');
    const endpoint = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object.objectName)}`;
    const metadataUrl = new URL(endpoint);
    metadataUrl.searchParams.set('fields', 'name,bucket,generation,metadata');
    const metadataResponse = await fetch(metadataUrl, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000) });
    if (metadataResponse.status === 404) {
      const claim = await getAdminDocument('galleryDeletionClaims', claimId);
      if (decodeFirestoreValue(claim?.fields?.objectName) === object.objectName
        && decodeFirestoreValue(claim?.fields?.downloadToken) === object.downloadToken) return json({ deleted: true });
      throw new InvalidPhotoError('Gallery object is unavailable.');
    }
    if (!metadataResponse.ok) throw new Error('Gallery object lookup failed.');
    const metadata = await metadataResponse.json() as {
      name?: string; bucket?: string; generation?: string; metadata?: { firebaseStorageDownloadTokens?: string };
    };
    if (metadata.name !== object.objectName || metadata.bucket !== bucket
      || !metadata.generation || !/^\d+$/.test(metadata.generation)
      || !metadata.metadata?.firebaseStorageDownloadTokens?.split(',').includes(object.downloadToken)
      || photoUrl !== `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(object.objectName)}?alt=media&token=${encodeURIComponent(object.downloadToken)}`) {
      throw new InvalidPhotoError('Gallery metadata is invalid.');
    }

    await runFirestoreTransaction(
      ['profiles', 'publicProfiles', 'verifiedProfilePhotos'].map((collection) => ({ collection, id: user.uid }))
        .concat([{ collection: 'galleryDeletionClaims', id: claimId }]),
      ({ projectId, get }) => {
        if (['profiles', 'publicProfiles', 'verifiedProfilePhotos'].some((collection) =>
          referencesObject(get({ collection, id: user.uid }), object.objectName, user.uid))) {
          throw new ReferencedPhotoError('Gallery object is still in use.');
        }
        const claim = get({ collection: 'galleryDeletionClaims', id: claimId });
        if (claim && (decodeFirestoreValue(claim.fields?.objectName) !== object.objectName
          || decodeFirestoreValue(claim.fields?.downloadToken) !== object.downloadToken
          || decodeFirestoreValue(claim.fields?.generation) !== metadata.generation)) {
          throw new InvalidPhotoError('Gallery deletion claim does not match.');
        }
        return {
          writes: claim ? [] : [{
            update: {
              name: adminDocumentName(projectId, 'galleryDeletionClaims', claimId),
              fields: {
                userId: { stringValue: user.uid },
                objectName: { stringValue: object.objectName },
                downloadToken: { stringValue: object.downloadToken },
                generation: { stringValue: metadata.generation! },
                createdAt: { timestampValue: new Date().toISOString() },
              },
            },
            currentDocument: { exists: false },
          }],
          result: true,
        };
      },
    );

    const deleteUrl = new URL(endpoint);
    deleteUrl.searchParams.set('ifGenerationMatch', metadata.generation);
    const deleted = await fetch(deleteUrl, { method: 'DELETE', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000) });
    if (deleted.status === 412) return json({ error: '사진 파일이 변경되어 삭제를 중단했습니다.' }, 409);
    if (!deleted.ok && deleted.status !== 404) throw new Error('Gallery object deletion failed.');
    return json({ deleted: true });
  } catch (error) {
    if (error instanceof ReferencedPhotoError) return json({ error: '현재 프로필에 사용 중인 사진은 삭제할 수 없습니다. 먼저 프로필을 저장해주세요.' }, 409);
    if (error instanceof InvalidPhotoError) return json({ error: '사진 파일의 소유권이나 업로드 상태를 확인해주세요.' }, 409);
    return json({ error: '사진 파일을 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.' }, 503);
  }
}
