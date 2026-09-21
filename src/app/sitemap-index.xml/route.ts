import { splitSitemapIndexResponse } from '@/lib/sitemapXml';

export const runtime = 'edge';

export function GET(request: Request) {
  return splitSitemapIndexResponse(new URL(request.url).origin);
}
