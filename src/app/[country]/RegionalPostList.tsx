'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Clock3, Star, X } from 'lucide-react';
import ImageCarousel from '@/components/media/ImageCarousel';
import type { RegionalPost } from '@/lib/regionalContent';
import { parseGoogleMapsUrl, resolvedGooglePlaceId } from '@/lib/directoryMaps';
import { regionalPostHref } from '@/lib/regionRoutes';
import { seoExcerpt } from '@/lib/seo';

type PlaceInfo = {
  status?: string;
  source?: string;
  placeId?: string;
  rating?: number;
  reviews?: number;
  openNow?: boolean;
  hours?: string[];
  images?: string[];
  photoAttributions?: Array<{ displayName: string; uri?: string }>;
  recentReviews?: Array<{ author: string; authorUrl?: string; rating: number; text: string; relativeTime?: string }>;
};
type PlaceState = { loading: boolean; error: string; place?: PlaceInfo };

function isBusinessPost(post: RegionalPost) {
  return post.collection === 'directories' || post.category === 'directory' || post.category === 'food';
}

function placeIdFor(post: RegionalPost) {
  return resolvedGooglePlaceId(post.placeId, post.mapsUrl, post.sourceUrl) || '';
}

function postHref(post: RegionalPost, basePath?: string) {
  return basePath ? `${basePath}/${encodeURIComponent(post.id)}` : regionalPostHref(post.country, post.category, post.id);
}

export default function RegionalPostList({ posts, basePath }: { posts: RegionalPost[]; basePath?: string }) {
  const [selectedKey, setSelectedKey] = useState('');
  const [placeStates, setPlaceStates] = useState<Record<string, PlaceState>>({});
  const placeCache = useRef(new Map<string, PlaceInfo>());
  const selectedBusiness = posts.find((post) => `${post.collection}:${post.id}` === selectedKey && isBusinessPost(post));
  const selectedPlaceId = selectedBusiness ? placeIdFor(selectedBusiness) : '';

  useEffect(() => {
    const post = posts.find((item) => `${item.collection}:${item.id}` === selectedKey && isBusinessPost(item));
    if (!post) return;
    const key = `${post.collection}:${post.id}`;
    const placeId = placeIdFor(post);
    if (!placeId) {
      setPlaceStates((current) => ({ ...current, [key]: { loading: false, error: 'Google Place ID가 없어 평점·운영시간·리뷰를 확인할 수 없습니다.' } }));
      return;
    }
    const cached = placeCache.current.get(placeId);
    if (cached) {
      setPlaceStates((current) => ({ ...current, [key]: { loading: false, error: '', place: cached } }));
      return;
    }

    const controller = new AbortController();
    let active = true;
    setPlaceStates((current) => ({ ...current, [key]: { loading: true, error: '' } }));
    void fetch(`/api/directory/place?placeId=${encodeURIComponent(placeId)}`, { signal: controller.signal })
      .then(async (response) => {
        const place = await response.json() as PlaceInfo & { error?: string };
        if (!response.ok || place.status !== 'ready' || place.source !== 'Google Places' || place.placeId !== placeId) throw new Error(place.error || 'Google Places 정보를 확인하지 못했습니다.');
        return place;
      })
      .then((place) => {
        if (!active) return;
        placeCache.current.set(placeId, place);
        setPlaceStates((current) => ({ ...current, [key]: { loading: false, error: '', place } }));
      })
      .catch(() => {
        if (active) setPlaceStates((current) => ({ ...current, [key]: { loading: false, error: 'Google Places API 응답이 없어 평점·운영시간·리뷰를 표시할 수 없습니다.' } }));
      });
    return () => { active = false; controller.abort(); };
  }, [posts, selectedKey]);

  const selectedState = selectedBusiness ? placeStates[`${selectedBusiness.collection}:${selectedBusiness.id}`] : undefined;
  const place = selectedState?.place;
  const hasPlaceData = place?.status === 'ready' && place.source === 'Google Places' && place.placeId === selectedPlaceId;

  return <>
    {selectedBusiness && <section aria-label={`${selectedBusiness.title} 업소 상세`} className="mb-5 overflow-hidden rounded-2xl border border-cyan-200/15 bg-slate-950/70 shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-4 sm:px-6">
        <div><p className="text-[10px] font-black uppercase tracking-[.18em] text-cyan-300">Business details</p><h2 className="mt-1 text-xl font-black text-white">{selectedBusiness.title}</h2><p className="mt-1 text-xs text-slate-400">{selectedBusiness.country.label}{selectedBusiness.city ? ` · ${selectedBusiness.city}` : ''}</p></div>
        <button type="button" onClick={() => setSelectedKey('')} aria-label="업소 상세 닫기" className="rounded-full border border-white/10 p-2 text-slate-300 hover:bg-white/10"><X size={18} /></button>
      </header>
      <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <ImageCarousel images={hasPlaceData && place?.images?.length ? place.images : selectedBusiness.images} alt={selectedBusiness.title} emptyLabel="확인된 사진이 없습니다." className="min-h-52 rounded-xl" />
        <div className="min-w-0">
          {selectedBusiness.body && <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-300">{selectedBusiness.body}</p>}
          {selectedBusiness.facts.length > 0 && <dl className="mt-4 grid gap-2 rounded-xl border border-white/10 bg-white/[.03] p-4 text-xs sm:grid-cols-2">{selectedBusiness.facts.map((fact) => <div key={fact.label}><dt className="inline text-slate-500">{fact.label}: </dt><dd className="inline break-words font-bold text-slate-200">{fact.value}</dd></div>)}</dl>}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[.03] p-3"><p className="text-[10px] font-black uppercase tracking-wider text-slate-500">평점</p><p className="mt-1 flex items-center gap-1.5 text-lg font-black text-amber-200"><Star size={15} fill="currentColor" />{hasPlaceData && typeof place?.rating === 'number' ? place.rating.toFixed(1) : selectedState?.loading ? '확인 중' : '미제공'}</p><p className="text-[11px] text-slate-500">{hasPlaceData && typeof place?.reviews === 'number' ? `${place.reviews.toLocaleString()}개 리뷰` : 'Google Places 응답 필요'}</p></div>
            <div className="rounded-xl border border-white/10 bg-white/[.03] p-3"><p className="text-[10px] font-black uppercase tracking-wider text-slate-500">운영시간</p><p className="mt-1 flex items-center gap-1.5 text-sm font-bold text-slate-200"><Clock3 size={14} />{hasPlaceData && place?.openNow === true ? '현재 영업 중' : hasPlaceData && place?.openNow === false ? '현재 영업 종료' : selectedState?.loading ? '확인 중' : '미제공'}</p><p className="mt-1 text-[11px] leading-5 text-slate-400">{hasPlaceData && place?.hours?.length ? place.hours.join(' · ') : 'Google Places 응답 필요'}</p></div>
          </div>
          {selectedState?.error && <p role="status" className="mt-3 rounded-lg border border-amber-200/10 bg-amber-200/[.05] p-3 text-xs leading-5 text-amber-100">{selectedState.error}</p>}
          {hasPlaceData && place?.photoAttributions?.map((author, index) => <a key={`${author.displayName}-${index}`} href={author.uri?.startsWith('https://') ? author.uri : undefined} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block pr-3 text-[10px] text-slate-500">{author.displayName}</a>)}
          <div className="mt-4 flex flex-wrap gap-3 text-xs font-bold">{selectedBusiness.sourceUrl && <a href={selectedBusiness.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-200 underline">출처 열기 ↗</a>}<Link href={postHref(selectedBusiness, basePath)} className="text-slate-400 underline">상세 페이지 열기</Link></div>
        </div>
      </div>
      {hasPlaceData && place?.recentReviews?.length ? <div className="border-t border-white/10 p-4 sm:p-6"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-black text-white">Google 리뷰</h3><span className="text-[10px] text-slate-500">Places API 제공</span></div><div className="grid gap-2 md:grid-cols-2">{place.recentReviews.slice(0, 5).map((review, index) => <article key={`${review.author}-${index}`} className="rounded-xl border border-white/5 bg-white/[.03] p-3"><div className="flex justify-between gap-3 text-xs"><a href={review.authorUrl?.startsWith('https://') ? review.authorUrl : undefined} target="_blank" rel="noopener noreferrer" className="font-bold text-slate-200">{review.author || 'Google 사용자'}</a><span className="text-amber-200">{'★'.repeat(Math.max(0, Math.min(5, review.rating)))}</span></div><p className="mt-1 text-xs leading-5 text-slate-400">{review.text || '리뷰 본문이 공개되지 않았습니다.'}</p>{review.relativeTime && <p className="mt-1 text-[10px] text-slate-600">{review.relativeTime}</p>}</article>)}</div></div> : <p className="border-t border-white/10 px-4 py-3 text-xs text-slate-500">{hasPlaceData ? 'Places API 응답에 공개 리뷰가 없습니다.' : 'Google Places API 응답이 없어 리뷰를 표시할 수 없습니다.'}</p>}
    </section>}
    <ul className="divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10 bg-white/[.025]">
      {posts.map((post) => {
        const key = `${post.collection}:${post.id}`;
        const href = postHref(post, basePath);
        const business = isBusinessPost(post);
        const toggle = () => setSelectedKey((current) => current === key ? '' : key);
        return <li key={key} role={business ? 'button' : undefined} tabIndex={business ? 0 : undefined} aria-expanded={business ? selectedKey === key : undefined} onClick={business ? toggle : undefined} onKeyDown={business ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } } : undefined} className={`p-5 sm:p-6 ${business ? 'cursor-pointer transition hover:bg-white/[.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200' : ''}`}>
          <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400"><span>{post.sourceName || post.author || post.country.label}</span>{post.createdAt && <time dateTime={post.createdAt}>{post.createdAt.slice(0, 10)}</time>}</div>
          <h3 className="break-words text-lg font-bold text-white">{business ? <span className="transition hover:text-teal-200">{post.title}<span className="ml-2 text-xs font-bold text-cyan-200">{selectedKey === key ? '상세 닫기' : '한 화면에서 보기'}</span></span> : <Link href={href} className="hover:text-teal-200">{post.title}</Link>}</h3>
          {post.body && <p className="mt-3 break-words text-sm leading-7 text-slate-300">{seoExcerpt(post.body, 320)}</p>}
          {post.facts.length > 0 && <p className="mt-3 text-xs leading-6 text-slate-400">{post.facts.map((fact) => `${fact.label}: ${fact.value}`).join(' / ')}</p>}
        </li>;
      })}
    </ul>
  </>;
}
