import type { Metadata } from 'next';
import BrickBreaker from '@/components/games/brickbreaker';

export const metadata: Metadata = {
  title: '배드볼 벽돌깨기 | GYOPO',
  description: '무료 2인 비공개 벽돌깨기. 동일 시드 대전, 실제 상대 보드, 선택형 무음 카메라와 채팅. 자가 신고 연습 순위, 금전 베팅 없음.',
};

export default function BrickBreakerPage() {
  return <BrickBreaker />;
}
