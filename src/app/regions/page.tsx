import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, MapPin } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/ui/Primitives';
import { COUNTRY_LOCATIONS, LOCATION_GROUPS } from '@/lib/locations';
import { REGION_ROUTES } from '@/lib/regionRoutes';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata('지역별 교민 네트워크', '국가와 도시를 선택해 가까운 교민 커뮤니티, 구인구직, 생활 정보와 지역 서비스를 확인하세요.', '/regions');

export default function RegionsPage() {
  return (
    <PageContainer className="category-page mx-auto max-w-7xl px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="Explore by location / 지역 탐색"
        title="우리 동네 교민 네트워크"
        subtitle="국가에서 도시까지 내려가면 해당 지역의 구인구직, 주거, 교육, 커뮤니티, 업소록과 장터를 한 흐름으로 확인할 수 있습니다."
      />
      <nav aria-label="지역 대륙" className="mt-8 flex flex-wrap gap-2">{REGION_ROUTES.map((region) => <Link key={region.slug} href={`/regions/${region.slug}`} className="rounded-full border border-white/10 bg-white/[.04] px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-teal-300/30 hover:text-teal-100">{region.korean}</Link>)}</nav>
      <div className="mt-8 space-y-10">
        {LOCATION_GROUPS.map((group) => {
          const countries = COUNTRY_LOCATIONS.filter((country) => country.group === group.id);
          return <section key={group.id} aria-labelledby={`region-${group.id}`}><div className="mb-4 flex items-end justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-slate-500">{group.english}</p><h2 id={`region-${group.id}`} className="mt-1 text-2xl font-black text-white">{group.label}</h2></div><span className="text-xs font-bold text-slate-500">{countries.length}개 국가</span></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{countries.map((country) => <article key={country.id} className="rounded-3xl border border-white/10 bg-white/[.045] p-5 transition hover:border-teal-300/25 hover:bg-white/[.07]"><div className="flex items-start justify-between gap-3"><div><span className="text-2xl" aria-hidden="true">{country.flag}</span><h3 className="mt-3 text-lg font-black text-white">{country.label}<span className="ml-2 text-xs font-semibold text-slate-500">{country.english}</span></h3></div><Link href={`/${country.slug}`} aria-label={`${country.label} 국가 게시판`} className="rounded-full border border-white/10 p-2 text-slate-400 hover:border-teal-300/30 hover:text-teal-200"><ArrowUpRight size={16} /></Link></div><div className="mt-5 flex flex-wrap gap-2">{country.cities.map((city) => <Link key={city.slug} href={`/${country.slug}/${city.slug}`} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/10 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-teal-300/30 hover:text-teal-100"><MapPin size={11} className="text-teal-300" />{city.label}</Link>)}</div></article>)}</div></section>;
        })}
      </div>
    </PageContainer>
  );
}
