import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import PostActions from '@/components/posts/PostActions';
import PostComments from '@/components/posts/PostComments';
import EditorialBlocks from '@/components/posts/EditorialBlocks';
import { EmptyState, ErrorState, PageContainer, PageHeader } from '@/components/ui/Primitives';
import { getCityOverview, getCountryOverview, getRegionalListing, getRegionalPost, isIndexableRegionalPost, type RegionalListing } from '@/lib/regionalContent';
import { cityHref, cityRegionalPostHref, getCityRoute, getCountryRoute, getPublicServiceRoute, getRegionalCategory, isRegionalPostId, PUBLIC_SERVICE_ROUTES, regionalPostHref, serviceHref, type CityRoute, type CountryRoute, type PublicServiceRoute, type RegionalCategory } from '@/lib/regionRoutes';
import { canonicalUrl, pageMetadata, seoExcerpt, serializeJsonLd } from '@/lib/seo';
import { postThreadKey } from '@/lib/comments';
import RegionalNavigation from '../RegionalNavigation';
import RegionalPostComposer from '../RegionalPostComposer';
import RegionalPostList from '../RegionalPostList';

export const runtime = 'edge';

type Props = {
  params: Promise<{ country: string; segments: string[] }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

type CategoryRoute = NonNullable<ReturnType<typeof getRegionalCategory>>;

type ResolvedRoute =
  | { kind: 'country'; country: CountryRoute; overview: Awaited<ReturnType<typeof getCountryOverview>> }
  | { kind: 'city'; country: CountryRoute; city: CityRoute; overview: Awaited<ReturnType<typeof getCityOverview>> }
  | { kind: 'service'; country: CountryRoute; service: PublicServiceRoute; category?: RegionalCategory; listing: RegionalListing; after?: string }
  | { kind: 'city-service'; country: CountryRoute; city: CityRoute; service: PublicServiceRoute; category?: RegionalCategory; listing: RegionalListing; after?: string }
  | { kind: 'category'; country: CountryRoute; category: CategoryRoute; listing: RegionalListing; after?: string }
  | { kind: 'city-category'; country: CountryRoute; city: CityRoute; category: CategoryRoute; listing: RegionalListing; after?: string }
  | { kind: 'detail'; country: CountryRoute; category: CategoryRoute; id: string; result: Awaited<ReturnType<typeof getRegionalPost>>; service?: PublicServiceRoute }
  | { kind: 'city-detail'; country: CountryRoute; city: CityRoute; category: CategoryRoute; id: string; result: Awaited<ReturnType<typeof getRegionalPost>>; service?: PublicServiceRoute };

function categoryOrNotFound(value: ReturnType<typeof getRegionalCategory>): RegionalCategory {
  if (!value) notFound();
  return value.slug;
}

async function readAfter(searchParams: Props['searchParams']) {
  const value = (await searchParams).after;
  if (value !== undefined && (typeof value !== 'string' || !isRegionalPostId(value))) notFound();
  return value;
}

function emptyListing(): RegionalListing {
  return { status: 'ok', posts: [] };
}

async function resolveRoute({ params, searchParams }: Props): Promise<ResolvedRoute> {
  const { country: countrySlug, segments = [] } = await params;
  const country = getCountryRoute(countrySlug);
  if (!country) notFound();
  const [first, second, third, ...rest] = segments;
  if (!first) return { kind: 'country', country, overview: await getCountryOverview(country.slug) };

  const service = getPublicServiceRoute(first);
  if (service && !second) {
    const after = await readAfter(searchParams);
    return { kind: 'service', country, service, category: service.category, after, listing: service.category ? await getRegionalListing(country.slug, service.category, after) : emptyListing() };
  }
  if (service && service.category && second && !third && isRegionalPostId(second)) {
    const category = getRegionalCategory(service.category);
    if (!category) notFound();
    return { kind: 'detail', country, service, category, id: second, result: await getRegionalPost(country.slug, category.slug, second) };
  }

  const category = getRegionalCategory(first);
  if (category && !second) {
    const after = await readAfter(searchParams);
    return { kind: 'category', country, category, after, listing: await getRegionalListing(country.slug, category.slug, after) };
  }

  const city = getCityRoute(country.slug, first);
  if (city && !second) return { kind: 'city', country, city, overview: await getCityOverview(country.slug, city.slug) };

  if (category && second && !third && isRegionalPostId(second)) {
    return { kind: 'detail', country, category, id: second, result: await getRegionalPost(country.slug, category.slug, second) };
  }

  const cityCategory = city && second ? getRegionalCategory(second) : undefined;
  const cityService = city && second ? getPublicServiceRoute(second) : undefined;
  if (city && cityService && !third) {
    const after = await readAfter(searchParams);
    return { kind: 'city-service', country, city, service: cityService, category: cityService.category, after, listing: cityService.category ? await getRegionalListing(country.slug, cityService.category, after, city.slug) : emptyListing() };
  }
  if (city && cityService && cityService.category && third && !rest.length && isRegionalPostId(third)) {
    const category = getRegionalCategory(cityService.category);
    if (!category) notFound();
    return { kind: 'city-detail', country, city, service: cityService, category, id: third, result: await getRegionalPost(country.slug, category.slug, third, city.slug) };
  }
  if (city && cityCategory && !third) {
    const after = await readAfter(searchParams);
    return { kind: 'city-category', country, city, category: cityCategory, after, listing: await getRegionalListing(country.slug, cityCategory.slug, after, city.slug) };
  }
  if (city && cityCategory && third && !rest.length && isRegionalPostId(third)) {
    return { kind: 'city-detail', country, city, category: cityCategory, id: third, result: await getRegionalPost(country.slug, cityCategory.slug, third, city.slug) };
  }
  notFound();
}

export async function generateMetadata(props: Props) {
  const route = await resolveRoute(props);
  if (route.kind === 'country') return pageMetadata(`${route.country.label} 한인 커뮤니티`, `${route.country.label} 교민을 위한 구인구직, 주거, 생활 이야기, 뉴스, 업소록과 장터 게시판입니다.`, `/${route.country.slug}`, route.overview.every(({ listing }) => listing.status === 'ok') && route.overview.some(({ listing }) => listing.posts.slice(0, 3).some(isIndexableRegionalPost)));
  if (route.kind === 'city') return pageMetadata(`${route.city.label} 한인 생활`, `${route.country.label} ${route.city.label} 교민을 위한 구인구직, 생활 정보, 커뮤니티와 지역 서비스를 찾아보세요.`, cityHref(route.city), route.overview.every(({ listing }) => listing.status === 'ok') && route.overview.some(({ listing }) => listing.posts.some(isIndexableRegionalPost)));
  if (route.kind === 'service' || route.kind === 'city-service') {
    const path = route.kind === 'city-service' ? serviceHref(route.country, route.service.slug, route.city) : serviceHref(route.country, route.service.slug);
    const location = route.kind === 'city-service' ? `${route.city.label} ` : `${route.country.label} `;
    const title = `${location}${route.service.label}`;
    const index = Boolean(route.category && !route.after && route.listing.status === 'ok' && route.listing.posts.some(isIndexableRegionalPost));
    return pageMetadata(title, `${title}: ${route.service.description}. 공개된 정보가 없으면 새 콘텐츠가 준비될 때까지 비공개 상태로 유지됩니다.`, path, index);
  }
  if (route.kind === 'category' || route.kind === 'city-category') {
    const path = route.kind === 'city-category' ? cityHref(route.city, route.category.slug) : `/${route.country.slug}/${route.category.slug}`;
    const title = route.kind === 'city-category' ? `${route.city.label} ${route.category.label}` : `${route.country.label} ${route.category.label}`;
    return pageMetadata(title, `${title}: ${route.category.description}. 공개된 게시글의 내용을 확인하세요.`, path, !route.after && route.listing.status === 'ok' && route.listing.posts.some(isIndexableRegionalPost));
  }
  if (route.result.status === 'redirect') redirect(route.result.href);
  const title = route.result.status === 'ok' ? route.result.post.title : `${route.country.label} ${route.category.label}`;
  const description = route.result.status === 'ok' ? seoExcerpt(route.result.post.body || route.result.post.description || title) : `${title} 게시글`;
  const path = route.kind === 'city-detail' ? cityRegionalPostHref(route.city, route.category.slug, route.id) : regionalPostHref(route.country, route.category.slug, route.id);
  return pageMetadata(title, description, path, route.result.status === 'ok' && isIndexableRegionalPost(route.result.post));
}

function CityPage({ city }: { city: CityRoute }) {
  return (
    <PageContainer className="category-page mx-auto max-w-5xl px-4 py-8 text-slate-100 sm:px-6">
      <PageHeader
        breadcrumb={<><Link href="/regions" className="text-sm font-bold text-teal-200">지역 탐색 / Regions</Link><span className="text-xs font-bold uppercase tracking-widest text-teal-200">{city.country.flag} {city.country.english} / {city.english}</span></>}
        title={`${city.label} 한인 생활`}
        subtitle={`${city.country.label} ${city.label}에 거주하거나 방문하는 교민을 위한 지역별 게시판입니다. 필요한 분야를 골라 구인구직, 주거, 커뮤니티와 생활 서비스를 확인하세요.`}
      />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PUBLIC_SERVICE_ROUTES.map((service) => <Link key={service.slug} href={serviceHref(city.country, service.slug, city)} className="rounded-2xl border border-white/10 bg-white/[.045] p-5 transition hover:border-teal-300/30 hover:bg-teal-300/[.06]"><h2 className="font-black text-white">{service.label}</h2><p className="mt-2 text-xs leading-5 text-slate-400">{service.description}</p><span className="mt-5 block text-xs font-black text-teal-200">게시판 보기 →</span></Link>)}
      </div>
      <Link href={`/${city.country.slug}`} className="mt-8 inline-flex text-sm font-bold text-slate-400 hover:text-white">{city.country.label} 국가 전체 게시판 보기 →</Link>
    </PageContainer>
  );
}

function CategoryPage({ country, city, category, service, listing, after }: { country: CountryRoute; city?: CityRoute; category: CategoryRoute; service?: PublicServiceRoute; listing: RegionalListing; after?: string }) {
  const categorySlug = categoryOrNotFound(category);
  const path = service ? serviceHref(country, service.slug, city) : city ? cityHref(city, categorySlug) : `/${country.slug}/${categorySlug}`;
  const heading = city ? `${city.label} ${service?.label || category.label}` : `${country.label} ${service?.label || category.label}`;
  return (
    <PageContainer className="category-page mx-auto max-w-5xl px-4 py-8 text-slate-100 sm:px-6">
      <PageHeader
        breadcrumb={<Link href={city ? cityHref(city) : `/${country.slug}`} className="text-sm font-bold text-teal-200">{city ? `${city.label} 한인 생활` : `${country.label} 한인 커뮤니티`}</Link>}
        title={heading}
        subtitle={city ? `${city.label}에서 확인할 수 있는 공개 게시글과 생활 정보를 살펴보세요.` : `${country.label} 지역의 ${service?.description || category.description}를 확인하세요.`}
        actions={!city ? <RegionalPostComposer country={country} category={categorySlug} label={category.label} /> : undefined}
      />
      {!city && !service && <RegionalNavigation country={country} current={categorySlug} />}
      {listing.status === 'unavailable' ? <ErrorState title="게시글을 불러오지 못했습니다" description="현재 공개 데이터에 연결할 수 없습니다. 잠시 후 다시 확인해주세요." />
        : listing.posts.length ? <RegionalPostList posts={listing.posts} basePath={path} />
          : <EmptyState title={after || listing.nextCursor ? '이 목록 구간에 표시할 게시글이 없습니다' : '아직 공개된 게시글이 없습니다'} description="다른 분야의 지역 게시판도 살펴보세요." />}
      <nav aria-label="게시글 목록 이동" className="mt-6 flex gap-5 text-sm font-bold text-teal-200">
        {after && <Link href={path}>첫 목록</Link>}
        {listing.nextCursor && <Link href={`${path}?after=${encodeURIComponent(listing.nextCursor)}`} rel="next">다음 목록</Link>}
      </nav>
      {listing.posts.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd({ '@context': 'https://schema.org', '@type': 'CollectionPage', name: heading, url: canonicalUrl(path), mainEntity: { '@type': 'ItemList', itemListElement: listing.posts.map((post, index) => ({ '@type': 'ListItem', position: index + 1, name: post.title, url: canonicalUrl(`${path}/${encodeURIComponent(post.id)}`) })) } }) }} />}
    </PageContainer>
  );
}

function ServicePage({ country, city, service, category, listing, after }: { country: CountryRoute; city?: CityRoute; service: PublicServiceRoute; category?: RegionalCategory; listing: RegionalListing; after?: string }) {
  if (category) {
    const categoryRoute = getRegionalCategory(category);
    if (!categoryRoute) notFound();
    return <CategoryPage country={country} city={city} category={categoryRoute} service={service} listing={listing} after={after} />;
  }
  const path = serviceHref(country, service.slug, city);
  const heading = city ? `${city.label} ${service.label}` : `${country.label} ${service.label}`;
  return (
    <PageContainer className="category-page mx-auto max-w-5xl px-4 py-8 text-slate-100 sm:px-6">
      <PageHeader
        breadcrumb={<><Link href={city ? cityHref(city) : `/${country.slug}`} className="text-sm font-bold text-teal-200">{city ? `${city.label} 한인 생활` : `${country.label} 한인 커뮤니티`}</Link><span className="text-xs font-bold uppercase tracking-widest text-teal-200">{path}</span></>}
        title={heading}
        subtitle={service.description}
      />
      <div className="mt-8">
        <EmptyState title="아직 공개된 정보가 없습니다" description="확인된 공개 데이터가 준비되면 이 지역에 표시됩니다." />
      </div>
    </PageContainer>
  );
}

function DetailPage({ country, city, category, result }: { country: CountryRoute; city?: CityRoute; category: CategoryRoute; result: Awaited<ReturnType<typeof getRegionalPost>> }) {
  const categorySlug = categoryOrNotFound(category);
  if (result.status !== 'ok') {
    if (result.status === 'not-found') notFound();
    if (result.status === 'redirect') redirect(result.href);
    return <PageContainer className="mx-auto max-w-3xl px-4 py-20 text-center text-amber-100"><ErrorState title="게시글을 불러오지 못했습니다. 잠시 후 다시 시도해주세요." /></PageContainer>;
  }
  const post = result.post;
  const path = city ? cityRegionalPostHref(city, categorySlug, post.id) : regionalPostHref(country, categorySlug, post.id);
  const backHref = city ? cityHref(city, categorySlug) : `/${country.slug}/${categorySlug}`;
  const threadKey = post.sourceBacked ? postThreadKey('source', post.id) : postThreadKey(post.collection, post.id);
  return (
    <article className="public-article mx-auto max-w-4xl px-4 py-8 text-slate-100 sm:px-6">
      <Link href={backHref} className="text-sm font-bold text-teal-200">← {city ? `${city.label} ${category.label}` : `${country.label} ${category.label}`}</Link>
      <div className="article-mosaic mt-5 overflow-hidden">
        {post.images[0] && <img src={post.images[0]} alt={post.title} className="max-h-[34rem] w-full bg-black/20 object-contain" />}
        <div className="p-6 sm:p-9">
          <div className="flex flex-wrap gap-2 text-xs text-slate-400"><span>{country.flag} {city ? city.label : country.label}</span><span>{category.label}</span>{post.author && <span>작성자: {post.author}</span>}{post.sourceName && <span>출처: {post.sourceName}</span>}{post.createdAt && <time dateTime={post.createdAt}>{post.createdAt.slice(0, 10)}</time>}</div>
          <h1 className="mt-4 break-words text-3xl font-black leading-tight sm:text-4xl">{post.title}</h1>
          {post.facts.length > 0 && <dl className="article-mosaic-tile mt-6 grid gap-2 p-4 text-sm sm:grid-cols-2">{post.facts.map((fact) => <div key={fact.label}><dt className="inline text-slate-400">{fact.label}: </dt><dd className="inline font-bold text-slate-200">{fact.value}</dd></div>)}</dl>}
          {post.description && post.description !== post.body && <p className="article-mosaic-tile mt-6 p-4 text-sm leading-7 text-teal-50">{post.description}</p>}
          <div className="mt-8 whitespace-pre-wrap break-words text-[17px] leading-8 text-slate-200">{post.body || '상세 본문이 제공되지 않은 게시글입니다.'}</div>
          <EditorialBlocks value={post.editorial} />
          {post.sourceUrl && <a href={post.sourceUrl} target="_blank" rel="noreferrer" className="mt-7 inline-block text-sm font-bold text-teal-200">원문 출처 열기 ↗</a>}
        </div>
      </div>
      {!post.sourceBacked && <PostActions collection={post.collection} id={post.id} authorId={post.authorId} backHref={backHref} />}
      {threadKey && <PostComments threadKey={threadKey} />}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd({ '@context': 'https://schema.org', '@type': 'Article', headline: post.title, description: seoExcerpt(post.body || post.description), url: canonicalUrl(path), datePublished: post.createdAt, dateModified: post.updatedAt || post.createdAt, author: { '@type': 'Person', name: post.author || 'GYOPO 회원' } }) }} />
    </article>
  );
}

export default async function CountrySegmentsPage(props: Props) {
  const route = await resolveRoute(props);
  if (route.kind === 'country') {
    return (
      <PageContainer className="category-page mx-auto max-w-5xl px-4 py-8 text-slate-100 sm:px-6">
        <PageHeader
          breadcrumb={<><Link href="/regions" className="text-sm font-bold text-teal-200">지역 탐색 / Regions</Link><span className="text-xs font-bold uppercase tracking-widest text-teal-200">{route.country.english} / GYOPO</span></>}
          title={`${route.country.label} 한인 커뮤니티`}
          subtitle={`${route.country.label} 교민의 생활 이야기와 공개 게시글을 분야별로 살펴보세요.`}
        />
        <RegionalNavigation country={route.country} />
        <div className="space-y-10">
          {route.overview.map(({ category, listing }) => (
            <section key={category.slug}>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-xl font-bold"><Link href={`/${route.country.slug}/${category.slug}`} className="hover:text-teal-200">{route.country.label} {category.label}</Link></h2>
                <Link href={`/${route.country.slug}/${category.slug}`} className="text-sm text-teal-200">게시판 보기</Link>
              </div>
              <p className="mb-4 text-sm text-slate-400">{category.description}</p>
              {listing.status === 'unavailable' ? <ErrorState title="게시글을 불러오지 못했습니다." />
                : listing.posts.length ? <RegionalPostList posts={listing.posts} />
                  : <EmptyState title="아직 이 지역에 공개된 게시글이 없습니다." />}
            </section>
          ))}
        </div>
      </PageContainer>
    );
  }
  if (route.kind === 'city') return <CityPage city={route.city} />;
  if (route.kind === 'service') return <ServicePage country={route.country} service={route.service} category={route.category} listing={route.listing} after={route.after} />;
  if (route.kind === 'city-service') return <ServicePage country={route.country} city={route.city} service={route.service} category={route.category} listing={route.listing} after={route.after} />;
  if (route.kind === 'category') return <CategoryPage country={route.country} category={route.category} listing={route.listing} after={route.after} />;
  if (route.kind === 'city-category') return <CategoryPage country={route.country} city={route.city} category={route.category} listing={route.listing} after={route.after} />;
  if (route.kind === 'detail') return <DetailPage country={route.country} category={route.category} result={route.result} />;
  return <DetailPage country={route.country} city={route.city} category={route.category} result={route.result} />;
}
