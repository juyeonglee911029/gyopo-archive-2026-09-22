import type { MetadataRoute } from 'next';
import { getRegionalSitemapPosts } from '@/lib/regionalContent';
import { canonicalUrl } from '@/lib/seo';
import { cityRegionalPostHref, countriesForRegion, getCityRoute, publicServiceSlugForCategory, REGION_ROUTES, regionalPostHref } from '@/lib/regionRoutes';

export const runtime = 'edge';

const routes = [
  '/', '/regions', '/jobs', '/housing', '/guides', '/directory', '/events', '/life', '/community', '/apps', '/apps/ai-search', '/apps/tetris', '/apps/random-chat', '/games', '/games/brick-breaker',
  '/music', '/theater', '/news', '/market', '/blog', '/help', '/ads', '/pricing', '/refund', '/privacy', '/terms',
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const rows = await getRegionalSitemapPosts();
  const regional = new Map<string, MetadataRoute.Sitemap[number]>();
  for (const region of REGION_ROUTES) {
    if (countriesForRegion(region.slug).length > 0) regional.set(`/regions/${region.slug}`, { url: canonicalUrl(`/regions/${region.slug}`), changeFrequency: 'weekly', priority: 0.7 });
  }
  for (const post of rows) {
    const lastModified = post.updatedAt || post.createdAt;
    const countryPath = `/${post.country.slug}`;
    const categoryPath = `${countryPath}/${publicServiceSlugForCategory(post.category)}`;
    regional.set(countryPath, { url: canonicalUrl(countryPath), lastModified, changeFrequency: 'daily', priority: 0.8 });
    regional.set(categoryPath, { url: canonicalUrl(categoryPath), lastModified, changeFrequency: 'daily', priority: 0.85 });
    const city = post.city ? getCityRoute(post.country.slug, post.city) : undefined;
    if (city) {
      const cityPath = `/${post.country.slug}/${city.slug}`;
      const cityCategoryPath = `${cityPath}/${publicServiceSlugForCategory(post.category)}`;
      regional.set(cityPath, { url: canonicalUrl(cityPath), lastModified, changeFrequency: 'daily', priority: 0.75 });
      regional.set(cityCategoryPath, { url: canonicalUrl(cityCategoryPath), lastModified, changeFrequency: 'daily', priority: 0.8 });
    }
    const detailPath = city ? cityRegionalPostHref(city, post.category, post.id) : regionalPostHref(post.country, post.category, post.id);
    regional.set(detailPath, { url: canonicalUrl(detailPath), lastModified: post.updatedAt || post.createdAt, changeFrequency: 'weekly', priority: 0.7 });
    regional.set(`/regions/${post.country.region}`, { url: canonicalUrl(`/regions/${post.country.region}`), changeFrequency: 'weekly', priority: 0.7 });
  }
  return [...routes.map((route) => ({
    url: canonicalUrl(route),
    changeFrequency: route === '/' || route === '/news' ? 'daily' as const : 'weekly' as const,
     priority: route === '/' ? 1 : ['/regions', '/jobs', '/life', '/community', '/apps', '/news', '/directory'].includes(route) ? 0.8 : 0.6,
  })), ...regional.values()];
}
