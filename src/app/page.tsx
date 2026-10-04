'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, ArrowUpRight, Film, Gamepad2, MessageCircle, Music2, Radio, Search, UserRoundCheck } from 'lucide-react';
import BannerAd from '@/components/ads/BannerAd';
import MarketTicker from '@/components/layout/MarketTicker';
import { GlobalRegionSelectors } from '@/components/layout/GlobalSidebar';
import { beginRoute, useRouteReadiness } from '@/components/layout/RouteExperience';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Primitives';
import { listDocuments } from '@/lib/firebase';
import { serviceHref } from '@/lib/regionRoutes';
import { PUBLIC_CATEGORIES, publicCategoryHref, publicCategoryRegion } from '@/lib/publicCategories';
import type { PublicCategory } from '@/lib/publicCategories';
import { isPublicArticle } from '@/lib/publicArticle';
import { regionLabel } from '@/lib/regions';
import { resolvePortalSearch } from '@/lib/searchRouting';
import { trackSearch } from '@/lib/searchTracking';
import { trackGrowth } from '@/lib/growthTracking';
import { useGlobalStore } from '@/store/useGlobalStore';
import styles from './home.module.css';

type HomePost = { id: string; title: string; type: string; authorId: string; views?: number; createdAt: string; country: string; sourceUrl?: string; sourceName?: string; status?: string; deleted?: boolean; isPublic?: boolean; sourceSnapshot?: boolean; expiresAt?: unknown };

const typeLabels: Record<string, string> = { notice: '공지', news: '뉴스', free: '자유' };
const mainCategories = ['jobs', 'housing', 'directory', 'market', 'community', 'news', 'life', 'guides'];

function HomeFeedReadiness({ loading, error }: { loading: boolean; error: boolean }) {
  useRouteReadiness(loading, error);
  return null;
}

export default function Home() {
  const router = useRouter();
  const selectedCountry = useGlobalStore((state) => state.selectedCountry);
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
  const categoryHref = (category: PublicCategory) => category.service && selectedRoute
    ? serviceHref(selectedRoute, category.service, selectedCity)
    : publicCategoryHref(category, selectedCountry);

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
    <div className={styles.home}>
      <Suspense fallback={null}><HomeFeedReadiness loading={feedStatus === 'loading'} error={feedStatus === 'error'} /></Suspense>
      <section className={styles.hero} aria-label="GYOPO 시작">
        <div className={styles.heroCopy}>
          <div className={styles.heroTopline}>
            <span className={styles.heroEyebrow}><i aria-hidden="true" />GYOPO SOCIAL CLUB</span>
            <div className={styles.locationPicker}><span>내 지역</span><GlobalRegionSelectors /></div>
          </div>
          <h1>좋아하는 순간을,<br /><span>좋은 사람과.</span></h1>
          <p>교민 생활 정보부터 친구, 라이브, 즐길 거리까지.</p>
          <form role="search" onSubmit={submitSmartSearch} className={styles.search}>
            <Search size={20} aria-hidden="true" />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} aria-label="지역, 일자리, 업소 검색" placeholder="어떤 정보가 필요하세요?" />
            <button type="submit">검색 <ArrowRight size={16} aria-hidden="true" /></button>
          </form>
        </div>
        <Link href="/users" className={styles.matchCard} aria-label="온라인 교민과 매칭하기">
          <span className={styles.matchCardTop}><span>ONLINE · MATCH</span><ArrowUpRight size={17} aria-hidden="true" /></span>
          <span className={styles.matchOrb} aria-hidden="true"><UserRoundCheck size={28} /><i /><b /></span>
          <span className={styles.matchCopy}><strong>새 친구를<br />만날 시간</strong><small>온라인 교민과 연결하고<br />대화를 시작해보세요.</small></span>
          <span className={styles.matchAction}>매칭 시작 <ArrowRight size={16} aria-hidden="true" /></span>
        </Link>
        <div className={styles.heroFooter}><span>COMMUNITY · ENTERTAINMENT · LIFE</span><span><i aria-hidden="true" />{regionName}에서 둘러보기</span></div>
      </section>

      <nav className={styles.quickLinks} aria-label="엔터테인먼트 바로가기">
        <Link href="/theater"><Radio size={20} aria-hidden="true" /><span><b>라이브 룸</b><small>같이 보고 참여하기</small></span><ArrowUpRight size={15} aria-hidden="true" /></Link>
        <Link href="/music"><Music2 size={20} aria-hidden="true" /><span><b>음악</b><small>지금 듣고 싶은 플레이</small></span><ArrowUpRight size={15} aria-hidden="true" /></Link>
        <Link href="/games"><Gamepad2 size={20} aria-hidden="true" /><span><b>게임</b><small>잠깐, 한 판 즐기기</small></span><ArrowUpRight size={15} aria-hidden="true" /></Link>
        <button type="button" onClick={() => window.dispatchEvent(new Event('gyopo-open-global-chat'))}><MessageCircle size={20} aria-hidden="true" /><span><b>라운지</b><small>지금 접속한 교민과 대화</small></span><ArrowUpRight size={15} aria-hidden="true" /></button>
      </nav>

      <section className={styles.marketSection} aria-label="코인 시세와 환율 계산기"><MarketTicker /></section>

      <section aria-labelledby="home-routes-heading">
        <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>{regionName} · DISCOVER</span><h2 id="home-routes-heading">생활 정보 둘러보기</h2></div><Link href="/services">전체 서비스 <ArrowRight size={14} aria-hidden="true" /></Link></div>
        <nav className={styles.categories} aria-label="생활 카테고리">
          {mainCategories.map((id) => PUBLIC_CATEGORIES.find((category) => category.id === id)!).map((category) => {
            const Icon = category.icon;
            return <Link key={category.id} href={categoryHref(category)} className={styles.category}>
              <Icon size={22} className={styles.categoryIcon} aria-hidden="true" />
              <ArrowUpRight size={16} className={styles.categoryArrow} aria-hidden="true" />
              <h3>{category.title}</h3><p>{category.description}</p>
            </Link>;
          })}
        </nav>
        <nav className={styles.moreLinks} aria-label="더 둘러보기">
          <span>더 둘러보기</span>{PUBLIC_CATEGORIES.filter((category) => !mainCategories.includes(category.id)).map((category) => {
            const Icon = category.icon;
            return <Link key={category.id} href={categoryHref(category)}><Icon size={15} aria-hidden="true" />{category.title}</Link>;
          })}
        </nav>
      </section>

      <section className={styles.feedLayout} aria-labelledby="home-board-heading">
        <div className={styles.feed}>
          <div className={styles.sectionHeading}><h2 id="home-board-heading">동네에서 지금 나누는 이야기</h2><Link href={publicCategoryHref(PUBLIC_CATEGORIES.find((category) => category.id === 'community')!, selectedCountry)}>전체 보기 <ArrowRight size={14} aria-hidden="true" /></Link></div>
          <div className={styles.feedItems}>
            {feedStatus === 'loading' && <Skeleton label="최근 이야기를 불러오고 있습니다" lines={5} />}
            {feedStatus === 'error' && <ErrorState title="이야기를 불러오지 못했습니다" description="연결을 확인한 뒤 다시 시도해주세요." actions={<button className={styles.retry} type="button" onClick={() => { setFeedStatus('loading'); setFeedAttempt((attempt) => attempt + 1); }}>다시 시도</button>} />}
            {feedStatus === 'ready' && visiblePosts.length === 0 && <EmptyState title="이 지역의 첫 이야기를 기다리고 있어요" description="다른 지역의 이야기나 커뮤니티를 살펴보세요." actions={<Link href="/community">커뮤니티 둘러보기 <ArrowRight size={14} /></Link>} />}
            {feedStatus === 'ready' && visiblePosts.map((post) => <Link href={post.sourceUrl || `/community/${post.id}`} key={post.id} className={styles.post}><span>{typeLabels[post.type] || '소식'}</span><b>{post.title}</b><ArrowUpRight size={15} aria-hidden="true" /></Link>)}
          </div>
        </div>
        <aside className={styles.connect}>
          <Film size={25} aria-hidden="true" />
          <span className={styles.eyebrow}>YOUR LOCAL SCENE</span>
          <h2>이 도시의 이야기를<br />함께 만들어가요.</h2>
          <p>현지 생활의 작은 질문부터 반가운 일상까지.<br />우리 동네 교민들과 나눠보세요.</p>
          <Link href={publicCategoryHref(PUBLIC_CATEGORIES.find((category) => category.id === 'community')!, selectedCountry)}>커뮤니티 둘러보기 <ArrowRight size={15} aria-hidden="true" /></Link>
        </aside>
      </section>

      <section className={styles.advertisement} aria-label="광고">
        <span>ADVERTISEMENT</span><BannerAd type="horizontal" />
      </section>
    </div>
  );
}
