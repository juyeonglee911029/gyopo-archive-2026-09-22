'use client';

import { Suspense, useEffect, useEffectEvent, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { getFreshSessionToken, getOnlineCount, getSiteStats, isMasterUser, listDocuments, type PortalUser, type SiteStats } from '@/lib/firebase';
import { useGlobalStore } from '@/store/useGlobalStore';
import EditorialAutomationWorkspace from '@/components/master/EditorialAutomationWorkspace';
import CountryEditorialWorkspace from '@/components/master/CountryEditorialWorkspace';
import MasterUsdGrantPanel from '@/components/master/MasterUsdGrantPanel';

type Member = PortalUser & { id: string };
type SafetyReport = { id: string; reporterId: string; reportedUserId: string; category: string; details?: string; createdAt?: string; status: 'open' | 'resolved' };
type Moderation = { id: string; userId: string; status: 'active' | 'suspended' | 'banned'; reason?: string; until?: string; updatedAt?: string; updatedBy?: string };

export default function MasterPage() {
  const user = useGlobalStore((state) => state.user);
  const [profiles, setProfiles] = useState<Member[]>([]);
  const [siteStats, setSiteStats] = useState<SiteStats>({ today: 0, month: 0, total: 0 });
  const [onlineCount, setOnlineCount] = useState(0);
  const [safetyReports, setSafetyReports] = useState<SafetyReport[]>([]);
  const [moderationRows, setModerationRows] = useState<Moderation[]>([]);
  const [loading, setLoading] = useState(true);
  const masterUserId = user?.id && isMasterUser(user) ? user.id : undefined;

  const load = async () => {
    const token = await getFreshSessionToken();
    if (!token || !isMasterUser(user)) return;
    setLoading(true);
    const [nextProfiles, nextSiteStats, nextOnlineCount, nextSafetyReports, nextModerationRows] = await Promise.all([
      listDocuments<PortalUser>('profiles', token).catch(() => []),
      getSiteStats().catch(() => ({ today: 0, month: 0, total: 0 })),
      getOnlineCount().catch(() => 0),
      listDocuments<SafetyReport>('safetyReports', token).catch(() => []),
      listDocuments<Moderation>('accountModeration', token).catch(() => []),
    ]);
    setProfiles(nextProfiles);
    setSiteStats(nextSiteStats);
    setOnlineCount(nextOnlineCount);
    setSafetyReports(nextSafetyReports);
    setModerationRows(nextModerationRows);
    setLoading(false);
  };
  const loadEffect = useEffectEvent(load);
  useEffect(() => { void loadEffect(); }, [user?.id]);

  if (!isMasterUser(user)) return <div className="mx-auto max-w-xl px-4 py-24 text-center"><ShieldAlert className="mx-auto mb-4 text-rose-400" size={42} /><h1 className="text-2xl font-black">마스터 전용 페이지</h1><p className="mt-3 text-sm text-slate-500">관리자 계정으로 로그인해야 접근할 수 있습니다.</p></div>;

  const totalBalance = profiles.reduce((sum, profile) => sum + Number(profile.usdBalance || 0), 0);
  const openReports = safetyReports.filter((report) => report.status === 'open').length;
  const suspendedMembers = moderationRows.filter((row) => row.status !== 'active').length;

  return (
    <main className="mx-auto min-h-screen max-w-7xl bg-[#080d18] px-4 py-8 text-slate-100">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-black uppercase tracking-[0.28em] text-emerald-300">Master Operations</p><h1 className="mt-2 text-4xl font-black">운영자 센터</h1><p className="mt-2 text-sm text-slate-400">회원 서비스 잔고, 지급 원장, 편집 자동화를 관리합니다.</p></div>
        <Link href="/" className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-slate-300 hover:bg-white/5">사이트로 돌아가기</Link>
      </header>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-3xl border border-emerald-300/20 bg-emerald-300/10 p-5"><p className="text-xs font-bold text-emerald-200">전체 회원</p><p className="mt-2 text-3xl font-black">{profiles.length}</p></div>
        <div className="rounded-3xl border border-cyan-300/20 bg-cyan-300/10 p-5"><p className="text-xs font-bold text-cyan-200">USD 잔고 합계</p><p className="mt-2 text-3xl font-black">${totalBalance.toFixed(2)}</p></div>
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5"><p className="text-xs font-bold text-slate-400">현재 접속</p><p className="mt-2 text-3xl font-black">{onlineCount.toLocaleString()}</p></div>
        <div className="rounded-3xl border border-rose-300/20 bg-rose-300/10 p-5"><p className="text-xs font-bold text-rose-200">미처리 신고</p><p className="mt-2 text-3xl font-black">{openReports}</p></div>
        <div className="rounded-3xl border border-amber-300/20 bg-amber-300/10 p-5"><p className="text-xs font-bold text-amber-200">제재 회원</p><p className="mt-2 text-3xl font-black">{suspendedMembers}</p></div>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-3xl border border-white/10 bg-white/[.04] p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black">회원 USD 잔고</h2><p className="mt-1 text-xs text-slate-400">서버 원장에 저장된 서비스 결제용 잔고입니다.</p></div><button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs font-black text-slate-300"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />새로고침</button></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="border-b border-white/10 text-xs text-slate-500"><tr><th className="p-3">회원</th><th className="p-3">이메일</th><th className="p-3">가입 국가</th><th className="p-3 text-right">USD 잔고</th></tr></thead><tbody>{[...profiles].sort((a, b) => Number(b.usdBalance || 0) - Number(a.usdBalance || 0)).map((profile) => <tr key={profile.id} className="border-b border-white/5"><td className="p-3 font-bold">{profile.name || '이름 없음'}</td><td className="p-3 text-slate-400">{profile.email || profile.id}</td><td className="p-3 text-slate-400">{profile.country || 'Global'}</td><td className="p-3 text-right font-black text-emerald-300">${Number(profile.usdBalance || 0).toFixed(2)}</td></tr>)}</tbody></table></div>
          {!profiles.length && <p className="py-10 text-center text-sm text-slate-500">표시할 회원이 없습니다.</p>}
        </section>
        <MasterUsdGrantPanel members={profiles} onGranted={load} />
      </div>

      {masterUserId && <section className="mb-6 rounded-3xl border border-white/10 bg-white/[.04] p-5"><Suspense fallback={<p className="text-sm text-slate-400">자동 편집 작업대를 준비하고 있습니다.</p>}><EditorialAutomationWorkspace /></Suspense></section>}
      {masterUserId && <details className="mb-6 rounded-3xl border border-white/10 bg-white/[.04] p-5"><summary className="cursor-pointer text-sm font-bold text-slate-300">기존 국가별 초안 편집</summary><div className="mt-4"><Suspense fallback={<p className="text-sm text-slate-400">편집 데스크를 준비하고 있습니다.</p>}><CountryEditorialWorkspace uid={masterUserId} /></Suspense></div></details>}
    </main>
  );
}
