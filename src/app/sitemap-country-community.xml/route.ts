import { splitSitemapResponse } from '@/lib/sitemapXml';

export const runtime = 'edge';
export function GET() { return splitSitemapResponse('country-community'); }
