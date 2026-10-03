'use client';

import Link from 'next/link';
import { ArrowUpRight, Radio, UserRoundCheck } from 'lucide-react';
import { useGlobalStore } from '@/store/useGlobalStore';

export default function Footer() {
  const isKorean = useGlobalStore((state) => state.language === 'ko');
  const links = [
    { href: '/community', ko: '커뮤니티', en: 'Community' },
    { href: '/jobs', ko: '구인구직', en: 'Jobs' },
    { href: '/directory', ko: '업소록', en: 'Directory' },
    { href: '/market', ko: '장터', en: 'Marketplace' },
    { href: '/news', ko: '뉴스', en: 'News' },
    { href: '/regions', ko: '지역·행사', en: 'Regions & events' },
    { href: '/community?category=notice', ko: '공지사항', en: 'Notices' },
    { href: '/ads', ko: '광고 문의', en: 'Advertising' },
    { href: '/help', ko: '고객센터', en: 'Help center' },
    { href: '/pricing', ko: '가격 안내', en: 'Pricing' },
    { href: '/refund', ko: '환불 정책', en: 'Refund policy' },
    { href: '/terms', ko: '이용약관', en: 'Terms of service' },
    { href: '/privacy', ko: '개인정보처리방침', en: 'Privacy policy' },
  ];

  return (
    <footer className="global-footer gyopo-global-footer">
      <div className="global-footer-inner gyopo-footer-inner mx-auto w-full">
        <div className="gyopo-footer-top">
          <div className="gyopo-footer-brand">
            <Link href="/" className="gyopo-footer-logo">GYOPO<span>GLOBAL NETWORK</span></Link>
            <p>{isKorean ? '어디에 살든, 사람과 생활 정보를 연결합니다.' : 'Connecting people and local life, wherever you live.'}</p>
          </div>
          <div className="gyopo-footer-main">
            <div className="gyopo-footer-features">
              <Link href="/users" className="gyopo-footer-feature is-primary">
                <span className="gyopo-footer-feature-icon"><UserRoundCheck size={18} aria-hidden="true" /></span>
                <span className="gyopo-footer-feature-copy"><strong>{isKorean ? '친구 매칭' : 'Friend matching'}</strong><small>{isKorean ? '프로필을 둘러보고 서로 좋아요를 보내 연결하세요.' : 'Browse profiles and connect with mutual likes.'}</small></span>
                <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
              <Link href="/theater" className="gyopo-footer-feature is-live">
                <span className="gyopo-footer-feature-icon"><Radio size={18} aria-hidden="true" /></span>
                <span className="gyopo-footer-feature-copy"><strong>{isKorean ? '라이브 룸' : 'Live rooms'}</strong><small>{isKorean ? '전 세계 교민과 방송을 보고 이야기를 나눠보세요.' : 'Watch, broadcast, and chat with the global community.'}</small></span>
                <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            </div>
            <nav className="gyopo-footer-links" aria-label={isKorean ? '푸터 메뉴' : 'Footer links'}>
              {links.map(({ href, ko, en }) => <Link key={href} href={href} className="gyopo-footer-link">{isKorean ? ko : en}</Link>)}
            </nav>
          </div>
        </div>
        <div className="gyopo-footer-bottom">
          <span>© 2026 GYOPO GLOBAL NETWORK</span>
          <span>{isKorean ? '글로벌 한인 커뮤니티' : 'A global Korean community'}</span>
        </div>
      </div>
    </footer>
  );
}
