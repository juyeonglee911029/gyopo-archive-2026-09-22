'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowDownLeft, ArrowUpRight, Download, History, WalletCards } from 'lucide-react';
import { getFreshSessionToken, queryDocumentsWhere, type WalletLedgerEntry } from '@/lib/firebase';
import { useGlobalStore } from '@/store/useGlobalStore';
import { useEffectEvent } from '@/lib/useeffectevent';
import '@/styles/call-ui.css';

type LedgerRow = WalletLedgerEntry & { id: string };
type HistoryFilter = 'ALL' | 'DEPOSIT' | 'TRANSFER' | 'WITHDRAWAL' | 'FEE';

const filters: Array<{ id: HistoryFilter; label: string }> = [
  { id: 'ALL', label: '전체' },
  { id: 'DEPOSIT', label: '입금' },
  { id: 'TRANSFER', label: '내부 송금' },
  { id: 'WITHDRAWAL', label: '차감' },
  { id: 'FEE', label: '수수료' },
];

function kindOf(row: LedgerRow): Exclude<HistoryFilter, 'ALL'> {
  if (row.type === 'DEPOSIT' || row.type === 'ONCHAIN_RECEIVE') return 'DEPOSIT';
  if (row.type === 'INTERNAL_TRANSFER') return 'TRANSFER';
  if (row.type === 'ONCHAIN_SEND') return 'WITHDRAWAL';
  if (row.type === 'WITHDRAWAL') return 'WITHDRAWAL';
  return 'FEE';
}

function kindLabel(row: LedgerRow) {
  return filters.find((filter) => filter.id === kindOf(row))?.label || row.type;
}

function formatDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatUsdt(value: number) {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function shorten(value?: string, fallback = '-') {
  if (!value) return fallback;
  return value.length > 20 ? `${value.slice(0, 9)}...${value.slice(-7)}` : value;
}

function routeLabel(row: LedgerRow) {
  if (row.direction === 'IN') return '서비스 잔액 충전';
  if (row.direction === 'OUT') return '서비스 잔액 사용';
  return shorten(row.memo, '서비스 처리');
}

function csvCell(value: unknown) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export default function WalletHistoryPage() {
  const user = useGlobalStore((state) => state.user);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [filter, setFilter] = useState<HistoryFilter>('ALL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await getFreshSessionToken();
      if (!token) throw new Error('로그인 세션이 만료되었습니다. 로그인 화면에서 Google 계정을 다시 선택해주세요.');
      const next = await queryDocumentsWhere<WalletLedgerEntry>('walletLedger', [{ field: 'userId', op: 'EQUAL', value: user.id }], token, 300);
      setRows(next.sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime()));
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '거래내역을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };
  const loadEffect = useEffectEvent(load);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadEffect(), 0);
    return () => window.clearTimeout(timer);
  }, [user?.id]);

  if (!user) {
    return <div className="mx-auto max-w-xl px-4 py-24 text-center"><h1 className="text-2xl font-black">로그인이 필요합니다.</h1><Link href="/login" className="mt-4 inline-block text-cyan-300 underline">로그인 페이지로 이동</Link></div>;
  }

  const visibleRows = filter === 'ALL' ? rows : rows.filter((row) => kindOf(row) === filter);
  const incoming = rows.filter((row) => row.direction === 'IN').reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const outgoing = rows.filter((row) => row.direction === 'OUT').reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const pending = rows.filter((row) => row.status === 'PENDING' || row.status === 'SUBMITTED').length;

  const exportCsv = () => {
    const header = ['일시', '분류', '이동 경로', '금액', '수수료', '상태', '네트워크', 'TXID', '메모'];
    const body = rows.map((row) => [formatDate(row.createdAt), kindLabel(row), routeLabel(row), row.amount, row.fee || 0, row.status, row.network || '', row.txHash || '', row.memo || ''].map(csvCell).join(','));
    const blob = new Blob([`\ufeff${[header.map(csvCell).join(','), ...body].join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gyopo-wallet-history-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
      <div className="wallet-history-page mx-auto w-full max-w-5xl px-4 py-8 text-slate-100 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/wallet" className="mb-3 inline-flex text-xs font-bold text-cyan-300 hover:text-cyan-100">← 내 지갑</Link>
            <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-none bg-cyan-300/10 text-cyan-300"><History size={21} /></span><div><p className="text-[10px] font-black uppercase tracking-[.24em] text-cyan-300">Wallet ledger</p><h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">거래 내역서</h1></div></div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">충전과 서비스 이용 기록을 한 화면에서 확인합니다. 모든 항목은 서비스 원장에 기록된 시간과 상태를 기준으로 표시됩니다.</p>
        </div>
        <button type="button" onClick={exportCsv} disabled={!rows.length} className="inline-flex items-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100 disabled:opacity-40"><Download size={14} /> CSV 내려받기</button>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <div className="wallet-history-shell rounded-2xl p-4"><div className="flex items-center gap-2 text-xs font-bold text-emerald-300"><ArrowDownLeft size={14} /> 충전 합계</div><strong className="mt-2 block text-2xl font-black">${formatUsdt(incoming)}</strong></div>
          <div className="wallet-history-shell rounded-2xl p-4"><div className="flex items-center gap-2 text-xs font-bold text-rose-300"><ArrowUpRight size={14} /> 사용 합계</div><strong className="mt-2 block text-2xl font-black">${formatUsdt(outgoing)}</strong></div>
         <div className="wallet-history-shell rounded-2xl p-4"><div className="flex items-center gap-2 text-xs font-bold text-amber-300"><WalletCards size={14} /> 처리 대기</div><strong className="mt-2 block text-2xl font-black">{pending} <small className="text-xs text-slate-500">건</small></strong></div>
      </div>

      <section className="wallet-history-shell overflow-hidden rounded-3xl">
         <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4 sm:p-5"><div><h2 className="font-black">거래 목록</h2><p className="mt-1 text-xs text-slate-500">{visibleRows.length}건 표시 · 서비스 잔액의 충전과 사용 기록입니다.</p></div></div>
        <div className="flex flex-wrap gap-2 border-b border-white/10 p-4">{filters.map((item) => <button key={item.id} type="button" onClick={() => setFilter(item.id)} className={`rounded-full px-3 py-1.5 text-xs font-black transition ${filter === item.id ? 'bg-cyan-300 text-slate-950' : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'}`}>{item.label}</button>)}</div>
        {error && <p className="m-4 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-xs font-bold text-amber-100">{error}</p>}
         {loading && !rows.length ? <div className="min-h-24" aria-busy="true" /> : !visibleRows.length ? <div className="p-14 text-center text-sm text-slate-500">선택한 분류의 거래내역이 없습니다.</div> : <>
           <div>{visibleRows.map((row) => <article key={row.id} className="wallet-history-row border-b border-white/10 last:border-b-0"><div className="min-w-0"><div className="flex items-center gap-2"><span className={`rounded-md px-2 py-1 text-[10px] font-black ${row.direction === 'IN' ? 'bg-emerald-300/15 text-emerald-200' : row.direction === 'OUT' ? 'bg-rose-300/15 text-rose-200' : 'bg-white/10 text-slate-300'}`}>{kindLabel(row)}</span><span className="truncate text-sm font-bold text-white">{row.memo || '서비스 이용'}</span></div></div><time className="text-xs text-slate-500">{formatDate(row.createdAt)}</time><strong className={`whitespace-nowrap text-right text-sm ${row.direction === 'IN' ? 'text-emerald-200' : row.direction === 'OUT' ? 'text-rose-200' : 'text-slate-200'}`}>{row.direction === 'IN' ? '+' : row.direction === 'OUT' ? '-' : ''}${formatUsdt(Number(row.amount || 0))}</strong><span className={`text-right text-[10px] font-black ${row.status === 'COMPLETED' ? 'text-emerald-200' : row.status === 'PENDING' || row.status === 'SUBMITTED' ? 'text-amber-200' : 'text-slate-400'}`}>{row.status}</span></article>)}</div>
             <div className="wallet-history-mobile">{visibleRows.map((row) => <article key={row.id} className="border-b border-white/10 p-4 last:border-b-0"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className={`inline-flex rounded-md px-2 py-1 text-[10px] font-black ${row.direction === 'IN' ? 'bg-emerald-300/15 text-emerald-200' : row.direction === 'OUT' ? 'bg-rose-300/15 text-rose-200' : 'bg-white/10 text-slate-300'}`}>{kindLabel(row)}</span><h3 className="mt-2 truncate text-sm font-bold text-white">{row.memo || '서비스 이용'}</h3></div><strong className={`whitespace-nowrap text-sm ${row.direction === 'IN' ? 'text-emerald-200' : row.direction === 'OUT' ? 'text-rose-200' : 'text-slate-200'}`}>{row.direction === 'IN' ? '+' : row.direction === 'OUT' ? '-' : ''}${formatUsdt(Number(row.amount || 0))}</strong></div><div className="mt-3 grid gap-1 text-xs text-slate-500"><span>일시: {formatDate(row.createdAt)}</span><span>상태: <b className="text-slate-200">{row.status}</b></span></div></article>)}</div>
        </>}
      </section>
    </div>
  );
}
