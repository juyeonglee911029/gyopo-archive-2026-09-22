import type { Metadata } from 'next';
import DatingApp from './DatingApp';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(
  '교민 데이트',
  '기존 GYOPO 회원이 프로필을 선택 공개하고 서로 동의한 관심을 주고받습니다.',
  '/dating',
  false,
);

export default function DatingPage() {
  return <DatingApp />;
}
