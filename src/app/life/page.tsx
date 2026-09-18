import type { Metadata } from 'next';
import Link from 'next/link';
import { ContentCard, ContentCardBody, PageContainer, PageHeader, SectionHeader } from '@/components/ui/Primitives';
import { PublicCategoryGrid } from '@/components/ui/RegionalServiceHub';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata('교민 생활 서비스', '해외 생활에 필요한 구인구직, 주거, 교육, 업소록, 장터와 지역 정보를 한곳에서 찾아보세요.', '/life');

export default function LifePage() {
  return (
    <PageContainer category="life">
      <PageHeader breadcrumb={<><Link href="/services">전체 카테고리</Link><span aria-hidden="true"> / </span><span aria-current="page">생활</span></>} title="해외 생활을 더 가볍게" subtitle="살 곳, 일할 곳, 가까운 업소와 정착 정보. 선택한 지역의 생활 서비스를 찾아보세요." actions={<Link className="ui-text-link" href="/regions">지역 선택</Link>} />
      <section aria-labelledby="life-services-heading">
        <SectionHeader id="life-services-heading" title="생활 서비스" />
        <PublicCategoryGrid ids={['jobs', 'housing', 'directory', 'market', 'guides', 'community', 'news', 'events', 'regions']} />
      </section>
      <ContentCard aria-labelledby="life-help-heading">
        <ContentCardBody>
          <SectionHeader id="life-help-heading" title="찾는 정보가 없나요?" subtitle="다른 지역을 살펴보거나 커뮤니티에 질문해보세요." />
          <nav className="ui-inline-links" aria-label="생활 도움"><Link href="/assistant">검색으로 찾기</Link><Link href="/help">이용 및 안전 안내</Link><Link href="/services">전체 카테고리</Link></nav>
        </ContentCardBody>
      </ContentCard>
    </PageContainer>
  );
}
