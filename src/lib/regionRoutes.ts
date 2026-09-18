import { COUNTRY_LOCATIONS, type CityLocation, type LocationRegion } from './locations';
import { REGIONS } from './regions';

export const REGION_ROUTES = [
  { slug: 'north-america', label: 'North America', korean: '북아메리카', description: '미국과 캐나다의 한인 생활 정보' },
  { slug: 'south-america', label: 'South America', korean: '남아메리카', description: '남아메리카 한인 생활 정보' },
  { slug: 'europe', label: 'Europe', korean: '유럽', description: '유럽 각국의 한인 생활 정보' },
  { slug: 'east-asia', label: 'East Asia', korean: '동아시아', description: '동아시아 한인 생활 정보' },
  { slug: 'southeast-asia', label: 'Southeast Asia', korean: '동남아시아', description: '동남아시아 한인 생활 정보' },
  { slug: 'central-asia', label: 'Central Asia', korean: '중앙아시아', description: '중앙아시아 한인 생활 정보' },
  { slug: 'oceania', label: 'Oceania', korean: '오세아니아', description: '오세아니아 한인 생활 정보' },
  { slug: 'middle-east', label: 'Middle East', korean: '중동', description: '중동 한인 생활 정보' },
  { slug: 'africa', label: 'Africa', korean: '아프리카', description: '아프리카 한인 생활 정보' },
] as const;

export type RegionSlug = (typeof REGION_ROUTES)[number]['slug'];

export function getRegionRoute(slug: string) {
  const value = slug.trim().toLowerCase();
  return REGION_ROUTES.find((region) => region.slug === value);
}

export function countriesForRegion(region: RegionSlug) {
  return COUNTRY_LOCATIONS.filter((country) => country.region === region);
}

export const REGIONAL_CATEGORIES = [
  { slug: 'jobs', label: '구인구직', description: '현지 채용 공고와 구직 정보' },
  { slug: 'immigration', label: '이민·비자', description: '비자, 영주권과 정착 정보' },
  { slug: 'community', label: '커뮤니티', description: '교민이 나누는 생활 질문과 이야기' },
  { slug: 'housing', label: '주거', description: '집 구하기, 임대와 룸메이트 게시글' },
  { slug: 'education', label: '교육', description: '학교, 유학과 자녀 교육 정보' },
  { slug: 'cars', label: '자동차', description: '차량 구매, 정비와 보험 정보' },
  { slug: 'tax-finance', label: '세금·금융', description: '현지 세금, 은행과 금융 정보' },
  { slug: 'food', label: '맛집·업소', description: '한식당과 현지 생활 업소 정보' },
  { slug: 'safety', label: '사건·안전', description: '지역 안전 소식과 도움 요청' },
  { slug: 'freeboard', label: '자유게시판', description: '자유롭게 나누는 지역 이야기' },
  { slug: 'news', label: '뉴스', description: '지역 소식과 교민 뉴스' },
  { slug: 'events', label: '이벤트', description: '지역 행사와 모임 정보' },
  { slug: 'directory', label: '업소록', description: '한인 업체와 지역 서비스 소개' },
  { slug: 'market', label: '장터', description: '교민들의 중고 물품과 거래 정보' },
] as const;

export type RegionalCategory = (typeof REGIONAL_CATEGORIES)[number]['slug'];
export type PublicServiceSlug = 'jobs' | 'businesses' | 'guides' | 'housing' | 'market' | 'community' | 'news' | 'events';
export type PublicServiceRoute = {
  slug: PublicServiceSlug;
  label: string;
  description: string;
  category?: RegionalCategory;
  aliases: readonly string[];
};

export const PUBLIC_SERVICE_ROUTES: readonly PublicServiceRoute[] = [
  { slug: 'jobs', label: '구인구직', description: '현지 채용 공고와 구직 정보', category: 'jobs', aliases: ['jobs'] },
  { slug: 'businesses', label: '업소록', description: '한인 업체와 지역 서비스 소개', category: 'directory', aliases: ['businesses', 'directory'] },
  { slug: 'guides', label: '생활가이드', description: '비자, 정착과 현지 생활 가이드', aliases: ['guides', 'guide'] },
  { slug: 'housing', label: '주거', description: '집 구하기, 임대와 룸메이트 게시글', category: 'housing', aliases: ['housing'] },
  { slug: 'market', label: '장터', description: '교민들의 중고 물품과 거래 정보', category: 'market', aliases: ['market'] },
  { slug: 'community', label: '커뮤니티', description: '교민이 나누는 생활 질문과 이야기', category: 'community', aliases: ['community'] },
  { slug: 'news', label: '뉴스', description: '지역 소식과 교민 뉴스', category: 'news', aliases: ['news'] },
  { slug: 'events', label: '이벤트', description: '지역 행사와 모임 정보', category: 'events', aliases: ['events', 'event'] },
];

const COUNTRY_LIFE_CATEGORY_ORDER = ['immigration', 'jobs', 'housing', 'education', 'cars', 'tax-finance', 'food', 'safety', 'freeboard'] as const;
export const COUNTRY_LIFE_CATEGORIES = COUNTRY_LIFE_CATEGORY_ORDER.flatMap((slug) => {
  const category = REGIONAL_CATEGORIES.find((item) => item.slug === slug);
  return category ? [category] : [];
});

export type CountryRoute = {
  slug: string;
  id: string;
  isoAlpha2: string;
  label: string;
  english: string;
  flag: string;
  region: LocationRegion;
  regionIds: readonly string[];
  aliases: readonly string[];
  cities: readonly CityLocation[];
};

export type CityRoute = CityLocation & { country: CountryRoute };

export const COUNTRY_ROUTES: readonly CountryRoute[] = COUNTRY_LOCATIONS.map((location) => {
  const members = REGIONS.filter((region) => region.id === location.id || (location.id === 'USA' && region.id === 'USA-LA'));
  const aliases = members.flatMap((region) => [region.id, region.id.toLowerCase(), region.label, region.short]);
  aliases.push(location.slug, location.label, location.english, location.english.toLowerCase());
  if (location.id === 'USA') aliases.push('us', 'united states', '미국 전체', 'la', 'los angeles', '로스앤젤레스');
  return {
    slug: location.slug,
    id: location.id,
    isoAlpha2: location.isoAlpha2,
    label: location.label,
    english: location.english,
    flag: location.flag,
    region: location.region,
    regionIds: members.map((region) => region.id),
    aliases: [...new Set([...aliases, location.slug.toUpperCase(), location.isoAlpha2, location.isoAlpha2.toLowerCase(), ...(location.slug === 'uk' ? ['gb'] : [])])],
    cities: location.cities,
  };
});

export function getCountryRoute(slug: string): CountryRoute | undefined {
  const value = slug.trim().toLowerCase();
  return COUNTRY_ROUTES.find((country) => country.slug === value || country.aliases.some((alias) => alias.toLowerCase() === value));
}

export function getRegionalCategory(slug: string) {
  return REGIONAL_CATEGORIES.find((category) => category.slug === slug);
}

export function getPublicServiceRoute(slug: string): PublicServiceRoute | undefined {
  const value = slug.trim().toLowerCase();
  return PUBLIC_SERVICE_ROUTES.find((service) => service.slug === value || service.aliases.includes(value));
}

export function publicServiceSlugForCategory(category: RegionalCategory): string {
  return category === 'directory' || category === 'food' ? 'businesses' : category;
}

export function serviceHref(country: CountryRoute, service: PublicServiceSlug, city?: CityRoute): string {
  return `${city ? `/${country.slug}/${city.slug}` : `/${country.slug}`}/${service}`;
}

export function getCityRoute(countrySlug: string, citySlug: string): CityRoute | undefined {
  const country = getCountryRoute(countrySlug);
  if (!country) return undefined;
  const value = citySlug.trim().toLowerCase();
  const city = country.cities.find((item) => item.slug === value || item.label.toLowerCase() === value || item.english.toLowerCase() === value);
  return city ? { ...city, country } : undefined;
}

export function countryForRegion(region: string): CountryRoute | undefined {
  const value = region.trim().toLowerCase();
  return COUNTRY_ROUTES.find((country) => country.aliases.some((alias) => alias.toLowerCase() === value));
}

export function countryMatchesRegion(country: CountryRoute, region: string): boolean {
  return countryForRegion(region)?.slug === country.slug;
}

export function countryHref(region: string, category?: RegionalCategory): string {
  const country = countryForRegion(region);
  if (!country) return category ? `/${publicServiceSlugForCategory(category)}` : '/';
  return `/${country.slug}${category ? `/${publicServiceSlugForCategory(category)}` : ''}`;
}

export function cityHref(city: CityRoute, category?: RegionalCategory): string {
  return `/${city.country.slug}/${city.slug}${category ? `/${publicServiceSlugForCategory(category)}` : ''}`;
}

export function isRegionalPostId(id: string): boolean {
  return Boolean(id) && id !== '.' && id !== '..' && !/^__.*__$/.test(id)
    && !/[\/\u0000-\u001f\u007f]/.test(id) && new TextEncoder().encode(id).length <= 1500;
}

export function regionalPostHref(country: CountryRoute, category: RegionalCategory, id: string): string {
  if (!isRegionalPostId(id)) throw new Error('Invalid regional post ID');
  return `/${country.slug}/${category === 'food' ? 'food' : publicServiceSlugForCategory(category)}/${encodeURIComponent(id)}`;
}

export function cityRegionalPostHref(city: CityRoute, category: RegionalCategory, id: string): string {
  if (!isRegionalPostId(id)) throw new Error('Invalid regional post ID');
  return `/${city.country.slug}/${city.slug}/${category === 'food' ? 'food' : publicServiceSlugForCategory(category)}/${encodeURIComponent(id)}`;
}
