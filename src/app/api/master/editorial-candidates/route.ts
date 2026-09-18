import { requireMasterUser, unauthorizedResponse, consumeRateLimit, rateLimitResponse } from '@/lib/apiSecurity';
import { getCountryRoute } from '@/lib/regionRoutes';
import { MarketKeywordsError } from '@/lib/master/googleMarketKeywords';
import { loadEditorialCandidates, type EditorialDiscoveryMode } from '@/lib/master/editorialCandidates';

export const runtime = 'edge';

export async function GET(request: Request) {
  const headers = { 'cache-control': 'private, no-store', Vary: 'Authorization' };
  try {
    const user = await requireMasterUser(request);
    const rate = consumeRateLimit(`editorial-candidates:${user.uid}`, 12, 60_000);
    if (!rate.allowed) {
      const response = rateLimitResponse(rate.retryAfterMs);
      for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      return response;
    }
  } catch (error) {
    const response = unauthorizedResponse(error);
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
  const params = new URL(request.url).searchParams;
  const country = params.get('country') || 'KR';
  const mode = params.get('mode') || 'trends';
  const query = (params.get('query') || '').trim();
  if ([...params.keys()].some((key) => !['country', 'mode', 'query'].includes(key) || params.getAll(key).length !== 1)
    || !/^[A-Z]{2}$/.test(country) || !getCountryRoute(country) || !['trends', 'ideas', 'official-topics'].includes(mode) || query.length > 80) {
    return Response.json({ error: '국가·출처·검색어를 확인하세요.' }, { status: 400, headers });
  }
  try {
    return Response.json(await loadEditorialCandidates(country, mode as EditorialDiscoveryMode, query), { headers });
  } catch (error) {
    return Response.json(error instanceof MarketKeywordsError ? { error: error.message, setup: error.setup, code: error.code }
      : { error: '키워드 출처를 읽지 못했습니다. 국가와 연결 설정을 확인하세요.' }, { status: error instanceof MarketKeywordsError ? error.status : 502, headers });
  }
}
