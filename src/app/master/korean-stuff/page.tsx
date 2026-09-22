import type { Metadata } from 'next';
import KoreanStuffMaster from './KoreanStuffMaster';

export const metadata: Metadata = { title: 'Korean Stuff 운영센터 | GYOPO', robots: { index: false, follow: false } };

export default function KoreanStuffMasterPage() {
  return <KoreanStuffMaster />;
}
