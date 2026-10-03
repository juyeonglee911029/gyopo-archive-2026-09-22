'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Heart, MapPin, RotateCcw, X } from 'lucide-react';
import type { OnlineUser } from '@/lib/firebase';
import { useGlobalStore } from '@/store/useGlobalStore';

type LikeResult = { matched: boolean; ok: boolean };
type DiscoveryNotice = 'passed' | 'liked' | '';
type Props = {
  viewerId?: string;
  canLike: boolean;
  candidates: OnlineUser[];
  incomingLikeIds: string[];
  busyId: string;
  error?: string;
  onLike: (memberId: string) => Promise<LikeResult>;
  onPass: (memberId: string) => Promise<boolean>;
  onProfile: (member: OnlineUser) => void;
  onOpenChat: (memberId: string) => void;
};

export default function FriendDiscoveryDeck({ viewerId, canLike, candidates, incomingLikeIds, busyId, error = '', onLike, onPass, onProfile, onOpenChat }: Props) {
  const isKorean = useGlobalStore((state) => state.language === 'ko');
  const t = (korean: string, english: string) => isKorean ? korean : english;
  const [handledIds, setHandledIds] = useState<string[]>([]);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [notice, setNotice] = useState<DiscoveryNotice>('');
  const [match, setMatch] = useState<OnlineUser | null>(null);
  const dragStart = useRef<number | null>(null);
  const actionBusyRef = useRef(false);
  const member = candidates.find((candidate) => !handledIds.includes(candidate.id));
  const incomingLike = Boolean(member && incomingLikeIds.includes(member.id));

  useEffect(() => {
    const pendingIds = new Set(incomingLikeIds);
    setHandledIds((current) => {
      const next = current.filter((id) => !pendingIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [incomingLikeIds]);

  const pass = async (candidate = member) => {
    if (!candidate || busyId || actionBusyRef.current) return;
    actionBusyRef.current = true;
    setActionBusy(true);
    try {
      if (!await onPass(candidate.id)) return;
      setHandledIds((current) => [...current, candidate.id]);
       setNotice('passed');
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
       else setNotice('liked');
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

  return <section aria-label={t('친구 매칭', 'Friend matching')} className="friend-discovery-deck mb-8 overflow-hidden rounded-[2rem] border border-cyan-200/15 bg-[#07111f]/90 p-4 shadow-[0_24px_80px_rgba(0,0,0,.28)] sm:p-7">
    <div className="friend-discovery-inner mx-auto max-w-5xl">
      <header className="friend-discovery-heading mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[.24em] text-cyan-200/70">MEMBER MATCHING</p>
           <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">{t('회원 프로필', 'Member profiles')}</h2>
            <p className="mt-2 max-w-xl text-xs leading-5 text-slate-400">{t('좋아요를 보내세요. 서로 좋아요를 누르면 매칭되어 채팅할 수 있어요.', 'Tap Like. If they like you too, match and chat.')}</p>
            <p className="mt-1 text-[10px] font-bold tracking-wide text-cyan-100/70">LIKE / 좋아요 <span aria-hidden="true">·</span> PASS / 건너뛰기</p>
        </div>
         <span className="rounded-full border border-white/10 bg-white/[.04] px-3 py-1.5 text-xs font-bold text-slate-300">{isKorean ? `${candidates.length}명 둘러보기` : `Explore ${candidates.length}`}</span>
      </header>

       <nav className="friend-discovery-tier-switch mb-4 grid grid-cols-2 gap-2" aria-label={t('등급별 매칭 기능', 'Matching plans')}>
        <Link href="#friend-discovery-profile" className="flex min-h-12 min-w-0 items-center justify-between gap-2 rounded-2xl border border-cyan-200/30 bg-cyan-200/[.1] px-3 py-2 text-left transition hover:bg-cyan-200/[.15] sm:px-4">
           <span className="min-w-0"><span className="block text-[9px] font-black uppercase tracking-[.16em] text-cyan-100/70">FREE</span><strong className="mt-0.5 block truncate text-xs font-black text-white sm:text-sm">{t('기본 매칭', 'Basic matching')}</strong></span>
           <span className="shrink-0 text-[10px] font-black text-cyan-100 sm:text-xs">{t('프로필 보기', 'View profile')}</span>
        </Link>
         <button type="button" disabled title={t('프리미엄 멤버십은 아직 준비 중입니다.', 'Premium membership is coming soon.')} className="flex min-h-12 min-w-0 items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[.035] px-3 py-2 text-left opacity-60 sm:px-4">
           <span className="min-w-0"><span className="block text-[9px] font-black uppercase tracking-[.16em] text-slate-400">PREMIUM</span><strong className="mt-0.5 block truncate text-xs font-black text-slate-200 sm:text-sm">{t('프리미엄', 'Premium')}</strong></span>
           <span className="shrink-0 text-[10px] font-black text-slate-400 sm:text-xs">{t('준비 중', 'Coming soon')}</span>
        </button>
      </nav>

      <div className="friend-discovery-grid grid items-center gap-7">
        <div id="friend-discovery-profile" className="friend-discovery-card mx-auto w-full" style={{ maxWidth: '22rem' }}>
          {member ? <>
            <article
              key={member.id}
              id="friend-discovery-member"
              tabIndex={0}
              aria-label={t(`${member.name} 프로필 카드. 오른쪽으로 밀면 좋아요, 왼쪽으로 밀면 건너뜁니다.`, `${member.name}'s profile. Swipe right to like or left to pass.`)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') { event.preventDefault(); void pass(); }
                if (event.key === 'ArrowRight') { event.preventDefault(); void like(); }
              }}
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={() => { dragStart.current = null; setIsDragging(false); setDragX(0); }}
              style={{ transform: `translateX(${dragX}px) rotate(${dragX / 20}deg) scale(${isDragging ? 0.985 : 1})`, opacity: Math.max(0.72, 1 - Math.abs(dragX) / 850), touchAction: 'pan-y', transition: isDragging ? 'none' : 'transform 360ms cubic-bezier(.18,.89,.32,1.28), opacity 180ms ease', aspectRatio: '4 / 5', minHeight: 'min(21rem, 50dvh)', maxHeight: '50dvh' }}
              className="friend-discovery-member relative isolate overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-900 shadow-2xl outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
            >
              <div className={`friend-discovery-swipe-cue${dragX > 28 ? ' is-like' : dragX < -28 ? ' is-pass' : ''}`} aria-hidden="true"><span>{dragX > 28 ? 'LIKE' : 'PASS'}</span></div>
              {member.image && <img src={member.image} alt={t(`${member.name} 프로필`, `${member.name}'s profile`)} draggable={false} className="absolute inset-0 h-full w-full select-none object-cover" />}
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,.5)_0%,transparent_35%,rgba(2,6,23,.08)_48%,rgba(2,6,23,.92)_100%)]" />
              {!member.image && <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_35%_25%,rgba(103,232,249,.22),transparent_36%),linear-gradient(145deg,#15253a,#090e18)]"><span className="grid h-36 w-36 place-items-center rounded-full border border-white/15 bg-white/[.06] text-5xl font-black text-cyan-100">{member.name.slice(0, 1)}</span></div>}
              <div className="absolute inset-x-4 top-4 flex items-center justify-between gap-2 sm:inset-x-5 sm:top-5">
                 <span className={`inline-flex items-center gap-2 rounded-full border bg-slate-950/70 px-3 py-1.5 text-[11px] font-black backdrop-blur ${incomingLike ? 'border-pink-200/30 text-pink-100' : 'border-emerald-200/20 text-emerald-100'}`}><i className={`h-2 w-2 rounded-full ${incomingLike ? 'bg-pink-300' : 'animate-pulse bg-emerald-300'}`} />{incomingLike ? t('회원님께 좋아요를 보냈어요', 'Liked your profile') : t('지금 온라인', 'Online now')}</span>
                 <span className="max-w-[55%] truncate rounded-full border border-white/10 bg-slate-950/60 px-3 py-1.5 text-[11px] font-bold text-white backdrop-blur">{member.country || t('지역 미설정', 'Location not set')}</span>
              </div>
              <div className="absolute inset-x-5 bottom-5 text-white sm:inset-x-6 sm:bottom-6">
                <p className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-200">GYOPO MEMBER</p>
                <h3 className="mt-1 break-words text-3xl font-black tracking-tight sm:text-4xl">{member.name}{member.age ? <span className="ml-2 text-2xl font-bold text-white/85">{member.age}</span> : null}</h3>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-slate-200">
                   {member.gender && <span>{member.gender === 'male' ? t('남성', 'Male') : t('여성', 'Female')}</span>}
                  {member.country && <span className="inline-flex items-center gap-1"><MapPin size={13} />{member.country}</span>}
                </div>
              </div>
            </article>

            <div className="friend-discovery-actions mt-4 flex items-center justify-center gap-3 sm:gap-4">
              <button type="button" onClick={() => void pass()} aria-label={t('건너뛰기', 'Pass')} className="inline-flex min-h-12 shrink-0 items-center justify-center gap-1.5 rounded-full border border-rose-200/20 bg-rose-300/[.08] px-3 text-[11px] font-black text-rose-100 transition hover:bg-rose-300/15 disabled:opacity-50 sm:px-4 sm:text-xs" disabled={Boolean(busyId) || actionBusy}><X size={17} /><span>{t('건너뛰기', 'Pass')}</span></button>
              <button type="button" onClick={() => onProfile(member)} className="min-h-12 flex-1 rounded-full border border-white/15 bg-white/[.06] px-3 text-[11px] font-black text-slate-200 transition hover:bg-white/10 sm:px-4 sm:text-xs">{t('프로필 자세히', 'View profile')}</button>
              {viewerId ? <button type="button" onClick={() => void like()} aria-label={incomingLike ? t('나도 좋아요 보내기', 'Like back') : t('좋아요 보내기', 'Send a like')} disabled={!canLike || Boolean(busyId) || actionBusy} className="inline-flex min-h-12 shrink-0 items-center justify-center gap-1.5 rounded-full border border-cyan-200/35 bg-cyan-300 px-3 text-[11px] font-black text-slate-950 shadow-[0_8px_28px_rgba(103,232,249,.2)] transition hover:scale-105 disabled:cursor-wait disabled:opacity-60 sm:px-4 sm:text-xs"><Heart size={17} fill="currentColor" /><span>{incomingLike ? t('나도 좋아요', 'Like back') : t('좋아요', 'Like')}</span></button> : <Link href="/login" aria-label={t('로그인하고 좋아요 보내기', 'Log in to send a like')} className="inline-flex min-h-12 shrink-0 items-center justify-center gap-1.5 rounded-full border border-cyan-200/35 bg-cyan-300 px-3 text-[11px] font-black text-slate-950 sm:px-4 sm:text-xs"><Heart size={17} fill="currentColor" /><span>{t('좋아요', 'Like')}</span></Link>}
            </div>
          </> : <div className="friend-discovery-empty grid min-h-[25rem] place-items-center rounded-[1.75rem] border border-dashed border-white/15 bg-white/[.025] p-6 text-center sm:min-h-[30rem]">
            <div>
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-cyan-200/15 bg-cyan-300/[.08] text-cyan-100"><Heart size={25} /></div>
               <h3 className="mt-5 text-xl font-black text-white">{candidates.length ? t('모두 둘러봤어요', 'You have seen everyone') : t('새 회원을 기다리고 있어요', 'Waiting for new members')}</h3>
               <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-slate-400">{candidates.length ? t('프로필을 다시 보고 싶으면 처음부터 둘러보세요.', 'Start over to review profiles again.') : t('실제 공개 프로필만 표시됩니다. 새 회원이 접속하면 이곳에서 만날 수 있습니다.', 'Only public profiles appear here. New members show up when they come online.')}</p>
               {candidates.length > 0 && <button type="button" onClick={() => { setHandledIds([]); setNotice(''); }} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 px-4 text-xs font-black text-slate-200 hover:bg-white/5"><RotateCcw size={14} />{t('처음부터 보기', 'Start over')}</button>}
               {!viewerId && <Link href="/login" className="mt-3 block text-xs font-black text-cyan-200 underline">{t('로그인하고 매칭 시작', 'Log in to start matching')}</Link>}
            </div>
          </div>}
          {error && <p role="alert" className="mt-3 rounded-xl border border-rose-200/15 bg-rose-200/[.06] px-3 py-2 text-center text-xs font-bold leading-5 text-rose-100">{error}</p>}
           {notice && <p role="status" className="mt-3 min-h-5 text-center text-xs font-bold text-cyan-100">{notice === 'passed' ? t('다음 프로필을 보여드릴게요.', 'Here is the next profile.') : t('좋아요를 보냈어요. 상대도 좋아요를 보내면 매칭됩니다.', 'Like sent. You will match if they like you back.')}</p>}
          {!viewerId && member && <p className="friend-discovery-guest-note mt-3 text-center text-xs text-slate-500">{t('로그인하면 좋아요를 보내고 친구를 만날 수 있어요.', 'Log in to send likes and meet friends.')}</p>}
        </div>

      </div>
    </div>

    {match && typeof document !== 'undefined' && createPortal(<div className="friend-match-backdrop fixed inset-0 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm" style={{ zIndex: 300 }} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setMatch(null)}>
      <section role="dialog" aria-modal="true" aria-labelledby="friend-match-title" className="friend-match-dialog relative w-full max-w-md rounded-[2rem] border border-cyan-200/20 bg-[#0b1525] p-6 text-center shadow-2xl sm:p-8">
         <button type="button" onClick={() => setMatch(null)} aria-label={t('매칭 알림 닫기', 'Close match notification')} className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full border border-white/10 text-slate-400 transition hover:bg-white/10 hover:text-white"><X size={17} /></button>
        <div className="friend-match-hearts mx-auto grid h-16 w-16 place-items-center rounded-full bg-cyan-300 text-slate-950"><Heart size={28} fill="currentColor" /></div>
        <p className="mt-5 text-[10px] font-black uppercase tracking-[.25em] text-cyan-200">IT&apos;S A MATCH</p>
         <h2 id="friend-match-title" className="mt-2 text-2xl font-black text-white">{t('서로 좋아요를 보냈어요!', 'It is a match!')}</h2>
         <p className="mt-2 text-sm text-slate-400">{isKorean ? `${match.name}님과 친구가 되었어요. 이제 이야기를 나눠보세요.` : `You and ${match.name} matched. Start a conversation.`}</p>
         <div className="mt-6 flex gap-2"><button type="button" onClick={() => { onOpenChat(match.id); setMatch(null); }} className="min-h-12 flex-1 rounded-xl bg-cyan-300 px-3 text-sm font-black text-slate-950">{t('채팅 탭에서 대화하기', 'Open chat')}</button><button type="button" onClick={() => setMatch(null)} className="min-h-12 rounded-xl border border-white/10 px-4 text-sm font-bold text-slate-300">{t('계속 보기', 'Keep browsing')}</button></div>
      </section>
    </div>, document.body)}
  </section>;
}
