import { AppWindow, BookOpen, BriefcaseBusiness, Building2, CalendarDays, House, Map, MessageCircle, Music, Newspaper, Play, ShoppingBag, Sprout } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { countryForRegion, getCityRoute, serviceHref } from './regionRoutes';
import type { PublicServiceSlug } from './regionRoutes';

export type PublicCategory = {
  id: string;
  title: string;
  description: string;
  href: string;
  service?: PublicServiceSlug;
  icon: LucideIcon;
};

export const PUBLIC_CATEGORIES = [
  { id: 'jobs', title: '구인구직', description: '현지 채용 공고와 구직 정보', href: '/jobs', service: 'jobs', icon: BriefcaseBusiness },
  { id: 'life', title: '생활', description: '정착과 일상에 필요한 서비스', href: '/life', icon: Sprout },
  { id: 'community', title: '커뮤니티', description: '교민이 나누는 질문과 이야기', href: '/community', service: 'community', icon: MessageCircle },
  { id: 'housing', title: '주거', description: '집 구하기, 임대와 룸메이트', href: '/housing', service: 'housing', icon: House },
  { id: 'directory', title: '업소록', description: '한인 업체와 지역 생활 서비스', href: '/directory', service: 'businesses', icon: Building2 },
  { id: 'market', title: '장터', description: '교민 중고거래와 나눔', href: '/market', service: 'market', icon: ShoppingBag },
  { id: 'news', title: '뉴스', description: '지역 소식과 교민 뉴스', href: '/news', service: 'news', icon: Newspaper },
  { id: 'events', title: '이벤트', description: '지역 행사와 교민 모임', href: '/events', service: 'events', icon: CalendarDays },
  { id: 'regions', title: '지역', description: '국가와 도시별 게시판 찾기', href: '/regions', icon: Map },
  { id: 'apps', title: '앱', description: '검색, 대화와 게임을 한곳에서', href: '/apps', icon: AppWindow },
  { id: 'music', title: '음악', description: '음악 검색과 뮤직비디오', href: '/music', icon: Music },
  { id: 'watch', title: 'Watch', description: '영상과 라이브 공간 둘러보기', href: '/watch', icon: Play },
  { id: 'guides', title: '생활 가이드', description: '비자, 이주와 현지 정착 안내', href: '/guides', service: 'guides', icon: BookOpen },
] as const satisfies readonly PublicCategory[];

export type PublicCategoryId = (typeof PUBLIC_CATEGORIES)[number]['id'];

export function publicCategoryRegion(region: string, city?: string) {
  const country = countryForRegion(region);
  // USA-LA is the existing persisted city-level region preference.
  const citySlug = city ?? (region === 'USA-LA' ? 'los-angeles' : undefined);
  return { country, city: country && citySlug ? getCityRoute(country.slug, citySlug) : undefined };
}

export function publicCategoryHref(category: PublicCategory, region = 'Global', citySlug?: string): string {
  const { country, city } = publicCategoryRegion(region, citySlug);
  if (category.service && country) return serviceHref(country, category.service, city);
  if (country && category.id === 'regions') return `/${country.slug}${city ? `/${city.slug}` : ''}`;
  if (country && category.id === 'life') {
    const query = new URLSearchParams({ country: country.slug });
    if (city) query.set('city', city.slug);
    return `${category.href}?${query}`;
  }
  return category.href;
}
