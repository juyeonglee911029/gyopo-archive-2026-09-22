'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Clock3, Radio, ShieldCheck } from 'lucide-react';
import { RouteErrorState, RouteSkeleton, useRouteReadiness } from '@/components/layout/RouteExperience';
import { withRouteTimeout } from '@/lib/routeExperience';
import { listDocuments } from '@/lib/firebase';
import { isPublicArticle } from '@/lib/publicArticle';
import { regionLabel } from '@/lib/regions';
import { CONTENT_SOURCES, contentSourceMatchesRegion, sourceItemId } from '@/lib/contentSources';
import { hasCacheableNews, readLastGoodNews, resolveNewsSnapshots, writeLastGoodNews, type NewsCacheItem, type NewsCacheSection, type NewsCacheSnapshot } from '@/lib/newsSnapshotCache';
import { useGlobalStore } from '@/store/useGlobalStore';
import { useEffectEvent } from '@/lib/useeffectevent';
import CategoryPostWriter from '@/components/posts/CategoryPostWriter';

type SnapshotItem = NewsCacheItem;
type SnapshotSection = NewsCacheSection;
type Snapshot = NewsCacheSnapshot & { sourceSnapshot?: boolean; status?: string; warnings?: string[] };
type NewsStory = { entry: SnapshotItem; category: string; categoryLabel: string; source: Snapshot };
type StoredPost = Partial<Snapshot> & { type?: string; status?: unknown; deleted?: unknown; isPublic?: unknown; expiresAt?: unknown; body?: string; authorId?: string; author?: string; country?: string; createdAt?: string; image?: string; images?: string[] };
type NativeNewsPost = { id: string; title: string; body: string; author: string; country: string; createdAt: string; image?: string };

const categoryLabels: Record<string, string> = { news: '뉴스', events: '행사', jobs: '구인구직', directory: '업소', community: '커뮤니티' };
const navigationTitlePattern = /^(로그인|회원가입|전체보기|더보기|기사 보기|상품 등록|공고 등록|업체 등록|관심 상품|내 거래|글쓰기|검색|한인회소개|임원소개|역대 회장|찾아오시는 길|주요 연락처|공지사항|한인회 소식지|대사관소식)$/i;

function contentHref(sourceId: string, category: string, entry: SnapshotItem) {
  return `/content/${sourceItemId(sourceId, category, entry.url)}?source=${encodeURIComponent(sourceId)}&category=${encodeURIComponent(category)}&url=${encodeURIComponent(entry.url)}`;
}

function formatStoryDate(value?: string) {
  if (!value) return '최신 업데이트';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '최신 업데이트';
  return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function isNewsEntry(entry: SnapshotItem, source: Snapshot) {
  const title = entry.title.trim();
  const entryUrl = entry.url.replace(/\/+$/, '');
  const sourceUrl = source.url.replace(/\/+$/, '');
  if (!title || navigationTitlePattern.test(title) || entryUrl === sourceUrl) return false;
  if (!entry.publishedAt && entry.description && source.description && entry.description.trim() === source.description.trim()) return false;
  return true;
}

function hasNewsStories(source: Snapshot) {
  const sourceCategory = CONTENT_SOURCES.find((item) => item.id === source.sourceId)?.categories[0];
  return Boolean(
    source.sections?.some((section) => section.category === 'news' && section.items.some((entry) => isNewsEntry(entry, source)))
    || source.items?.some((entry) => (entry.category || sourceCategory || 'news') === 'news' && isNewsEntry(entry, source)),
  );
}

function readBrowserNewsCache(region: string) {
  try {
    return readLastGoodNews(window.localStorage, region);
  } catch {
    return [];
  }
}

function latestFetchedAt(snapshots: readonly Snapshot[]) {
  return snapshots.map((snapshot) => snapshot.fetchedAt).filter((value) => !Number.isNaN(Date.parse(value))).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || '';
}

async function loadStoredSources() {
  const results = await Promise.allSettled([
    listDocuments<Omit<Snapshot, 'id'>>('contentSnapshots'),
    listDocuments<StoredPost>('posts'),
  ]);
  const rows = results[0].status === 'fulfilled' ? results[0].value : [];
  const posts = results[1].status === 'fulfilled' ? results[1].value : [];
  const knownSources = new Set(rows.map((row) => row.sourceId));
  const fallbackRows = posts.filter((post) => post.sourceSnapshot && post.sourceId && !knownSources.has(post.sourceId)) as Snapshot[];
  const nativeNews = posts.flatMap((post): NativeNewsPost[] => post.type === 'news' && isPublicArticle(post) && !post.sourceSnapshot && post.title?.trim() && post.body?.trim() && post.authorId && post.createdAt
    ? [{ id: post.id, title: post.title, body: post.body, author: post.author || '교민 회원', country: post.country || 'Global', createdAt: post.createdAt, image: post.image }]
    : []);
  return { items: [...rows, ...fallbackRows].sort((a, b) => new Date(b.fetchedAt || '').getTime() - new Date(a.fetchedAt || '').getTime()), nativeNews, partial: results.some((result) => result.status === 'rejected') };
}

export default function NewsPage() {
  const selectedCountry = useGlobalStore((state) => state.selectedCountry);
  const [items, setItems] = useState<Snapshot[]>([]);
  const [nativeNews, setNativeNews] = useState<NativeNewsPost[]>([]);
  const [liveSources, setLiveSources] = useState<Snapshot[]>([]);
  const [usingLastGoodCache, setUsingLastGoodCache] = useState(false);
  const [lastGoodFetchedAt, setLastGoodFetchedAt] = useState('');
  const [isLoading, setLoading] = useState(true);
  const [loadedCountry, setLoadedCountry] = useState('');
  const [loadError, setLoadError] = useState('');
  const loadRequest = useRef(0);
  const loading = isLoading || loadedCountry !== selectedCountry;
  useRouteReadiness(loading, Boolean(loadError));

  const load = async () => {
    const request = ++loadRequest.current;
    const sources = CONTENT_SOURCES.filter((source) => source.autoImport && source.categories.includes('news') && contentSourceMatchesRegion(source, selectedCountry));
    const requests = [
      ...sources.slice(0, 24).map((source) => ({ sourceId: source.id, url: `/api/content/preview?source=${encodeURIComponent(source.id)}` })),
      { sourceId: `regional-${selectedCountry}`, url: `/api/content/preview?region=${encodeURIComponent(selectedCountry)}` },
    ];
    const requestIds = new Set(requests.map((item) => item.sourceId));
    const cachedAtStart = readBrowserNewsCache(selectedCountry).filter((snapshot) => requestIds.has(snapshot.sourceId));
    setLoadError('');
    if (cachedAtStart.length) {
      setLiveSources(cachedAtStart);
      setUsingLastGoodCache(true);
      setLastGoodFetchedAt(latestFetchedAt(cachedAtStart));
      setLoadedCountry(selectedCountry);
      setLoading(false);
    } else {
      setLoading(true);
      setUsingLastGoodCache(false);
      setLastGoodFetchedAt('');
    }
    try {
      const result = await withRouteTimeout((async () => {
        const [stored, live] = await Promise.all([loadStoredSources(), Promise.allSettled(requests.map(async ({ url, sourceId }) => {
          const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
          if (!response.ok) throw new Error('News source unavailable');
          const snapshot = await response.json() as Snapshot;
          if (!snapshot || (!Array.isArray(snapshot.items) && !Array.isArray(snapshot.sections))) throw new Error('Invalid news source');
          return { ...snapshot, id: snapshot.id || snapshot.sourceId || sourceId };
        }))]);
        const storedCache = stored.items.filter(hasNewsStories);
        const resolved = resolveNewsSnapshots(live.map((entry, index) => ({
          sourceId: requests[index].sourceId,
          snapshot: entry.status === 'fulfilled' ? entry.value : undefined,
        })), [...storedCache, ...cachedAtStart], hasNewsStories);
        const next = resolved.snapshots as Snapshot[];
        if (next.some(hasNewsStories)) {
          try { writeLastGoodNews(window.localStorage, selectedCountry, next.filter(hasCacheableNews)); } catch { /* Cache is optional. */ }
        }
        const sourceUnavailable = live.some((entry) => entry.status === 'rejected' || (entry.status === 'fulfilled' && !hasNewsStories(entry.value)));
        return { stored, next, partial: stored.partial || sourceUnavailable, cacheFallbacks: resolved.cacheFallbacks as Snapshot[] };
      })());
      if (request !== loadRequest.current) return;
      setItems(result.stored.items);
      setNativeNews(result.stored.nativeNews);
      setLiveSources(result.next);
      setUsingLastGoodCache(result.cacheFallbacks.length > 0);
      setLastGoodFetchedAt(latestFetchedAt(result.cacheFallbacks));
      if (result.partial && !result.cacheFallbacks.length) setLoadError('뉴스 출처가 응답하지 않습니다. 마지막 정상 캐시가 없어 다시 시도해주세요.');
    } catch {
      if (request === loadRequest.current) {
        const fallback = cachedAtStart.length ? cachedAtStart : readBrowserNewsCache(selectedCountry).filter((snapshot) => requestIds.has(snapshot.sourceId));
        if (fallback.length) {
          setLiveSources(fallback);
          setUsingLastGoodCache(true);
          setLastGoodFetchedAt(latestFetchedAt(fallback));
        } else {
          setLoadError('뉴스를 불러오지 못했습니다. 연결을 확인하고 다시 시도해주세요.');
        }
      }
    } finally {
      if (request === loadRequest.current) { setLoadedCountry(selectedCountry); setLoading(false); }
    }
  };
  const loadEffect = useEffectEvent(load);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadEffect(), 0);
    return () => { window.clearTimeout(timer); loadRequest.current++; };
  }, [selectedCountry]);

  const liveIds = new Set(liveSources.map((item) => item.sourceId));
  const visible = [...liveSources, ...items.filter((item) => !liveIds.has(item.sourceId))].filter((item) => selectedCountry === 'Global' || item.region === selectedCountry || item.region === 'Global');
  const storyKeys = new Set<string>();
  const stories: NewsStory[] = [];
  visible.forEach((source) => {
    source.sections?.filter((section) => section.category === 'news' && section.items.length).forEach((section) => section.items.filter((entry) => isNewsEntry(entry, source)).forEach((entry) => {
      const key = `${source.sourceId}:${entry.url}`;
      if (storyKeys.has(key)) return;
      storyKeys.add(key);
      stories.push({ entry, category: section.category, categoryLabel: section.label || categoryLabels[section.category] || '소식', source });
    }));
    const sourceCategory = CONTENT_SOURCES.find((item) => item.id === source.sourceId)?.categories[0];
    source.items?.filter((entry) => (entry.category || sourceCategory || 'news') === 'news' && isNewsEntry(entry, source)).forEach((entry) => {
      const key = `${source.sourceId}:${entry.url}`;
      if (storyKeys.has(key)) return;
      storyKeys.add(key);
      stories.push({ entry, category: 'news', categoryLabel: categoryLabels.news, source });
    });
  });
  stories.sort((a, b) => new Date(b.entry.publishedAt || b.source.fetchedAt).getTime() - new Date(a.entry.publishedAt || a.source.fetchedAt).getTime());
  const regionName = selectedCountry === 'Global' ? '글로벌' : regionLabel(selectedCountry);

  return (
    <div className="category-page news-page min-h-screen bg-transparent text-slate-100">
      <header className="category-header">
          <div className="category-heading">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[.2em] text-emerald-200"><Radio size={12} /> {regionName} live desk</div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">오늘의 뉴스</h1>
            <p className="mt-2 text-sm text-slate-400">카테고리 선택 없이 최신 소식을 목록에서 바로 확인하세요.</p>
          </div>
          <CategoryPostWriter category="news" onSaved={() => void loadEffect()} />
      </header>

      <main className="category-shell mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {nativeNews.filter((post) => selectedCountry === 'Global' || post.country === 'Global' || post.country === selectedCountry).length > 0 && <section aria-label="교민이 작성한 뉴스" className="mb-6 rounded-2xl border border-white/10 bg-white/[.04]">
          <div className="border-b border-white/10 px-4 py-3"><p className="text-[10px] font-black uppercase tracking-[.16em] text-cyan-200">Community Desk</p><h2 className="mt-1 font-black text-white">교민이 쓴 소식</h2></div>
          <div className="divide-y divide-white/10">{nativeNews.filter((post) => selectedCountry === 'Global' || post.country === 'Global' || post.country === selectedCountry).map((post) => <Link key={post.id} href={`/community/${encodeURIComponent(post.id)}`} className="flex gap-3 p-4 transition hover:bg-white/[.05]">{post.image && <img src={post.image} alt="" className="h-16 w-20 shrink-0 rounded-lg object-cover" />}<span className="min-w-0"><span className="flex flex-wrap gap-2 text-[10px] font-bold text-slate-400"><span>{regionLabel(post.country)}</span><span>{post.author}</span><span>{formatStoryDate(post.createdAt)}</span></span><strong className="mt-1 block truncate text-sm text-white">{post.title}</strong><span className="mt-1 block line-clamp-2 text-xs leading-5 text-slate-400">{post.body}</span></span></Link>)}</div>
        </section>}
        <div className="mb-4 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-teal-300">Latest stories</p><h2 className="mt-1 text-lg font-black text-white">최신 소식 <span className="text-slate-500">{stories.length}</span></h2></div><span className="text-xs text-slate-500">행을 클릭하면 원문을 확인합니다</span></div>
        {usingLastGoodCache && <p role="status" className="mb-3 rounded-xl border border-amber-200/15 bg-amber-200/[.05] px-3 py-2 text-xs text-amber-100">뉴스 출처가 응답하지 않아 마지막 정상 수신 기사를 표시하고 있습니다{lastGoodFetchedAt ? ` · ${formatStoryDate(lastGoodFetchedAt)}` : ''}.</p>}
        {loading && <RouteSkeleton label="뉴스 출처와 최신 기사를 불러오는 중입니다." />}
        {!loading && loadError && <RouteErrorState message={loadError} onRetry={() => void load()} />}
        {!loading && !loadError && stories.length === 0 && <div className="ui-state route-state">선택한 지역의 뉴스가 없습니다.</div>}
        {stories.length > 0 && <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[.045]">
          <div className="hidden grid-cols-[100px_minmax(0,1fr)_160px_110px] gap-4 border-b border-white/10 px-4 py-3 text-[10px] font-black uppercase tracking-[.14em] text-slate-500 md:grid"><span>분류</span><span>제목</span><span>출처</span><span>업데이트</span></div>
          <div className="divide-y divide-white/7">{stories.map((story) => <Link key={`${story.source.sourceId}-${story.category}-${story.entry.url}`} href={contentHref(story.source.sourceId, story.category, story.entry)} className="grid gap-2 px-4 py-3 transition hover:bg-white/[.05] md:grid-cols-[100px_minmax(0,1fr)_160px_110px] md:items-center md:gap-4"><div className="flex items-center gap-2 text-[10px] font-black"><span className="rounded-full bg-teal-300/10 px-2 py-1 text-teal-200">{story.categoryLabel}</span><span className="text-slate-500 md:hidden">{regionLabel(story.source.region)}</span></div><div className="min-w-0"><h3 className="truncate text-sm font-bold text-white">{story.entry.title}</h3><p className="mt-1 line-clamp-1 text-xs text-slate-400">{story.entry.description || story.entry.body || '원문에서 자세한 내용을 확인하세요.'}</p></div><div className="flex min-w-0 items-center gap-1.5 text-xs text-slate-300"><span className="truncate">{story.source.sourceName}</span>{story.source.verified && <ShieldCheck size={12} className="shrink-0 text-emerald-300" />}</div><div className="flex items-center gap-1.5 text-[11px] text-slate-500"><Clock3 size={12} />{formatStoryDate(story.entry.publishedAt || story.source.fetchedAt)}</div></Link>)}</div>
        </div>}
      </main>
    </div>
  );
}
