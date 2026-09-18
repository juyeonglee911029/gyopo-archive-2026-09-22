import type { Metadata } from 'next';
import { MARKET_COUNTRIES } from '@/lib/master/googleMarketKeywords';
import { GoogleMarketKeywords } from '@/components/master/GoogleMarketKeywords';

export const metadata: Metadata = {
  title: 'Google Market Keywords | Master',
  robots: { index: false, follow: false },
};

export default function MasterKeywordsPage() {
  return <GoogleMarketKeywords countries={MARKET_COUNTRIES} />;
}
