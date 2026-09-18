import type { Metadata } from 'next';
import Link from 'next/link';
import { PageContainer, PageHeader, SectionHeader } from '@/components/ui/Primitives';
import { PublicCategoryGrid } from '@/components/ui/RegionalServiceHub';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata('전체 카테고리', '구인구직, 생활, 커뮤니티부터 음악과 영상까지 GYOPO의 모든 공개 서비스를 찾아보세요.', '/services');

export default function ServicesPage() {
  return <PageContainer category="services"><PageHeader breadcrumb={<Link href="/">GYOPO 홈</Link>} title="전체 카테고리" subtitle="교민 생활에 필요한 정보와 서비스를 한곳에서. 지역 서비스는 선택한 국가와 도시로 연결됩니다." actions={<Link className="ui-text-link" href="/regions">지역 선택</Link>} /><section aria-labelledby="services-heading"><SectionHeader id="services-heading" title="GYOPO 서비스" /><PublicCategoryGrid /></section></PageContainer>;
}
