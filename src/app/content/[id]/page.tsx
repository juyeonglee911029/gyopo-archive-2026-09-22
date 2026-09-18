'use client';

import Link from 'next/link';
import { Image as ImageIcon, ShieldCheck } from 'lucide-react';
import { notFound, useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { findContent, type ResolvedContent } from '@/components/posts/contentLookup';
import { getRegionalCategory } from '@/lib/regionRoutes';
import PostComments from '@/components/posts/PostComments';
import PostActions from '@/components/posts/PostActions';
import ImageCarousel from '@/components/media/ImageCarousel';
import EditorialBlocks from '@/components/posts/EditorialBlocks';
import { RouteErrorState, RoutePending, RouteSkeleton, useRouteReadiness } from '@/components/layout/RouteExperience';
import { withRouteTimeout } from '@/lib/routeExperience';

export const runtime = 'edge';

function categoryLabel(category?: string) {
  return getRegionalCategory(category || '')?.label || '출처 콘텐츠';
}

export default function ContentDetailPage() {
  return <Suspense fallback={<Suspense fallback={<RouteSkeleton />}><RoutePending /></Suspense>}><ContentDetailRoute /></Suspense>;
}

function ContentDetailRoute() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  return <ContentDetail key={`${id}?${searchParams.toString()}`} id={id} collection={searchParams.get('collection')} source={searchParams.get('source')} category={searchParams.get('category')} url={searchParams.get('url')} />;
}

function ContentDetail({ id, collection, source, category, url }: { id: string; collection: string | null; source: string | null; category: string | null; url: string | null }) {
  const [content, setContent] = useState<ResolvedContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useRouteReadiness(loading, error);

  useEffect(() => {
    let active = true;
    void withRouteTimeout(findContent(id, collection, source, category, url))
      .then((record) => { if (active) setContent(record); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, collection, source, category, url, attempt]);

  if (loading) return <RouteSkeleton label="콘텐츠를 불러오는 중입니다." />;
  if (error) return <RouteErrorState message="콘텐츠를 불러오지 못했습니다. 연결을 확인하고 다시 시도해주세요." onRetry={() => { setError(false); setLoading(true); setAttempt((value) => value + 1); }} />;
  if (!content) notFound();

  const title = content.title || content.name || '출처 콘텐츠';
  const body = content.body?.trim() || content.desc?.trim() || '';
  const description = content.description?.trim() || content.summary?.trim() || '';
  const images = [content.image, ...(content.images || [])].filter((image, index, values): image is string => Boolean(image) && values.indexOf(image) === index);
  const backHref = content.sourceCategory === 'jobs' ? '/jobs' : content.sourceCategory === 'directory' ? '/directory' : content.sourceCategory === 'market' ? '/market' : content.sourceCategory === 'community' ? '/community' : '/news';
  const imported = content.collection === 'source' || Boolean(content.sourceId || content.sourceContentId || content.sourceUrl);

  return (
    <article className="public-article w-full px-4 py-8 sm:px-6 lg:px-10">
      <Link href={backHref} className="text-sm font-bold text-teal-300 hover:text-teal-200">← 목록으로 돌아가기</Link>
      <div className="article-mosaic mt-5 overflow-hidden">
        {images[0] ? <ImageCarousel images={images} alt={title} className="max-h-[42rem] min-h-64" /> : imported ? <div className="article-mosaic-tile grid h-52 place-items-center text-sm font-bold text-teal-200">원문 대표 이미지가 없습니다</div> : null}
        <div className="p-6 sm:p-10">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {content.country && <span className="rounded-full bg-teal-300/10 px-2.5 py-1 font-bold text-teal-200">{content.country}</span>}
            <span className="rounded-full bg-white/10 px-2.5 py-1 font-bold text-slate-300">{categoryLabel(content.sourceCategory)}</span>
            {content.sourceName && <span className="inline-flex items-center gap-1 font-bold text-emerald-300"><ShieldCheck size={14} /> {content.sourceName}</span>}
            {(content.author || content.authorName) && <span>{content.author || content.authorName}</span>}
            {content.createdAt && <span>{new Date(content.createdAt).toLocaleDateString('ko-KR')}</span>}
          </div>
          <h1 className="mt-5 text-3xl font-black leading-tight text-white sm:text-4xl">{title}</h1>

          {description && description !== body && <p className="article-mosaic-tile mt-5 p-4 text-sm leading-7 text-teal-50">{description}</p>}

           {(content.company || content.location || content.salary || content.price || content.address || content.tel) && (
            <div className="article-mosaic-tile mt-6 grid gap-2 p-4 text-sm text-slate-300 sm:grid-cols-2">
              {content.company && <div><span className="text-slate-500">회사</span><strong className="ml-2">{content.company}</strong></div>}
              {content.location && <div><span className="text-slate-500">지역</span><strong className="ml-2">{content.location}</strong></div>}
              {content.salary && <div><span className="text-slate-500">급여</span><strong className="ml-2">{content.salary}</strong></div>}
              {content.price && <div><span className="text-slate-500">가격</span><strong className="ml-2">{content.price}</strong></div>}
              {content.address && <div><span className="text-slate-500">주소</span><strong className="ml-2">{content.address}</strong></div>}
              {content.tel && <div><span className="text-slate-500">연락처</span><strong className="ml-2">{content.tel}</strong></div>}
            </div>
          )}

            <section className="mx-auto mt-8 max-w-5xl"><h2 className="mb-3 text-xs font-black uppercase tracking-[.18em] text-slate-500">본문</h2>{body ? <div className="whitespace-pre-wrap text-[17px] leading-8 text-slate-200">{body}</div> : <p className="rounded-2xl border border-dashed border-white/10 p-5 text-sm leading-6 text-slate-500">{imported ? '이 출처는 상세 본문을 제공하지 않습니다.' : '등록된 상세 정보는 위에서 확인할 수 있습니다.'}</p>}</section>
           {images.length > 1 && <div className="mx-auto mt-8 grid max-w-5xl gap-3 sm:grid-cols-2"><div className="col-span-full mb-1 flex items-center gap-2 text-xs font-black uppercase tracking-[.18em] text-slate-500"><ImageIcon size={14} /> 원문 이미지 {images.length - 1}장</div>{images.slice(1).map((image) => <img key={image} src={image} alt={title} className="max-h-96 w-full rounded-2xl bg-black/20 object-contain" />)}</div>}
          <EditorialBlocks value={content.editorial} />
        </div>
      </div>
      {!imported && <PostActions collection={content.collection} id={content.id} authorId={content.authorId} backHref={backHref} />}
      {content.threadKey && <PostComments threadKey={content.threadKey} />}
    </article>
  );
}
