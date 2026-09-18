import { clientAddress, consumeRateLimit, rateLimitResponse } from '@/lib/apiSecurity';
import { placesRequest } from '@/lib/directoryPlaces';
export const runtime = 'edge';
export async function GET(request: Request) {
  const rate = consumeRateLimit(`directory-photo:${clientAddress(request)}`, 90, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterMs);
  const name = new URL(request.url).searchParams.get('name') || '';
  if (name.length > 1500 || !/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(name)) return new Response(null, { status: 400 });
  try {
    const data = await placesRequest(`${name}/media?maxWidthPx=1200&skipHttpRedirect=true`);
    const url = new URL(data.photoUri);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.endsWith('.googleusercontent.com')) throw new Error('INVALID_PHOTO');
    return new Response(null, { status: 302, headers: { Location: url.href, 'Cache-Control': 'no-store' } });
  } catch { return new Response(null, { status: process.env.GOOGLE_PLACES_API_KEY ? 502 : 503 }); }
}
