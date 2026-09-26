import { searchAssetsDocument } from '@/components/master/SearchAssetsDocument';

export const runtime = 'edge';

// The selected release serves a complete document here, outside the portal shell.
export function GET() {
  return new Response(searchAssetsDocument, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex, nofollow',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'content-security-policy': "frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
    },
  });
}
