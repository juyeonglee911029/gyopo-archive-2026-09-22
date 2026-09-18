'use client';

import { useRef, useState } from 'react';
import { CircleDollarSign, ShieldCheck } from 'lucide-react';
import { getFreshSessionToken, type PortalUser } from '@/lib/firebase';

type Member = PortalUser & { id: string };

export default function MasterUsdGrantPanel({ members, onGranted }: { members: Member[]; onGranted?: () => void | Promise<void> }) {
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [password, setPassword] = useState('');
  const [memo, setMemo] = useState('운영자 USD 지급');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const grantIdRef = useRef('');
  const selected = members.find((member) => member.id === userId);

  const submit = async () => {
    const amountUsd = Math.round(Number(amount) * 100) / 100;
    if (!userId) return setError('지급할 회원을 선택해주세요.');
    if (!Number.isFinite(amountUsd) || amountUsd <= 0 || amountUsd > 1_000_000) return setError('0보다 크고 1,000,000 이하의 USD 금액을 입력해주세요.');
    setBusy(true);
    setError('');
    setMessage('서버 원장에 지급 내용을 저장하는 중입니다...');
    try {
      const token = await getFreshSessionToken();
      if (!token) throw new Error('로그인 세션이 없습니다. 다시 로그인해주세요.');
      const grantId = grantIdRef.current || (grantIdRef.current = crypto.randomUUID());
      const response = await fetch('/api/master/wallet/credit', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ userId, grantId, amountUsd, direction, password, memo }) });
      const payload = await response.json() as { error?: string; amountUsd?: number; balanceUsd?: number; direction?: 'CREDIT' | 'DEBIT'; alreadyApplied?: boolean };
      if (!response.ok) throw new Error(payload.error || 'USD 지급에 실패했습니다.');
      setMessage(`${selected?.name || '회원'}의 USD 잔고를 ${payload.direction === 'DEBIT' ? '-' : '+'}$${Number(payload.amountUsd || amountUsd).toFixed(2)} 조정했습니다${payload.alreadyApplied ? ' (이미 처리된 요청)' : ''}. 현재 잔고 $${Number(payload.balanceUsd || 0).toFixed(2)} USD`);
      setAmount('');
      setPassword('');
      grantIdRef.current = '';
      await onGranted?.();
    } catch (requestError) {
      setMessage('');
      setPassword('');
      setError(requestError instanceof Error ? requestError.message : 'USD 지급에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-3xl border border-emerald-200/30 bg-[#0f211f] p-5 shadow-2xl shadow-emerald-950/20">
      <div className="flex items-start gap-3"><div className="rounded-2xl bg-emerald-300 p-2 text-slate-950"><CircleDollarSign size={19} /></div><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-emerald-300">Master Wallet Control</p><h2 className="mt-1 text-xl font-black text-white">회원 USD 잔고 조정</h2><p className="mt-1 text-xs leading-5 text-slate-400">마스터 인증과 추가 비밀번호를 거친 서버 원장 작업입니다. 모든 조정은 감사 기록에 남습니다.</p></div></div>
      <div className="mt-5 space-y-3">
        <label className="block text-xs font-bold text-slate-300">지급 회원<select value={userId} onChange={(event) => { grantIdRef.current = ''; setUserId(event.target.value); }} className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white"><option value="">회원 선택</option>{[...members].sort((a, b) => `${a.name}${a.email}`.localeCompare(`${b.name}${b.email}`)).map((member) => <option key={member.id} value={member.id}>{member.name || '이름 없음'} · {member.email || member.id} · 현재 ${Number(member.usdBalance || 0).toFixed(2)}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => { grantIdRef.current = ''; setDirection('CREDIT'); }} className={`rounded-xl py-2.5 text-sm font-black ${direction === 'CREDIT' ? 'bg-emerald-300 text-slate-950' : 'border border-white/10 text-slate-400'}`}>잔고 추가</button><button type="button" onClick={() => { grantIdRef.current = ''; setDirection('DEBIT'); }} className={`rounded-xl py-2.5 text-sm font-black ${direction === 'DEBIT' ? 'bg-rose-300 text-slate-950' : 'border border-white/10 text-slate-400'}`}>잔고 차감</button></div>
          <label className="block text-xs font-bold text-slate-300">조정 금액 (USD)<input value={amount} onChange={(event) => { grantIdRef.current = ''; setAmount(event.target.value); }} inputMode="decimal" type="number" min="0.01" max="1000000" step="0.01" placeholder="예: 10.00" className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-300/60" /></label>
          <label className="block text-xs font-bold text-slate-300">조정 사유<input value={memo} onChange={(event) => { grantIdRef.current = ''; setMemo(event.target.value); }} maxLength={200} className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-300/60" /></label>
          <label className="block text-xs font-bold text-slate-300">운영자 비밀번호<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="off" maxLength={128} placeholder="서버에서 검증됩니다" className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-300/60" /></label>
         <button type="button" onClick={() => void submit()} disabled={busy || !members.length || !password} className={`inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50 ${direction === 'DEBIT' ? 'bg-rose-300' : 'bg-emerald-300'}`}><ShieldCheck size={16} />{busy ? '서버 원장 처리 중...' : direction === 'DEBIT' ? 'USD 차감 확정' : 'USD 추가 확정'}</button>
        {error && <p role="alert" className="rounded-xl bg-rose-300/10 px-3 py-2 text-xs font-bold text-rose-200">{error}</p>}
        {message && <p role="status" className="rounded-xl bg-emerald-300/10 px-3 py-2 text-xs font-bold leading-5 text-emerald-100">{message}</p>}
      </div>
      <p className="mt-4 text-[10px] leading-5 text-slate-500">비밀번호 원문은 브라우저 저장소나 로그에 남기지 않고, 서버에는 솔트가 적용된 검증값만 저장합니다. 이 기능은 외부 은행 송금이 아닌 사이트 내부 서비스 USD 잔고 조정입니다.</p>
    </section>
  );
}
