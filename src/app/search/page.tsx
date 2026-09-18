import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata('GYOPO 검색', 'GYOPO의 기존 AI 검색에서 지역 정보와 공개 게시글을 찾아보세요.', '/search');

export { default } from '@/app/assistant/page';
