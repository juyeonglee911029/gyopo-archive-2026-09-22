import { consumeRateLimit, rateLimitResponse, requireMasterUser, unauthorizedResponse } from '@/lib/apiSecurity';
import { loadGoogleMarketKeywords, MarketKeywordsError, parseMarketRequest } from '@/lib/master/googleMarketKeywords';

export const runtime = 'edge';

export async function GET(request: Request) {
  let user;
  try {
    user = await requireMasterUser(request);
  } catch (error) {
    const response = unauthorizedResponse(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
  // Apply the shared per-user limiter before any Google market-data/OAuth request.
  const rate = consumeRateLimit(`master-market-keywords:${user.uid}`, 6, 60_000);
  if (!rate.allowed) {
    const response = rateLimitResponse(rate.retryAfterMs);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization', 'X-Robots-Tag': 'noindex, nofollow' };
  try {
    if (request.url.length > 2_048) throw new MarketKeywordsError('Request URL exceeds the size limit.', 414, 'INVALID_INPUT');
    const input = parseMarketRequest(new URL(request.url).searchParams);
    return Response.json(await loadGoogleMarketKeywords(input), { headers });
  } catch (error) {
    if (error instanceof MarketKeywordsError) return Response.json({ error: error.message, code: error.code, setup: error.setup }, { status: error.status, headers });
    return Response.json({ error: 'Keyword intelligence is unavailable. No substitute data was generated.', code: 'SOURCE_UNAVAILABLE' }, { status: 502, headers });
  }
}
