'use client';

import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="global-footer">
      <div className="global-footer-inner mx-auto w-full max-w-[1600px]">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
          <div><div className="text-[9px] font-black uppercase tracking-[.28em] text-cyan-300">Global Korean community</div><div className="mt-0.5 text-lg font-black tracking-tight">GYOPO NETWORK</div></div>
           <div className="flex gap-1.5 text-[9px] font-black"><Link href="/regions" className="footer-link footer-link-regions">REGIONS</Link><Link href="/community" className="footer-link">COMMUNITY</Link><Link href="/apps" className="footer-link footer-link-apps">APPS</Link></div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
           <p className="text-[10px] text-slate-500">지역, 생활 정보, 커뮤니티와 앱으로 연결되는 글로벌 교민 네트워크</p>
          <nav className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-bold text-slate-500" aria-label="푸터 메뉴">
            <Link href="/community?category=notice" className="transition-colors hover:text-cyan-200">공지사항</Link>
            <Link href="/ads" className="transition-colors hover:text-cyan-200">광고 문의</Link>
             <Link href="/terms" className="transition-colors hover:text-cyan-200">이용약관</Link>
             <Link href="/privacy" className="transition-colors hover:text-cyan-200">개인정보처리방침</Link>
             <Link href="/pricing" className="transition-colors hover:text-cyan-200">가격 안내</Link>
             <Link href="/refund" className="transition-colors hover:text-cyan-200">환불 정책</Link>
             <Link href="/help" className="transition-colors hover:text-cyan-200">고객센터</Link>
          </nav>
        </div>
        <div className="pt-2 text-center text-[9px] font-bold tracking-wider text-slate-600">
          &copy; 2026 GYOPO GLOBAL NETWORK. ALL RIGHTS RESERVED.
        </div>
      </div>
    </footer>
  );
}
