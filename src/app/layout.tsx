import type { Metadata, Viewport } from 'next';
import './globals.css';
import './globals-live-shell-compat.css';
import './korean-stuff/korean-stuff.css';
import '@/styles/design-system.css';
import GlobalAppShell from '@/components/layout/GlobalAppShell';
import AppRuntime from '@/components/layout/AppRuntime';
import { SITE_URL } from '@/lib/seo';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'K-Global Portal | 글로벌 한인 교민 통합 포털',
  description: '전 세계 한인 교민을 위한 구인구직, 업체목록, 에스크로 장터 통합 플랫폼',
  keywords: ['한인 포털', '교민 커뮤니티', '해외 구인구직', '한인 업소록', '교민 장터', '랜덤 화상채팅', 'K-POP 라디오'],
  applicationName: 'GYOPO',
  authors: [{ name: 'GYOPO' }],
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    url: SITE_URL,
    siteName: 'GYOPO',
    title: 'GYOPO | 글로벌 한인 교민 통합 포털',
    description: '교민 커뮤니티, 구인구직, 업소록, 장터, 화상채팅과 K-POP 라디오를 한 곳에서 만나보세요.',
    images: [{ url: '/og-image.svg', alt: 'GYOPO 글로벌 한인 교민 네트워크' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GYOPO | 글로벌 한인 교민 통합 포털',
    description: '전 세계 한인을 위한 커뮤니티와 생활 플랫폼',
    images: ['/og-image.svg'],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: '#090e18', colorScheme: 'dark', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="font-sans min-h-screen">
        <AppRuntime>
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: 'GYOPO',
            alternateName: 'K-Global Portal',
             url: SITE_URL,
            description: '전 세계 한인을 위한 커뮤니티, 구인구직, 업소록, 장터, 화상채팅, K-POP 라디오 포털',
            inLanguage: ['ko', 'en'],
             potentialAction: { '@type': 'SearchAction', target: `${SITE_URL}/search?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
          }) }} />
          <GlobalAppShell>{children}</GlobalAppShell>
        </AppRuntime>
      </body>
    </html>
  );
}
