'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { MapPin } from 'lucide-react';
import { CategoryCard, ContentCard, ContentCardBody, PageContainer, PageHeader, SectionHeader, Skeleton } from './Primitives';
import { PUBLIC_CATEGORIES, publicCategoryHref, publicCategoryRegion } from '@/lib/publicCategories';
import type { PublicCategory, PublicCategoryId } from '@/lib/publicCategories';
import { COUNTRY_ROUTES, REGION_ROUTES, serviceHref } from '@/lib/regionRoutes';
import { useGlobalStore } from '@/store/useGlobalStore';

function useCategoryRegion() {
  const selectedCountry = useGlobalStore((state) => state.selectedCountry);
  const query = useSearchParams();
  const queryCountry = query.get('country');
  const region = queryCountry && (queryCountry === 'Global' || publicCategoryRegion(queryCountry).country) ? queryCountry : selectedCountry;
  const citySlug = query.get('city') ?? undefined;
  return { region, citySlug, ...publicCategoryRegion(region, citySlug) };
}

function CategoryLinks({ categories, region = 'Global', citySlug }: { categories: readonly PublicCategory[]; region?: string; citySlug?: string }) {
  return <nav className="ui-category-grid" aria-label="생활 카테고리">{categories.map((category) => <CategoryCard key={category.id} icon={<category.icon size={20} />} title={category.title} description={category.description} href={publicCategoryHref(category, region, citySlug)} />)}</nav>;
}

function SelectedCategoryLinks({ categories }: { categories: readonly PublicCategory[] }) {
  const { region, citySlug } = useCategoryRegion();
  return <CategoryLinks categories={categories} region={region} citySlug={citySlug} />;
}

export function PublicCategoryGrid({ ids }: { ids?: readonly PublicCategoryId[] }) {
  const categories = ids ? PUBLIC_CATEGORIES.filter((category) => ids.includes(category.id)) : PUBLIC_CATEGORIES;
  return <Suspense fallback={<CategoryLinks categories={categories} />}><SelectedCategoryLinks categories={categories} /></Suspense>;
}

type HubCategoryId = 'housing' | 'guides' | 'events';

function RegionalServiceContent({ categoryId }: { categoryId: HubCategoryId }) {
  const category = PUBLIC_CATEGORIES.filter((item) => 'service' in item).find((item) => item.id === categoryId)!;
  const { country, city } = useCategoryRegion();
  const setSelectedCountry = useGlobalStore((state) => state.setSelectedCountry);
  const router = useRouter();
  const pathname = usePathname();

  function selectRegion(countrySlug: string, citySlug = '') {
    const nextCountry = publicCategoryRegion(countrySlug).country;
    setSelectedCountry(nextCountry?.id || 'Global');
    const query = new URLSearchParams({ country: nextCountry?.slug || 'Global' });
    if (nextCountry && citySlug) query.set('city', citySlug);
    router.replace(`${pathname}?${query}`, { scroll: false });
  }

  return (
    <PageContainer category={category.id} region={city?.slug || country?.slug || 'Global'}>
      <PageHeader breadcrumb={<><Link href="/services">전체 카테고리</Link><span aria-hidden="true"> / </span><span aria-current="page">{category.title}</span></>} title={category.title} subtitle={`${category.description}. 국가와 도시를 선택해 해당 지역의 기존 게시판으로 이동하세요.`} actions={<Link className="ui-text-link" href="/regions">지역 둘러보기</Link>} />
      <ContentCard aria-labelledby="hub-region-heading">
        <ContentCardBody>
          <SectionHeader id="hub-region-heading" title="내 지역에서 찾기" subtitle="게시글과 공개 여부는 각 지역 게시판에서 확인할 수 있습니다." />
          <div className="ui-region-controls">
            <label><span>국가</span><select value={country?.slug || 'Global'} onChange={(event) => selectRegion(event.target.value)}><option value="Global">전체 국가</option>{COUNTRY_ROUTES.map((item) => <option key={item.slug} value={item.slug}>{item.flag} {item.label}</option>)}</select></label>
            {country && <label><span>도시</span><select value={city?.slug || ''} onChange={(event) => selectRegion(country.slug, event.target.value)}><option value="">국가 전체</option>{country.cities.map((item) => <option key={item.slug} value={item.slug}>{item.label}</option>)}</select></label>}
          </div>
          {country ? <nav className="ui-category-grid" aria-label="선택한 지역 게시판"><CategoryCard icon={<category.icon size={20} />} title={`${city?.label || country.label} ${category.title}`} description={category.description} href={serviceHref(country, category.service, city)} badge="선택한 지역" />{city && <CategoryCard icon={<MapPin size={20} />} title={`${country.label} 전체`} description={`도시를 넓혀 ${category.title} 게시판을 확인하세요.`} href={serviceHref(country, category.service)} />}</nav> : <p className="ui-region-hint">국가를 선택하거나 아래에서 지역 게시판을 바로 열어보세요.</p>}
        </ContentCardBody>
      </ContentCard>
      <section className="ui-regional-directory" aria-labelledby="hub-countries-heading">
        <SectionHeader id="hub-countries-heading" title="국가별 게시판" subtitle="지역별로 공개된 정보만 표시되며, 게시글이 없는 지역도 있습니다." />
        {REGION_ROUTES.map((group) => {
          const countries = COUNTRY_ROUTES.filter((item) => item.region === group.slug);
          if (!countries.length) return null;
          return <details className="ui-region-group" key={group.slug} open={country?.region === group.slug || undefined}><summary>{group.korean}</summary><nav className="ui-category-grid" aria-label={`${group.korean} ${category.title}`}>{countries.map((item) => <CategoryCard key={item.slug} icon={<span>{item.flag}</span>} title={`${item.label} ${category.title}`} description={category.description} href={serviceHref(item, category.service)} />)}</nav></details>;
        })}
      </section>
    </PageContainer>
  );
}

export default function RegionalServiceHub({ categoryId }: { categoryId: HubCategoryId }) {
  return <Suspense fallback={<Skeleton label="지역 선택을 준비하고 있습니다" />}><RegionalServiceContent categoryId={categoryId} /></Suspense>;
}
