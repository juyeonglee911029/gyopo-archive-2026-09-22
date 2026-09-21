import { getRegionalSitemapPosts } from '@/lib/regionalContent';
import { canonicalUrl } from '@/lib/seo';
import { cityRegionalPostHref, countriesForRegion, getCityRoute, publicServiceSlugForCategory, REGION_ROUTES, regionalPostHref } from '@/lib/regionRoutes';

export const SPLIT_SITEMAPS = [
  'core', 'countries', 'cities', 'country-jobs', 'country-visa', 'country-tax-finance', 'country-housing', 'country-community',
  'city-jobs', 'city-housing', 'city-community',
] as const;

export type SplitSitemap = typeof SPLIT_SITEMAPS[number];
type SitemapEntry = { url: string; lastModified?: string; changeFrequency?: string; priority?: number };

const CORE_ROUTES = [
  '/', '/regions', '/jobs', '/housing', '/guides', '/directory', '/events', '/life', '/community', '/apps', '/apps/ai-search', '/apps/tetris', '/apps/random-chat', '/games', '/games/brick-breaker',
  '/music', '/theater', '/news', '/market', '/blog', '/help', '/ads', '/pricing', '/refund', '/privacy', '/terms',
];

const COUNTRY_SEGMENTS: Record<string, Exclude<SplitSitemap, 'core' | 'countries' | 'cities' | 'city-jobs' | 'city-housing' | 'city-community'>> = {
  jobs: 'country-jobs',
  immigration: 'country-visa',
  'tax-finance': 'country-tax-finance',
  housing: 'country-housing',
  community: 'country-community',
  education: 'country-community',
  cars: 'country-community',
  food: 'country-community',
  safety: 'country-community',
  freeboard: 'country-community',
  news: 'country-community',
  events: 'country-community',
  directory: 'country-community',
  market: 'country-community',
};

const CITY_SEGMENTS: Record<string, Exclude<SplitSitemap, 'core' | 'countries' | 'cities' | 'country-jobs' | 'country-visa' | 'country-tax-finance' | 'country-housing' | 'country-community'>> = {
  jobs: 'city-jobs',
  housing: 'city-housing',
  community: 'city-community',
  immigration: 'city-community',
  education: 'city-community',
  cars: 'city-community',
  'tax-finance': 'city-community',
  food: 'city-community',
  safety: 'city-community',
  freeboard: 'city-community',
  news: 'city-community',
  events: 'city-community',
  directory: 'city-community',
  market: 'city-community',
};

function add(entries: Map<string, SitemapEntry>, path: string, lastModified?: string, priority = 0.7) {
  entries.set(path, { url: canonicalUrl(path), ...(lastModified ? { lastModified } : {}), changeFrequency: 'daily', priority });
}

function categorySegment(category: string, city: boolean): SplitSitemap | undefined {
  return (city ? CITY_SEGMENTS : COUNTRY_SEGMENTS)[category];
}

export async function buildSplitSitemap(segment: SplitSitemap): Promise<SitemapEntry[]> {
  const entries = new Map<string, SitemapEntry>();
  if (segment === 'core') for (const route of CORE_ROUTES) add(entries, route, undefined, route === '/' ? 1 : 0.6);
  if (segment === 'core') return [...entries.values()];
  if (segment === 'countries') for (const region of REGION_ROUTES) if (countriesForRegion(region.slug).length) add(entries, `/regions/${{region.slug}`, undefined, 0.7);
  const posts = await getRegionalSitemapPosts();
  for (const post of posts) {
    const lastModified = post.updatedAt || post.createdAt;
    const countryPath = `/${{post.country.slug}`;
    const categoryPath = ${{countryPath}`/${{publicServiceSlugForCategory(post.category)}`;
    const city = post.city ? getCityRoute(post.country.slug, post.city) : undefined;
    if (segment === 'countries') add(entries, countryPath, lastModified, 0.8);
    const countrySegment = categorySegment(post.category, false);
    if (countrySegment === segment && !city) {
      add(entries, categoryPath, lastModified, 0.85);
      add(entries, regionalPostHref(post.country, post.category, post.id), lastModified, 0.7);
    }
    if (!city) continue;
    const cityPath = ${{countryPath}`/${{city.slug}`;
    if (segment === 'cities') add(entries, cityPath, lastModified, 0.75);
    const citySegment = categorySegment(post.category, true);
    if (citySegment === segment) {
      const cityCategoryPath = ${{cityPath}`/${{publicServiceSlugForCategory(post.category)}`;
      add(entries, cityCategoryPath, lastModified, 0.8);
      add(entries, cityRegionalPostHref(city, post.category, post.id), lastModified, 0.7);
    }
  }
  return [...entries.values()];
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

export async function splitSitemapResponse(segment: SplitSitemap): Promise<Response> {
  const entries = await buildSplitSitemap(segment);
  const body = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${{entries.map((entry) => `<url><loc>${{escapeXml(entry.url)}</loc>${{entry.lastModified ? `<lastmod>${{escapeXml(entry.lastModified)}</lastmod>` : ''}${{entry.changeFrequency ? `<changefreq>${{entry.changeFrequency}</changefreq>` : ''}${{entry.priority !== undefined ? `<priority>${{entry.priority.toFixed(1)}</priority>` : ''}</url>`).join('')}</urlset>`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate' } });
}

export function splitSitemapIndexResponse(origin: string): Response {
  const body = `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${{SPLIT_SITEMAPS.map((segment) => `<sitemap><loc>${{escapeXml(${{origin}`/sitemap-${{segment}.xml`)}</loc></sitemap>`).join('')}</sitemapindex>`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate' } });
}
