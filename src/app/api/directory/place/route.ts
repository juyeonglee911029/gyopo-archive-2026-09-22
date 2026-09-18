import { clientAddress, consumeRateLimit, rateLimitResponse, requireAuthenticatedUser, unauthorizedResponse } from '@/lib/apiSecurity';
import { googlePlace, placesRequest } from '@/lib/directoryPlaces';

export const runtime = 'edge';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const input = params.get('input');
  let identity = clientAddress(request);
  if (input !== null) {
    try { identity = (await requireAuthenticatedUser(request)).uid; }
    catch (error) { return unauthorizedResponse(error); }
  }
  const rate = consumeRateLimit(`directory-place:${identity}`, 30, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterMs);
  try {
    if (input !== null) {
      if (input.trim().length < 3 || input.length > 200) return Response.json({ error: '검색어는 3~200자여야 합니다.' }, { status: 400 });
      const data = await placesRequest('places:autocomplete', { method: 'POST', body: JSON.stringify({ input: input.trim(), includePureServiceAreaBusinesses: false }) });
      return Response.json({ suggestions: (data.suggestions || []).flatMap((item: { placePrediction?: { placeId: string; text?: { text: string } } }) => item.placePrediction ? [{ placeId: item.placePrediction.placeId, label: item.placePrediction.text?.text || '' }] : []).slice(0, 5) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const placeId = params.get('placeId') || '';
    if (!/^[A-Za-z0-9_-]{5,200}$/.test(placeId)) return Response.json({ error: 'Google 장소를 선택하거나 장소 ID가 있는 Maps 링크를 입력해주세요.' }, { status: 400 });
    return Response.json(await googlePlace(placeId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const missing = error instanceof Error && error.message === 'NOT_CONFIGURED';
    return Response.json({ status: missing ? 'unconfigured' : 'unavailable', error: missing ? 'Google Places API 키가 설정되지 않았습니다. Google Maps 링크로 미검증 등록할 수 있습니다.' : 'Google Places 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.' }, { status: missing ? 503 : 502 });
  }
}
