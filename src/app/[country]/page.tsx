import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState, ErrorState, PageContainer, PageHeader } from '@/components/ui/Primitives';
import { getCountryOverview, isIndexableRegionalPost } from '@/lib/regionalContent';
import { getCountryRoute } from '@/lib/regionRoutes';
import { cityHref } from '@/lib/regionRoutes';
import { pageMetadata } from '@/lib/seo';
import RegionalNavigation from './RegionalNavigation';
import RegionalPostList from './RegionalPostList';
import RegionalPostComposer from './RegionalPostComposer';

export const runtime = 'edge';

type Props = { params: Promise<{ country: string }> };

export async function generateMetadata({ params }: Props) {
  const country = getCountryRoute((await params).country);
  if (!country) notFound();
  const overview = await getCountryOverview(country.slug);
  const index = overview.every(({ listing }) => listing.status === 'ok')
    && overview.some(({ listing }) => listing.posts.slice(0, 3).some(isIndexableRegionalPost));
  return pageMetadata(`${country.label} 한인 커뮤니티`, `${country.label} 교민을 위한 구인구직, 주거, 생활 이야기, 뉴스, 업소록과 장터 게시판입니다.`, `/${country.slug}`, index);
}

export default async function CountryPage({ params }: Props) {
  const country = getCountryRoute((await params).country);
  if (!country) notFound();
  const overview = await getCountryOverview(country.slug);
  return (
    <PageContainer className="category-page mx-auto max-w-5xl px-4 py-8 text-slate-100 sm:px-6">
      <PageHeader
        breadcrumb={<><Link href="/" className="text-sm font-bold text-teal-200">GYOPO 홈</Link><span className="text-xs font-bold uppercase tracking-widest text-teal-200">{country.slug} / GYOPO</span></>}
        title={`${country.label} 한인 커뮤니티`}
        subtitle={`${country.label} 교민의 생활 이야기와 공개 게시글을 분야별로 살펴보세요. 구인구직, 주거, 뉴스, 업소록과 장터에서 필요한 정보를 찾을 수 있습니다.`}
        actions={<RegionalPostComposer country={country} category="community" label="커뮤니티" />}
      />
      <RegionalNavigation country={country} />
      <nav aria-label={`${country.label} 도시`} className="mb-8 flex flex-wrap gap-2">
        {country.cities.map((city) => <Link key={city.slug} href={cityHref({ ...city, country })} className="rounded-full border border-white/10 bg-white/[.04] px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-teal-300/30 hover:text-teal-100">{city.label}</Link>)}
      </nav>
      <div className="space-y-10">
        {overview.map(({ category, listing }) => (
          <section key={category.slug} aria-labelledby={`heading-${category.slug}`}>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
              <h2 id={`heading-${category.slug}`} className="text-xl font-bold"><Link href={`/${country.slug}/${category.slug}`} className="hover:text-teal-200">{country.label} {category.label}</Link></h2>
              <Link href={`/${country.slug}/${category.slug}`} className="text-sm text-teal-200">게시판 보기</Link>
            </div>
            <p className="mb-4 text-sm text-slate-400">{category.description}</p>
            {listing.status === 'unavailable' ? <ErrorState title="게시글을 불러오지 못했습니다. 잠시 후 다시 확인해주세요." />
              : listing.posts.length ? <RegionalPostList posts={listing.posts.slice(0, 3)} />
                : <EmptyState title={listing.nextCursor ? '이 목록 구간에 표시할 게시글이 없습니다. 게시판에서 다음 목록을 확인해주세요.' : '아직 이 지역에 공개된 게시글이 없습니다.'} />}
          </section>
        ))}
      </div>
    </PageContainer>
  );
}
