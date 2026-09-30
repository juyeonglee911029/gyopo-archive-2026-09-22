'use client';

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Heart, MapPin, RotateCcw, X } from 'lucide-react';
import type { OnlineUser } from '@/lib/firebase';

type LikeResult = { matched: boolean; ok: boolean };
type Props = {
  viewerId?: string;
  canLike: boolean;
  candidates: OnlineUser[];
  busyId: string;
  error?: string;
  onLike: (memberId: string) => Promise<LikeResult>;
  onPass: (memberId: string) => Promise<boolean>;
  onProfile: (member: OnlineUser) => void;
};

export default function FriendDiscoveryDeck({ viewerId, canLike, candidates, busyId, error = '', onLike, onPass, onProfile }: Props) {
  const [handledIds, setHandledIds] = useState<string[]>([]);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [match, setMatch] = useState<OnlineUser | null>(null);
  const dragStart = useRef<number | null>(null);
  const actionBusyRef = useRef(false);
  const member = candidates.find((candidate) => !handledIds.includes(candidate.id));

  const pass = async (candidate = member) => {
    if (!candidate || busyId || actionBusyRef.current) return;
    actionBusyRef.current = true;
    setActionBusy(true);
    try {
      if (!await onPass(candidate.id)) return;
      setHandledIds((current) => [...current, candidate.id]);
      setNotice('다음 프로필을 보여드릴게요.');
    } finally {
      actionBusyRef.current = false;
      setActionBusy(false);
    }
  };

  const like = async (candidate = member) => {
    if (!candidate || !viewerId || !canLike || busyId || actionBusyRef.current) return;
    actionBusyRef.current = true;
    setActionBusy(true);
    setNotice('');
    try {
      const result = await onLike(candidate.id);
      if (!result.ok) return;
      setHandledIds((current) => [...current, candidate.id]);
      if (result.matched) setMatch(candidate);
      else setNotice('좋아요를 보냈어요. 상대도 좋아요를 보내면 매칭됩니다.');
    } finally {
      actionBusyRef.current = false;
      setActionBusy(false);
    }
  };

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button, a')) return;
    dragStart.current = event.clientX;
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragStart.current !== null) setDragX(event.clientX - dragStart.current);
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragStart.current === null) return;
    const distance = event.clientX - dragStart.current;
    dragStart.current = null;
    setIsDragging(false);
    setDragX(0);
    if (distance > 110) void like();
    else if (distance < -110) void pass();
  };

  return <section aria-label="친구 매칭" className="mb-8 overflow-hidden rounded-[2rem] border border-cyan-200/15 bg-[#07111f]/90 p-4 shadow-[0_24px_80px_rgba(0,0,0,.28)] sm:p-7">
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[.24em] text-cyan-200/70">GYOPO · PEOPLE NEAR YOU</p>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">오늘의 발견</h2>
          <p className="mt-2 max-w-xl text-xs leading-5 text-slate-400">온라인 회원의 프로필을 살펴보세요. 서로 좋아요를 보내면 친구로 연결됩니다.</p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[.04] px-3 py-1.5 text-xs font-bold text-slate-300">{candidates.length}명 둘러보기</span>
      </header>

      <div className="grid items-center gap-7" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 24rem), 1fr))' }}>
        <div className="mx-auto w-full" style={{ maxWidth: '27rem' }}>
          {member ? <>
            <article
              tabIndex={0}
              aria-label={`${member.name} 프로필 카드. 오른쪽으로 밀면 좋아요, 왼쪽으로 밀면 건너뜁니다.`}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') { event.preventDefault(); void pass(); }
                if (event.key === 'ArrowRight') { event.preventDefault(); void like(); }
              }}
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={() => { dragStart.current = null; setIsDragging(false); setDragX(0); }}
              style={{ transform: `translateX(${dragX}px) rotate(${dragX / 24}deg)`, touchAction: 'pan-y', transition: isDragging ? 'none' : 'transform 160ms ease-out', aspectRatio: '4 / 5', minHeight: 'min(25rem, 68dvh)', maxHeight: '68dvh' }}
              className="relative isolate overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-900 shadow-2xl outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
            >
              {member.image && <img src={member.image} alt={`${member.name} 프로필`} draggable={false} className="absolute inset-0 h-full w-full select-none object-cover" />}
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,.5)_0%,transparent_35%,rgba(2,6,23,.08)_48%,rgba(2,6,23,.92)_100%)]" />
              {!member.image && <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_35%_25%,rgba(103,232,249,.22),transparent_36%),linear-gradient(145deg,#15253a,#090e18)]"><span className="grid h-36 w-36 place-items-center rounded-full border border-white/15 bg-white/[.06] text-6xl font-black text-cyan-100">{member.name.slice(0, 1)}</span></div>}
              <div className="absolute inset-x-4 top-4 flex items-center justify-between gap-2 sm:inset-x-5 sm:top-5">
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200/20 bg-slate-950/60 px-3 py-1.5 text-[11px] font-black text-emerald-100 backdrop-blur"><i className="h-2 w-2 animate-pulse rounded-full bg-emerald-300" />지금 온라인</span>
                <span className="max-w-[55%] truncate rounded-full border border-white/10 bg-slate-950/60 px-3 py-1.5 text-[11px] font-bold text-white backdrop-blur">{member.country || '지역 미설정'}</span>
              </div>
              <div className="absolute inset-x-5 bottom-5 text-white sm:inset-x-6 sm:bottom-6">
                <p className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-200">GYOPO MEMBER</p>
                <h3 className="mt-1 break-words text-3xl font-black tracking-tight sm:text-4xl">{member.name}{member.age ? <span className="ml-2 text-2xl font-bold text-white/85">{member.age}</span> : null}</h3>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-slate-200">
                  {member.gender && <span>{member.gender === 'male' ? '남성' : '여성'}</span>}
                  {member.country && <span className="inline-flex items-center gap-1"><MapPin size={13} />{member.country}</span>}
                </div>
              </div>
            </article>

            <div className="mt-4 flex items-center justify-center gap-3 sm:gap-4">
              <button type="button" onClick={() => void pass()} aria-label="건너뛰기" className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-rose-200/20 bg-rose-300/[.08] text-rose-200 transition hover:bg-rose-300/15 disabled:opacity-50" disabled={Boolean(busyId) || actionBusy}><X size={23} /></button>
              <button type="button" onClick={() => onProfile(member)} className="min-h-12 flex-1 rounded-full border border-white/15 bg-white/[.06] px-4 text-xs font-black text-slate-200 transition hover:bg-white/10">프로필 자세히</button>
              {viewerId ? <button type="button" onClick={() => void like()} aria-label="좋아요" disabled={!canLike || Boolean(busyId) || actionBusy} className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-cyan-200/35 bg-cyan-300 text-slate-950 shadow-[0_8px_28px_rgba(103,232,249,.2)] transition hover:scale-105 disabled:cursor-wait disabled:opacity-60"><Heart size={22} fill="currentColor" /></button> : <Link href="/login" aria-label="로그인하고 좋아요 보내기" className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-cyan-200/35 bg-cyan-300 text-slate-950"><Heart size={22} fill="currentColor" /></Link>}
            </div>
          </> : <div className="grid min-h-[25rem] place-items-center rounded-[1.75rem] border border-dashed border-white/15 bg-white/[.025] p-6 text-center sm:min-h-[30rem]">
            <div>
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-cyan-200/15 bg-cyan-300/[.08] text-cyan-100"><Heart size={25} /></div>
              <h3 className="mt-5 text-xl font-black text-white">{candidates.length ? '모두 둘러봤어요' : '새 회원을 기다리고 있어요'}</h3>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-slate-400">{candidates.length ? '온라인 회원을 다시 보고 싶으면 처음부터 둘러보세요.' : '새 회원이 접속하면 이곳에서 프로필을 만날 수 있습니다.'}</p>
              {candidates.length > 0 && <button type="button" onClick={() => { setHandledIds([]); setNotice(''); }} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 px-4 text-xs font-black text-slate-200 hover:bg-white/5"><RotateCcw size={14} />처음부터 보기</button>}
              {!viewerId && <Link href="/login" className="mt-3 block text-xs font-black text-cyan-200 underline">로그인하고 매칭 시작</Link>}
            </div>
          </div>}
          {error && <p role="alert" className="mt-3 rounded-xl border border-rose-200/15 bg-rose-200/[.06] px-3 py-2 text-center text-xs font-bold leading-5 text-rose-100">{error}</p>}
          {notice && <p role="status" className="mt-3 min-h-5 text-center text-xs font-bold text-cyan-100">{notice}</p>}
          {!viewerId && member && <p className="mt-3 text-center text-xs text-slate-500">로그인하면 좋아요를 보내고 친구를 만날 수 있어요.</p>}
        </div>

        <aside className="rounded-[1.5rem] border border-white/10 bg-white/[.035] p-5 sm:p-6">
          <p className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-200/70">HOW IT WORKS</p>
          <h3 className="mt-2 text-lg font-black text-white">부담 없이, 서로 원할 때만</h3>
          <div className="mt-5 space-y-4">
            <div className="flex gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[.07] text-xs font-black text-slate-300">01</span><p className="pt-1 text-xs leading-5 text-slate-400">카드를 왼쪽으로 넘기거나 X를 눌러 건너뛰세요.</p></div>
            <div className="flex gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-cyan-300/10 text-xs font-black text-cyan-100">02</span><p className="pt-1 text-xs leading-5 text-slate-400">마음에 들면 오른쪽으로 넘기거나 하트를 눌러 좋아요를 보내세요.</p></div>
            <div className="flex gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-300/10 text-xs font-black text-emerald-100">03</span><p className="pt-1 text-xs leading-5 text-slate-400">상대도 좋아요를 보내면 자동으로 친구 매칭이 됩니다.</p></div>
          </div>
          <div className="mt-6 border-t border-white/10 pt-5">
            <p className="text-xs font-black text-slate-200">실시간 회원 {candidates.length}명</p>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">친구 요청이나 좋아요는 매칭 상대에게만 전달됩니다. 프로필에서 공개하는 정보만 표시합니다.</p>
          </div>
        </aside>
      </div>
    </div>

    {match && typeof document !== 'undefined' && createPortal(<div className="fixed inset-0 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm" style={{ zIndex: 300 }} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setMatch(null)}>
      <section role="dialog" aria-modal="true" aria-labelledby="friend-match-title" className="w-full max-w-md rounded-[2rem] border border-cyan-200/20 bg-[#0b1525] p-6 text-center shadow-2xl sm:p-8">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-cyan-300 text-slate-950"><Heart size={28} fill="currentColor" /></div>
        <p className="mt-5 text-[10px] font-black uppercase tracking-[.25em] text-cyan-200">IT&apos;S A MATCH</p>
        <h2 id="friend-match-title" className="mt-2 text-2xl font-black text-white">서로 좋아요를 보냈어요!</h2>
        <p className="mt-2 text-sm text-slate-400">{match.name}님과 친구가 되었어요. 이제 이야기를 나눠보세요.</p>
        <div className="mt-6 flex gap-2"><button type="button" onClick={() => { window.dispatchEvent(new CustomEvent('gyopo-friends-open', { detail: { friendId: match.id } })); setMatch(null); }} className="min-h-12 flex-1 rounded-xl bg-cyan-300 px-3 text-sm font-black text-slate-950">친구 채팅 열기</button><button type="button" onClick={() => setMatch(null)} className="min-h-12 rounded-xl border border-white/10 px-4 text-sm font-bold text-slate-300">계속 보기</button></div>
      </section>
    </div>, document.body)}
  </section>;
}
