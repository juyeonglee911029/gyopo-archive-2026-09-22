import { authenticateRequest, clientAddress, consumeRateLimit, rateLimitResponse, unauthorizedResponse } from '@/lib/apiSecurity';
import { adminDocumentName, runFirestoreTransaction, serviceAccountAccessToken, type AdminFirestoreValue } from '@/lib/firebaseAdmin';
import { galleryDeletionClaimId, MAX_PROFILE_PHOTOS, normalizeProfilePhotos, parseProfileGalleryUrl } from '@/lib/profilePhotos';

export const runtime = 'edge';

const bucket = 'gyopo-live-portal-506019.firebasestorage.app';
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store, private' } });

class InvalidGalleryError extends Error {}

function encodedPhotos(photos: string[]): AdminFirestoreValue {
  return { arrayValue: { values: photos.map((stringValue) => ({ stringValue })) } };
}

export async function POST(request: Request) {
  const user = await authenticateRequest(request).catch(() => null);
  if (!user) return unauthorizedResponse(new Error('로그인 세션이 필요합니다.'));
  const rate = consumeRateLimit(`profile-gallery-verify:${user.uid}:${clientAddress(request)}`, 8, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterMs);

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 16_384) return json({ error: '요청 크기가 너무 큽니다.' }, 413);
  let input: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 16_384) return json({ error: '요청 크기가 너무 큽니다.' }, 413);
    input = JSON.parse(raw);
  } catch {
    return json({ error: '요청 형식이 올바르지 않습니다.' }, 400);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => key !== 'profilePhotos')) {
    return json({ error: '공개 사진 정보가 올바르지 않습니다.' }, 400);
  }
  const values = (input as { profilePhotos?: unknown }).profilePhotos;
  if (!Array.isArray(values) || values.length > MAX_PROFILE_PHOTOS || values.some((value) => typeof value !== 'string')) {
    return json({ error: '공개 사진은 최대 5장까지 확인할 수 있습니다.' }, 400);
  }
  const photos = normalizeProfilePhotos(values);
  if (photos.length !== values.length || photos.some((photo, index) => photo !== values[index])) {
    return json({ error: '공개 사진 주소가 중복되었거나 올바르지 않습니다.' }, 400);
  }
  const objects = photos.map((photo) => parseProfileGalleryUrl(photo, user.uid, bucket));
  if (objects.some((object) => !object)) return json({ error: '본인 계정에 업로드한 공개 JPEG 사진만 사용할 수 있습니다.' }, 400);

  try {
    if (objects.length > 0) {
      const token = await serviceAccountAccessToken('https://www.googleapis.com/auth/devstorage.read_only');
      await Promise.all(objects.map(async (object, index) => {
        if (!object) throw new InvalidGalleryError('Invalid gallery object.');
        const url = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object.objectName)}`);
        url.searchParams.set('fields', 'name,bucket,size,contentType,metadata');
        const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000) });
        if (response.status === 404 || response.status === 403) throw new InvalidGalleryError('Gallery object is unavailable.');
        if (!response.ok) throw new Error('Gallery object lookup failed.');
        const metadata = await response.json() as {
          name?: string; bucket?: string; size?: string; contentType?: string;
          metadata?: { firebaseStorageDownloadTokens?: string };
        };
        const tokens = metadata.metadata?.firebaseStorageDownloadTokens?.split(',') || [];
        if (metadata.name !== object.objectName || metadata.bucket !== bucket || metadata.contentType !== 'image/jpeg'
          || Number(metadata.size) <= 0 || Number(metadata.size) > 5 * 1024 * 1024 || !tokens.includes(object.downloadToken)
          || photos[index] !== `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(object.objectName)}?alt=media&token=${encodeURIComponent(object.downloadToken)}`) {
          throw new InvalidGalleryError('Gallery metadata is invalid.');
        }
      }));
    }

    const claims = await Promise.all(objects.map((object) => galleryDeletionClaimId(object!.objectName)));
    const verifiedCount = await runFirestoreTransaction(
      [{ collection: 'verifiedProfilePhotos', id: user.uid }, ...claims.map((id) => ({ collection: 'galleryDeletionClaims', id }))],
      ({ projectId, get }) => {
        if (claims.some((id) => get({ collection: 'galleryDeletionClaims', id }))) {
          throw new InvalidGalleryError('Gallery object was removed.');
        }
        const existing = get({ collection: 'verifiedProfilePhotos', id: user.uid });
        return {
          writes: [{
            update: {
              name: adminDocumentName(projectId, 'verifiedProfilePhotos', user.uid),
              fields: {
                profilePhotos: encodedPhotos(photos),
                updatedAt: { timestampValue: new Date().toISOString() },
              },
            },
            currentDocument: existing?.updateTime ? { updateTime: existing.updateTime } : { exists: false },
          }],
          result: photos.length,
        };
      },
    );
    return json({ verified: true, photoCount: verifiedCount });
  } catch (error) {
    if (error instanceof InvalidGalleryError) return json({ error: '사진 주소 또는 업로드 상태를 확인해야 합니다.' }, 409);
    return json({ error: '공개 사진 인증을 완료하지 못했습니다. 잠시 후 저장을 다시 시도해주세요.' }, 503);
  }
}
