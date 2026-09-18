import { consumeRateLimit, FIREBASE_PROJECT_ID, rateLimitResponse, requireAuthenticatedUser, unauthorizedResponse } from '@/lib/apiSecurity';
import { googlePlace } from '@/lib/directoryPlaces';
import { parseGoogleMapsUrl } from '@/lib/directoryMaps';
export const runtime = 'edge';
export async function POST(request: Request) {
  let user;
  try { user = await requireAuthenticatedUser(request); } catch (error) { return unauthorizedResponse(error); }
  const rate = consumeRateLimit(`directory-submit:${user.uid}`, 5, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterMs);
  if (Number(request.headers.get('content-length')) > 12_000) return Response.json({ error: '요청이 너무 큽니다.' }, { status: 413 });
  const raw = await request.text();
  if (raw.length > 12_000) return Response.json({ error: '요청이 너무 큽니다.' }, { status: 413 });
  let body;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: '잘못된 요청입니다.' }, { status: 400 }); }
  const categories = ['음식점·카페', '병원·의료', '마트·식품', '미용·뷰티', '법률·회계', '부동산', '교육', 'IT·서비스', '공공기관·단체', '종교·단체', '기타'];
  if (!body || typeof body.placeId !== 'string' || (body.placeId !== '' && !/^[A-Za-z0-9_-]{5,200}$/.test(body.placeId)) || !categories.includes(body.category) || typeof body.name !== 'string' || body.name.trim().length < 2 || body.name.length > 200 || typeof body.address !== 'string' || body.address.trim().length < 3 || body.address.length > 1000 || typeof body.desc !== 'string' || body.desc.trim().length < 12 || body.desc.length > 4000 || typeof body.country !== 'string' || body.country.length > 80 || typeof body.image !== 'string' || body.image.length > 2048 || typeof body.tel !== 'string' || body.tel.length > 40 || body.tel.replace(/\D/g, '').length < 7) return Response.json({ error: '업체 정보를 정확히 입력해주세요.' }, { status: 400 });
  const maps = typeof body.mapsUrl === 'string' ? parseGoogleMapsUrl(body.mapsUrl) : null;
  if ((!body.placeId && !maps) || (body.mapsUrl && !maps)) return Response.json({ error: '유효한 Google Maps 링크가 필요합니다.' }, { status: 400 });
  if (/구인|구직|채용|모집|급여|시급|월급|파트타임|정규직/i.test([body.name, body.address, body.desc, body.tel, body.image].join(' '))) return Response.json({ error: '구인 정보는 구인구직 메뉴에 등록해주세요.' }, { status: 400 });
  if (body.image) { try { const url = new URL(body.image); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); } catch { return Response.json({ error: '사진은 HTTPS URL이어야 합니다.' }, { status: 400 }); } }
  try {
    // Re-fetch authoritative identity at write time; never trust client verification flags.
    // Manual links are stored, never fetched or treated as provider verification.
    const place = body.placeId && (process.env.GOOGLE_PLACES_API_KEY?.trim() || !maps) ? await googlePlace(body.placeId) : null;
    if (place && place.businessStatus !== 'OPERATIONAL') return Response.json({ error: '영업 중인 실제 업체만 등록할 수 있습니다.' }, { status: 422 });
    const record: Record<string, string> = { name: place?.name || body.name.trim(), address: place?.address || body.address.trim(), tel: place?.tel || body.tel.trim(), placeId: place?.placeId || '', mapsUrl: place?.mapsUrl || maps?.url || '', verificationStatus: place ? 'google_verified' : 'unverified', category: body.category, desc: body.desc.trim(), image: body.image, country: body.country, authorId: user.uid, createdAt: new Date().toISOString() };
    const response = await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/directories`, { method: 'POST', headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(record).map(([key, value]) => [key, { stringValue: value }])) }), signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return Response.json({ error: '업체 저장 권한 또는 연결을 확인해주세요.' }, { status: 502 });
    return Response.json({ status: 'created', verificationStatus: record.verificationStatus }, { status: 201 });
  } catch (error) {
    const missing = error instanceof Error && error.message === 'NOT_CONFIGURED';
    return Response.json({ error: missing ? 'Google Places API 키가 없습니다. Google Maps 링크로 미검증 등록할 수 있습니다.' : '업체 검증 또는 저장에 실패했습니다.' }, { status: missing ? 503 : 502 });
  }
}
