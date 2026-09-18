'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppWindow, BriefcaseBusiness, CalendarDays, CarFront, ChevronDown, Film, Gamepad2, GraduationCap, Home, Landmark, MapPin, MessageCircle, Music2, Newspaper, ShieldCheck, ShoppingBag, Store } from 'lucide-react';
import { COUNTRY_ROUTES, cityHref, countryHref, countryForRegion, getCityRoute, getCountryRoute, getPublicServiceRoute, getRegionalCategory } from '@/lib/regionRoutes';
import { REGIONS } from '@/lib/regions';
import { PUBLIC_CATEGORIES } from '@/lib/publicCategories';
import { useGlobalStore } from '@/store/useGlobalStore';
import { beginRoute } from '@/lib/routeExperience';

const navigationGroups = [
  { title: 'PRIMARY', links: [
    { id: 'home', href: '/', label: '홈', english: 'Home', icon: Home },
    { id: 'community', href: '/community', label: '커뮤니티', english: 'Community', icon: MessageCircle },
    { id: 'jobs', href: '/jobs', label: '구인구직', english: 'Jobs', icon: BriefcaseBusiness },
    { id: 'directory', href: '/directory', label: '업소록', english: 'Directory', icon: Store },
    { id: 'market', href: '/market', label: '장터', english: 'Market', icon: ShoppingBag },
    { id: 'news', href: '/news', label: '뉴스', english: 'News', icon: Newspaper },
    { id: 'events', href: '/regions', label: '행사', english: 'Events', icon: CalendarDays },
  ] },
  { title: 'LIFE ESSENTIALS', links: [
    { id: 'life', href: '/life', label: '생활 가이드', english: 'Life guides', icon: MapPin },
    { id: 'immigration', href: '/regions', label: '이민·비자', english: 'Immigration', icon: Landmark },
    { id: 'housing', href: '/regions', label: '주거', english: 'Housing', icon: Home },
    { id: 'education', href: '/regions', label: '교육', english: 'Education', icon: GraduationCap },
    { id: 'cars', href: '/regions', label: '자동차', english: 'Cars', icon: CarFront },
    { id: 'tax-finance', href: '/regions', label: '세금·금융', english: 'Tax & finance', icon: Landmark },
    { id: 'safety', href: '/regions', label: '안전', english: 'Safety', icon: ShieldCheck },
  ] },
  { title: 'DISCOVER', links: [
    { id: 'apps', href: '/apps', label: '앱', english: 'Apps', icon: AppWindow },
    { id: 'music', href: '/music', label: '음악', english: 'Music', icon: Music2 },
    { id: 'watch', href: '/watch', label: '영상', english: 'Watch', icon: Film },
    { id: 'games', href: '/games', label: '테트리스', english: 'Tetris', icon: Gamepad2 },
    { id: 'badball', href: '/games/brick-breaker', label: '배드볼', english: 'Badball', icon: Gamepad2 },
    { id: 'theater', href: '/theater', label: '라이브 룸', english: 'Live rooms', icon: Film },
  ] },
] as const;

export function getSidebarLocation(pathname: string, selectedCountry: string) {
  const segments = pathname.split('?')[0].split('/').filter(Boolean).map((segment) => {
    try { return decodeURIComponent(segment); } catch { return segment; }
  });
  const routeCountry = getCountryRoute(segments[0] || '');
  const country = routeCountry || countryForRegion(selectedCountry);
  const city = routeCountry ? getCityRoute(routeCountry.slug, segments[1] || '') : undefined;
  const section = segments[routeCountry ? (city ? 2 : 1) : 0] || '';
  const category = getPublicServiceRoute(section)?.category || getRegionalCategory(section)?.slug;
  return { country, city, routeCountry, section, category };
}

export function getNavigationHref(href: string, category: string, pathname: string, selectedCountry: string) {
  const location = getSidebarLocation(pathname, selectedCountry);
  const regionalCategory = getRegionalCategory(category);
  if (!location.country || !regionalCategory) return href;
  return location.city ? cityHref(location.city, regionalCategory.slug) : countryHref(location.country.id, regionalCategory.slug);
}

export function getRegionSelectorHref(pathname: string, selectedCountry: string, nextCountryId: string) {
  const location = getSidebarLocation(pathname, selectedCountry);
  const next = getCountryRoute(nextCountryId);
  if (!next) return '/regions';
  const nextCity = location.city ? getCityRoute(next.slug, location.city.slug) : undefined;
  return nextCity ? cityHref(nextCity, location.category) : countryHref(next.id, location.category);
}

export function isNavigationActive(pathname: string, href: string) {
  const path = pathname.split('?')[0].replace(/\/$/, '') || '/';
  if (href === '/') return path === '/';
  if (href === '/games') return path === '/games' || path === '/apps/tetris';
  if (href === '/webrtc') return path === '/webrtc' || path === '/apps/random-chat';
  const current = getSidebarLocation(path, 'Global');
  const target = getSidebarLocation(href, 'Global');
  if (current.category && current.category === target.category) {
    if (current.routeCountry && target.routeCountry && current.routeCountry.slug !== target.routeCountry.slug) return false;
    return !target.city || current.city?.slug === target.city.slug;
  }
  if (href === '/regions') return path === '/regions' || path.startsWith('/regions/') || Boolean(current.routeCountry && !current.section);
  return path === href || path.startsWith(`${href}/`);
}

export function GlobalRegionSelectors({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const selectedCountry = useGlobalStore((state) => state.selectedCountry);
  const setSelectedCountry = useGlobalStore((state) => state.setSelectedCountry);
  const language = useGlobalStore((state) => state.language);
  const { country, city } = getSidebarLocation(pathname, selectedCountry);
  const global = REGIONS[0];

  return <div className={`global-region-selectors${compact ? ' is-compact' : ''}`}>
    <label className="global-region-field">
      <span className={compact ? 'sr-only' : 'global-region-label'}>{language === 'ko' ? '국가' : 'Country'}</span>
      <select aria-label={language === 'ko' ? '국가 선택' : 'Select country'} value={country?.id || global.id} onChange={(event) => {
        const next = getCountryRoute(event.target.value);
        setSelectedCountry(next?.id || global.id);
        const href = getRegionSelectorHref(pathname, selectedCountry, next?.id || global.id);
        if (beginRoute(href)) router.push(href);
        onNavigate?.();
      }}>
        <option value={global.id}>{global.flag} {language === 'ko' ? global.label : 'All regions'}</option>
        {COUNTRY_ROUTES.map((item) => <option key={item.id} value={item.id}>{item.flag} {language === 'ko' ? item.label : item.english}</option>)}
      </select>
    </label>
    {!compact && <label className="global-region-field">
      <span className="global-region-label">{language === 'ko' ? '도시' : 'City'}</span>
      <select aria-label={language === 'ko' ? '도시 선택' : 'Select city'} value={city?.slug || ''} disabled={!country || !country.cities.length} onChange={(event) => {
        if (!country) return;
        const next = getCityRoute(country.slug, event.target.value);
        setSelectedCountry(country.id);
        const href = next ? cityHref(next) : countryHref(country.id);
        if (beginRoute(href)) router.push(href);
        onNavigate?.();
      }}>
        <option value="">{language === 'ko' ? '전체 도시' : 'All cities'}</option>
        {country?.cities.map((item) => <option key={item.slug} value={item.slug}>{language === 'ko' ? item.label : item.english}</option>)}
      </select>
    </label>}
  </div>;
}

export default function GlobalSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const selectedCountry = useGlobalStore((state) => state.selectedCountry);
  const language = useGlobalStore((state) => state.language);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const { country } = getSidebarLocation(pathname, selectedCountry);
  const renderedNavigationIds = new Set<string>();

  return <div className="global-sidebar-content">
    <GlobalRegionSelectors onNavigate={onNavigate} />
    {navigationGroups.map((group) => {
      const collapsed = Boolean(collapsedGroups[group.title]);
      return <nav key={group.title} className={`global-nav-group${collapsed ? ' is-collapsed' : ''}`} aria-label={group.title}>
      <h2 className="global-nav-heading"><button type="button" className="global-nav-heading-toggle" aria-expanded={!collapsed} onClick={() => setCollapsedGroups((current) => ({ ...current, [group.title]: !current[group.title] }))}><span>{group.title}</span><ChevronDown size={14} aria-hidden="true" /></button></h2>
       {!collapsed && group.links.filter(({ id }) => {
         if (renderedNavigationIds.has(id)) return false;
         renderedNavigationIds.add(id);
         return true;
       }).map(({ id, href: fallback, label, english, icon: Icon }) => {
        const publicHref = PUBLIC_CATEGORIES.find((category) => category.id === id)?.href || fallback;
        const href = getNavigationHref(publicHref, id, pathname, selectedCountry);
        const needsCountry = !country && publicHref === '/regions';
        const active = !needsCountry && isNavigationActive(pathname, href);
         return <Link key={id} href={href} onClick={onNavigate} className={`global-nav-link${active ? ' is-active' : ''}${id === 'theater' ? ' global-live-room-link' : ''}`} aria-current={active ? 'page' : undefined} title={needsCountry ? (language === 'ko' ? `${label}: 국가 선택` : `${english}: choose a country`) : undefined}>
           <Icon size={18} aria-hidden="true" /><span>{language === 'ko' ? label : english}</span>{id === 'theater' && <i className="global-live-room-dot" aria-hidden="true" />}
         </Link>;
       })}
    </nav>;
    })}
  </div>;
}
