import type { Metadata } from 'next';
import KoreanStuffStorefront from './KoreanStuffStorefront';

export const metadata: Metadata = {
  title: 'KOREAN STUFF | GYOPO',
  description: '3일 배송 조건을 확인한 공식 공급 상품을 위한 GYOPO 쇼핑 공간',
  robots: { index: false, follow: false },
};

export default function KoreanStuffPage() {
  return <KoreanStuffStorefront />;
}
