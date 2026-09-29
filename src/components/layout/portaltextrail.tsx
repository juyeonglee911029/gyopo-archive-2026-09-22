'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Gamepad2, Languages, Search, Video } from 'lucide-react';
import MarketTicker from '@/components/layout/MarketTicker';
import { useGlobalStore } from '@/store/useGlobalStore';
import { REGIONS, regionLabel } from '@/lib/regions';
import { resolvePortalSearch } from '@/lib/searchRouting';
import { trackSearch } from '@/lib/searchTracking';

const links = [
  ['/', '홈', 'Home'],
  ['/regions', '지역', 'Regions'],
  ['/jobs', '구인', 'Jobs'],
  ['/life', '생활', 'Life'],
  ['/community', '커뮤니티', 'Community'],
  ['/news', '오늘의 뉴스', 'News'],
  ['/directory', '업소록', 'Directory'],
  ['/market', '중고장터', 'Market'],
  ['/users', '유저 목록', 'Members'],
  ['/games', '테트리스', 'Tetris'],
  ['/webrtc', '화상채팅', 'Video'],
  ['/music', 'MUSIC VIDEO', 'MUSIC VIDEO'],
   ['/watch', 'Watch', 'Watch'],
   ['/theater', 'LIVE ROOM', 'LIVE ROOM'],
  ['/assistant', '검색', 'Search'],
] as const;

export default function PortalTextRail() {
  const pathname = usePathname();
  const router = useRouter();
  const language = useGlobalStore((state) => state.language);
  const setLanguage = useGlobalStore((state) => state.setLanguage);
  const selectedCountry = useGlobalStore((state) => state.selectedCountry);
  const setSelectedCountry = useGlobalStore((state) => state.setSelectedCountry);
  const user = useGlobalStore((state) => state.user);
  const [searchQuery, setSearchQuery] = useState('');

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;
    const portalRoute = resolvePortalSearch(query);
    if (portalRoute) {
      trackSearch({ query, mode: portalRoute.mode, destination: portalRoute.href, country: selectedCountry, audience: user ? 'member' : 'guest' });
      router.push(portalRoute.href);
      return;
    }
    trackSearch({ query, mode: 'AI', destination: '/assistant', country: selectedCountry, audience: user ? 'member' : 'guest' });
    window.dispatchEvent(new CustomEvent('gyopo-assistant-query', { detail: { query } }));
  };

  return (
    <aside className="portal-text-rail" aria-label="GYOPO 메뉴">
      <MarketTicker />
      <div className="portal-rail-card">
        <form onSubmit={submitSearch} className="portal-rail-search" role="search">
          <label><Search size={12} /> {language === 'ko' ? '검색' : 'Search'}</label>
          <div><Search size={14} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={language === 'ko' ? '질문 또는 핫키워드' : 'Question or keyword'} aria-label="포털 검색" /><button type="submit" aria-label="검색"><Search size={12} /></button></div>
          <small>{language === 'ko' ? '질문은 답변으로, 핫키워드는 해당 메뉴로 이동합니다.' : 'Questions open answers; hot keywords open portal pages.'}</small>
        </form>
        <div className="portal-text-rail-label">EXPLORE / LIVE</div>
        <nav className="portal-text-rail-nav">
             {links.map(([href, label, english]) => {
               const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
               const linkClass = ['portal-text-link', active ? 'portal-text-link-active' : '', href === '/' ? 'portal-text-link-home' : '', href === '/music' ? 'portal-text-link-music' : ''].filter(Boolean).join(' ');
               const Icon = href === '/games' ? Gamepad2 : href === '/webrtc' ? Video : null;
                if (href === '/assistant') return <button key={href} type="button" onClick={() => window.dispatchEvent(new CustomEvent('gyopo-assistant-open'))} className={`${linkClass} portal-text-link-button`}>{language === 'ko' ? label : english}</button>;
                return <Link key={href} href={href} className={linkClass}>{Icon && <Icon size={14} aria-hidden="true" />}{language === 'ko' ? label : english}</Link>;
             })}
           <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('gyopo-friends-open'))} className="portal-text-link portal-text-link-button portal-friends-link"><span>{language === 'ko' ? '친구 채팅·통화' : 'Friends Chat / Call'}</span></button>
            </nav>
            <div className="portal-rail-preferences">
              <label className="portal-rail-select">
                <span className="sr-only">현재 지역 선택</span>
                <select aria-label="현재 지역 선택" value={selectedCountry} onChange={(event) => setSelectedCountry(event.target.value)}>
                  {REGIONS.map((region) => <option key={region.id} value={region.id}>{region.flag} {regionLabel(region.id)}</option>)}
                </select>
              </label>
              <button type="button" onClick={() => setLanguage(language === 'ko' ? 'en' : 'ko')} className="portal-rail-language" aria-label={language === 'ko' ? 'Switch to English' : '한국어로 전환'}>
                <Languages size={14} />
                <span>{language === 'ko' ? 'English' : '한국어'}</span>
              </button>
            </div>
          </div>
    </aside>
  );
}
