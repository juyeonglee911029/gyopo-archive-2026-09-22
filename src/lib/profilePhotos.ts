export const MAX_PROFILE_PHOTOS = 5;
export const MIN_PROFILE_PHOTOS_FOR_MATCH = 3;
export const MATCH_PHOTO_PREVIEW_COUNT = 3;

export type ProfileGalleryObject = { objectName: string; downloadToken: string };

export function normalizeProfilePhotos(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((photo): photo is string => typeof photo === 'string')
    .map((photo) => photo.trim())
    .filter(Boolean))]
    .slice(0, MAX_PROFILE_PHOTOS);
}

export function canPhotoMatch(profilePhotos: unknown): boolean {
  return normalizeProfilePhotos(profilePhotos).length >= MIN_PROFILE_PHOTOS_FOR_MATCH;
}

export function getVisibleMatchPhotos(viewerPhotos: unknown, otherPhotos: unknown): string[] {
  const viewerCount = normalizeProfilePhotos(viewerPhotos).length;
  if (viewerCount < MIN_PROFILE_PHOTOS_FOR_MATCH) return [];
  const revealCount = viewerCount < MAX_PROFILE_PHOTOS
    ? MATCH_PHOTO_PREVIEW_COUNT
    : MAX_PROFILE_PHOTOS;
  return normalizeProfilePhotos(otherPhotos).slice(0, revealCount);
}

export function parseProfileGalleryUrl(value: string, userId: string, bucket: string): ProfileGalleryObject | null {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId)) return null;
  try {
    const url = new URL(value);
    const prefix = `/v0/b/${bucket}/o/`;
    if (url.origin !== 'https://firebasestorage.googleapis.com' || !url.pathname.startsWith(prefix) || url.hash) return null;
    const objectName = decodeURIComponent(url.pathname.slice(prefix.length));
    const ownedPrefix = `profiles/${userId}/gallery/`;
    const fileName = objectName.slice(ownedPrefix.length);
    const downloadToken = url.searchParams.get('token') || '';
    if (!objectName.startsWith(ownedPrefix) || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\.jpg$/i.test(fileName)) return null;
    if (url.searchParams.get('alt') !== 'media' || !/^[A-Za-z0-9_-]{16,256}$/.test(downloadToken)) return null;
    return { objectName, downloadToken };
  } catch {
    return null;
  }
}

export async function galleryDeletionClaimId(objectName: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(objectName));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
