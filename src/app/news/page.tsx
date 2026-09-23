'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Clock3, Radio, ShieldCheck } from 'lucide-react';
import { RouteErrorState, RouteSkeleton, useRouteReadiness } from '@/components/layout/RouteExperience';
import { withRouteTimeout } from '@/lib/routeExperience';
import { listDocuments } from '@/lib/firebase';
import { regionLabel } from '@/lib/regions';
import { CONTENT_SOURCES, sourceItemId } from '@/lib/contentSources';
import { useGlobalStore } from '@/store/useGlobalStore';
import { useEffectEvent } from '@/lib/useeffectevent';

type SnapshotItem = { title: string; url: string; description?: string; body?: string; publishedAt?: string; category?: string };
type SnapshotSection = { category: string; label: string; url: string; items: SnapshotItem[] };
type Snapshot = { id: string; sourceId: string; sourceName: string; region: string; url: string; title: string; description?: string; fetchedAt: string; verified?: boolean; items?: SnapshotItem[]; sections?: SnapshotSection[]; sourceSnapshot?: boolean };
type NewsStory = { entry: SnapshotItem; category: string; categoryLabel: string; source: Snapshot };

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

async function loadStoredSources() {
  const results = await Promise.allSettled([
    listDocuments<Omit<Snapshot, 'id'>>('contentSnapshots'),
    listDocuments<Snapshot>('posts'),
  ]);
  const rows = results[0].status === 'fulfilled' ? results[0].value : [];
  const posts = results[1].status === 'fulfilled' ? results[1].value : [];
  const knownSources = new Set(rows.map((row) => row.sourceId));
  const fallbackRows = posts.filter((post) => post.sourceSnapshot && post.sourceId && !knownSources.has(post.sourceId));
  return { items: [...rows, ...fallbackRows].sort((a, b) => new Date(b.fetchedAt || '').getTime() - new Date(a.fetchedAt || '').getTime()), partial: results.some((result) => result.status === 'rejected') };
}

export default function NewsPage() {
  const selectedCountry = useGlobalStore((state) => state.selectedCountry);
  const [items, setItems] = useState<Snapshot[]>([]);
  const [liveSources, setLiveSources] = useState<Snapshot[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [loadedCountry, setLoadedCountry] = useState('');
  const [loadError, setLoadError] = useState('');
  const loadRequest = useRef(0);
  const loading = isLoading || loadedCountry !== selectedCountry;
  useRouteReadiness(loading, Boolean(loadError));

  const load = async () => {
    const request = ++loadRequest.current;
    setLoading(true);
    setLoadError('');
    try {
      const result = await withRouteTimeout((async () => {
      const sources = CONTENT_SOURCES.filter((source) => source.autoImport && source.categories.includes('news') && (selectedCountry === 'Global' || source.region === selectedCountry || source.region === 'Global'));
      const urls = [...sources.slice(0, 24).map((source) => `/api/content/preview?source=${encodeURIComponent(source.id)}`), `/api/content/preview?region=${encodeURIComponent(selectedCountry)}`];
      const [stored, live] = await Promise.all([loadStoredSources(), Promise.allSettled(urls.map(async (url) => {
        const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error('News source unavailable');
        const snapshot = await response.json() as Snapshot;
        if (!snapshot || (!Array.isArray(snapshot.items) && !Array.isArray(snapshot.sections))) throw new Error('Invalid news source');
        return snapshot;
      }))]);
      // Keep empty live responses so stale Firestore snapshots cannot reappear.
      const next = live.flatMap((entry) => entry.status === 'fulfilled' ? [{ ...entry.value, id: entry.value.id || entry.value.sourceId }] : []);
      return { stored, next, partial: stored.partial || live.some((entry) => entry.status === 'rejected') };
      })());
      if (request !== loadRequest.current) return;
      setItems(result.stored.items);
      setLiveSources(result.next);
      if (result.partial) setLoadError('일부 뉴스 출처를 불러오지 못했습니다. 확인된 기사만 표시합니다.');
    } catch {
      if (request === loadRequest.current) setLoadError('뉴스를 불러오지 못했습니다. 연결을 확인하고 다시 시도해주세요.');
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
      </header>

      <main className="category-shell mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-4 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-teal-300">Latest stories</p><h2 className="mt-1 text-lg font-black text-white">최신 소식 <span className="text-slate-500">{stories.length}</span></h2></div><span className="text-xs text-slate-500">행을 클릭하면 원문을 확인합니다</span></div>
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
