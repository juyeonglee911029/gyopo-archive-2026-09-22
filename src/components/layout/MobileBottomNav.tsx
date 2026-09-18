'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, MapPin, MessageCircle, Search, UserRound } from 'lucide-react';
import { useGlobalStore } from '@/store/useGlobalStore';
import { getNavigationHref, isNavigationActive } from './GlobalSidebar';

export default function MobileBottomNav() {
  const pathname = usePathname();
  const user = useGlobalStore((state) => state.user);
  const selectedCountry = useGlobalStore((state) => state.selectedCountry);
  const language = useGlobalStore((state) => state.language);
  const links = [
    { href: '/', label: '홈', english: 'Home', icon: Home },
    { href: '/search', label: '검색', english: 'Search', icon: Search },
    { href: '/regions', label: '지역', english: 'Regions', icon: MapPin },
    { href: getNavigationHref('/community', 'community', pathname, selectedCountry), label: '커뮤니티', english: 'Community', icon: MessageCircle },
    { href: user ? '/users' : '/login', label: 'MY', english: 'My', icon: UserRound },
  ];

  return <nav className="global-bottom-nav mobile-bottom-nav" aria-label="모바일 주요 메뉴">
    {links.map(({ href, label, english, icon: Icon }) => {
      const active = isNavigationActive(pathname, href);
      return <Link key={label} href={href} className={`global-bottom-nav-link mobile-bottom-nav-link${active ? ' is-active mobile-bottom-nav-link-active' : ''}`} aria-current={active ? 'page' : undefined}>
        <Icon size={20} aria-hidden="true" /><span>{language === 'ko' ? label : english}</span>
      </Link>;
    })}
  </nav>;
}
