import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import ReleaseRouteStyles from '@/components/layout/ReleaseRouteStyles';

export const metadata: Metadata = pageMetadata('실시간 교민 랭킹 테트리스', '설치 없이 다른 교민과 실시간으로 즐기는 GYOPO 테트리스 아레나입니다.', '/games', true, '/apps/tetris');

export default function GamesLayout({ children }: { children: React.ReactNode }) {
  return <><ReleaseRouteStyles page="games" />{children}</>;
}
