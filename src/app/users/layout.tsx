import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata('GYOPO 친구 매칭', '온라인 회원을 둘러보고, 서로 좋아요를 보내 글로벌 친구를 만나보세요.', '/users', false);

export default function UsersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
