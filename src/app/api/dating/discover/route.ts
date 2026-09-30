import { decodeFirestoreValue, getAdminDocument, getAdminDocuments, queryAdminDocuments } from '@/lib/firebaseAdmin';
import { clientAddress, consumeRateLimit, requireAuthenticatedUser } from '@/lib/apiSecurity';
import type { VerifiedUser } from '@/lib/apiSecurity';
import { areDatingProfilesCompatible, hasDatingContactInfo, type DatingGender, type DatingPreference } from '@/lib/dating';

export const runtime = 'edge';

function allowedAccount(record: { status?: unknown; until?: unknown } | null): boolean {
  if (!record) return true;
  if (record.status === 'active') return true;
  return record.status === 'suspended'
    && typeof record.until === 'string'
    && Number.isFinite(Date.parse(record.until))
    && Date.parse(record.until) <= Date.now();
}

type PublicAdultProfile = {
  displayName: string;
  image: string;
  age: number;
  gender: DatingGender;
  country: string;
  city: string;
  bio: string;
  preferredGender: DatingPreference;
  minAge: number;
  maxAge: number;
  isActive: true;
};

function isPublicAdultProfile(profile: Record<string, unknown>): profile is Record<string, unknown> & PublicAdultProfile {
  return profile.isActive === true
    && Number.isInteger(profile.age) && Number(profile.age) >= 18 && Number(profile.age) <= 130
    && (profile.gender === 'male' || profile.gender === 'female')
    && typeof profile.displayName === 'string' && profile.displayName.trim().length > 0 && profile.displayName.length <= 80
    && typeof profile.image === 'string' && profile.image.length <= 2_000 && (!profile.image || /^https:\/\//i.test(profile.image))
    && typeof profile.country === 'string' && profile.country.trim().length > 0 && profile.country !== 'Global' && profile.country.length <= 80
    && typeof profile.city === 'string' && profile.city.length <= 80
    && typeof profile.bio === 'string' && profile.bio.length <= 280
    && !hasDatingContactInfo(profile.displayName) && !hasDatingContactInfo(profile.city) && !hasDatingContactInfo(profile.bio)
    && (profile.preferredGender === 'any' || profile.preferredGender === 'male' || profile.preferredGender === 'female')
    && Number.isInteger(profile.minAge) && Number(profile.minAge) >= 18
    && Number.isInteger(profile.maxAge) && Number(profile.maxAge) >= Number(profile.minAge)
    && Number(profile.maxAge) <= 130;
}

export async function GET(request: Request) {
  let user: VerifiedUser;
  try {
    user = await requireAuthenticatedUser(request);
  } catch {
    return Response.json({ error: '로그인 후 이용해주세요.' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
  }
  const limit = consumeRateLimit(`dating-discover:${user.uid}:${clientAddress(request)}`, 30, 60_000);
  if (!limit.allowed) return Response.json(
    { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', retryAfterMs: limit.retryAfterMs },
    { status: 429, headers: { 'Retry-After': String(Math.ceil(limit.retryAfterMs / 1_000)), 'Cache-Control': 'private, no-store' } },
  );

  try {
    const [profile, moderation] = await Promise.all([
      getAdminDocument('profiles', user.uid),
      getAdminDocument('accountModeration', user.uid),
    ]);
    const age = decodeFirestoreValue(profile?.fields?.age);
    const moderationData = moderation ? {
      status: decodeFirestoreValue(moderation.fields?.status),
      until: decodeFirestoreValue(moderation.fields?.until),
    } : null;
    if (!Number.isInteger(age) || Number(age) < 18) return Response.json({ error: '데이트 기능은 만 18세 이상 회원만 이용할 수 있습니다.' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
    if (!allowedAccount(moderationData)) return Response.json({ error: '현재 계정 상태에서는 회원 검색을 사용할 수 없습니다.' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
    const ownDatingProfile = await getAdminDocument('datingProfiles', user.uid);
    const ownData = Object.fromEntries(Object.entries(ownDatingProfile?.fields || {}).map(([key, value]) => [key, decodeFirestoreValue(value)]));
    const accountGender = decodeFirestoreValue(profile?.fields?.gender);
    const accountCountry = decodeFirestoreValue(profile?.fields?.country);
    if (!isPublicAdultProfile(ownData) || ownData.age !== age || ownData.gender !== accountGender || ownData.country !== accountCountry) {
      return Response.json({ error: '먼저 데이트 프로필을 작성하고 공개를 켜주세요.' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
    }

    const profiles = await queryAdminDocuments('datingProfiles', 'isActive', true, 200);
    const viewerCriteria = {
      id: user.uid,
      age: ownData.age,
      gender: ownData.gender,
      preferredGender: ownData.preferredGender,
      minAge: ownData.minAge,
      maxAge: ownData.maxAge,
      isActive: ownData.isActive,
    };
    const publicProfiles = profiles.flatMap(({ id, data }) => {
      if (id === user.uid || !isPublicAdultProfile(data)) return [];
      return [{ id, data }];
    });
    const mutualProfiles = publicProfiles
      .filter(({ id, data }) => areDatingProfilesCompatible(viewerCriteria, {
        id,
        age: data.age,
        gender: data.gender,
        preferredGender: data.preferredGender,
        minAge: data.minAge,
        maxAge: data.maxAge,
        isActive: data.isActive,
      }));

    const [blockedByViewer, blockingViewer, moderationRows, accountRows] = await Promise.all([
      queryAdminDocuments('userBlocks', 'ownerId', user.uid, 501),
      queryAdminDocuments('userBlocks', 'blockedUserId', user.uid, 501),
      getAdminDocuments('accountModeration', mutualProfiles.map(({ id }) => id)),
      getAdminDocuments('profiles', mutualProfiles.map(({ id }) => id)),
    ]);
    if (blockedByViewer.length > 500 || blockingViewer.length > 500) {
      return Response.json({ error: '차단 목록이 너무 커서 회원 검색을 안전하게 처리하지 못했습니다.' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
    }
    const hiddenIds = new Set([
      ...blockedByViewer.map(({ data }) => data.blockedUserId).filter((id): id is string => typeof id === 'string'),
      ...blockingViewer.map(({ data }) => data.ownerId).filter((id): id is string => typeof id === 'string'),
      ...moderationRows.filter(({ data }) => !allowedAccount(data)).map(({ id }) => id),
    ]);
    const accountsById = new Map(accountRows.map(({ id, data }) => [id, data]));

    const safeProfiles = mutualProfiles
      .filter(({ id, data }) => {
        const account = accountsById.get(id);
        const accountAge = account?.age;
        return !hiddenIds.has(id)
          && typeof accountAge === 'number' && Number.isInteger(accountAge) && accountAge >= 18 && accountAge <= 130
          && accountAge === data.age
          && account?.gender === data.gender
          && account?.country === data.country;
      })
      .map(({ id, data }) => ({
        id,
        displayName: data.displayName,
        image: data.image,
        age: data.age,
        gender: data.gender,
        country: data.country,
        city: data.city,
        bio: data.bio,
      }));

    return Response.json({ profiles: safeProfiles }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: '회원 프로필을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
