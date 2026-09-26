'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useId, useLayoutEffect, useState, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import Header from './Header';
import Footer from './footer';
import GlobalSidebar, { isNavigationActive } from './GlobalSidebar';
import MobileDrawer from './MobileDrawer';
import MobileBottomNav from './MobileBottomNav';
import GlobalChat from './GlobalChat';
import FriendDock from './FriendDock';
import AssistantDock from './AssistantDock';
import GoogleTranslate from './GoogleTranslate';
import SiteBackgroundVideo from './sitebackgroundvideo';
import { AdSenseScript } from '@/components/ads/AdSense';
import RouteExperience from './RouteExperience';
import { PageContainer } from '@/components/ui/Primitives';
import { musicPlayback } from '@/lib/musicPlayback';

const subscribeToDocument = () => () => {};

export function getShellMode(pathname: string, compact: boolean | null) {
  if (pathname === '/admin' || pathname.startsWith('/admin/') || pathname === '/master' || pathname.startsWith('/master/')) return 'admin';
  if ((pathname === '/webrtc' || pathname === '/apps/random-chat') && compact !== false) return 'compact';
  return 'public';
}

function CompactCallMode({ onChange }: { onChange: Dispatch<SetStateAction<boolean | null>> }) {
  const searchParams = useSearchParams();
  const compact = searchParams.get('compact') === '1';
  useEffect(() => { onChange(compact); }, [compact, onChange]);
  return null;
}

export default function GlobalAppShell({ children, rightRail }: { children: ReactNode; rightRail?: ReactNode }) {
  const pathname = usePathname();
  const [compact, setCompact] = useState<boolean | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerId = useId();
  const portalTarget = useSyncExternalStore(subscribeToDocument, () => document.body, () => null);
  const mode = getShellMode(pathname, compact);
  const isCompact = mode === 'compact';
  const isCallRoute = pathname === '/webrtc' || pathname === '/apps/random-chat';
  const mediaRoute = pathname === '/music' || pathname === '/watch';
  const musicOwner = mode !== 'public' || isCallRoute ? null : pathname === '/music' ? 'video' : 'top';
  // Ordinary routes retain the same background host and controller, without pausing.
  useLayoutEffect(() => { musicPlayback.setRoute(musicOwner); }, [musicOwner]);

  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  useEffect(() => {
    if (mode !== 'public') return;
    const openMenu = () => setDrawerOpen(true);
    window.addEventListener('gyopo-menu-open', openMenu);
    return () => window.removeEventListener('gyopo-menu-open', openMenu);
  }, [mode]);

  if (mode === 'admin') return <div className="global-admin-shell">
    <nav className="global-admin-nav" aria-label="관리자 메뉴">
      {[
        ['/', 'GYOPO 홈'],
        ['/master', '관리자'],
        ['/master/keywords', '키워드'],
        ['/admin/growth/exposure', 'Exposure OS'],
      ].map(([href, label]) => {
        const active = href === '/master' ? pathname === href : isNavigationActive(pathname, href);
        return <Link key={href} href={href} className={active ? 'is-active' : undefined} aria-current={active ? 'page' : undefined}>{label}</Link>;
      })}
    </nav>
    <main className="global-main global-admin-main min-w-0">{children}</main>
  </div>;

  return <div className={`global-app-shell${isCompact ? ' is-compact' : ''}${mediaRoute ? ' is-media-route' : ''}`} data-shell-mode={mode} data-media-route={mediaRoute ? pathname.slice(1) : undefined}>
    {isCallRoute && <Suspense fallback={null}><CompactCallMode onChange={setCompact} /></Suspense>}
    {musicOwner === 'top' && <SiteBackgroundVideo />}
    {!isCompact && <AdSenseScript />}
    {!isCompact && <GoogleTranslate />}
    {!isCompact && <a href="#global-main" className="global-skip-link">본문 바로가기</a>}
    {/* Hide compact chrome without moving the page subtree or replacing the header player. */}
    <div className="global-header-wrap" hidden={isCompact} inert={isCompact}>
      <Header menuOpen={drawerOpen} menuId={drawerId} onMenuOpen={() => setDrawerOpen(true)} />
    </div>
    <div className={`global-page-body${!isCompact && rightRail ? ' has-right-rail' : ''}`}>
      {!isCompact && <aside className="global-sidebar" aria-label="주요 메뉴"><GlobalSidebar /></aside>}
      <main id="global-main" className="global-main min-w-0" tabIndex={-1}><RouteExperience><PageContainer>{children}</PageContainer></RouteExperience></main>
      {!isCompact && rightRail && <aside className="global-right-rail min-w-0" aria-label="추가 정보">{rightRail}</aside>}
    </div>
    {!isCompact && <Footer />}
    {!isCompact && <MobileBottomNav />}
    {!isCompact && <MobileDrawer id={drawerId} open={drawerOpen} onOpenChange={setDrawerOpen} />}
    {!isCompact && portalTarget && createPortal(<div className="global-public-docks"><GlobalChat /><FriendDock /><AssistantDock /></div>, portalTarget)}
  </div>;
}
