'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Heart, MapPin, MessageCircle, PackageCheck, ShieldCheck, UserPlus, Users as UsersIcon, Video, X } from 'lucide-react';
import { getDocument, getSessionToken, listEscrowOrdersForMember, listFriendConnections, listOnlineUsers, respondToFriendRequest, sendFriendRequest, type EscrowOrder, type FriendConnection, type OnlineUser, type PublicProfile } from '@/lib/firebase';
import { canPhotoMatch, normalizeProfilePhotos } from '@/lib/profilePhotos';
import { addMissingIncomingLikeCandidates, prioritizeIncomingLikes } from '@/lib/friendMatching';
import FriendDiscoveryDeck from '@/components/friends/FriendDiscoveryDeck';
import { useGlobalStore } from '@/store/useGlobalStore';

type SelectedMember = Partial<PublicProfile> & Pick<OnlineUser, 'id' | 'name' | 'image'>;

const STATUS_LABELS: Record<string, string> = {
  PAYMENT_HELD: '결제 보관 완료',
  SHIPPING: '배송 준비/시작',
  IN_TRANSIT: '배송 중',
  DELIVERED: '수령 완료',
};

export default function UsersPage() {
  const user = useGlobalStore((state) => state.user);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [mobileTab, setMobileTab] = useState<'matching' | 'chat'>('matching');
  const [selectedMember, setSelectedMember] = useState<SelectedMember | null>(null);
  const [sharedOrders, setSharedOrders] = useState<EscrowOrder[]>([]);
  const [profileLoading, setProfileLoading] = useState(false);
  const [friendships, setFriendships] = useState<FriendConnection[]>([]);
  const [incomingProfiles, setIncomingProfiles] = useState<Record<string, PublicProfile>>({});
  const [friendProfiles, setFriendProfiles] = useState<Record<string, Partial<PublicProfile>>>({});
  const [friendBusy, setFriendBusy] = useState('');
  const [friendError, setFriendError] = useState('');
  const selectionRequest = useRef(0);

  useEffect(() => {
    const showChatTab = () => setMobileTab('chat');
    const showMatchingTab = () => setMobileTab('matching');
    window.addEventListener('gyopo-mobile-friends-opened', showChatTab);
    window.addEventListener('gyopo-mobile-friends-closed', showMatchingTab);
    return () => {
      window.removeEventListener('gyopo-mobile-friends-opened', showChatTab);
      window.removeEventListener('gyopo-mobile-friends-closed', showMatchingTab);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const users = await listOnlineUsers().catch(() => []);
      if (active) setOnlineUsers(users);
    };
    void load();
    const timer = window.setInterval(load, 3_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!user) {
      setFriendships([]);
      return () => { active = false; };
    }
    const load = async () => {
      const rows = await listFriendConnections(user.id).catch(() => []);
      if (active) setFriendships(rows);
    };
    void load();
    const timer = window.setInterval(load, 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [user?.id]);

  const pendingIncomingKey = user
    ? [...new Set(friendships.filter((connection) => connection.status === 'pending' && connection.addresseeId === user.id).map((connection) => connection.requesterId))].join('|')
    : '';

  useEffect(() => {
    const incomingIds = pendingIncomingKey ? pendingIncomingKey.split('|') : [];
    if (!user || incomingIds.length === 0) {
      setIncomingProfiles({});
      return;
    }
    let active = true;
    const token = getSessionToken();
    void Promise.all(incomingIds.map(async (id) => [id, await getDocument<PublicProfile>('publicProfiles', id, token).catch(() => null)] as const)).then((rows) => {
      if (!active) return;
      setIncomingProfiles(Object.fromEntries(rows.flatMap(([id, profile]) => profile?.isPublic ? [[id, profile]] : [])));
    });
    return () => { active = false; };
  }, [pendingIncomingKey, user?.id]);

  useEffect(() => {
    let active = true;
    if (!user || friendships.length === 0) {
      setFriendProfiles({});
      return () => { active = false; };
    }
    const ids = [...new Set(friendships.map((connection) => connection.requesterId === user.id ? connection.addresseeId : connection.requesterId))];
    void Promise.all(ids.map(async (id) => [id, await getDocument<PublicProfile>('publicProfiles', id).catch(() => null)] as const)).then((rows) => {
      if (!active) return;
      setFriendProfiles(Object.fromEntries(rows.filter(([, profile]) => profile).map(([id, profile]) => [id, profile as PublicProfile])));
    });
    return () => { active = false; };
  }, [friendships, user?.id]);

  const relationshipFor = (memberId: string) => friendships.find((item) => item.requesterId === memberId || item.addresseeId === memberId);
  const isFriend = (memberId: string) => relationshipFor(memberId)?.status === 'accepted';
  const onlineMatchingCandidates = onlineUsers.filter((online) => {
    if (online.id === user?.id) return false;
    const relationship = relationshipFor(online.id);
    return !relationship || relationship.status === 'declined' || (relationship.status === 'pending' && relationship.addresseeId === user?.id);
  });
  const onlineCandidateIds = new Set(onlineMatchingCandidates.map((candidate) => candidate.id));
  const offlineIncomingCandidates = friendships.flatMap((connection) => {
    const id = connection.requesterId;
    const profile = incomingProfiles[id];
    if (connection.status !== 'pending' || connection.addresseeId !== user?.id || id === user?.id || onlineCandidateIds.has(id) || !profile?.isPublic) return [];
    return [{
      id,
      userId: id,
      name: profile.name,
      image: profile.image || profile.profilePhotos?.[0] || '',
      gender: profile.gender,
      age: profile.age,
      country: profile.country,
      lastSeenAt: connection.updatedAt || connection.createdAt,
    }];
  });
  const allMatchingCandidates = addMissingIncomingLikeCandidates(onlineMatchingCandidates, offlineIncomingCandidates);
  const matchingCandidates = prioritizeIncomingLikes(allMatchingCandidates, friendships, user?.id);
  const incomingLikeIds = user
    ? friendships.filter((connection) => connection.status === 'pending' && connection.addresseeId === user.id).map((connection) => connection.requesterId)
    : [];

  const openFriendChat = (memberId?: string) => {
    setMobileTab('chat');
    if (!user) return;
    window.dispatchEvent(new CustomEvent('gyopo-friends-open', { detail: memberId ? { friendId: memberId } : {} }));
  };

  const showMatchingTab = () => {
    setMobileTab('matching');
    window.dispatchEvent(new Event('gyopo-friends-close'));
  };

  const showChatTab = () => {
    setMobileTab('chat');
    if (user) window.dispatchEvent(new CustomEvent('gyopo-friends-open'));
  };

  const requestFriend = async (memberId: string): Promise<{ matched: boolean; ok: boolean }> => {
    if (!user) return { matched: false, ok: false };
    setFriendBusy(memberId);
    setFriendError('');
    try {
      const matched = await sendFriendRequest(memberId);
      const rows = await listFriendConnections(user.id).catch(() => []);
      setFriendships(rows);
      return { matched, ok: true };
    } catch (error) {
      setFriendError(error instanceof Error ? error.message : '친구 요청을 보내지 못했습니다. 다시 시도해주세요.');
      return { matched: false, ok: false };
    } finally {
      setFriendBusy('');
    }
  };

  const passFriend = async (memberId: string) => {
    const connection = relationshipFor(memberId);
    if (!user || connection?.status !== 'pending' || connection.addresseeId !== user.id) return true;
    setFriendBusy(connection.id);
    setFriendError('');
    try {
      await respondToFriendRequest(connection, 'declined');
      setFriendships((rows) => rows.map((row) => row.id === connection.id ? { ...row, status: 'declined' } : row));
      return true;
    } catch {
      setFriendError('요청을 정리하지 못했습니다. 잠시 후 다시 시도해주세요.');
      return false;
    } finally {
      setFriendBusy('');
    }
  };

  const acceptFriend = async (connection: FriendConnection) => {
    setFriendBusy(connection.id);
    setFriendError('');
    try {
      await respondToFriendRequest(connection, 'accepted');
      setFriendships((rows) => rows.map((row) => row.id === connection.id ? { ...row, status: 'accepted' } : row));
    } catch (error) {
      setFriendError(error instanceof Error ? error.message : '친구 요청을 수락하지 못했습니다.');
    } finally {
      setFriendBusy('');
    }
  };

  const showMember = async (online: OnlineUser) => {
    const requestId = ++selectionRequest.current;
    setSelectedMember({
      id: online.id,
      name: online.name,
      image: online.image,
      gender: online.gender,
      country: online.country,
      age: online.age,
    });
    setSharedOrders([]);
    setProfileLoading(true);
    const token = getSessionToken();
    const [profile, orders] = await Promise.all([
      getDocument<PublicProfile>('publicProfiles', online.id, token).catch(() => null),
      user && token ? listEscrowOrdersForMember(online.id, token).catch(() => []) : Promise.resolve([]),
    ]);
    if (selectionRequest.current !== requestId) return;
    if (profile) setSelectedMember(profile);
    setSharedOrders(orders);
    setProfileLoading(false);
  };

  const closeMember = () => {
    selectionRequest.current += 1;
    setSelectedMember(null);
    setSharedOrders([]);
    setProfileLoading(false);
  };

  const likeCandidate = (memberId: string) => requestFriend(memberId);
  const passCandidate = (memberId: string) => passFriend(memberId);

  return (
    <div className="category-page users-page min-h-[calc(100vh-64px)] bg-transparent px-4 py-8 md:py-12" data-mobile-tab={mobileTab}>
      <div className="users-mobile-bar">
        <Link href="/" className="users-mobile-action" aria-label="홈으로 돌아가기"><ArrowLeft size={19} aria-hidden="true" /></Link>
        <div className="users-mobile-copy"><span>MATCHING</span><strong>친구 매칭</strong></div>
      </div>
      <div className="category-shell mx-auto max-w-6xl">
        <header className="category-header">
          <div className="category-heading">
            <div className="mb-2 text-xs font-black uppercase tracking-[0.28em] text-indigo-500">MEMBER MATCHING</div>
            <h1 className="text-2xl font-black tracking-tight text-slate-950 md:text-3xl">친구 매칭</h1>
            <p className="mt-3 text-sm text-slate-500">관심이 맞는 회원과 서로 동의하면 연결됩니다.</p>
          </div>
        </header>

        {user && !canPhotoMatch(user.profilePhotos) && <p className="users-profile-photo-note mb-6 border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-bold text-indigo-800">친구 매칭을 이용하려면 공개 프로필 사진을 3장 이상 등록해주세요. <button type="button" className="underline" onClick={() => window.dispatchEvent(new Event('gyopo-profile-edit'))}>사진 올리기</button></p>}
        <FriendDiscoveryDeck viewerId={user?.id} canLike={canPhotoMatch(user?.profilePhotos)} candidates={matchingCandidates} incomingLikeIds={incomingLikeIds} busyId={friendBusy} error={friendError} onLike={likeCandidate} onPass={passCandidate} onProfile={showMember} onOpenChat={openFriendChat} />

        {user && <section className="mb-8 rounded-[2rem] border border-indigo-100 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><div className="text-xs font-black uppercase tracking-[0.2em] text-indigo-500">My network</div><h2 className="mt-1 text-xl font-black text-slate-950">친구 목록</h2><p className="mt-1 text-xs text-slate-500">친구를 선택해 바로 영상 통화를 시작하세요.</p></div><span className="shrink-0 rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-black text-indigo-700">{friendships.filter((item) => item.status === 'accepted').length}명 친구</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{friendships.length === 0 ? <div className="col-span-full rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-sm font-bold text-slate-500">아직 친구가 없습니다. 아래 회원 목록에서 친구 추가를 눌러보세요.</div> : friendships.map((connection) => { const memberId = connection.requesterId === user.id ? connection.addresseeId : connection.requesterId; const online = onlineUsers.find((item) => item.id === memberId); const profile = friendProfiles[memberId]; const name = online?.name || profile?.name || '친구 회원'; const image = online?.image || profile?.image; const incoming = connection.addresseeId === user.id && connection.status === 'pending'; return <div key={connection.id} className="flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3"><div className="relative shrink-0">{image ? <img src={image} alt="" className="h-11 w-11 rounded-2xl object-cover" /> : <div className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-100 text-sm font-black text-indigo-700">{name.slice(0, 1)}</div>}{online && <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-black text-slate-900">{name}</div><div className="truncate text-[11px] text-slate-400">{online?.country || profile?.country || (online ? '온라인' : '오프라인')}</div></div>{connection.status === 'accepted' ? <Link href={`/webrtc?friend=${encodeURIComponent(memberId)}`} className="shrink-0 rounded-xl bg-indigo-600 px-2.5 py-2 text-[11px] font-black text-white">영상통화</Link> : incoming ? <button type="button" disabled={friendBusy === connection.id} onClick={() => void acceptFriend(connection)} className="shrink-0 rounded-xl bg-emerald-500 px-2.5 py-2 text-[11px] font-black text-slate-950 disabled:opacity-50">수락</button> : <span className="shrink-0 text-[10px] font-bold text-slate-400">대기 중</span>}</div>; })}</div></section>}

        <details className="mt-8 rounded-[1.5rem] border border-white/10 bg-white/[.025]">
          <summary className="cursor-pointer px-5 py-4 text-sm font-black text-slate-200">온라인 회원 전체 목록 <span className="ml-1 text-xs text-slate-500">{onlineUsers.length}명</span></summary>
        {onlineUsers.length === 0 ? (
          <div className="rounded-[2rem] border border-dashed border-slate-300 bg-white p-20 text-center shadow-sm">
            <UsersIcon className="mx-auto mb-4 text-slate-300" size={38} />
            <h2 className="font-black text-slate-700">현재 접속 중인 회원이 없습니다.</h2>
            <p className="mt-2 text-sm text-slate-400">다른 회원이 로그인하면 이곳에 표시됩니다.</p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {onlineUsers.map((online) => (
              <article key={online.id} className="group overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
                 <div role="button" tabIndex={0} onClick={() => void showMember(online)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') void showMember(online); }} className="block w-full text-left">
                  <div className="h-24 bg-[linear-gradient(135deg,#111827,#334155,#4f46e5)]" />
                  <div className="relative px-5 pb-5">
                    <img src={online.image} alt="" className="-mt-10 h-20 w-20 rounded-3xl border-4 border-white object-cover shadow-lg" />
                    <h2 className="mt-4 text-xl font-black text-slate-950">{online.name}</h2>
                    <div className="mt-2 flex items-center gap-1 text-xs font-bold text-emerald-600"><span className="h-2 w-2 rounded-full bg-emerald-500" /> 지금 접속 중</div>
                     <div className="mt-4 flex items-center gap-1 text-sm text-slate-500"><MapPin size={14} /> {online.country || '국가 미설정'}</div>
                     {online.age ? <p className="mt-2 text-xs text-slate-400">{online.age}세 · {online.gender === 'male' ? '남성' : online.gender === 'female' ? '여성' : '성별 미설정'}</p> : <p className="mt-2 text-xs text-slate-400">{online.gender === 'male' ? '남성' : online.gender === 'female' ? '여성' : '성별 미설정'}</p>}
                     {user && online.id !== user.id && <div className="mt-4 flex gap-2" onClick={(event) => event.stopPropagation()}>
                        {isFriend(online.id) ? <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('gyopo-friends-open', { detail: { friendId: online.id } }))} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-black text-white hover:bg-indigo-500"><Video size={14} /> 친구 통화</button> : relationshipFor(online.id)?.status === 'pending' && relationshipFor(online.id)?.addresseeId === user.id ? <button type="button" disabled={friendBusy === relationshipFor(online.id)?.id || !canPhotoMatch(user.profilePhotos) || !canPhotoMatch(friendProfiles[online.id]?.profilePhotos)} onClick={() => { const relation = relationshipFor(online.id); if (relation) void acceptFriend(relation); }} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2.5 text-xs font-black text-slate-950 disabled:opacity-50">친구 수락</button> : <button type="button" disabled={relationshipFor(online.id)?.status === 'pending' || friendBusy === online.id || !canPhotoMatch(user.profilePhotos)} onClick={() => void requestFriend(online.id)} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-xs font-black text-indigo-700 disabled:opacity-50"><UserPlus size={14} /> {relationshipFor(online.id)?.status === 'pending' ? '요청 보냄' : relationshipFor(online.id)?.status === 'declined' ? '다시 요청' : '친구 추가'}</button>}
                     </div>}
                   </div>
                 </div>
              </article>
            ))}
          </div>
        )}
        </details>
      </div>

      {mobileTab === 'chat' && !user && <section className="users-chat-guest" role="tabpanel" aria-label="친구 채팅 로그인"><div><MessageCircle size={34} className="mx-auto text-cyan-200" /><h2>친구 채팅은 로그인 후 이용할 수 있어요.</h2><p>로그인 후 서로 좋아요를 보내 매칭되면 여기서 대화를 나눌 수 있습니다.</p><Link href="/login">로그인하기</Link><button type="button" onClick={showMatchingTab}>매칭 계속하기</button></div></section>}

      {selectedMember && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/75 p-4" onMouseDown={(event) => event.target === event.currentTarget && closeMember()}>
          <section role="dialog" aria-modal="true" aria-label={`${selectedMember.name} 공개 프로필`} className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-[2rem] bg-white p-6 text-slate-900 shadow-2xl md:p-8">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-4">
                {selectedMember.image ? <img src={selectedMember.image} alt="" className="h-20 w-20 rounded-3xl object-cover shadow-md" /> : <div className="grid h-20 w-20 place-items-center rounded-3xl bg-indigo-100 text-lg font-black text-indigo-700">{selectedMember.id.slice(-3)}</div>}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-indigo-500"><ShieldCheck size={15} /> Public profile</div>
                  <h2 className="mt-2 truncate text-3xl font-black">{selectedMember.name}</h2>
                </div>
              </div>
              <button type="button" onClick={closeMember} aria-label="닫기" className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200"><X size={19} /></button>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl bg-slate-50 p-4"><span className="block text-xs font-bold text-slate-400">국가/지역</span><b className="mt-1 block">{selectedMember.country || '공개 정보 없음'}</b></div>
              <div className="rounded-2xl bg-slate-50 p-4"><span className="block text-xs font-bold text-slate-400">프로필</span><b className="mt-1 block">{selectedMember.gender === 'male' ? '남성' : selectedMember.gender === 'female' ? '여성' : '공개 정보 없음'}{selectedMember.age ? ` · ${selectedMember.age}세` : ''}</b></div>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between gap-3"><h3 className="font-black">공개 사진</h3><span className="text-xs font-bold text-slate-400">{normalizeProfilePhotos(selectedMember.profilePhotos).length}장</span></div>
              {normalizeProfilePhotos(selectedMember.profilePhotos).length > 0 ? <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{normalizeProfilePhotos(selectedMember.profilePhotos).map((photo, index) => <img key={`${photo}-${index}`} src={photo} alt={`${selectedMember.name} 공개 사진 ${index + 1}`} loading="lazy" className="aspect-square w-full rounded-xl object-cover" />)}</div> : <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">아직 공개 사진이 없습니다.</p>}
            </div>

            <div className="mt-7 border-t border-slate-200 pt-6">
              <div className="flex items-center gap-2"><PackageCheck className="text-emerald-600" size={20} /><h3 className="font-black">{selectedMember.id === user?.id ? '내 에스크로 상태' : '나와의 에스크로 상태'}</h3></div>
              <p className="mt-2 text-xs leading-5 text-slate-500">구매·배송 상태는 거래 당사자에게만 표시되며 금액과 비공개 정보는 공개하지 않습니다.</p>
              {profileLoading ? (
                <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm font-bold text-slate-500">안전하게 정보를 확인하고 있습니다...</p>
              ) : !user ? (
                <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm font-bold text-slate-500">로그인하면 이 회원과 직접 진행한 거래 상태만 확인할 수 있습니다.</p>
              ) : sharedOrders.length === 0 ? (
                <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm font-bold text-slate-500">표시할 공동 거래가 없습니다.</p>
              ) : (
                <div className="mt-4 space-y-2">
                  {sharedOrders.map((order) => (
                    <div key={order.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-4 text-sm">
                      <div><b>{order.buyerId === user.id ? '구매' : '판매'}</b><div className="mt-1 text-xs text-slate-400">{new Date(order.updatedAt || order.createdAt).toLocaleDateString('ko-KR')}</div></div>
                      <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">{STATUS_LABELS[order.status] || order.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
      {!selectedMember && <nav className="users-mobile-tabs" aria-label="친구 매칭 탭" role="tablist">
        <button type="button" role="tab" aria-selected={mobileTab === 'matching'} onClick={showMatchingTab} className={mobileTab === 'matching' ? 'is-active' : ''}><Heart size={18} aria-hidden="true" /><span>매칭</span></button>
        <button type="button" role="tab" aria-selected={mobileTab === 'chat'} onClick={showChatTab} className={mobileTab === 'chat' ? 'is-active' : ''}><MessageCircle size={18} aria-hidden="true" /><span>채팅</span></button>
      </nav>}
    </div>
  );
}
