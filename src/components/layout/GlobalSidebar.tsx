'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { BriefcaseBusiness, CalendarDays, Check, ChevronDown, Film, Gamepad2, Home, MessageCircle, Music2, Newspaper, Search, ShoppingBag, Store, UserRoundCheck, Video } from 'lucide-react';
import { COUNTRY_ROUTES, cityHref, countryHref, countryForRegion, getCityRoute, getCountryRoute, getPublicServiceRoute, getRegionalCategory } from '@/lib/regionRoutes';
import { REGIONS } from '@/lib/regions';
import { PUBLIC_CATEGORIES } from '@/lib/publicCategories';
import { useGlobalStore } from '@/store/useGlobalStore';
import { beginRoute } from '@/lib/routeExperience';

const navigationGroups = [
  { title: 'PRIMARY', korean: '주요 메뉴', links: [
    { id: 'home', href: '/', label: '홈', english: 'Home', icon: Home },
    { id: 'community', href: '/community', label: '커뮤니티', english: 'Community', icon: MessageCircle },
    { id: 'jobs', href: '/jobs', label: '구인구직', english: 'Jobs', icon: BriefcaseBusiness },
    { id: 'directory', href: '/directory', label: '업소록', english: 'Directory', icon: Store },
    { id: 'market', href: '/market', label: '장터', english: 'Market', icon: ShoppingBag },
    { id: 'news', href: '/news', label: '뉴스', english: 'News', icon: Newspaper },
    { id: 'events', href: '/regions', label: '행사', english: 'Events', icon: CalendarDays },
  ] },
  { title: 'DISCOVER', korean: '둘러보기', links: [
    { id: 'friends', href: '/users', label: '매칭', english: 'Matching', icon: UserRoundCheck },
    { id: 'music', href: '/music', label: '음악', english: 'Music', icon: Music2 },
    { id: 'watch', href: '/watch', label: '영상', english: 'Watch', icon: Film },
    { id: 'games', href: '/games', label: '테트리스', english: 'Tetris', icon: Gamepad2 },
    { id: 'webrtc', href: '/webrtc', label: '영상 통화', english: 'Video chat', icon: Video },
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
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [openMenu, setOpenMenu] = useState<'country' | 'city' | null>(null);
  const [locationQuery, setLocationQuery] = useState('');
  const normalizedQuery = locationQuery.trim().toLocaleLowerCase();
  const matchingCountries = COUNTRY_ROUTES.filter((item) => `${item.label} ${item.english} ${item.id} ${item.slug}`.toLocaleLowerCase().includes(normalizedQuery));
  const matchingCities = (country?.cities || []).filter((item) => `${item.label} ${item.english} ${item.slug}`.toLocaleLowerCase().includes(normalizedQuery));
  const globalLabel = language === 'ko' ? global.label : 'All regions';

  useEffect(() => {
    if (openMenu) searchRef.current?.focus();
  }, [openMenu]);

  useEffect(() => {
    if (!openMenu) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (pickerRef.current?.contains(event.target as Node)) return;
      setOpenMenu(null);
      setLocationQuery('');
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpenMenu(null);
      setLocationQuery('');
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openMenu]);

  const toggleMenu = (menu: 'country' | 'city') => {
    setLocationQuery('');
    setOpenMenu((current) => current === menu ? null : menu);
  };

  const chooseCountry = (nextCountryId: string) => {
    const next = getCountryRoute(nextCountryId);
    const countryId = next?.id || global.id;
    setSelectedCountry(countryId);
    const href = getRegionSelectorHref(pathname, selectedCountry, countryId);
    if (beginRoute(href)) router.push(href);
    setOpenMenu(null);
    setLocationQuery('');
    onNavigate?.();
  };

  const chooseCity = (citySlug: string) => {
    if (!country) return;
    const next = getCityRoute(country.slug, citySlug);
    setSelectedCountry(country.id);
    const href = next ? cityHref(next) : countryHref(country.id);
    if (beginRoute(href)) router.push(href);
    setOpenMenu(null);
    setLocationQuery('');
    onNavigate?.();
  };

  return <div ref={pickerRef} className={`global-region-selectors global-region-picker${compact ? ' is-compact' : ''}`}>
    <div className="global-location-field">
      <span className={compact ? 'sr-only' : 'global-region-label'}>{language === 'ko' ? '국가' : 'Country'}</span>
      <button type="button" className="global-location-trigger" aria-label={language === 'ko' ? '국가 선택' : 'Select country'} aria-expanded={openMenu === 'country'} aria-haspopup="listbox" aria-controls={openMenu === 'country' ? 'global-country-options' : undefined} onClick={() => toggleMenu('country')}>
        <span className="global-location-flag" aria-hidden="true">{country?.flag || global.flag}</span>
        <span className="global-location-value">{country ? (language === 'ko' ? country.label : country.english) : globalLabel}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {openMenu === 'country' && <div className="global-location-popover">
        <label className="global-location-search"><Search size={15} aria-hidden="true" /><input ref={searchRef} type="search" value={locationQuery} onChange={(event) => setLocationQuery(event.target.value)} placeholder={language === 'ko' ? '국가 이름 검색' : 'Search countries'} aria-label={language === 'ko' ? '국가 이름 검색' : 'Search countries'} /></label>
        <div className="global-location-options" id="global-country-options" role="listbox" aria-label={language === 'ko' ? '국가 목록' : 'Country list'}>
          {(!normalizedQuery || `${globalLabel} global all regions`.toLocaleLowerCase().includes(normalizedQuery)) && <button type="button" role="option" aria-selected={!country} className="global-location-option" onClick={() => chooseCountry(global.id)}><span className="global-location-flag" aria-hidden="true">{global.flag}</span><span>{globalLabel}</span>{!country && <Check size={14} aria-hidden="true" />}</button>}
          {matchingCountries.map((item) => <button type="button" role="option" aria-selected={country?.id === item.id} key={item.id} className="global-location-option" onClick={() => chooseCountry(item.id)}><span className="global-location-flag" aria-hidden="true">{item.flag}</span><span>{language === 'ko' ? item.label : item.english}</span>{country?.id === item.id && <Check size={14} aria-hidden="true" />}</button>)}
          {matchingCountries.length === 0 && normalizedQuery && <p className="global-location-empty">{language === 'ko' ? '일치하는 국가가 없습니다.' : 'No countries found.'}</p>}
        </div>
        <span className="global-location-count">{COUNTRY_ROUTES.length + 1} {language === 'ko' ? '개 지역' : 'locations'}</span>
      </div>}
    </div>
    {!compact && <div className="global-location-field">
      <span className="global-region-label">{language === 'ko' ? '도시' : 'City'}</span>
      <button type="button" className="global-location-trigger" aria-label={language === 'ko' ? '도시 선택' : 'Select city'} aria-expanded={openMenu === 'city'} aria-haspopup="listbox" aria-controls={openMenu === 'city' ? 'global-city-options' : undefined} disabled={!country || !country.cities.length} onClick={() => toggleMenu('city')}>
        <span className="global-location-value">{city ? (language === 'ko' ? city.label : city.english) : language === 'ko' ? '전체 도시' : 'All cities'}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {openMenu === 'city' && country && <div className="global-location-popover">
        <label className="global-location-search"><Search size={15} aria-hidden="true" /><input ref={searchRef} type="search" value={locationQuery} onChange={(event) => setLocationQuery(event.target.value)} placeholder={language === 'ko' ? '도시 이름 검색' : 'Search cities'} aria-label={language === 'ko' ? '도시 이름 검색' : 'Search cities'} /></label>
        <div className="global-location-options" id="global-city-options" role="listbox" aria-label={language === 'ko' ? '도시 목록' : 'City list'}>
          {(!normalizedQuery || (language === 'ko' ? '전체 도시' : 'all cities').toLocaleLowerCase().includes(normalizedQuery)) && <button type="button" role="option" aria-selected={!city} className="global-location-option" onClick={() => chooseCity('')}><span>{language === 'ko' ? '전체 도시' : 'All cities'}</span>{!city && <Check size={14} aria-hidden="true" />}</button>}
          {matchingCities.map((item) => <button type="button" role="option" aria-selected={city?.slug === item.slug} key={item.slug} className="global-location-option" onClick={() => chooseCity(item.slug)}><span>{language === 'ko' ? item.label : item.english}</span>{city?.slug === item.slug && <Check size={14} aria-hidden="true" />}</button>)}
          {matchingCities.length === 0 && normalizedQuery && <p className="global-location-empty">{language === 'ko' ? '일치하는 도시가 없습니다.' : 'No cities found.'}</p>}
        </div>
      </div>}
    </div>}
  </div>;
}

export default function GlobalSidebar({ onNavigate, hideRegionSelectors = false }: { onNavigate?: () => void; hideRegionSelectors?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useGlobalStore((state) => state.user);
  const selectedCountry = useGlobalStore((state) => state.selectedCountry);
  const language = useGlobalStore((state) => state.language);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const { country } = getSidebarLocation(pathname, selectedCountry);
  const renderedNavigationIds = new Set<string>();

  return <div className="global-sidebar-content">
    {!hideRegionSelectors && <GlobalRegionSelectors onNavigate={onNavigate} />}
    {navigationGroups.map((group) => {
      const collapsed = Boolean(collapsedGroups[group.title]);
      const groupLabel = language === 'ko' ? group.korean : group.title;
      return <nav key={group.title} className={`global-nav-group${collapsed ? ' is-collapsed' : ''}`} aria-label={groupLabel}>
      <h2 className="global-nav-heading"><button type="button" className="global-nav-heading-toggle" aria-expanded={!collapsed} onClick={() => setCollapsedGroups((current) => ({ ...current, [group.title]: !current[group.title] }))}><span>{groupLabel}</span><ChevronDown size={14} aria-hidden="true" /></button></h2>
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
      <button type="button" className="global-friends-link" style={{ borderRadius: 0 }} onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onNavigate?.();
        if (!user) {
          if (beginRoute('/users')) router.push('/users');
          return;
        }
        const anchor = window.matchMedia('(min-width: 769px)').matches ? { left: rect.left, top: rect.top, bottom: rect.bottom } : undefined;
        window.dispatchEvent(new CustomEvent('gyopo-friends-open', { detail: { anchor } }));
        }}><UserRoundCheck size={18} aria-hidden="true" /><span>{language === 'ko' ? '친구' : 'Friends'}</span></button>
  </div>;
}
