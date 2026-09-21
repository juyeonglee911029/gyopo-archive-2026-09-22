'use client';

import Link from 'next/link';
import { useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, Check, ChevronRight, CircleGauge, ExternalLink, FilePenLine, Gauge, LockKeyhole, RefreshCw, Search, Settings2, ShieldCheck, Target, TrendingDown, TrendingUp } from 'lucide-react';
import { getFreshSessionToken, isMasterUser } from '@/lib/firebase';
import { useGlobalStore } from '@/store/useGlobalStore';
import { EXPOSURE_ACTIONS, EXPOSURE_STATES, validateExposureContract, type ExposureCluster, type ExposureContract, type ExposureOpportunity, type ExposureState } from '@/lib/master/exposure';

export type ExposureView = 'dashboard' | 'queue' | 'pages' | 'keywords' | 'clusters' | 'assets' | 'recovery' | 'monitoring' | 'reports' | 'settings';

type ExposureRow = { date: string; query: string; page: string; country: string; device: string; searchAppearance: string; clicks: number; impressions: number; ctr: number; position: number };
type ExposureData = {
  generatedAt: string;
  days: number;
  range: { startDate: string; endDate: string };
  previousRange: { startDate: string; endDate: string };
  sources: { searchConsole: string; googleAds: string; searchConsoleMessage?: string; googleAdsMessage?: string };
  metrics: { impressions: number; clicks: number; ctr: number; position: number | null; indexedPages: number; rankingKeywords: number; top3Keywords: number; top10Keywords: number; page2Keywords: number; zeroExposurePages: number; exposureLost: number; exposureGained: number; clickChange: number; ctrChange: number };
  rows: ExposureRow[];
  queue: ExposureOpportunity[];
  clusters: ExposureCluster[];
  contracts: Array<ExposureContract & { id: string }>;
  monitoring: Array<ExposureContract & { id: string }>;
};

const NAV: Array<{ id: ExposureView; label: string; href: string }> = [
  { id: 'dashboard', label: 'Exposure OS', href: '/admin/growth/exposure/' },
  { id: 'queue', label: 'Exposure Queue', href: '/admin/growth/exposure/queue/' },
  { id: 'pages', label: 'Pages', href: '/admin/growth/exposure/pages/' },
  { id: 'keywords', label: 'Keywords', href: '/admin/growth/exposure/keywords/' },
  { id: 'clusters', label: 'Clusters', href: '/admin/growth/exposure/clusters/' },
  { id: 'assets', label: 'URL Assets', href: '/admin/growth/exposure/assets/' },
  { id: 'recovery', label: 'Recovery', href: '/admin/growth/exposure/recovery/' },
  { id: 'monitoring', label: 'Monitoring', href: '/admin/growth/exposure/monitoring/' },
  { id: 'reports', label: 'Reports', href: '/admin/growth/exposure/reports/' },
  { id: 'settings', label: 'Settings', href: '/admin/growth/exposure/settings/' },
];

const DAY_WINDOWS = [3, 5, 7, 15, 30, 60, 90];
const stateLabel: Record<ExposureState, string> = { NOT_INDEXED: '미색인', INDEXED_NO_EXPOSURE: '색인·무노출', EXPOSED: '노출', LOW_VISIBILITY: '저노출', PAGE_2: '2페이지', TOP_10: 'TOP 10', TOP_3: 'TOP 3', DECLINING: '하락', GROWING: '성장', PROTECTED: '보호', RECOVERY: '복구' };
const actionLabel: Record<string, string> = { INDEX_FIX: '색인 점검', CREATE: '신규 작성', EXPAND: '확장', UPDATE: '기존 수정', CTR_OPTIMIZE: 'CTR 개선', TOP_3_PUSH: 'TOP 3 추진', PAGE_1_PUSH: '1페이지 추진', INTERNAL_LINK: '내부링크', MERGE: '통합 검토', CANNIBALIZATION_FIX: '카니벌라이제이션', REFRESH: '갱신', PROTECT: '보호', NO_ACTION: '관찰' };

function number(value: number | null | undefined): string { return value === null || value === undefined ? 'N/A' : value.toLocaleString('ko-KR'); }
function percent(value: number | null | undefined): string { return value === null || value === undefined ? 'N/A' : `${(value * 100).toFixed(1)}%`; }
function position(value: number | null | undefined): string { return value === null || value === undefined || value <= 0 ? 'N/A' : value.toFixed(1); }
function stateClass(state: string): string { return state === 'TOP_3' || state === 'PROTECTED' ? 'bg-emerald-300/15 text-emerald-200' : state === 'PAGE_2' || state === 'TOP_10' ? 'bg-amber-300/15 text-amber-200' : state === 'RECOVERY' || state === 'DECLINING' ? 'bg-rose-300/15 text-rose-200' : 'bg-white/8 text-slate-300'; }

function emptyContract(opportunity?: ExposureOpportunity): ExposureContract {
  const now = new Date();
  const review = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  return {
    articleId: '', url: opportunity?.page || '', primaryKeyword: opportunity?.query || '', keywordClusterId: '', secondaryKeywords: [], countryCode: opportunity?.country || 'GLOBAL', cityId: opportunity?.city || '', language: 'ko', searchIntent: '', contentType: 'article', targetAudience: '', baselineDate: now.toISOString().slice(0, 10), baselineImpressions: opportunity?.impressions || 0, baselineClicks: opportunity?.clicks || 0, baselineCtr: opportunity?.ctr || 0, baselinePosition: opportunity?.position || null, indexStatus: '', monthlySearchVolume: null, averageCpc: null, lowTopBid: null, highTopBid: null, trendScore: null, hotScore: null, goldenScore: null, exposureOpportunityScore: opportunity?.score || null, targetPosition: opportunity?.position && opportunity.position > 3 ? 3 : opportunity?.position || null, targetExposureState: opportunity?.state === 'TOP_3' ? 'PROTECTED' : 'TOP_3', review3d: review(3), review5d: review(5), review7d: review(7), review15d: review(15), review30d: review(30), review60d: review(60), review90d: review(90), status: 'DRAFT',
  };
}

export function ExposureOS({ view }: { view: ExposureView }) {
  const user = useGlobalStore((state) => state.user);
  const [days, setDays] = useState(7);
  const [data, setData] = useState<ExposureData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<ExposureOpportunity | null>(null);
  const [contract, setContract] = useState<ExposureContract | null>(null);
  const [contractSaving, setContractSaving] = useState(false);
  const [search, setSearch] = useState('');

  const load = async (windowDays = days) => {
    setLoading(true);
    try {
      const token = await getFreshSessionToken();
      if (!token) throw new Error('로그인 세션을 갱신할 수 없습니다. 로그인 화면에서 Google 계정을 다시 선택해주세요.');
      const response = await fetch(`/api/master/exposure?days=${windowDays}`, { cache: 'no-store', headers: { authorization: `Bearer ${token}` } });
      const payload = await response.json() as ExposureData & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Exposure OS 데이터를 불러오지 못했습니다.');
      setData(payload);
      setMessage(payload.sources.searchConsole === 'connected' ? '실제 Search Console 데이터가 동기화되었습니다.' : 'Search Console 연결 전 상태입니다. 숫자는 임의로 채우지 않습니다.');
    } catch (error) {
      setData(null);
      setMessage(error instanceof Error ? error.message : 'Exposure OS를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const loadEffect = useEffectEvent(load);
  useEffect(() => { void loadEffect(); }, [days]);

  const openContract = (opportunity: ExposureOpportunity) => {
    setSelected(opportunity);
    setContract(emptyContract(opportunity));
  };

  const saveContract = async () => {
    if (!contract) return;
    const missing = validateExposureContract(contract);
    if (missing.length) return setMessage(`발행 전 필수 항목을 완성해주세요: ${missing.join(', ')}`);
    setContractSaving(true);
    try {
      const token = await getFreshSessionToken();
      if (!token) throw new Error('로그인 세션이 없습니다.');
      const response = await fetch('/api/master/exposure', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'saveContract', contract }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Exposure Contract를 저장하지 못했습니다.');
      setMessage('Exposure Contract가 저장되었습니다. 이제 Editorial에서 해당 키워드의 발행 게이트를 통과할 수 있습니다.');
      setSelected(null);
      setContract(null);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Exposure Contract 저장에 실패했습니다.');
    } finally {
      setContractSaving(false);
    }
  };

  if (!isMasterUser(user)) return <div className="mx-auto max-w-2xl px-5 py-24 text-center text-slate-200"><LockKeyhole className="mx-auto mb-4 text-amber-300" size={42} /><h1 className="text-2xl font-black">Exposure OS는 Master 전용입니다.</h1><p className="mt-3 text-sm text-slate-500">관리자 Google 계정으로 로그인한 뒤 다시 열어주세요.</p></div>;

  const metrics = data?.metrics;
  const queue = (data?.queue || []).filter((row) => !search || `${row.query} ${row.page} ${row.country}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const pages = [...new Map((data?.rows || []).filter((row) => row.page).map((row) => [row.page, row])).values()];
  const keywords = [...new Map((data?.rows || []).filter((row) => row.query).map((row) => [row.query, row])).values()];

  return (
    <div className="exposure-os mx-auto max-w-[1500px] px-4 py-7 text-slate-100 sm:px-6">
      <header className="mb-5 overflow-hidden rounded-[2rem] border border-cyan-300/15 bg-[#0b1223] shadow-2xl shadow-cyan-950/20">
        <div className="flex flex-wrap items-start justify-between gap-5 bg-[radial-gradient(circle_at_0%_0%,rgba(34,211,238,.18),transparent_32%),radial-gradient(circle_at_100%_0%,rgba(167,139,250,.18),transparent_35%)] p-6">
          <div><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[.25em] text-cyan-300"><CircleGauge size={14} /> Master Growth / Exposure OS</div><h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">검색노출 운영 레이어</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">검색수요 → Query/Page/지역 → 노출 상태 → 작업 큐 → 콘텐츠 계약 → 실제 Google 노출을 한 화면에서 연결합니다.</p></div>
          <div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-[11px] font-black text-emerald-200">실제 데이터만</span><button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-3 py-2 text-xs font-black text-slate-950"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 동기화</button></div>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-white/8 p-2" aria-label="Exposure OS 메뉴">{NAV.map((item) => <Link key={item.id} href={item.href} className={`whitespace-nowrap rounded-xl px-3 py-2 text-xs font-black transition ${view === item.id ? 'bg-white text-slate-950' : 'text-slate-400 hover:bg-white/8 hover:text-white'}`}>{item.label}</Link>)}</nav>
      </header>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/8 bg-[#0e172a] p-3"><div className="flex flex-wrap items-center gap-1.5"><span className="mr-2 text-[10px] font-black uppercase tracking-[.16em] text-slate-500">Search Exposure</span>{DAY_WINDOWS.map((value) => <button key={value} type="button" onClick={() => setDays(value)} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-black ${days === value ? 'bg-cyan-300 text-slate-950' : 'bg-white/5 text-slate-400 hover:text-white'}`}>{value}D</button>)}</div><div className="text-[11px] text-slate-500">{data?.range.startDate || '—'} → {data?.range.endDate || '—'} · {data?.sources.searchConsole === 'connected' ? 'GSC Connected' : 'GSC Not Connected'} · {data?.sources.googleAds === 'connected' ? 'Ads Connected' : 'Ads Not Connected'}</div></div>

      {message && <div className="mb-5 flex items-start gap-2 rounded-2xl border border-cyan-300/15 bg-cyan-300/8 px-4 py-3 text-xs font-bold text-cyan-100"><ShieldCheck size={15} className="mt-0.5 shrink-0" />{message}</div>}
      {loading && !data ? <div className="rounded-3xl border border-white/8 bg-[#0d1629] px-6 py-24 text-center text-sm text-slate-500">실제 Search Console 행과 Exposure 상태를 읽는 중...</div> : view === 'dashboard' ? <DashboardView metrics={metrics} data={data} queue={queue} onOpenContract={openContract} /> : view === 'queue' ? <QueueView queue={queue} search={search} setSearch={setSearch} onOpenContract={openContract} /> : view === 'pages' ? <RowsView title="Pages" subtitle="Query/Page 관계에서 실제로 노출된 GYOPO URL을 확인합니다." rows={pages} kind="page" /> : view === 'keywords' ? <RowsView title="Site Keywords" subtitle="Search Console이 반환한 실제 Query와 장치·국가 차원을 확인합니다." rows={keywords} kind="keyword" /> : view === 'clusters' ? <ClustersView clusters={data?.clusters || []} /> : view === 'recovery' ? <RecoveryView queue={queue} onOpenContract={openContract} /> : view === 'monitoring' ? <MonitoringView contracts={data?.monitoring || []} /> : view === 'reports' ? <ReportsView metrics={metrics} data={data} /> : <SettingsView sources={data?.sources} />}

      {selected && contract && <ContractPanel contract={contract} setContract={setContract} onClose={() => { setSelected(null); setContract(null); }} onSave={() => void saveContract()} saving={contractSaving} selected={selected} />}
    </div>
  );
}

function MetricCard({ label, value, detail, tone = 'cyan', icon: Icon }: { label: string; value: string; detail: string; tone?: 'cyan' | 'emerald' | 'amber' | 'rose'; icon: typeof Gauge }) {
  const tones = { cyan: 'border-cyan-300/15 bg-cyan-300/8 text-cyan-200', emerald: 'border-emerald-300/15 bg-emerald-300/8 text-emerald-200', amber: 'border-amber-300/15 bg-amber-300/8 text-amber-200', rose: 'border-rose-300/15 bg-rose-300/8 text-rose-200' };
  return <article className={`rounded-2xl border p-4 ${tones[tone]}`}><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-black uppercase tracking-[.12em] opacity-75">{label}</span><Icon size={15} /></div><strong className="mt-3 block text-2xl font-black text-white">{value}</strong><small className="mt-1 block text-[10px] opacity-75">{detail}</small></article>;
}

function DashboardView({ metrics, data, queue, onOpenContract }: { metrics?: ExposureData['metrics']; data: ExposureData | null; queue: ExposureOpportunity[]; onOpenContract: (row: ExposureOpportunity) => void }) {
  return <div className="space-y-5">
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Impressions" value={number(metrics?.impressions)} detail={`${metrics?.exposureGained ? `+${number(metrics.exposureGained)} gained` : '이전 기간 비교 데이터 없음'}`} icon={BarChart3} />
      <MetricCard label="Clicks" value={number(metrics?.clicks)} detail={`${metrics?.clickChange && metrics.clickChange > 0 ? '+' : ''}${number(metrics?.clickChange)} vs previous`} tone="emerald" icon={ArrowUpRight} />
      <MetricCard label="CTR" value={percent(metrics?.ctr)} detail={`변화 ${metrics?.ctrChange && metrics.ctrChange > 0 ? '+' : ''}${percent(metrics?.ctrChange)}`} tone="amber" icon={Target} />
      <MetricCard label="Average Position" value={position(metrics?.position)} detail={`${number(metrics?.rankingKeywords)} ranking queries`} tone="rose" icon={Gauge} />
    </section>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <MetricCard label="Indexed Pages" value={number(metrics?.indexedPages)} detail="GSC가 반환한 URL 기준" icon={ShieldCheck} />
      <MetricCard label="Top 3" value={number(metrics?.top3Keywords)} detail="실제 Query 수" tone="emerald" icon={TrendingUp} />
      <MetricCard label="Top 10" value={number(metrics?.top10Keywords)} detail="실제 Query 수" tone="emerald" icon={TrendingUp} />
      <MetricCard label="Page 2" value={number(metrics?.page2Keywords)} detail="1페이지 추진 후보" tone="amber" icon={ChevronRight} />
      <MetricCard label="Exposure Lost" value={number(metrics?.exposureLost)} detail="이전 동일 기간 대비" tone="rose" icon={TrendingDown} />
    </section>
    <section className="grid gap-5 xl:grid-cols-[1.3fr_.7fr]">
      <div className="rounded-3xl border border-white/8 bg-[#0d1629] p-5"><div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-300">Daily Exposure Brief</p><h2 className="mt-1 text-xl font-black">오늘의 검색노출 브리핑</h2></div><span className="rounded-full bg-white/6 px-2.5 py-1 text-[10px] font-bold text-slate-400">Source: GSC {data?.range.startDate} ~ {data?.range.endDate}</span></div><div className="grid gap-2 sm:grid-cols-2"><BriefItem icon={<TrendingUp size={15} />} label="가장 우선 처리할 작업" value={queue[0] ? `${queue[0].query} · ${actionLabel[queue[0].action]}` : '실제 데이터 연결 후 표시'} /><BriefItem icon={<ArrowUpRight size={15} />} label="상승 기회" value={queue.find((row) => row.state === 'PAGE_2')?.query || 'Page 2 키워드 없음'} /><BriefItem icon={<ArrowDownRight size={15} />} label="저노출 위험" value={queue.find((row) => row.state === 'LOW_VISIBILITY')?.query || '현재 감지된 위험 없음'} /><BriefItem icon={<LockKeyhole size={15} />} label="보호 대상" value={queue.find((row) => row.action === 'PROTECT')?.query || 'TOP 3 데이터 없음'} /></div></div>
      <div className="rounded-3xl border border-white/8 bg-[#0d1629] p-5"><p className="text-[10px] font-black uppercase tracking-[.2em] text-fuchsia-300">Data Quality</p><h2 className="mt-1 text-xl font-black">연결 상태</h2><div className="mt-4 space-y-3"><ConnectionRow label="Google Search Console" status={data?.sources.searchConsole || 'unknown'} detail={data?.sources.searchConsoleMessage} /><ConnectionRow label="Google Ads / Planner" status={data?.sources.googleAds || 'unknown'} detail={data?.sources.googleAdsMessage} /><ConnectionRow label="Daily snapshot" status="ready" detail="날짜·Query·Page·Country·Device 차원 설계" /></div><Link href="/admin/growth/exposure/settings/" className="mt-5 inline-flex items-center gap-1 text-xs font-black text-cyan-200 hover:text-white">연결 설정 보기 <ChevronRight size={14} /></Link></div>
    </section>
    <section className="rounded-3xl border border-white/8 bg-[#0d1629] p-5"><div className="mb-4 flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-amber-300">Priority Queue</p><h2 className="mt-1 text-xl font-black">예상 노출 개선 우선순위</h2></div><Link href="/admin/growth/exposure/queue/" className="text-xs font-black text-cyan-200">전체 큐 보기 →</Link></div><QueueTable queue={queue.slice(0, 8)} onOpenContract={onOpenContract} /></section>
  </div>;
}

function BriefItem({ icon, label, value }: { icon: ReactNode; label: string; value: string }) { return <div className="rounded-2xl border border-white/7 bg-white/[.03] p-3"><div className="flex items-center gap-2 text-[10px] font-black text-slate-500">{icon}{label}</div><p className="mt-2 truncate text-sm font-black text-slate-100">{value}</p></div>; }
function ConnectionRow({ label, status, detail }: { label: string; status: string; detail?: string }) { const connected = status === 'connected' || status === 'ready'; return <div className="flex items-start justify-between gap-3 border-b border-white/7 pb-3 last:border-0 last:pb-0"><div><p className="text-xs font-black text-white">{label}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">{detail || (connected ? '정상' : '연결 필요')}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${connected ? 'bg-emerald-300/15 text-emerald-200' : status === 'error' ? 'bg-rose-300/15 text-rose-200' : 'bg-amber-300/15 text-amber-200'}`}>{connected ? '연결됨' : status === 'error' ? '오류' : '미연결'}</span></div>; }

function QueueView({ queue, search, setSearch, onOpenContract }: { queue: ExposureOpportunity[]; search: string; setSearch: (value: string) => void; onOpenContract: (row: ExposureOpportunity) => void }) { return <section className="rounded-3xl border border-white/8 bg-[#0d1629] p-5"><div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-300">Exposure Queue</p><h2 className="mt-1 text-2xl font-black">오늘 무엇을 처리할 것인가</h2><p className="mt-2 text-xs text-slate-500">Expected Exposure Gain · Commercial Value · Urgency · Confidence를 조합한 운영 큐입니다.</p></div><label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Query, URL, 국가 검색" className="w-64 rounded-xl border border-white/10 bg-black/20 py-2.5 pl-9 pr-3 text-xs text-white outline-none focus:border-cyan-300/50" /></label></div><QueueTable queue={queue} onOpenContract={onOpenContract} /></section>; }

function QueueTable({ queue, onOpenContract }: { queue: ExposureOpportunity[]; onOpenContract: (row: ExposureOpportunity) => void }) { return <div className="overflow-x-auto rounded-2xl border border-white/8"><table className="w-full min-w-[930px] text-left text-xs"><thead className="bg-white/5 text-[10px] uppercase tracking-[.12em] text-slate-500"><tr><th className="p-3">Priority</th><th className="p-3">Query / Page</th><th className="p-3">State</th><th className="p-3">Action</th><th className="p-3 text-right">Impressions</th><th className="p-3 text-right">CTR</th><th className="p-3 text-right">Position</th><th className="p-3">Confidence</th><th className="p-3" /></tr></thead><tbody>{queue.length ? queue.map((row) => <tr key={row.id} className="border-t border-white/6 hover:bg-white/[.03]"><td className="p-3"><span className="inline-flex min-w-10 justify-center rounded-lg bg-cyan-300/15 px-2 py-1 font-black text-cyan-200">{row.score}</span></td><td className="max-w-[300px] p-3"><p className="truncate font-black text-white">{row.query || 'Query 없음'}</p><p className="mt-1 truncate text-[10px] text-slate-500">{row.page || 'Target Page 없음'}{row.country ? ` · ${row.country}` : ''}</p></td><td className="p-3"><span className={`rounded-full px-2 py-1 text-[10px] font-black ${stateClass(row.state)}`}>{stateLabel[row.state]}</span></td><td className="p-3 font-bold text-amber-200">{actionLabel[row.action]}</td><td className="p-3 text-right text-slate-300">{number(row.impressions)}</td><td className="p-3 text-right text-slate-300">{percent(row.ctr)}</td><td className="p-3 text-right text-slate-300">{position(row.position)}</td><td className="p-3 text-[10px] text-slate-500">{row.confidence}</td><td className="p-3 text-right"><button type="button" onClick={() => onOpenContract(row)} className="inline-flex items-center gap-1 rounded-lg bg-cyan-300 px-2.5 py-1.5 text-[10px] font-black text-slate-950"><FilePenLine size={12} /> Contract</button></td></tr>) : <tr><td colSpan={9} className="p-12 text-center text-sm text-slate-500">연결된 실제 데이터가 없어 큐를 만들 수 없습니다.</td></tr>}</tbody></table></div>; }

function RowsView({ title, subtitle, rows, kind }: { title: string; subtitle: string; rows: Array<ExposureRow>; kind: 'page' | 'keyword' }) { return <section className="rounded-3xl border border-white/8 bg-[#0d1629] p-5"><p className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-300">{kind === 'page' ? 'Page Exposure' : 'Query Exposure'}</p><h2 className="mt-1 text-2xl font-black">{title}</h2><p className="mt-2 text-xs text-slate-500">{subtitle}</p><div className="mt-5 overflow-x-auto rounded-2xl border border-white/8"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-white/5 text-[10px] uppercase tracking-[.12em] text-slate-500"><tr><th className="p-3">{kind === 'page' ? 'Page' : 'Query'}</th><th className="p-3">국가</th><th className="p-3">Device</th><th className="p-3">Search Appearance</th><th className="p-3 text-right">Clicks</th><th className="p-3 text-right">Impressions</th><th className="p-3 text-right">CTR</th><th className="p-3 text-right">Position</th></tr></thead><tbody>{rows.length ? rows.slice(0, 200).map((row) => <tr key={`${row.query}-${row.page}-${row.country}`} className="border-t border-white/6"><td className="max-w-[330px] p-3"><p className="truncate font-black text-white">{kind === 'page' ? row.page : row.query}</p>{kind === 'page' && <a className="mt-1 inline-flex items-center gap-1 text-[10px] text-cyan-200" href={row.page} target="_blank" rel="noreferrer">열기 <ExternalLink size={10} /></a>}</td><td className="p-3 text-slate-400">{row.country || 'N/A'}</td><td className="p-3 text-slate-400">{row.device || 'N/A'}</td><td className="max-w-[180px] truncate p-3 text-slate-500">{row.searchAppearance || 'N/A'}</td><td className="p-3 text-right">{number(row.clicks)}</td><td className="p-3 text-right">{number(row.impressions)}</td><td className="p-3 text-right">{percent(row.ctr)}</td><td className="p-3 text-right">{position(row.position)}</td></tr>) : <tr><td colSpan={8} className="p-12 text-center text-sm text-slate-500">실제 Search Console 데이터가 없습니다.</td></tr>}</tbody></table></div></section>; }

function ClustersView({ clusters }: { clusters: ExposureCluster[] }) { return <section className="rounded-3xl border border-white/8 bg-[#0d1629] p-5"><p className="text-[10px] font-black uppercase tracking-[.2em] text-fuchsia-300">Query → Page Map</p><h2 className="mt-1 text-2xl font-black">Keyword Clusters & Cannibalization</h2><p className="mt-2 text-xs text-slate-500">같은 검색의도에 여러 GYOPO 페이지가 경쟁하면 자동 삭제하지 않고 병합·canonical·내부링크 검토 대상으로 표시합니다.</p><div className="mt-5 grid gap-3 lg:grid-cols-2">{clusters.length ? clusters.slice(0, 100).map((cluster) => <article key={cluster.id} className="rounded-2xl border border-white/8 bg-white/[.03] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.14em] text-slate-500">Cluster</p><h3 className="mt-1 font-black text-white">{cluster.name}</h3></div><span className={`rounded-full px-2 py-1 text-[10px] font-black ${cluster.cannibalizationRisk === 'HIGH' ? 'bg-rose-300/15 text-rose-200' : cluster.cannibalizationRisk === 'MEDIUM' ? 'bg-amber-300/15 text-amber-200' : 'bg-emerald-300/15 text-emerald-200'}`}>{cluster.cannibalizationRisk} RISK</span></div><div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px] text-slate-500"><div className="rounded-xl bg-black/20 p-2"><b className="block text-sm text-white">{number(cluster.impressions)}</b>노출</div><div className="rounded-xl bg-black/20 p-2"><b className="block text-sm text-white">{number(cluster.currentPages.length)}</b>페이지</div><div className="rounded-xl bg-black/20 p-2"><b className="block text-sm text-white">{position(cluster.position)}</b>위치</div></div><div className="mt-3 space-y-1">{cluster.currentPages.slice(0, 4).map((page) => <p key={page} className="truncate rounded-lg bg-black/15 px-2 py-1.5 text-[10px] text-slate-400">{page}</p>)}</div><div className="mt-3 flex items-center justify-between gap-2 text-[10px] font-black"><span className="text-fuchsia-200">Primary: {cluster.primaryKeyword}</span><span className="text-amber-200">{cluster.recommendedAction}</span></div></article>) : <EmptyBox text="실제 Query/Page 데이터가 연결되면 Cluster가 생성됩니다." />}</div></section>; }

function RecoveryView({ queue, onOpenContract }: { queue: ExposureOpportunity[]; onOpenContract: (row: ExposureOpportunity) => void }) { const rows = queue.filter((row) => ['DECLINING', 'LOW_VISIBILITY', 'INDEXED_NO_EXPOSURE', 'PAGE_2'].includes(row.state)); return <section className="rounded-3xl border border-rose-300/15 bg-[#0d1629] p-5"><p className="text-[10px] font-black uppercase tracking-[.2em] text-rose-300">Recovery Center</p><h2 className="mt-1 text-2xl font-black">노출 손실과 개선 후보</h2><p className="mt-2 text-xs text-slate-500">자동 롤백하지 않습니다. 이전 버전·스냅샷·실제 성과를 확인한 뒤 Master가 판단합니다.</p><div className="mt-5"><QueueTable queue={rows} onOpenContract={onOpenContract} /></div></section>; }

function MonitoringView({ contracts }: { contracts: Array<ExposureContract & { id: string }> }) { return <section className="rounded-3xl border border-white/8 bg-[#0d1629] p-5"><p className="text-[10px] font-black uppercase tracking-[.2em] text-emerald-300">Monitoring Checkpoints</p><h2 className="mt-1 text-2xl font-black">발행 후 실제 노출 추적</h2><p className="mt-2 text-xs text-slate-500">3D·5D·7D·15D·30D·60D·90D 체크포인트를 계약에 저장합니다.</p><div className="mt-5 overflow-x-auto rounded-2xl border border-white/8"><table className="w-full min-w-[850px] text-left text-xs"><thead className="bg-white/5 text-[10px] uppercase tracking-[.12em] text-slate-500"><tr><th className="p-3">Article</th><th className="p-3">Keyword</th><th className="p-3">State</th><th className="p-3">Baseline</th><th className="p-3">Target</th><th className="p-3">Review</th><th className="p-3">Status</th></tr></thead><tbody>{contracts.length ? contracts.map((row) => <tr key={row.id} className="border-t border-white/6"><td className="max-w-[260px] truncate p-3 text-white">{row.url || row.articleId}</td><td className="p-3 font-black text-cyan-200">{row.primaryKeyword}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-[10px] font-black ${stateClass(row.targetExposureState)}`}>{row.targetExposureState || 'N/A'}</span></td><td className="p-3 text-slate-400">{number(row.baselineImpressions)} 노출 · {position(row.baselinePosition)}</td><td className="p-3 text-slate-400">{position(row.targetPosition)} · {row.targetExposureState || 'N/A'}</td><td className="p-3 text-slate-400">{row.review3d || 'N/A'}</td><td className="p-3 font-black text-emerald-200">{row.status}</td></tr>) : <tr><td colSpan={7} className="p-12 text-center text-sm text-slate-500">저장된 Exposure Contract가 없습니다.</td></tr>}</tbody></table></div></section>; }

function ReportsView({ metrics, data }: { metrics?: ExposureData['metrics']; data: ExposureData | null }) { return <section className="space-y-5"><div className="rounded-3xl border border-white/8 bg-[#0d1629] p-5"><p className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-300">Exposure Reports</p><h2 className="mt-1 text-2xl font-black">운영 보고서</h2><p className="mt-2 text-xs text-slate-500">시장점유율이 아닌 GYOPO 자체 노출·기회 지표입니다. Forecast와 Actual을 구분합니다.</p><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><BriefItem icon={<BarChart3 size={15} />} label="Qualified Impressions" value={number(metrics?.impressions)} /><BriefItem icon={<TrendingUp size={15} />} label="Exposure Gained" value={number(metrics?.exposureGained)} /><BriefItem icon={<TrendingDown size={15} />} label="Exposure Lost" value={number(metrics?.exposureLost)} /><BriefItem icon={<Target size={15} />} label="Ranking Keywords" value={number(metrics?.rankingKeywords)} /></div></div><div className="grid gap-5 lg:grid-cols-3"><ReportCard title="Daily Exposure Report" value={data?.range.endDate || 'N/A'} text="선택한 기간의 실제 GSC aggregate" /><ReportCard title="Page 2 Opportunities" value={number(metrics?.page2Keywords)} text="TOP 3 PUSH 후보" /><ReportCard title="CTR Opportunities" value={number((data?.queue || []).filter((row) => row.action === 'CTR_OPTIMIZE').length)} text="본문 전체 Rewrite 대신 title/meta 우선" /></div></section>; }
function ReportCard({ title, value, text }: { title: string; value: string; text: string }) { return <article className="rounded-3xl border border-white/8 bg-[#0d1629] p-5"><p className="text-[10px] font-black uppercase tracking-[.16em] text-slate-500">{title}</p><strong className="mt-4 block text-3xl font-black text-white">{value}</strong><p className="mt-2 text-xs text-slate-500">{text}</p></article>; }

function SettingsView({ sources }: { sources?: ExposureData['sources'] }) { const envs = ['GOOGLE_SEARCH_CONSOLE_SITE_URL', 'GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN', 'GOOGLE_SEARCH_CONSOLE_CLIENT_ID', 'GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_API_VERSION']; return <section className="grid gap-5 xl:grid-cols-[1fr_380px]"><div className="rounded-3xl border border-white/8 bg-[#0d1629] p-5"><p className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-300">Exposure Settings</p><h2 className="mt-1 text-2xl font-black">데이터 연결과 운영 기준</h2><p className="mt-2 text-xs leading-5 text-slate-500">토큰과 Secret은 브라우저에 노출하지 않고 Cloudflare Pages Production 환경변수에서만 읽습니다. 현재 화면은 연결 여부만 표시합니다.</p><div className="mt-5 space-y-2">{envs.map((env) => <div key={env} className="flex items-center justify-between gap-3 rounded-xl border border-white/7 bg-white/[.03] px-3 py-2.5"><code className="text-[10px] text-slate-300">{env}</code><span className="text-[10px] font-black text-slate-500">서버 Secret</span></div>)}</div></div><div className="space-y-5"><div className="rounded-3xl border border-white/8 bg-[#0d1629] p-5"><p className="text-[10px] font-black uppercase tracking-[.2em] text-fuchsia-300">Connection Status</p><div className="mt-4 space-y-3"><ConnectionRow label="Search Console" status={sources?.searchConsole || 'unknown'} detail={sources?.searchConsoleMessage} /><ConnectionRow label="Google Ads" status={sources?.googleAds || 'unknown'} detail={sources?.googleAdsMessage} /></div></div><div className="rounded-3xl border border-amber-300/15 bg-amber-300/8 p-5 text-xs leading-5 text-amber-100"><Settings2 className="mb-3 text-amber-300" size={18} /><p className="font-black">BigQuery 준비 상태</p><p className="mt-2 text-amber-100/70">대규모 Search Console Bulk Export는 아직 활성화하지 않았습니다. 연결되면 날짜 파티션 aggregate만 읽도록 확장할 수 있습니다. 지금은 API 차원 데이터를 보존하는 구조입니다.</p></div></div></section>; }

function EmptyBox({ text }: { text: string }) { return <div className="rounded-2xl border border-dashed border-white/10 px-4 py-12 text-center text-sm text-slate-500">{text}</div>; }

function ContractPanel({ contract, setContract, onClose, onSave, saving, selected }: { contract: ExposureContract; setContract: (next: ExposureContract) => void; onClose: () => void; onSave: () => void; saving: boolean; selected: ExposureOpportunity }) {
  const update = (field: keyof ExposureContract, value: string | number | null) => setContract({ ...contract, [field]: value });
  const missing = validateExposureContract(contract);
  return <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center"><div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-[2rem] border border-cyan-300/20 bg-[#0a1121] p-5 shadow-2xl shadow-cyan-950/40 sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-300">Exposure Contract</p><h2 className="mt-1 text-2xl font-black">{selected.query || 'SEO Article'}의 노출 목표</h2><p className="mt-2 text-xs text-slate-500">이 계약이 `EXPOSURE_READY`가 되기 전에는 Master SEO 게시를 허용하지 않습니다.</p></div><button type="button" onClick={onClose} className="rounded-xl bg-white/8 px-3 py-2 text-xs font-black text-slate-300">닫기</button></div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{([['primaryKeyword', 'Primary Keyword'], ['keywordClusterId', 'Keyword Cluster'], ['url', 'Target URL'], ['searchIntent', 'Search Intent'], ['countryCode', 'Country 또는 Global'], ['cityId', 'City'], ['contentType', 'Content Type'], ['targetAudience', 'Target Audience'], ['indexStatus', 'Index Strategy']] as const).map(([field, label]) => <label key={field} className="text-[10px] font-black uppercase tracking-[.12em] text-slate-500">{label}<input value={String(contract[field] || '')} onChange={(event) => update(field, event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-sm font-bold text-white outline-none focus:border-cyan-300/60" /></label>)}</div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><ContractNumber label="Baseline Impressions" value={contract.baselineImpressions} onChange={(value) => update('baselineImpressions', value)} /><ContractNumber label="Baseline Clicks" value={contract.baselineClicks} onChange={(value) => update('baselineClicks', value)} /><ContractNumber label="Baseline CTR" value={contract.baselineCtr} onChange={(value) => update('baselineCtr', value)} /><ContractNumber label="Baseline Position" value={contract.baselinePosition} onChange={(value) => update('baselinePosition', value)} /></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><label className="text-[10px] font-black uppercase tracking-[.12em] text-slate-500">Target Position<input type="number" value={contract.targetPosition ?? ''} onChange={(event) => update('targetPosition', event.target.value ? Number(event.target.value) : null)} className="mt-1 w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-sm font-bold text-white" /></label><label className="text-[10px] font-black uppercase tracking-[.12em] text-slate-500">Target State<select value={contract.targetExposureState} onChange={(event) => update('targetExposureState', event.target.value as ExposureState)} className="mt-1 w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-sm font-bold text-white"><option value="">선택</option>{EXPOSURE_STATES.map((state) => <option key={state} value={state}>{stateLabel[state]}</option>)}</select></label><label className="text-[10px] font-black uppercase tracking-[.12em] text-slate-500">Contract Status<select value={contract.status} onChange={(event) => update('status', event.target.value as ExposureContract['status'])} className="mt-1 w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-sm font-bold text-white">{['DRAFT', 'AI_ENHANCED', 'REVIEW', 'EXPOSURE_READY', 'PUBLISHED', 'MONITORING', 'PROTECTED', 'RECOVERY'].map((status) => <option key={status} value={status}>{status}</option>)}</select></label></div><div className="mt-5 rounded-2xl border border-white/8 bg-white/[.03] p-4"><p className="text-xs font-black text-white">Review Schedule</p><div className="mt-3 grid gap-2 sm:grid-cols-4 lg:grid-cols-7">{([['3D', 'review3d'], ['5D', 'review5d'], ['7D', 'review7d'], ['15D', 'review15d'], ['30D', 'review30d'], ['60D', 'review60d'], ['90D', 'review90d'] ] as const).map(([label, field]) => <label key={field} className="text-[10px] font-bold text-slate-500">{label}<input type="date" value={contract[field]} onChange={(event) => update(field, event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-[10px] text-white" /></label>)}</div></div><div className="mt-5 flex flex-wrap items-center justify-between gap-3"><div className="text-xs text-amber-200">{missing.length ? `미완료: ${missing.join(' · ')}` : 'Exposure Contract 필수 항목이 완성되었습니다.'}</div><button type="button" onClick={onSave} disabled={saving || missing.length > 0} className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 text-xs font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"><Check size={14} />{saving ? '저장 중...' : 'EXPOSURE_READY 저장'}</button></div></div></div>;
}

function ContractNumber({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) { return <label className="text-[10px] font-black uppercase tracking-[.12em] text-slate-500">{label}<input type="number" value={value ?? ''} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)} className="mt-1 w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-sm font-bold text-white" /></label>; }
