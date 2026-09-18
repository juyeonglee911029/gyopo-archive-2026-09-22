import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState, PageContainer, PageHeader } from '@/components/ui/Primitives';
import { countriesForRegion, getRegionRoute } from '@/lib/regionRoutes';
import { pageMetadata } from '@/lib/seo';

export const runtime = 'edge';

type Props = { params: Promise<{ region: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const region = getRegionRoute((await params).region);
  if (!region) notFound();
  const countries = countriesForRegion(region.slug);
  return pageMetadata(`${region.korean} 한인 포털`, `${region.description}. 국가와 도시별 GYOPO 생활 정보를 확인하세요.`, `/regions/${region.slug}`, countries.length > 0);
}

export default async function RegionPage({ params }: Props) {
  const region = getRegionRoute((await params).region);
  if (!region) notFound();
  const countries = countriesForRegion(region.slug);
  return (
    <PageContainer className="category-page mx-auto max-w-7xl px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb={<><Link href="/regions" className="text-sm font-bold text-teal-200">지역 탐색 / Regions</Link><span className="text-xs font-black uppercase tracking-[.22em] text-teal-300">{region.slug} / GYOPO</span></>}
        title={`${region.korean} 한인 포털`}
        subtitle={`${region.description}. 공개된 국가와 도시 경로를 통해 지역별 구인구직, 생활 정보와 커뮤니티를 확인할 수 있습니다.`}
      />
      {countries.length ? <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{countries.map((country) => <article key={country.slug} className="rounded-3xl border border-white/10 bg-white/[.045] p-5"><div className="flex items-start justify-between gap-3"><div><span className="text-2xl" aria-hidden="true">{country.flag}</span><h2 className="mt-3 text-lg font-black text-white">{country.label}</h2></div><Link href={`/${country.slug}`} className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-bold text-teal-200">국가 보기</Link></div><div className="mt-5 flex flex-wrap gap-2">{country.cities.map((city) => <Link key={city.slug} href={`/${country.slug}/${city.slug}`} className="rounded-full border border-white/10 bg-black/10 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-teal-300/30 hover:text-teal-100">{city.label}</Link>)}</div></article>)}</div> : <div className="mt-8"><EmptyState title="아직 공개된 국가가 없습니다" description="확인된 공개 국가 경로가 준비되면 이 지역에 표시됩니다." /></div>}
    </PageContainer>
  );
}
