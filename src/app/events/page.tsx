import type { Metadata } from 'next';
import RegionalServiceHub from '@/components/ui/RegionalServiceHub';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata('이벤트', '국가와 도시별 지역 행사와 교민 모임 게시판을 찾아보세요.', '/events');

export default function EventsPage() {
  return <RegionalServiceHub categoryId="events" />;
}
