'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import { Check, ExternalLink, RefreshCw, Save, Search, ShieldCheck } from 'lucide-react';
import { getFreshSessionToken, isMasterUser } from '@/lib/firebase';
import { useGlobalStore } from '@/store/useGlobalStore';

type Asset = { id: string; targetPath: string; primaryIntent: string; countryCode: string; citySlug: string; sitemapSegment: string; sitemapSegmentLabel: string; assetType: string; important: boolean; queryCount: number; verifiedQueryCount: number; clusterCount: number; keywordCluster: string[] };
type Slot = { slot: string; query: string; clusterId: string; clusterLabel: string; role: 'PRIMARY' | 'SECONDARY' | 'CANDIDATE'; verification: 'CANDIDATE' | 'APPROVED' | 'VERIFIED_GSC'; source: string; clicks: number; impressions: number; ctr: number; position: number | null };
type Payload = { assets: Asset[]; priorityUrls: string[]; summary: { targetCount: number; importantCount: number; observedCount: number; verifiedQueryCount: number; unverifiedImportantCount: number }; source?: string; sourceMessage?: string };
type Detail = Asset & { keywordSlots: Slot[]; plan: { primaryKeyword?: string; approvedKeywords?: string[] } | null };

const SITE_URL = 'https://gyopo.kr';

export function SearchAssets() {
  const user = useGlobalStore((state) => state.user);
  const [data, setData] = useState<Payload | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState('');
  const [segment, setSegment] = useState('all');
  const [needsIndexing, setNeedsIndexing] = useState(false);

  const token = async () => {
    const value = await getFreshSessionToken();
    if (!value) throw new Error('관리자 로그인 세션이 없습니다.');
    return value;
  };

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/master/search-assets', { cache: 'no-store', headers: { authorization: `Bearer ${await token()}` } });
      const payload = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(payload.error || '검색 자산을 불러오지 못했습니다.');
      setData(payload);
      setMessage(payload.source === 'connected' ? 'Search Console 실제 검색어와 자산을 대조했습니다.' : 'Search Console 연결 전입니다. 후보 키워드는 검증값으로 표시하지 않습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '검색 자산을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const loadEffect = useEffectEvent(load);
  useEffect(() => { if (isMasterUser(user)) void loadEffect(); }, [user?.id]);

  const openAsset = async (asset: Asset) => {
    try {
      const response = await fetch(`/api/master/search-assets?path=${encodeURIComponent(asset.targetPath)}`, { cache: 'no-store', headers: { authorization: `Bearer ${await token()}` } });
      const payload = await response.json() as { asset?: Detail; error?: string };
      if (!response.ok || !payload.asset) throw new Error(payload.error || 'URL 키워드 클러스터를 불러오지 못했습니다.');
      setDetail(payload.asset);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '상세 정보를 불러오지 못했습니다.');
    }
  };

  const toggleApproved = (index: number) => {
    if (!detail) return;
    const next = [...detail.keywordSlots];
    const slot = next[index];
    if (!slot.query || slot.verification === 'VERIFIED_GSC') return;
    slot.verification = slot.verification === 'APPROVED' ? 'CANDIDATE' : 'APPROVED';
    setDetail({ ...detail, keywordSlots: next });
  };

  const savePlan = async () => {
    if (!detail) return;
    try {
      const approvedKeywords = detail.keywordSlots.filter((slot) => slot.query && slot.verification !== 'CANDIDATE').map((slot) => slot.query);
      const primaryKeyword = detail.keywordSlots.find((slot) => slot.query && slot.verification === 'VERIFIED_GSC')?.query || approvedKeywords[0] || '';
      const response = await fetch('/api/master/search-assets', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await token()}` }, body: JSON.stringify({ action: 'savePlan', assetId: detail.id, primaryKeyword, approvedKeywords }) });
      const payload = await response.json() as { error?: string; approvedKeywords?: number };
      if (!response.ok) throw new Error(payload.error || '키워드 계획을 저장하지 못했습니다.');
      setMessage(`${detail.targetPath}에 ${payload.approvedKeywords || 0}개 키워드 계획을 저장했습니다.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '키워드 계획 저장에 실패했습니다.');
    }
  };

  const queuePriorityUrls = async () => {
    if (!data) return;
    try {
      const response = await fetch('/api/master/search-assets', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await token()}` }, body: JSON.stringify({ action: 'queuePriorityUrls', urls: data.priorityUrls }) });
      const payload = await response.json() as { error?: string; queued?: number };
      if (!response.ok) throw new Error(payload.error || '색인 우선순위를 저장하지 못했습니다.');
      setMessage(`중요 URL ${payload.queued || 0}개를 색인 재검토 큐에 넣었습니다. Google 색인은 자동 완료가 아니라 Search Console 재검토와 크롤링 대기 방식입니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '색인 큐 저장에 실패했습니다.');
    }
  };

  if (!isMasterUser(user)) return <div className="mx-auto max-w-2xl px-5 py-24 text-center text-slate-200"><ShieldCheck className="mx-auto mb-4 text-amber-300" size={42} /><h1 className="text-2xl font-black">마스터 전용 화면</h1><p className="mt-3 text-sm text-slate-500">관리자 Google 계정으로 로그인해야 합니다.</p></div>;
  const assets = (data?.assets || []).filter((asset) => (!needsIndexing || (asset.important && asset.verifiedQueryCount === 0)) && (segment === 'all' || asset.sitemapSegment === segment) && `${asset.targetPath} ${asset.primaryIntent}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));

  return <main className="mx-auto max-w-[1500px] px-4 py-7 text-slate-100 sm:px-6">
    <header className="rounded-[2rem] border border-cyan-300/15 bg-[#0b1223] p-6 shadow-2xl shadow-cyan-950/20">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-[.24em] text-cyan-300">GYOPO 검색 성장 엔진</p><h1 className="mt-2 text-3xl font-black sm:text-5xl">URL별 키워드 클러스터</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">후보 80개와 Google이 실제로 확인한 검색어를 분리합니다. 한 URL에는 대표 키워드 하나와 관련 의도 클러스터를 연결하고, 검증되지 않은 문구를 성과처럼 표시하지 않습니다.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-3 py-2 text-xs font-black text-slate-950"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />동기화</button><button type="button" onClick={() => void queuePriorityUrls()} className="inline-flex items-center gap-2 rounded-xl border border-amber-300/30 px-3 py-2 text-xs font-black text-amber-100">중요 URL 색인 큐</button></div></div>
      {message && <p className="mt-4 rounded-xl border border-white/10 bg-white/[.04] px-3 py-2 text-xs font-bold text-cyan-100">{message}</p>}
    </header>
    <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Kpi label="전체 자산" value={data?.summary.targetCount} /><Kpi label="중요 URL" value={data?.summary.importantCount} tone="amber" /><Kpi label="GSC 관측 URL" value={data?.summary.observedCount} tone="emerald" /><Kpi label="검증 검색어" value={data?.summary.verifiedQueryCount} tone="violet" /><Kpi label="색인·노출 확인 필요" value={data?.summary.unverifiedImportantCount} tone="rose" /></section>
    <section className="mt-5 rounded-3xl border border-white/8 bg-[#0d1629] p-4"><div className="flex flex-wrap items-center gap-2"><label className="relative min-w-[240px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="URL 또는 의도 검색" className="w-full rounded-xl border border-white/10 bg-black/20 py-2.5 pl-9 pr-3 text-xs text-white outline-none" /></label><select value={segment} onChange={(event) => setSegment(event.target.value)} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs text-white"><option value="all">모든 구간</option>{[...new Set((data?.assets || []).map((asset) => asset.sitemapSegment))].map((value) => <option key={value} value={value}>{value}</option>)}</select><label className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-xs text-slate-300"><input type="checkbox" checked={needsIndexing} onChange={(event) => setNeedsIndexing(event.target.checked)} />검증 검색어 없는 중요 URL</label></div></section>
    <section className="mt-5 overflow-hidden rounded-3xl border border-white/8 bg-[#0d1629]"><div className="max-h-[680px] overflow-auto"><table className="w-full min-w-[930px] text-left text-xs"><thead className="sticky top-0 z-10 bg-[#0d1629] text-[10px] uppercase tracking-[.12em] text-slate-500"><tr><th className="p-3">상태</th><th className="p-3">목표 URL</th><th className="p-3">사이트맵 구간</th><th className="p-3">키워드</th><th className="p-3">클러스터</th><th className="p-3">작업</th></tr></thead><tbody>{assets.map((asset) => <tr key={asset.id} className="border-t border-white/6 hover:bg-white/[.03]"><td className="p-3"><span className={`rounded-full px-2 py-1 text-[10px] font-black ${asset.verifiedQueryCount ? 'bg-emerald-300/15 text-emerald-200' : asset.important ? 'bg-amber-300/15 text-amber-100' : 'bg-white/8 text-slate-400'}`}>{asset.verifiedQueryCount ? 'GSC 검증' : asset.important ? 'GSC 미확인' : '후보'}</span></td><td className="max-w-[310px] p-3"><p className="truncate font-black text-white">{asset.targetPath}</p><p className="mt-1 truncate text-[10px] text-slate-500">{asset.primaryIntent}</p></td><td className="p-3 text-slate-400"><p>{asset.sitemapSegmentLabel}</p><p className="mt-1 text-[10px] text-slate-600">{asset.sitemapSegment}</p></td><td className="p-3 text-slate-300">{asset.queryCount} / 80 <span className="text-[10px] text-emerald-200">({asset.verifiedQueryCount} 검증)</span></td><td className="p-3 text-slate-300">{asset.clusterCount}</td><td className="p-3"><button type="button" onClick={() => void openAsset(asset)} className="rounded-lg bg-cyan-300 px-2.5 py-1.5 text-[10px] font-black text-slate-950">K01~K80 열기</button></td></tr>)}</tbody></table></div>{!assets.length && <p className="p-12 text-center text-sm text-slate-500">조건에 맞는 자산이 없습니다.</p>}</section>
    {detail && <DetailPanel detail={detail} onToggle={toggleApproved} onSave={() => void savePlan()} onClose={() => setDetail(null)} />}
  </main>;
}

function Kpi({ label, value, tone = 'cyan' }: { label: string; value?: number; tone?: string }) { const colors: Record<string, string> = { cyan: 'text-cyan-200', amber: 'text-amber-200', emerald: 'text-emerald-200', violet: 'text-violet-200', rose: 'text-rose-200' }; return <article className="rounded-2xl border border-white/8 bg-[#0d1629] p-4"><span className="text-[10px] font-black text-slate-500">{label}</span><strong className={`mt-2 block text-2xl font-black ${colors[tone]}`}>{value?.toLocaleString('ko-KR') || '0'}</strong></article>; }

function DetailPanel({ detail, onToggle, onSave, onClose }: { detail: Detail; onToggle: (index: number) => void; onSave: () => void; onClose: () => void }) { return <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center"><section className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-[2rem] border border-cyan-300/20 bg-[#0a1121] p-5 shadow-2xl sm:p-7"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-300">URL 키워드 클러스터</p><h2 className="mt-1 text-2xl font-black text-white">{detail.targetPath}</h2><p className="mt-2 text-xs text-slate-500">대표 키워드 1개, 승인 보조어, Google 검증 검색어를 분리해 관리합니다. 후보 80개 전체를 본문에 넣지는 않습니다.</p></div><div className="flex gap-2"><a href={`${SITE_URL}${detail.targetPath}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-xl border border-white/10 px-3 py-2 text-xs font-black text-slate-300">페이지 열기 <ExternalLink size={13} /></a><button type="button" onClick={onClose} className="rounded-xl bg-white/8 px-3 py-2 text-xs font-black text-slate-300">닫기</button></div></div><div className="mt-5 grid gap-2 sm:grid-cols-4"><Kpi label="전체 슬롯" value={detail.keywordSlots.filter((slot) => slot.query).length} /><Kpi label="GSC 검증" value={detail.verifiedQueryCount} tone="emerald" /><Kpi label="클러스터" value={detail.clusterCount} tone="violet" /><Kpi label="승인 후보" value={detail.keywordSlots.filter((slot) => slot.verification === 'APPROVED').length} tone="amber" /></div><div className="mt-5 overflow-x-auto rounded-2xl border border-white/8"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-white/5 text-[10px] uppercase tracking-[.12em] text-slate-500"><tr><th className="p-3">슬롯</th><th className="p-3">검색어</th><th className="p-3">클러스터</th><th className="p-3">검증</th><th className="p-3 text-right">클릭</th><th className="p-3 text-right">노출</th><th className="p-3 text-right">순위</th><th className="p-3" /></tr></thead><tbody>{detail.keywordSlots.map((slot, index) => <tr key={slot.slot} className="border-t border-white/6"><td className="p-3 font-black text-cyan-200">{slot.slot}</td><td className="p-3 font-bold text-white">{slot.query || '빈 후보 슬롯'}</td><td className="p-3 text-slate-400">{slot.clusterLabel || '—'}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-[10px] font-black ${slot.verification === 'VERIFIED_GSC' ? 'bg-emerald-300/15 text-emerald-200' : slot.verification === 'APPROVED' ? 'bg-cyan-300/15 text-cyan-200' : 'bg-white/8 text-slate-500'}`}>{slot.verification === 'VERIFIED_GSC' ? 'Google 검증' : slot.verification === 'APPROVED' ? '운영자 승인' : '후보'}</span></td><td className="p-3 text-right">{slot.clicks.toLocaleString()}</td><td className="p-3 text-right">{slot.impressions.toLocaleString()}</td><td className="p-3 text-right">{slot.position ? slot.position.toFixed(1) : '—'}</td><td className="p-3 text-right">{slot.query && slot.verification !== 'VERIFIED_GSC' && <button type="button" onClick={() => onToggle(index)} className={`rounded-lg px-2.5 py-1.5 text-[10px] font-black ${slot.verification === 'APPROVED' ? 'bg-amber-300 text-slate-950' : 'border border-white/10 text-slate-300'}`}>{slot.verification === 'APPROVED' ? <><Check size={12} className="mr-1 inline" />승인 취소</> : '승인'}</button>}</td></tr>)}</tbody></table></div><button type="button" onClick={onSave} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 text-xs font-black text-slate-950"><Save size={14} /> 키워드 계획 저장</button></section></div>; }
