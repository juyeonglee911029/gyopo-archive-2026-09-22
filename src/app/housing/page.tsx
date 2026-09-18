import type { Metadata } from 'next';
import RegionalServiceHub from '@/components/ui/RegionalServiceHub';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata('주거', '국가와 도시별 집 구하기, 임대와 룸메이트 게시판을 찾아보세요.', '/housing');

export default function HousingPage() {
  return <RegionalServiceHub categoryId="housing" />;
}
