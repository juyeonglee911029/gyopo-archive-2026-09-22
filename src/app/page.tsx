'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import {
  AppWindow,
  ArrowRight,
  ArrowUpRight,
  Gamepad2,
  MapPin,
  Play,
  Radio,
  Search,
  Sparkles,
  UsersRound,
  Video,
  Zap,
} from 'lucide-react';
import BannerAd from '@/components/ads/BannerAd';
import WorldClock from '@/components/layout/WorldClock';
import { beginRoute, useRouteReadiness } from '@/components/layout/RouteExperience';
import { AdSlot, CategoryCard, EmptyState, ErrorState, PageHeader, SectionHeader, Skeleton } from '@/components/ui/Primitives';
import { listDocuments } from '@/lib/firebase';
import { serviceHref } from '@/lib/regionRoutes';
import { PUBLIC_CATEGORIES, publicCategoryHref, publicCategoryRegion } from '@/lib/publicCategories';
import type { PublicCategory } from '@/lib/publicCategories';
import { isPublicArticle } from '@/lib/publicArticle';
import { REGIONS, regionLabel } from '@/lib/regions';
import { resolvePortalSearch } from '@/lib/searchRouting';
import { trackSearch } from '@/lib/searchTracking';
import { trackGrowth } from '@/lib/growthTracking';
import { useGlobalStore } from '@/store/useGlobalStore';
import ReleaseRouteStyles from '@/components/layout/ReleaseRouteStyles';

type HomePost = { id: string; title: string; type: string; authorId: string; views?: number; createdAt: string; country: string; sourceUrl?: string; sourceName?: string; status?: string; deleted?: boolean; isPublic?: boolean; sourceSnapshot?: boolean; expiresAt?: unknown };

const typeLabels: Record<string, string> = { notice: '공지', news: '뉴스', free: '자유' };

function HomeFeedReadiness({ loading, error }: { loading: boolean; error: boolean }) {
  useRouteReadiness(loading, error);
  return null;
}

export default function Home() {
  const router = useRouter();
  const selectedCountry = useGlobalStore((state) => state.selectedCountry);
  const setSelectedCountry = useGlobalStore((state) => state.setSelectedCountry);
  const user = useGlobalStore((state) => state.user);
  const [posts, setPosts] = useState<HomePost[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [feedStatus, setFeedStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [feedAttempt, setFeedAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const timeout = setTimeout(() => {
      if (!active) return;
      active = false;
      setFeedStatus('error');
    }, 12000);
    void listDocuments<Omit<HomePost, 'id'>>('posts').then((data) => {
      if (!active) return;
      setPosts(data.filter((post) => post.authorId && isPublicArticle(post)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setFeedStatus('ready');
    }).catch(() => {
      if (active) setFeedStatus('error');
    }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); };
  }, [feedAttempt]);

  const { country: selectedRoute, city: selectedCity } = publicCategoryRegion(selectedCountry);
  const visiblePosts = posts.filter((post) => selectedCountry === 'Global' || post.country === selectedCountry || post.country === 'Global').slice(0, 5);
  const regionName = selectedCountry === 'Global' ? '전 세계' : regionLabel(selectedCountry);

  const submitSearchQuery = (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const portalRoute = resolvePortalSearch(trimmed);
    if (portalRoute) {
      trackGrowth({ event: 'search_submit', country: selectedCountry, audience: user ? 'member' : 'guest', details: { mode: portalRoute.mode, destination: portalRoute.href } });
      trackSearch({ query: trimmed, mode: portalRoute.mode, destination: portalRoute.href, country: selectedCountry, audience: user ? 'member' : 'guest' });
      if (beginRoute(portalRoute.href)) router.push(portalRoute.href);
      return;
    }
    trackGrowth({ event: 'search_submit', country: selectedCountry, audience: user ? 'member' : 'guest', details: { mode: 'AI', destination: '/assistant' } });
    trackSearch({ query: trimmed, mode: 'AI', destination: '/assistant', country: selectedCountry, audience: user ? 'member' : 'guest' });
    window.dispatchEvent(new CustomEvent('gyopo-assistant-query', { detail: { query: trimmed } }));
  };

  const submitSmartSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitSearchQuery(searchQuery);
  };

  return (
    <div className="home-page home-refresh min-h-screen bg-transparent text-slate-100">
      <ReleaseRouteStyles page="home" />
      <Suspense fallback={null}><HomeFeedReadiness loading={feedStatus === 'loading'} error={feedStatus === 'error'} /></Suspense>
      <section className="home-lead">
        <div className="home-lead-grid">
          <div className="relative z-10 min-w-0">
            <form role="search" onSubmit={submitSmartSearch} className="home-smart-search flex items-center gap-3 border border-teal-200/20 bg-slate-950/45 p-2 backdrop-blur-xl">
              <Search size={19} className="ml-2 shrink-0 text-teal-200" />
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} aria-label="Smart Search" placeholder="지역, 일자리, 업소, 생활정보를 검색하세요" className="min-w-0 flex-1 bg-transparent px-1 py-3 text-sm text-white outline-none placeholder:text-slate-500" />
              <button type="submit" className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-teal-300 px-4 py-3 text-xs font-black text-slate-950 transition hover:bg-teal-200"><Sparkles size={14} />검색</button>
            </form>
            <PageHeader title="GYOPO, 세계 어디서나 교민과 함께" subtitle="내 지역의 일자리, 생활 정보와 새로운 연결을 찾아보세요." />
          </div>
          <aside className="home-context-card">
            <div className="home-location-controls"><MapPin size={17} className="shrink-0 text-teal-200" /><h2>{regionName}</h2>
              <label className="home-region-select"><span className="sr-only">현재 지역</span><select value={selectedCountry} onChange={(event) => setSelectedCountry(event.target.value)} aria-label="현재 지역 선택">{REGIONS.map((region) => <option key={region.id} value={region.id}>{region.flag} {regionLabel(region.id)}</option>)}</select></label>
              <Link href="/regions" aria-label="지역 둘러보기" className="text-teal-200"><ArrowUpRight size={17} /></Link>
            </div>
            <div className="home-clock-strip"><span className="sr-only"><UsersRound size={13} />세계 시간</span><WorldClock /></div>
          </aside>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="빠른 시작">
        <Link href="/webrtc" className="home-feature-card home-feature-video group"><span className="home-feature-icon"><Video size={19} /></span><span className="min-w-0 flex-1"><small>CONNECT NOW</small><b>영상으로 교민 만나기</b></span><ArrowRight size={16} className="transition group-hover:translate-x-1" /></Link>
        <Link href="/games" className="home-feature-card home-feature-game group"><span className="home-feature-icon"><Gamepad2 size={19} /></span><span className="min-w-0 flex-1"><small>QUICK PLAY</small><b>테트리스 한 판</b></span><ArrowRight size={16} className="transition group-hover:translate-x-1" /></Link>
        <button type="button" onClick={() => window.dispatchEvent(new Event('gyopo-open-global-chat'))} className="home-feature-card home-feature-live group text-left"><span className="home-feature-icon"><Radio size={19} /></span><span className="min-w-0 flex-1"><small>LIVE BOARD</small><b>지금 올라온 이야기</b></span><ArrowRight size={16} className="transition group-hover:translate-x-1" /></button>
      </section>

      <section aria-labelledby="home-routes-heading">
        <SectionHeader id="home-routes-heading" title="지금 필요한 정보" subtitle={regionName} actions={<Link className="ui-text-link" href="/services">전체 카테고리 <ArrowRight size={14} aria-hidden="true" /></Link>} />
        <nav className="ui-category-grid" aria-label="생활 카테고리">
          {PUBLIC_CATEGORIES.map((category: PublicCategory) => {
            const { id, service, title, description, icon: Icon } = category;
            const href = service && selectedRoute ? selectedCity ? serviceHref(selectedRoute, service, selectedCity) : serviceHref(selectedRoute, service) : publicCategoryHref(category, selectedCountry);
            return <CategoryCard key={id} icon={<Icon size={20} />} title={title} description={description} href={href} />;
          })}
        </nav>
      </section>

      <section className="grid gap-5 2xl:grid-cols-[1.15fr_.85fr]" aria-labelledby="home-board-heading">
        <div className="surface home-board rounded-[28px] p-5 sm:p-6">
          <SectionHeader id="home-board-heading" title="최근 올라온 이야기" actions={<Link href={publicCategoryHref(PUBLIC_CATEGORIES.find((category) => category.id === 'community')!, selectedCountry)} className="ui-text-link">전체 보기 <ArrowRight size={13} /></Link>} />
          <div className="divide-y divide-white/8">
            {feedStatus === 'loading' && <Skeleton label="최근 이야기를 불러오고 있습니다" lines={5} />}
            {feedStatus === 'error' && <ErrorState title="이야기를 불러오지 못했습니다" description="연결을 확인한 뒤 다시 시도해주세요." actions={<button className="ui-button" type="button" onClick={() => { setFeedStatus('loading'); setFeedAttempt((attempt) => attempt + 1); }}>다시 시도</button>} />}
            {feedStatus === 'ready' && visiblePosts.length === 0 && <EmptyState title="아직 등록된 이야기가 없습니다" description="다른 지역의 이야기나 커뮤니티를 살펴보세요." actions={<Link className="ui-text-link" href="/community">커뮤니티 둘러보기</Link>} />}
            {feedStatus === 'ready' && visiblePosts.map((post) => <Link href={post.sourceUrl || `/community/${post.id}`} key={post.id} className="group flex items-center gap-3 py-4"><span className="shrink-0 rounded-lg bg-teal-300/10 px-2 py-1 text-[10px] font-black text-teal-200">{typeLabels[post.type] || '소식'}</span><span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-300 transition group-hover:text-white">{post.title}</span><ArrowUpRight size={14} className="shrink-0 text-slate-600 transition group-hover:text-teal-300" /></Link>)}
          </div>
        </div>
        <aside className="home-support-panel rounded-[28px] border border-white/10 bg-white/[.045] p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-amber-200">Keep connected</p><h2 className="mt-1 text-xl font-black text-white">필요할 때 바로 이어지도록</h2></div><Zap size={18} className="text-amber-200" /></div><p className="mt-3 text-sm leading-6 text-slate-400">실시간 대화, 게임, 라이브 공간은 언제든 다시 열 수 있습니다.</p><div className="mt-5 grid gap-2 sm:grid-cols-2 2xl:grid-cols-1"><Link href="/webrtc" className="inline-flex items-center justify-between rounded-xl bg-white/[.06] px-3 py-3 text-xs font-black text-slate-200 hover:bg-teal-300/10 hover:text-teal-100"><span className="inline-flex items-center gap-2"><Video size={14} />영상채팅</span><ArrowUpRight size={14} /></Link><Link href="/theater" className="inline-flex items-center justify-between rounded-xl bg-white/[.06] px-3 py-3 text-xs font-black text-slate-200 hover:bg-rose-300/10 hover:text-rose-100"><span className="inline-flex items-center gap-2"><Play size={14} />LIVE ROOM</span><ArrowUpRight size={14} /></Link></div></aside>
      </section>

      <section aria-label="앱과 광고">
        <div className="home-lower-grid">
          <Link href="/apps" className="home-apps-card group"><div className="flex items-start justify-between gap-4"><span className="home-route-icon text-violet-200 bg-violet-300/10"><AppWindow size={19} /></span><ArrowUpRight size={18} className="text-slate-500 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-violet-200" /></div><p className="mt-7 text-[10px] font-black uppercase tracking-[.2em] text-violet-200">More from GYOPO</p><h2 className="mt-2 text-2xl font-black text-white">앱으로 더 빠르게</h2><p className="mt-2 max-w-md text-sm leading-6 text-slate-400">AI 검색, 랜덤 채팅, 테트리스와 음악을 한 곳에서 열어보세요.</p></Link>
          <AdSlot><BannerAd type="horizontal" /></AdSlot>
        </div>
      </section>
    </div>
  );
}
