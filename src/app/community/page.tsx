'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { RouteErrorState, RouteSkeleton, useRouteReadiness } from '@/components/layout/RouteExperience';
import { fetchRouteJson, withRouteTimeout } from '@/lib/routeExperience';
import { createDocument, deleteDocument, getDocument, getSessionToken, isMasterUser, listDocuments, mergeDocument } from '@/lib/firebase';
import { CONTENT_SOURCES, sourceItemId } from '@/lib/contentSources';
import { curateSourceItems, isSubstantiveCommunityItem, normalizeSourceBody, normalizeSourceText, normalizeSourceTitle, type LiveSourceItem } from '@/lib/sourcepreview';
import { COUNTRY_LOCATIONS } from '@/lib/locations';
import { REGIONS } from '@/lib/regions';
import { COMMUNITY_FILTERS, communityTopic, createFilterLocations, listingLocation, matchesCommunityFilters, paginateListings, type CommunityFilterFields, type CommunityTopic } from '@/lib/listingFilters';
import { useGlobalStore } from '@/store/useGlobalStore';
import WriterComposer, { type WriterDraft } from '@/components/posts/WriterComposer';
import { editorialForStorage, normalizeEditorial, type EditorialContent } from '@/lib/editorialContent';
import { countryForRegion, regionalPostHref } from '@/lib/regionRoutes';
import { useEffectEvent } from '@/lib/useeffectevent';

const locations = createFilterLocations(COUNTRY_LOCATIONS, REGIONS);
type SourceResponse = { items?: LiveSourceItem[]; sections?: Array<{ category: string; items: LiveSourceItem[] }>; fetchedAt?: string };

type Post = CommunityFilterFields & {
  id: string;
  type: string;
  title: string;
  body: string;
  authorId: string;
  author: string;
  country: string;
  location?: string;
  category?: string;
  tag?: string;
  createdAt: string;
  views?: number;
  likes?: number;
  comments?: number;
  image?: string;
  images?: string[];
  sourceUrl?: string;
  editorial?: EditorialContent;
  sourceId?: string;
  sourceCategory?: string;
  sourceName?: string;
  sourceContentId?: string;
  sourceSnapshot?: boolean;
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function isImportedPost(post: Post) {
  return Boolean(post.sourceUrl || post.sourceContentId || post.sourceSnapshot || post.id.startsWith('source-'));
}

function isUnsafeImportedPost(post: Post) {
  if (!isImportedPost(post)) return false;
  const text = `${post.title} ${post.body} ${post.sourceUrl || ''}`;
  return /(누누티비|티비위키|최신주소|주소톡|불법\s*(?:스트리밍|영상)|성착취물|무료\s*시청)/i.test(text);
}

function publicPostHref(post: Post) {
  const country = countryForRegion(post.country);
  return country ? regionalPostHref(country, 'community', post.id) : `/community/${encodeURIComponent(post.id)}`;
}

function curateCommunityPosts(items: Post[]) {
  const byOrigin = new Map<string, Post>();
  for (const post of items) {
    if (!post.authorId) continue;
    if (!isImportedPost(post)) {
      if (post.type === 'news') continue;
      byOrigin.set(post.id, post);
      continue;
    }
    if (post.sourceSnapshot || post.sourceCategory !== 'community' || !isSubstantiveCommunityItem(post)) continue;
    if (isUnsafeImportedPost(post)) continue;
    byOrigin.set(post.sourceUrl || post.id, { ...post, type: 'general', title: normalizeSourceTitle(post.title), body: normalizeSourceBody(post.body), author: normalizeSourceText(post.author || post.sourceName) });
  }
  const seenImported = new Set<string>();
  return [...byOrigin.values()]
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
    .filter((post) => {
      if (!isImportedPost(post)) return true;
      const key = `${normalizeSourceTitle(post.title).toLocaleLowerCase()}:${normalizeSourceBody(post.body).slice(0, 160).toLocaleLowerCase()}`;
      if (seenImported.has(key)) return false;
      seenImported.add(key);
      return true;
    });
}

export default function CommunityPage() {
  const { selectedCountry, setSelectedCountry, user } = useGlobalStore();
  const [posts, setPosts] = useState<Post[]>([]);
  const [isWriting, setIsWriting] = useState(false);
  const [draft, setDraft] = useState<WriterDraft>({ title: '', body: '', images: [] });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const loadRequest = useRef(0);
  useRouteReadiness(loading, Boolean(loadError));
  const [scope, setScope] = useState<'all' | 'country' | 'city'>('all');
  const [topic, setTopic] = useState<CommunityTopic | null>(null);
  const [cityChoice, setCityChoice] = useState({ country: '', city: '' });
  const [pagination, setPagination] = useState({ key: '', page: 1 });
  const baseLocation = listingLocation({ country: selectedCountry }, locations);
  const chosenLocation = { ...baseLocation, city: cityChoice.country === baseLocation.country ? cityChoice.city || undefined : baseLocation.city };
  const chosenCountry = locations.find((country) => country.id === chosenLocation.country);

  const loadPosts = async () => {
    const request = ++loadRequest.current;
    setLoading(true);
    setLoadError('');
    try {
      const result = await withRouteTimeout((async () => {
      const settings = await getDocument<{ disabledSourceIds?: string[] }>('adminSettings', 'contentSources').then(value => ({ value, failed: false }), () => ({ value: null, failed: true }));
      const sources = settings.failed ? [] : CONTENT_SOURCES.filter((source) => source.categories.includes('community') && !settings.value?.disabledSourceIds?.includes(source.id));
      const [data, sourceResults] = await Promise.all([
        Promise.allSettled([listDocuments<Omit<Post, 'id'>>('posts', getSessionToken())]),
        Promise.allSettled(sources.map(async (source) => {
          const snapshot = await fetchRouteJson<SourceResponse>(`/api/content/preview?source=${encodeURIComponent(source.id)}&category=community`);
          if (!Array.isArray(snapshot.items) && !Array.isArray(snapshot.sections)) throw new Error('Invalid community source');
          return { source, result: { items: curateSourceItems(snapshot.sections?.find((section) => section.category === 'community')?.items || snapshot.items || [], 'community'), fetchedAt: snapshot.fetchedAt || new Date().toISOString() } };
        })),
      ]);
      const sourcePosts = sourceResults.flatMap((entry) => {
        if (entry.status !== 'fulfilled') return [];
        const { source, result } = entry.value;
        if (!result) return [];
        return result.items.map((item) => {
          const id = sourceItemId(source.id, 'community', item.url);
          return { id, type: 'general' as const, category: item.category, tag: item.tag, title: item.title, body: item.body || item.description || '', authorId: 'source', author: item.author || source.name, country: item.country || source.region, sourceLocation: item, createdAt: item.publishedAt || result.fetchedAt, image: item.image, images: item.images, sourceId: source.id, sourceCategory: 'community', sourceName: source.name, sourceUrl: item.url, sourceContentId: id };
        });
      });
      const stored = data[0];
      return { posts: curateCommunityPosts([...(stored.status === 'fulfilled' ? stored.value : []), ...sourcePosts]), partial: settings.failed || stored.status === 'rejected' || sourceResults.some((entry) => entry.status === 'rejected' || !entry.value.result) };
      })());
      if (request !== loadRequest.current) return;
      setPosts(result.posts);
      if (result.partial) setLoadError('일부 게시글 출처를 불러오지 못했습니다. 확인된 게시글만 표시합니다.');
    } catch {
      if (request === loadRequest.current) setLoadError('게시글을 불러오지 못했습니다. 연결을 확인하고 다시 시도해주세요.');
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  };
  const loadPostsEffect = useEffectEvent(loadPosts);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPostsEffect(), 0);
    return () => { window.clearTimeout(timer); loadRequest.current++; };
  }, []);

  const openWrite = (post?: Post) => {
    setEditingId(post?.id || null);
    setDraft({ title: post?.title || '', body: post?.body || '', images: post?.images || (post?.image ? [post.image] : []), editorial: normalizeEditorial(post?.editorial) });
    setIsWriting(true);
  };

  const handleWrite = async (nextDraft: WriterDraft) => {
    if (!user) {
      window.alert('로그인 후 글을 작성할 수 있습니다.');
      return;
    }
    const token = getSessionToken();
    if (!token) return;
    const post = editingId
      ? { title: nextDraft.title, body: nextDraft.body, image: nextDraft.images[0] || '', images: nextDraft.images, updatedAt: new Date() }
      : { type: 'general' as const, title: nextDraft.title, body: nextDraft.body, image: nextDraft.images[0] || '', images: nextDraft.images, authorId: user.id, author: user.name, country: selectedCountry, createdAt: new Date().toISOString(), views: 0, likes: 0, comments: 0 };
    try {
      const content = { ...post, editorial: editorialForStorage(nextDraft.editorial) };
      if (editingId) await mergeDocument('posts', editingId, content, token);
      else await createDocument('posts', crypto.randomUUID(), content, token);
      setDraft({ title: '', body: '', images: [] });
      setEditingId(null);
      setIsWriting(false);
      await loadPosts();
    } catch {
      window.alert('게시글을 저장하지 못했습니다. 다시 시도해주세요.');
    }
  };

  const handleDelete = async (post: Post) => {
    if (!user || (user.id !== post.authorId && !isMasterUser(user)) || !window.confirm('이 게시글을 삭제할까요?')) return;
    const token = getSessionToken();
    if (!token) return;
    try {
      await deleteDocument('posts', post.id, token);
      setPosts((current) => current.filter((item) => item.id !== post.id));
    } catch {
      window.alert('게시글을 삭제하지 못했습니다.');
    }
  };

  const filteredPosts = posts.filter((post) => matchesCommunityFilters(post, scope, topic, chosenLocation, locations));
  const pageKey = JSON.stringify([scope, topic, chosenLocation]);
  const page = paginateListings(filteredPosts, pagination.key === pageKey ? pagination.page : 1);

  return (
     <div className="category-page community-page container mx-auto max-w-5xl px-4 py-8 text-slate-100">
      <div className="category-header">
        <div className="category-heading">
          <h1 className="text-3xl font-black text-white">교민 커뮤니티</h1>
          <p className="text-sm text-gray-500 mt-1">직접 쓴 이야기와 선별된 생활 질문·정보·유머를 나눠보세요.</p>
        </div>
        {user ? <button onClick={() => openWrite()} className="rounded-xl bg-cyan-300 px-5 py-2.5 font-black text-slate-950 shadow-md transition hover:bg-cyan-200">글쓰기</button> : <Link href="/login" className="rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-5 py-2.5 text-sm font-black text-cyan-100 transition hover:bg-cyan-300/20">로그인 후 글쓰기</Link>}
      </div>

       <section aria-label="커뮤니티 필터" className="mb-5 space-y-3 rounded-xl border border-white/10 p-4">
         <div className="flex flex-wrap gap-2">
           <select aria-label="커뮤니티 국가 선택" value={chosenCountry?.id || 'Global'} onChange={(event) => { setSelectedCountry(event.target.value); setCityChoice({ country: '', city: '' }); setPagination({ key: '', page: 1 }); }} className="max-w-full rounded-lg border border-white/20 bg-slate-900 px-3 py-2 text-sm"><option value="Global">국가 선택</option>{locations.map((country) => <option key={country.id} value={country.id}>{country.label}</option>)}</select>
           <select aria-label="커뮤니티 도시 선택" value={chosenLocation.city || ''} disabled={!chosenCountry?.cities.length} onChange={(event) => { setCityChoice({ country: chosenCountry?.id || '', city: event.target.value }); setPagination({ key: '', page: 1 }); }} className="max-w-full rounded-lg border border-white/20 bg-slate-900 px-3 py-2 text-sm disabled:opacity-50"><option value="">도시 선택</option>{chosenCountry?.cities.map((city) => <option key={city.slug} value={city.slug}>{city.label}</option>)}</select>
         </div>
         <div className="flex flex-wrap gap-2">
           {COMMUNITY_FILTERS.map((filter) => {
             const active = filter === '전체' ? scope === 'all' && topic === null : filter === '내국가' ? scope === 'country' : filter === '내도시' ? scope === 'city' : topic === filter;
             return <button key={filter} type="button" aria-pressed={active} onClick={() => {
               if (filter === '전체') { setScope('all'); setTopic(null); }
               else if (filter === '내국가') setScope((current) => current === 'country' ? 'all' : 'country');
              else if (filter === '내도시') setScope((current) => current === 'city' ? 'all' : 'city');
              else setTopic((current) => current === filter ? null : filter);
              setPagination({ key: '', page: 1 });
             }} className={`rounded-lg border px-3 py-2 text-sm font-bold ${active ? 'border-blue-400 bg-blue-600 text-white' : 'border-white/20 text-slate-300'}`}>{filter}</button>;
           })}
         </div>
         <p className="text-xs leading-relaxed text-slate-400">지역과 글 분류를 함께 선택할 수 있습니다. 생활과 정보는 별도 분류이며, 명시된 분류만 사용합니다. 위치·분류 미확인 글도 전체에서 볼 수 있습니다.</p>
         {scope !== 'all' && !chosenLocation.country && <p role="status" className="text-sm text-amber-200">내국가·내도시를 보려면 위에서 국가를 선택해주세요. 위치를 추측해 글을 표시하지 않습니다.</p>}
         {scope === 'city' && chosenLocation.country && !chosenLocation.city && <p role="status" className="text-sm text-amber-200">선택한 도시가 없습니다. 위에서 도시를 선택해주세요.{!chosenCountry?.cities.length && ' 이 국가의 도시 목록은 아직 연결되지 않았습니다. 내국가 또는 전체를 이용해주세요.'}</p>}
         <p role="status" className="text-sm font-bold text-slate-200">{loading ? '게시글을 불러오는 중입니다.' : `불러온 게시글 중 ${page.total}건 · ${page.from}–${page.to}건 표시`}</p>
       </section>

       <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[.045]">
         <div className="hidden grid-cols-12 gap-4 border-b border-white/10 bg-white/[.035] p-4 text-sm font-bold text-slate-400 md:grid">
          <div className="col-span-1 text-center">분류</div>
          <div className="col-span-1 text-center">국가</div>
          <div className="col-span-5">제목</div>
          <div className="col-span-2 text-center">작성자</div>
          <div className="col-span-2 text-center">날짜</div>
          <div className="col-span-1 text-center">조회</div>
        </div>

         <div className="divide-y divide-white/10">
           {loading && <RouteSkeleton label="게시글을 불러오는 중입니다." />}
           {!loading && loadError && <RouteErrorState message={loadError} onRetry={() => void loadPosts()} />}
           {!loading && !loadError && filteredPosts.length === 0 && <div className="ui-state route-state">선택한 조건에 맞는 게시글이 없습니다. 조건을 해제하거나 전체를 선택해주세요.</div>}
          {!loading && page.items.map((post) => (
             <div key={post.id} className="relative transition-colors hover:bg-white/[.06]">
               <Link href={post.sourceContentId ? `/content/${post.sourceContentId}?source=${encodeURIComponent(post.sourceId || '')}&category=${encodeURIComponent(post.sourceCategory || 'community')}&url=${encodeURIComponent(post.sourceUrl || '')}` : publicPostHref(post)} className="block">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 p-4 items-center">
                <div className="col-span-1 text-xs md:text-sm font-bold text-center">
                  <span className={post.type === 'notice' ? 'text-red-500' : post.type === 'news' ? 'text-blue-500' : 'text-gray-400'}>
                    {post.type === 'notice' ? '공지' : post.type === 'news' ? '뉴스' : communityTopic(post) || '미분류'}
                  </span>
                </div>
                 <div className="col-span-1 text-center text-xs font-bold md:text-sm"><span className="rounded bg-white/10 px-2 py-1 text-slate-300">{post.country}</span></div>
                 <div className="col-span-1 md:col-span-5">
                      <div className="flex items-center gap-3">{post.image && <img src={post.image} alt="" className="h-12 w-16 shrink-0 rounded-lg object-cover" />}<div className="min-w-0"><h3 className="truncate text-base font-bold text-white">{post.title}</h3><p className="mt-1 line-clamp-1 text-xs text-slate-400">{post.body}</p></div></div>
                   {post.sourceName && <div className="text-xs text-blue-500">출처: {post.sourceName}</div>}
                  {!!post.comments && <span className="text-blue-500 text-sm font-bold">[{post.comments}]</span>}
                </div>
                    <div className="col-span-2 flex items-center text-sm text-slate-400 md:justify-center"><span className="mr-1 md:hidden">작성자: </span>{post.author}</div>
                 <div className="col-span-2 text-center text-xs text-slate-500 md:text-sm">{formatDate(post.createdAt)}</div>
                 <div className="col-span-1 hidden text-center text-xs text-slate-500 md:block md:text-sm">{post.views || 0}</div>
              </div>
              </Link>
                {user && !isImportedPost(post) && (user.id === post.authorId || isMasterUser(user)) && !post.id.startsWith('seed-') && <div className="post-actions flex items-center justify-center gap-2 px-4 py-2 text-xs">{user.id === post.authorId && <button type="button" onClick={() => openWrite(post)} className="font-bold text-blue-600 hover:underline">수정</button>}<button type="button" onClick={() => void handleDelete(post)} className="delete-action font-bold text-red-500 hover:underline">삭제</button></div>}
             </div>
          ))}
        </div>
      </div>
      {!loading && page.total > 0 && <nav aria-label="커뮤니티 페이지" className="mt-5 flex items-center justify-center gap-4 text-sm"><button type="button" disabled={page.page === 1} onClick={() => setPagination({ key: pageKey, page: page.page - 1 })} className="rounded-lg border border-white/20 px-4 py-2 disabled:opacity-40">이전</button><span>{page.page} / {page.totalPages}</span><button type="button" disabled={page.page === page.totalPages} onClick={() => setPagination({ key: pageKey, page: page.page + 1 })} className="rounded-lg border border-white/20 px-4 py-2 disabled:opacity-40">다음</button></nav>}

       {isWriting && user && <WriterComposer userId={user.id} initial={draft} editing={Boolean(editingId)} onClose={() => { setIsWriting(false); setEditingId(null); }} onSave={handleWrite} />}
    </div>
  );
}
