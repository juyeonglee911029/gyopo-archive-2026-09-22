import type { Metadata } from 'next';
import RegionalServiceHub from '@/components/ui/RegionalServiceHub';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata('생활 가이드', '국가와 도시별 비자, 이주와 현지 정착 안내 페이지를 찾아보세요.', '/guides');

export default function GuidesPage() {
  return <RegionalServiceHub categoryId="guides" />;
}
