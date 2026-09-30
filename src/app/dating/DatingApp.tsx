'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Ban, Heart, LoaderCircle, MapPin, ShieldAlert, UserRound, UserRoundCheck } from 'lucide-react';
import {
  createSafetyAuditLog,
  createSafetyReport,
  createUserBlock,
  getDatingProfile,
  getFreshSessionToken,
  listDatingInterests,
  listDatingProfiles,
  respondToDatingInterest,
  saveDatingProfile,
  sendDatingInterest,
  sendFriendRequest,
  type DatingInterest,
  type DatingProfile,
  type DatingProfileDraft,
  type DatingProfileSummary,
  type SafetyReport,
  hasCompletedProfile,
} from '@/lib/firebase';
import { validateDatingProfileDraft } from '@/lib/dating';
import { useGlobalStore } from '@/store/useGlobalStore';

const EMPTY_DRAFT: DatingProfileDraft = {
  displayName: '',
  city: '',
  bio: '',
  preferredGender: 'any',
  minAge: 18,
  maxAge: 60,
  isActive: false,
};

const genderLabel = (gender: string) => gender === 'female' ? '여성' : '남성';

export default function DatingApp() {
  const user = useGlobalStore((state) => state.user);
  const [profile, setProfile] = useState<DatingProfile | null>(null);
  const [draft, setDraft] = useState<DatingProfileDraft>(EMPTY_DRAFT);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [candidates, setCandidates] = useState<DatingProfileSummary[]>([]);
  const [interests, setInterests] = useState<DatingInterest[]>([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reportTarget, setReportTarget] = useState<DatingProfileSummary | null>(null);
  const [reportCategory, setReportCategory] = useState<SafetyReport['category']>('harassment');
  const [reportDetails, setReportDetails] = useState('');
  const [reloadVersion, setReloadVersion] = useState(0);

  const userId = user?.id;
  const userName = user?.name;
  const isAdult = Number.isInteger(user?.age) && Number(user?.age) >= 18;
  const profileComplete = hasCompletedProfile(user);

  useEffect(() => {
    let active = true;
    if (!userId || !isAdult || !profileComplete) {
      setProfile(null);
      setCandidates([]);
      setInterests([]);
      setLoading(false);
      return () => { active = false; };
    }

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const token = await getFreshSessionToken();
        if (!token) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
        const [ownProfile, nextInterests] = await Promise.all([
          getDatingProfile(userId, token),
          listDatingInterests(userId, token),
        ]);
        const nextCandidates = ownProfile?.isActive ? await listDatingProfiles(token) : [];
        if (!active) return;
        setProfile(ownProfile);
        setDraft(ownProfile ? {
          displayName: ownProfile.displayName,
          city: ownProfile.city,
          bio: ownProfile.bio,
          preferredGender: ownProfile.preferredGender,
          minAge: ownProfile.minAge,
          maxAge: ownProfile.maxAge,
          isActive: ownProfile.isActive,
        } : { ...EMPTY_DRAFT, displayName: userName || '' });
        setConsentConfirmed(Boolean(ownProfile?.consentedAt));
        setCandidates(nextCandidates);
        setInterests(nextInterests);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : '데이트 정보를 불러오지 못했습니다.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [userId, userName, isAdult, profileComplete, reloadVersion]);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !isAdult || !profileComplete) return;
    const validationError = validateDatingProfileDraft(draft, user);
    if (validationError) { setError(validationError); return; }
    if (!consentConfirmed) { setError('만 18세 이상 확인과 프로필 공개·안전 안내에 동의해주세요.'); return; }

    setWorking('profile');
    setError('');
    setMessage('');
    try {
      const token = await getFreshSessionToken();
      if (!token) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
      await saveDatingProfile(user, draft, consentConfirmed, token);
      setMessage(draft.isActive ? '데이트 프로필을 회원에게 공개했습니다.' : '프로필을 저장했습니다. 공개 상태를 끄면 검색에서 숨겨집니다.');
      setReloadVersion((version) => version + 1);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '프로필을 저장하지 못했습니다.');
    } finally {
      setWorking('');
    }
  };

  const refresh = () => setReloadVersion((version) => version + 1);

  const toggleInterest = async (candidate: DatingProfileSummary) => {
    if (!user) return;
    setWorking(candidate.id);
    setError('');
    setMessage('');
    try {
      const outgoing = interests.find((item) => item.fromId === user.id && item.toId === candidate.id);
      const incoming = interests.find((item) => item.fromId === candidate.id && item.toId === user.id);
      if (outgoing?.status === 'accepted' || incoming?.status === 'accepted') {
        await sendFriendRequest(candidate.id);
        setMessage(`${candidate.displayName}님에게 GYOPO 친구 요청을 보냈습니다.`);
      } else if (incoming?.status === 'pending') {
        await respondToDatingInterest(incoming, 'accepted');
        setMessage('관심 요청을 수락했습니다. 기존 GYOPO 친구 요청 기능으로 연결할 수 있습니다.');
      } else {
        await sendDatingInterest(user.id, candidate.id);
        setMessage('관심을 보냈습니다. 상대가 수락하기 전까지 연락처는 공유되지 않습니다.');
      }
      refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '요청을 처리하지 못했습니다.');
    } finally {
      setWorking('');
    }
  };

  const respond = async (interest: DatingInterest, status: 'accepted' | 'declined') => {
    if (status === 'accepted' && !profile?.isActive) {
      setError('프로필을 공개한 뒤 관심 요청을 수락해주세요.');
      return;
    }
    setWorking(interest.id);
    setError('');
    setMessage('');
    try {
      await respondToDatingInterest(interest, status);
      setMessage(status === 'accepted' ? '관심 요청을 수락했습니다. 양측은 기존 GYOPO 친구 요청 기능으로 연결할 수 있습니다.' : '관심 요청을 거절했습니다.');
      refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '요청을 처리하지 못했습니다.');
    } finally {
      setWorking('');
    }
  };

  const block = async (candidate: DatingProfileSummary) => {
    if (!user || !window.confirm(`${candidate.displayName} 회원을 차단할까요? 양쪽 프로필 검색에서 서로 숨겨집니다.`)) return;
    setWorking(candidate.id);
    setError('');
    try {
      const token = await getFreshSessionToken();
      if (!token) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
      await createUserBlock(user.id, candidate.id, candidate.displayName, undefined, token);
      await createSafetyAuditLog({ actorId: user.id, action: 'block', targetUserId: candidate.id, metadata: 'dating profile' }, token);
      setMessage('해당 회원을 차단했습니다.');
      refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '차단하지 못했습니다.');
    } finally {
      setWorking('');
    }
  };

  const submitReport = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !reportTarget || !reportDetails.trim()) { setError('신고 사유를 입력해주세요.'); return; }
    setWorking(`report-${reportTarget.id}`);
    setError('');
    try {
      const token = await getFreshSessionToken();
      if (!token) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
      await createSafetyReport({
        reporterId: user.id,
        reportedUserId: reportTarget.id,
        category: reportCategory,
        details: `dating: ${reportDetails.trim().slice(0, 450)}`,
        createdAt: new Date(),
        status: 'open',
      }, token);
      await createSafetyAuditLog({ actorId: user.id, action: 'report', targetUserId: reportTarget.id, metadata: 'dating profile' }, token);
      setMessage('신고를 접수했습니다. 운영자가 검토할 수 있도록 접수 내용이 기록되었습니다.');
      setReportTarget(null);
      setReportDetails('');
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : '신고를 접수하지 못했습니다.');
    } finally {
      setWorking('');
    }
  };

  const compatibleCandidates = profile?.isActive ? candidates : [];
  const incoming = interests.filter((interest) => interest.toId === user?.id && interest.status === 'pending');

  return <div className="mx-auto max-w-7xl px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-black uppercase tracking-[.24em] text-pink-200">GYOPO Members / 18+</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">교민 데이트</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">기존 회원이 직접 공개한 프로필만 검색됩니다. 관심을 수락하기 전에는 연락처나 대화가 공유되지 않습니다.</p>
      </div>
      <Link href="/terms" className="inline-flex items-center gap-2 text-sm font-bold text-cyan-200 underline underline-offset-4"><ShieldAlert size={16} />안전 수칙</Link>
    </header>

    {!user && <section className="rounded-3xl border border-white/10 bg-white/[.04] p-8 text-center">
      <UserRound className="mx-auto text-slate-400" size={34} />
      <h2 className="mt-4 text-xl font-black text-white">기존 GYOPO 회원 전용</h2>
      <p className="mt-2 text-sm text-slate-400">새 계정을 만들지 않고 기존 Google 로그인 계정으로 이용할 수 있습니다.</p>
      <Link href="/login" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-pink-300 px-5 py-3 text-sm font-black text-slate-950">기존 계정으로 로그인 <ArrowRight size={16} /></Link>
    </section>}

    {user && !profileComplete && <section className="rounded-3xl border border-amber-200/20 bg-amber-200/[.06] p-6 text-sm leading-6 text-amber-100">데이트 프로필을 만들기 전에 기존 회원 프로필의 성별·나이·국가 설정을 완료해주세요. <Link href="/users" className="ml-1 font-black underline underline-offset-4">회원 페이지로 이동</Link></section>}

    {user && profileComplete && !isAdult && <section className="rounded-3xl border border-rose-200/20 bg-rose-200/[.06] p-6 text-sm leading-6 text-rose-100">데이트 기능은 회원 프로필에 만 18세 이상으로 등록된 계정만 이용할 수 있습니다.</section>}

    {user && profileComplete && isAdult && <>
      <div className="grid gap-6 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
        <form onSubmit={(event) => void save(event)} className="h-fit rounded-3xl border border-white/10 bg-slate-950/35 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-pink-300/10 text-pink-200"><Heart size={19} /></span>
            <div><p className="text-[10px] font-black uppercase tracking-[.2em] text-pink-200">My dating profile</p><h2 className="font-black text-white">내 프로필 설정</h2></div>
          </div>
          <div className="mt-5 space-y-4">
            <label className="block text-xs font-bold text-slate-300">표시 이름<input required maxLength={80} value={draft.displayName} onChange={(event) => setDraft((value) => ({ ...value, displayName: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-sm text-white outline-none focus:border-pink-200/50" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-bold text-slate-300">국가<input readOnly value={user.country || ''} className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[.025] px-3 py-2.5 text-sm text-slate-400" /></label>
              <label className="block text-xs font-bold text-slate-300">도시 (선택)<input maxLength={80} value={draft.city} onChange={(event) => setDraft((value) => ({ ...value, city: event.target.value }))} placeholder="예: Los Angeles" className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-sm text-white outline-none focus:border-pink-200/50" /></label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-bold text-slate-300">회원 프로필 성별<input readOnly value={user.gender ? genderLabel(user.gender) : ''} className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[.025] px-3 py-2.5 text-sm text-slate-400" /></label>
              <label className="block text-xs font-bold text-slate-300">희망 상대<select value={draft.preferredGender} onChange={(event) => setDraft((value) => ({ ...value, preferredGender: event.target.value as DatingProfileDraft['preferredGender'] }))} className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-white"><option value="any">모든 성별</option><option value="male">남성</option><option value="female">여성</option></select></label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-bold text-slate-300">최소 나이<input type="number" min={18} max={130} value={draft.minAge} onChange={(event) => setDraft((value) => ({ ...value, minAge: Number(event.target.value) }))} className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-sm text-white" /></label>
              <label className="block text-xs font-bold text-slate-300">최대 나이<input type="number" min={18} max={130} value={draft.maxAge} onChange={(event) => setDraft((value) => ({ ...value, maxAge: Number(event.target.value) }))} className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-sm text-white" /></label>
            </div>
            <label className="block text-xs font-bold text-slate-300">짧은 소개<textarea maxLength={280} rows={4} value={draft.bio} onChange={(event) => setDraft((value) => ({ ...value, bio: event.target.value }))} placeholder="취미나 만나고 싶은 관계를 소개해주세요. 연락처·주소·외부 링크는 적지 마세요." className="mt-1.5 w-full resize-y rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-sm leading-6 text-white outline-none focus:border-pink-200/50" /><span className="mt-1 block text-right text-[10px] text-slate-500">{draft.bio.length}/280</span></label>
            <label className="flex items-start gap-2.5 rounded-2xl border border-white/10 bg-white/[.025] p-3 text-xs leading-5 text-slate-300"><input type="checkbox" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)} className="mt-0.5 accent-pink-300" /><span>본인은 만 18세 이상이며, 프로필을 공개하면 다른 참여 회원에게 표시 이름·사진·나이·성별·국가/도시·소개가 보이는 점과 안전 수칙을 확인했습니다. 나이는 기존 회원 프로필의 <strong className="text-white">자기 신고 정보</strong>이며 신분증으로 검증된 나이가 아닙니다.</span></label>
            <label className="flex items-center gap-2.5 rounded-2xl border border-pink-200/15 bg-pink-200/[.04] p-3 text-xs font-bold text-pink-50"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft((value) => ({ ...value, isActive: event.target.checked }))} className="accent-pink-300" />프로필 공개 및 데이트 회원 검색 참여</label>
            <button type="submit" disabled={working === 'profile'} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-pink-300 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-pink-200 disabled:opacity-50">{working === 'profile' && <LoaderCircle className="animate-spin" size={16} />}{draft.isActive ? '동의하고 프로필 저장' : '비공개로 저장'}</button>
            <p className="text-[11px] leading-5 text-slate-500">프로필을 비공개로 바꾸면 검색에서 숨겨집니다. 정확한 주소·전화번호·이메일은 표시하지 않습니다. 회원 차단·신고는 즉시 이용할 수 있습니다.</p>
          </div>
        </form>

        <div className="space-y-6">
          <section className="rounded-3xl border border-white/10 bg-slate-950/25 p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><p className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-200">Member discovery</p><h2 className="mt-1 text-xl font-black text-white">서로 조건이 맞는 회원</h2><p className="mt-1 text-xs text-slate-400">양쪽의 연령대와 성별 희망이 모두 맞는 공개 프로필만 표시합니다.</p></div>
              <span className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-bold text-slate-300">{compatibleCandidates.length}명</span>
            </div>
            {!profile?.isActive && <div className="mt-5 rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm leading-6 text-slate-400">프로필을 작성하고 공개를 켜면 다른 참여 회원을 볼 수 있습니다. 언제든 공개를 끌 수 있습니다.</div>}
            {profile?.isActive && loading && <div className="mt-5 flex items-center justify-center gap-2 p-8 text-sm text-slate-400"><LoaderCircle className="animate-spin" size={18} />회원 프로필을 불러오는 중...</div>}
            {profile?.isActive && !loading && compatibleCandidates.length === 0 && <div className="mt-5 rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-slate-400">현재 서로의 검색 조건에 맞는 공개 프로필이 없습니다.</div>}
            {profile?.isActive && !loading && <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {compatibleCandidates.map((candidate) => {
                const outgoing = interests.find((item) => item.fromId === user.id && item.toId === candidate.id);
                const incoming = interests.find((item) => item.fromId === candidate.id && item.toId === user.id);
                const accepted = outgoing?.status === 'accepted' || incoming?.status === 'accepted';
                const actionLabel = accepted ? 'GYOPO 친구 요청' : outgoing?.status === 'pending' ? '관심 전송됨' : incoming?.status === 'pending' ? '관심 수락' : outgoing?.status === 'declined' ? '관심 다시 보내기' : '관심 보내기';
                return <article key={candidate.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[.035]">
                  <div className="flex items-center gap-3 p-4">
                    {candidate.image ? <img src={candidate.image} alt="" className="h-14 w-14 shrink-0 rounded-2xl object-cover" /> : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/5 text-slate-400"><UserRound size={22} /></span>}
                    <div className="min-w-0"><h3 className="truncate font-black text-white">{candidate.displayName}</h3><p className="mt-1 text-xs text-slate-400">{candidate.age}세 · {genderLabel(candidate.gender)}</p><p className="mt-1 flex items-center gap-1 truncate text-xs text-slate-500"><MapPin size={12} />{candidate.city ? `${candidate.city}, ` : ''}{candidate.country}</p></div>
                  </div>
                  {candidate.bio && <p className="border-t border-white/[.06] px-4 py-3 text-sm leading-6 text-slate-300">{candidate.bio}</p>}
                  <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-t border-white/[.06] p-3">
                    <button type="button" disabled={working === candidate.id || outgoing?.status === 'pending'} onClick={() => void toggleInterest(candidate)} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-pink-300 px-3 py-2.5 text-xs font-black text-slate-950 disabled:opacity-50"><Heart size={14} />{actionLabel}</button>
                    <button type="button" disabled={working === candidate.id} onClick={() => void block(candidate)} aria-label={`${candidate.displayName} 차단`} className="rounded-xl border border-white/10 px-3 py-2.5 text-slate-300 hover:bg-white/5 disabled:opacity-50"><Ban size={15} /></button>
                    <button type="button" onClick={() => { setReportTarget(candidate); setReportDetails(''); setError(''); }} aria-label={`${candidate.displayName} 신고`} className="rounded-xl border border-white/10 px-3 py-2.5 text-slate-300 hover:bg-white/5"><ShieldAlert size={15} /></button>
                  </div>
                </article>;
              })}
            </div>}
          </section>

          <section className="rounded-3xl border border-white/10 bg-slate-950/25 p-5 sm:p-6">
            <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-300/10 text-emerald-200"><UserRoundCheck size={18} /></span><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-emerald-200">Requests</p><h2 className="font-black text-white">받은 관심</h2></div></div>
            {incoming.length === 0 ? <p className="mt-4 rounded-2xl bg-white/[.025] p-4 text-sm text-slate-500">새로운 관심 요청이 없습니다.</p> : <div className="mt-4 space-y-2">{incoming.map((interest) => {
              const sender = candidates.find((candidate) => candidate.id === interest.fromId);
              const canAccept = profile?.isActive;
              return <div key={interest.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 p-4"><div className="min-w-0"><p className="truncate text-sm font-black text-white">{sender?.displayName || '회원 프로필 비공개'}</p><p className="mt-1 text-xs text-slate-400">관심 요청을 수락해도 연락처는 자동 공유되지 않습니다.</p></div><div className="flex gap-2"><button type="button" disabled={working === interest.id} onClick={() => void respond(interest, 'declined')} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-slate-300">거절</button><button type="button" disabled={working === interest.id || !canAccept} onClick={() => void respond(interest, 'accepted')} className="rounded-xl bg-emerald-300 px-3 py-2 text-xs font-black text-slate-950 disabled:opacity-50">{canAccept ? '수락' : '프로필 공개 필요'}</button></div></div>;
            })}</div>}
          </section>
        </div>
      </div>
    </>}

    {error && <p role="alert" className="mt-5 rounded-2xl border border-rose-300/20 bg-rose-300/[.06] p-4 text-sm text-rose-100">{error}</p>}
    {message && <p role="status" className="mt-5 rounded-2xl border border-emerald-300/20 bg-emerald-300/[.06] p-4 text-sm text-emerald-100">{message}</p>}
    {user && profileComplete && isAdult && loading && !profile && <p className="mt-5 text-center text-xs text-slate-500">프로필 공개 전에도 기존 계정으로 안전 수칙을 확인할 수 있습니다.</p>}

    {reportTarget && <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/80 p-4" onMouseDown={(event) => event.target === event.currentTarget && setReportTarget(null)}>
      <form role="dialog" aria-modal="true" aria-labelledby="dating-report-title" onSubmit={(event) => void submitReport(event)} className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900 p-5 shadow-2xl sm:p-6">
        <h2 id="dating-report-title" className="text-xl font-black text-white">프로필 신고</h2>
        <p className="mt-2 text-sm text-slate-400">{reportTarget.displayName} 프로필에서 확인한 안전 문제를 알려주세요.</p>
        <label className="mt-4 block text-xs font-bold text-slate-300">신고 유형<select value={reportCategory} onChange={(event) => setReportCategory(event.target.value as SafetyReport['category'])} className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white"><option value="harassment">괴롭힘·불쾌한 행동</option><option value="privacy">개인정보 노출</option><option value="spam">스팸·사기</option><option value="sexual_content">성적 콘텐츠</option><option value="minor_safety">미성년자 안전 우려</option><option value="other">기타</option></select></label>
        <label className="mt-3 block text-xs font-bold text-slate-300">상세 내용<textarea required maxLength={450} rows={4} value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} className="mt-1.5 w-full resize-y rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm leading-6 text-white" /></label>
        <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setReportTarget(null)} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-bold text-slate-300">취소</button><button type="submit" disabled={working === `report-${reportTarget.id}`} className="rounded-xl bg-rose-300 px-4 py-2.5 text-sm font-black text-slate-950 disabled:opacity-50">신고 접수</button></div>
      </form>
    </div>}
  </div>;
}
