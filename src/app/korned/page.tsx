import type { Metadata } from 'next';
import { ArrowUpRight } from 'lucide-react';
import { KORNED_GROUPS, KORNED_LINKS_VERIFIED_ON, KORNED_ORIGIN } from '@/lib/kornedBoards';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(
  '네덜란드 한인회 게시판',
  '네덜란드 한인회 Korned의 커뮤니티, 구직, 장터, 소식과 생활 정보 원문 링크를 확인하세요.',
  '/korned',
);

export default function KornedPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <header className="overflow-hidden rounded-[2rem] border border-emerald-200/10 bg-[radial-gradient(ellipse_at_top_right,rgba(16,185,129,.16),transparent_48%),linear-gradient(135deg,#071d1a,#101827_58%,#111827)] p-6 sm:p-10">
        <p className="text-xs font-black uppercase tracking-[.24em] text-emerald-200">Netherlands / Korned</p>
        <h1 className="mt-4 max-w-3xl text-3xl font-black tracking-tight text-white sm:text-5xl">네덜란드 한인회 게시판과 생활 정보를 한곳에서</h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
          Korned.org에서 확인한 공개 게시판과 한인회 정보 페이지를 주제별로 모았습니다. 게시글과 개인정보는 복사하지 않으며, 각 링크에서 원문을 확인합니다.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <a href={KORNED_ORIGIN} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-emerald-200 px-5 py-2.5 text-sm font-bold text-emerald-950 transition hover:bg-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-200">
            Korned 원문 사이트 <ArrowUpRight size={16} aria-hidden="true" />
          </a>
          <span className="text-xs text-slate-400">링크 확인일 {KORNED_LINKS_VERIFIED_ON}</span>
        </div>
      </header>

      <aside className="mt-5 rounded-2xl border border-amber-300/25 bg-amber-300/[.07] p-4 text-sm leading-6 text-amber-100" aria-label="외부 사이트 보안 안내">
        <strong className="font-bold">외부 사이트 보안 안내</strong>
        <p className="mt-1 text-amber-100/80">확인 당시 Korned는 HTTP로 열렸고 HTTPS 연결은 오류를 반환했습니다. 외부 사이트에 비밀번호, 개인정보 또는 결제 정보를 입력하기 전에 주소창의 보안 상태를 확인하세요.</p>
      </aside>

      <div className="mt-10 space-y-10">
        {KORNED_GROUPS.map((group) => (
          <section key={group.id} aria-labelledby={`korned-${group.id}`}>
            <div className="mb-4 flex items-end justify-between gap-4 border-b border-white/10 pb-3">
              <h2 id={`korned-${group.id}`} className="text-xl font-black text-white sm:text-2xl">{group.title}</h2>
              <span className="text-xs font-semibold text-slate-500">{String(group.links.length).padStart(2, '0')} links</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.links.map((link) => (
                <a key={link.id} href={link.href} target="_blank" rel="noopener noreferrer" aria-label={`${link.title}, Korned 원문 새 창에서 열기`} className="group rounded-2xl border border-white/10 bg-white/[.035] p-5 transition hover:-translate-y-0.5 hover:border-emerald-200/35 hover:bg-emerald-200/[.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-200">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-bold text-white">{link.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-400">{link.description}</p>
                    </div>
                    <ArrowUpRight size={18} className="mt-1 shrink-0 text-slate-500 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-emerald-200" aria-hidden="true" />
                  </div>
                  <span className="mt-5 inline-flex text-xs font-semibold text-emerald-200">원문 열기 · Korned.org</span>
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-10 border-t border-white/10 pt-5 text-xs leading-6 text-slate-500">이 페이지는 외부 원문으로 연결하는 링크 디렉터리이며, 게시글·댓글·회원 정보를 저장하거나 복제하지 않습니다.</p>
    </div>
  );
}
