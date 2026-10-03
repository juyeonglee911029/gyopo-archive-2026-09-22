'use client';

import { type ChangeEvent, type FormEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, FileText, MessageCircle, Paperclip, PhoneCall, Send, UserPlus, UserRoundCheck, X } from 'lucide-react';
import { createDocument, createFriendCallRequest, getDocument, getFriendCallRequest, getFreshSessionToken, listFriendConnections, listFriendMessages, listIncomingFriendCallRequests, listOnlineUsers, respondToFriendCallRequest, type FriendCallRequest, type PublicProfile } from '@/lib/firebase';
import { useGlobalStore } from '@/store/useGlobalStore';

type FriendMember = Partial<PublicProfile> & { id: string; friendshipId: string };
type DockAnchor = { left: number; top: number; bottom: number };
type FriendMessage = {
  id: string;
  friendshipId: string;
  participants: string[];
  authorId: string;
  user: string;
  text: string;
  attachmentData?: string;
  attachmentName?: string;
  attachmentType?: string;
  createdAt: string;
};

type FriendAttachment = {
  data: string;
  name: string;
  type: string;
  size: number;
};

function formatFriendMessageTime(value: string, language: 'ko' | 'en') {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(language === 'ko' ? 'ko-KR' : 'en-US', { hour: '2-digit', minute: '2-digit' });
}

export default function FriendDock() {
  const user = useGlobalStore((state) => state.user);
  const language = useGlobalStore((state) => state.language);
  const isKorean = language === 'ko';
  const t = useCallback((korean: string, english: string) => isKorean ? korean : english, [isKorean]);
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState<FriendMember[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [onlineFriendIds, setOnlineFriendIds] = useState<Set<string> | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [videoCall, setVideoCall] = useState<{ id: string; friendId: string } | null>(null);
  const [videoClosing, setVideoClosing] = useState(false);
  const [messages, setMessages] = useState<FriendMessage[]>([]);
  const [input, setInput] = useState('');
  const [attachment, setAttachment] = useState<FriendAttachment | null>(null);
  const [error, setError] = useState('');
  const [messageError, setMessageError] = useState('');
  const [messageReadError, setMessageReadError] = useState('');
  const [messageNotice, setMessageNotice] = useState<{ user: string } | null>(null);
  const [sending, setSending] = useState(false);
  const sendBusyRef = useRef(false);
  const messageContextRef = useRef('');
  const [incomingCalls, setIncomingCalls] = useState<FriendCallRequest[]>([]);
  const [pendingCall, setPendingCall] = useState<{ id: string; friendId: string; expiresAt: string } | null>(null);
  const [dockPosition, setDockPosition] = useState<{ left: number; top: number } | null>(null);
  const dockAnchorRef = useRef<DockAnchor | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ offsetX: number; offsetY: number; width: number; height: number } | null>(null);
  const callFrameRef = useRef<HTMLIFrameElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const latestMessageIdRef = useRef('');
  const callOperationRef = useRef(0);
  const callBusyRef = useRef(false);
  const closingRef = useRef(false);
  const friendOwnerIdRef = useRef('');

  const closeDock = useCallback(() => {
    setOpen(false);
    if (window.matchMedia('(max-width: 768px)').matches) window.dispatchEvent(new Event('gyopo-mobile-friends-closed'));
  }, []);

  const closeVideoCall = useCallback(() => {
    if (!videoCall || closingRef.current) return;
    closingRef.current = true;
    callOperationRef.current += 1;
    callFrameRef.current?.contentWindow?.postMessage({ type: 'gyopo-call-end', callKind: 'friend', callId: videoCall.id }, window.location.origin);
    setVideoClosing(true);
    closeDock();
  }, [closeDock, videoCall]);

  useEffect(() => {
    if (!videoCall) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== callFrameRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || data.type !== 'gyopo-call-ended' || data.callKind !== 'friend' || data.callId !== videoCall.id) return;
      closeVideoCall();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [closeVideoCall, videoCall?.id]);

  useEffect(() => {
    if (!videoClosing) return;
    const timer = window.setTimeout(() => {
      setVideoCall(null);
      setVideoClosing(false);
      closingRef.current = false;
      setError('');
    }, 260);
    return () => window.clearTimeout(timer);
  }, [videoClosing]);

  useEffect(() => () => { callOperationRef.current += 1; }, [user?.id]);

  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<{ friendId?: string; anchor?: DockAnchor }>).detail;
      if (detail?.friendId) setSelectedId(detail.friendId);
      if (detail?.anchor && window.matchMedia('(min-width: 769px)').matches) {
        dockAnchorRef.current = detail.anchor;
        const panel = document.getElementById('friend-dock')?.getBoundingClientRect();
        const height = panel?.height || 360;
        const below = detail.anchor.bottom + 8;
        setDockPosition({
          left: 16,
          top: height <= window.innerHeight - below - 8
            ? below
            : Math.max(8, Math.min(window.innerHeight - height - 8, detail.anchor.top - height - 8)),
        });
      } else {
        dockAnchorRef.current = null;
        setDockPosition(null);
      }
      setOpen(true);
      if (window.matchMedia('(max-width: 768px)').matches) window.dispatchEvent(new Event('gyopo-mobile-friends-opened'));
    };
    const hide = () => closeDock();
    window.addEventListener('gyopo-friends-open', show);
    window.addEventListener('gyopo-friends-close', hide);
    return () => {
      window.removeEventListener('gyopo-friends-open', show);
      window.removeEventListener('gyopo-friends-close', hide);
    };
  }, [closeDock]);

  useEffect(() => {
    if (!open) return;
    const panel = document.getElementById('friend-dock');
    if (!panel) return;
    const updatePosition = () => {
      if (!window.matchMedia('(min-width: 769px)').matches) {
        dockAnchorRef.current = null;
        setDockPosition(null);
        return;
      }
      const rect = panel.getBoundingClientRect();
      setDockPosition((current) => {
        if (!current) return current;
        const anchor = dockAnchorRef.current;
        const left = anchor ? 16 : Math.max(8, Math.min(window.innerWidth - rect.width - 8, current.left));
        const top = anchor
          ? rect.height <= window.innerHeight - anchor.bottom - 16
            ? anchor.bottom + 8
            : Math.max(8, Math.min(window.innerHeight - rect.height - 8, anchor.top - rect.height - 8))
          : Math.max(8, Math.min(window.innerHeight - rect.height - 8, current.top));
        return left === current.left && top === current.top ? current : { left, top };
      });
    };
    const observer = new ResizeObserver(updatePosition);
    observer.observe(panel);
    window.addEventListener('resize', updatePosition);
    updatePosition();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDock();
    };
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      const panel = document.getElementById('friend-dock');
      if (panel?.contains(target)) return;
      closeDock();
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsideClick);
    };
  }, [closeDock, open]);

  useEffect(() => {
    if (!user) {
      friendOwnerIdRef.current = '';
      setFriends([]);
      setSelectedId('');
      setVideoCall(null);
      setPendingCall(null);
      setOnlineFriendIds(null);
      setFriendsLoading(false);
      return;
    }
    if (friendOwnerIdRef.current !== user.id) {
      friendOwnerIdRef.current = user.id;
      setFriends([]);
      setSelectedId('');
      setOnlineFriendIds(null);
    }
    if (!open) return;
    let active = true;
    let loading = false;
    setFriendsLoading(true);
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const token = await getFreshSessionToken();
        if (!token) {
           if (active) setMessageError(t('다시 로그인해주세요.', 'Please log in again.'));
          return;
        }
        const [connections, onlineUsers] = await Promise.all([
          listFriendConnections(user.id, token).catch(() => []),
          listOnlineUsers().catch(() => null),
        ]);
        const accepted = connections.filter((item) => item.status === 'accepted');
        const rows = await Promise.all(accepted.map(async (connection) => {
          const id = connection.requesterId === user.id ? connection.addresseeId : connection.requesterId;
          const profile = await getDocument<PublicProfile>('publicProfiles', id, token).catch(() => null);
          return { id, friendshipId: connection.id, ...(profile || {}) } as FriendMember;
        }));
        if (!active) return;
        setFriends(rows);
        if (onlineUsers !== null) setOnlineFriendIds(new Set(onlineUsers.map((online) => online.id)));
        setSelectedId((current) => rows.some((friend) => friend.id === current) ? current : rows[0]?.id || '');
      } catch (loadError) {
        if (active) setMessageError(loadError instanceof Error ? loadError.message : t('친구 목록을 불러오지 못했습니다.', 'Could not load your friends.'));
      } finally {
        loading = false;
        if (active) setFriendsLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(load, 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [open, t, user?.id]);

  useEffect(() => {
    if (!user || !pendingCall) return;
    let active = true;
    const check = async () => {
      if (Date.now() >= new Date(pendingCall.expiresAt).getTime()) {
        if (active) {
          setPendingCall(null);
           setError(t('통화 요청이 1분 동안 응답이 없어 자동 종료되었습니다.', 'The call request expired after one minute without a response.'));
        }
        return;
      }
      const request = await getFriendCallRequest(pendingCall.id, await getFreshSessionToken()).catch(() => null);
      if (!active || !request) return;
      if (request.status === 'accepted') {
        active = false;
        setPendingCall(null);
        setSelectedId(pendingCall.friendId);
        setVideoCall({ id: pendingCall.id, friendId: pendingCall.friendId });
        setOpen(true);
         setError(t('통화가 수락되었습니다. 연결 중입니다.', 'Call accepted. Connecting...'));
      } else if (request.status === 'declined' || request.status === 'expired') {
        setPendingCall(null);
         setError(t('친구가 통화를 받지 않아 종료되었습니다.', 'Your friend did not answer the call.'));
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [pendingCall?.id, t, user?.id]);

  useEffect(() => {
    if (!user) {
      setIncomingCalls([]);
      return;
    }
    let active = true;
    const load = async () => {
       const requests = await listIncomingFriendCallRequests(user.id, await getFreshSessionToken()).catch(() => []);
      if (active) {
        setIncomingCalls(requests);
        if (requests.length > 0) setOpen(true);
      }
    };
    void load();
    const timer = window.setInterval(load, 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [user?.id]);

  const selected = friends.find((friend) => friend.id === selectedId) || null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    setError('');
    setMessageError('');
    setMessageReadError('');
  }, [selected?.friendshipId]);

  const handleAttachment = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 700 * 1024) {
      setError(t('첨부파일은 700KB 이하만 보낼 수 있습니다.', 'Attachments must be 700 KB or smaller.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAttachment({ data: String(reader.result || ''), name: file.name, type: file.type || 'application/octet-stream', size: file.size });
      setError('');
    };
    reader.onerror = () => setError(t('파일을 읽지 못했습니다. 다시 선택해주세요.', 'Could not read the file. Please choose it again.'));
    reader.readAsDataURL(file);
  };

  const startDockDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button, a')) return;
    const panel = document.getElementById('friend-dock');
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dockAnchorRef.current = null;
    setDockPosition((current) => current || { left: rect.left, top: rect.top });
    dragRef.current = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, width: rect.width, height: rect.height };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDock = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setDockPosition({
      left: Math.max(8, Math.min(window.innerWidth - drag.width - 8, event.clientX - drag.offsetX)),
      top: Math.max(8, Math.min(window.innerHeight - drag.height - 8, event.clientY - drag.offsetY)),
    });
  };

  const stopDockDrag = (event: ReactPointerEvent<HTMLElement>) => {
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  useEffect(() => {
    messageContextRef.current = `${user?.id || ''}:${selected?.friendshipId || ''}`;
    latestMessageIdRef.current = '';
    setMessages([]);
    setMessageNotice(null);
  }, [selected?.friendshipId, user?.id]);

  useEffect(() => {
    if (!user || !selected) return;
    let active = true;
    let loading = false;
    let timer: number | undefined;
    const load = async () => {
      if (loading || !active || document.hidden) return;
      loading = true;
      try {
        const rows = await listFriendMessages<Omit<FriendMessage, 'id'>>(user.id, selected.friendshipId);
        if (active) {
          const sorted = rows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
          const latest = sorted.at(-1);
          const previousLatestId = latestMessageIdRef.current;
          if (latest && latest.id !== previousLatestId) {
            latestMessageIdRef.current = latest.id;
            if (previousLatestId && latest.authorId !== user.id) {
              setSelectedId(selected.id);
              setOpen(true);
               setMessageNotice({ user: latest.user });
               window.setTimeout(() => setMessageNotice(null), 4_000);
            }
          }
          setMessages(sorted);
          setMessageReadError('');
        }
      } catch (error) {
        if (active) setMessageReadError(error instanceof Error ? error.message : t('메시지를 불러오지 못했습니다.', 'Could not load messages.'));
      } finally {
        loading = false;
      }
    };
    const updateVisibility = () => {
      window.clearInterval(timer);
      timer = undefined;
      if (document.hidden) return;
      void load();
      timer = window.setInterval(load, 1_500);
    };
    document.addEventListener('visibilitychange', updateVisibility);
    updateVisibility();
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, [open, selected?.friendshipId, t, user?.id]);

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !selected || sendBusyRef.current || (!input.trim() && !attachment)) return;
    sendBusyRef.current = true;
    setSending(true);
    const context = `${user.id}:${selected.friendshipId}`;
    const draft = input;
    const sentAttachment = attachment;
    const message = {
      friendshipId: selected.friendshipId,
      participants: [user.id, selected.id].sort(),
      authorId: user.id,
      user: user.name,
      text: input.trim(),
      attachmentData: attachment?.data,
      attachmentName: attachment?.name,
      attachmentType: attachment?.type,
      createdAt: new Date().toISOString(),
    };
    try {
      const token = await getFreshSessionToken();
      if (!token) throw new Error(t('다시 로그인해주세요.', 'Please log in again.'));
      const id = crypto.randomUUID();
      await createDocument('friendMessages', id, message, token);
      if (messageContextRef.current !== context) return;
      setMessages((rows) => [...rows.filter((row) => row.id !== id), { id, ...message }]);
      setInput((current) => current === draft ? '' : current);
      setAttachment((current) => current === sentAttachment ? null : current);
      setMessageError('');
    } catch (error) {
      if (messageContextRef.current === context) setMessageError(error instanceof Error ? error.message : t('메시지를 보내지 못했습니다. 다시 시도해주세요.', 'Could not send the message. Please try again.'));
    } finally {
      sendBusyRef.current = false;
      setSending(false);
    }
  };

  const requestVideoCall = async (friendId: string) => {
    if (!user) return;
    if (pendingCall || videoCall || callBusyRef.current) return;
    callBusyRef.current = true;
    const operation = ++callOperationRef.current;
    setError(t('친구의 통화 수락을 기다리는 중입니다. (최대 1분)', 'Waiting for your friend to accept (up to 1 minute).'));
    try {
       const token = await getFreshSessionToken();
       if (!token) throw new Error(t('로그인 세션이 만료되었습니다. 다시 로그인해주세요.', 'Your session expired. Please log in again.'));
       const requestId = await createFriendCallRequest(friendId, user, token);
      if (operation !== callOperationRef.current) return;
      setPendingCall({ id: requestId, friendId, expiresAt: new Date(Date.now() + 60_000).toISOString() });
       setError(t('통화 요청을 보냈습니다. 친구가 수락하면 바로 연결됩니다.', 'Call request sent. You will connect when your friend accepts.'));
    } catch (error) {
      if (operation !== callOperationRef.current) return;
      setPendingCall(null);
       setError(error instanceof Error ? error.message : t('통화 요청을 보내지 못했습니다. 다시 시도해주세요.', 'Could not send the call request. Please try again.'));
    } finally {
      callBusyRef.current = false;
    }
  };

  const answerVideoCall = async (request: FriendCallRequest, status: 'accepted' | 'declined') => {
    if (callBusyRef.current || videoCall || pendingCall) return;
    callBusyRef.current = true;
    const operation = ++callOperationRef.current;
    try {
       const token = await getFreshSessionToken();
       if (!token) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
       await respondToFriendCallRequest(request, status, token);
      if (operation !== callOperationRef.current) return;
      setIncomingCalls((rows) => rows.filter((row) => row.id !== request.id));
      if (status === 'accepted') {
        setSelectedId(request.callerId);
        setOpen(true);
        setVideoCall({ id: request.id, friendId: request.callerId });
         setError(t('통화를 연결하는 중입니다.', 'Connecting the call...'));
      }
    } catch {
      if (operation !== callOperationRef.current) return;
       setError(t('통화 요청을 처리하지 못했습니다. 다시 시도해주세요.', 'Could not process the call request. Please try again.'));
    } finally {
      callBusyRef.current = false;
    }
  };

  if (!user) return null;

  return (
    <>
          <aside id="friend-dock" style={{ ...(dockPosition ? { left: dockPosition.left, top: dockPosition.top, right: 'auto', bottom: 'auto' } : {}), maxHeight: 'calc(100dvh - 16px)' }} className={`gyopo-friend-dock fixed bottom-4 left-3 right-3 z-[70] overflow-x-hidden overflow-y-auto rounded-none border-0 bg-[#091120] text-white shadow-[0_25px_100px_rgba(0,0,0,.7)] transition ${dragging ? 'cursor-grabbing select-none transition-none' : 'cursor-default'} lg:left-4 lg:right-auto lg:w-[480px] ${videoCall ? 'friend-dock-call-active' : ''} ${videoClosing ? 'friend-dock-call-closing' : ''} ${open ? 'visible translate-y-0 opacity-100' : videoClosing ? 'visible translate-y-5 opacity-0' : 'invisible translate-y-5 opacity-0'}`}>
            <header onPointerDown={startDockDrag} onPointerMove={moveDock} onPointerUp={stopDockDrag} onPointerCancel={stopDockDrag} className={`flex items-center justify-between gap-2 border-0 px-4 py-3 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}>
              <div className="flex min-w-0 items-center gap-2 text-sm font-black"><UserRoundCheck size={17} className="shrink-0 text-cyan-300" /> <span className="truncate">{isKorean ? '친구 채팅·통화' : 'Friends Chat & Call'}</span></div>
              <div className="flex shrink-0 items-center gap-1">
                <Link href="/users" onPointerDown={(event) => event.stopPropagation()} className="inline-flex items-center gap-1.5 border-0 px-2 py-1.5 text-[10px] font-black text-cyan-200 hover:bg-white/10"><UserPlus size={14} />{isKorean ? '친구 찾기' : 'Find friends'}</Link>
                <button type="button" onClick={() => videoCall ? closeVideoCall() : closeDock()} aria-label={isKorean ? '친구 패널 닫기' : 'Close friends panel'} className="border-0 p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"><X size={17} /></button>
              </div>
            </header>
            {messageNotice && <p role="status" className="mx-3 mb-2 bg-emerald-300/10 px-3 py-2 text-[11px] font-bold text-emerald-100">{messageNotice.user}: {t('새 메시지', 'New message')}</p>}
           {(messageError || messageReadError) && <p role="alert" className="px-3 py-2 text-xs font-bold text-rose-300">{messageError || messageReadError}</p>}

          {incomingCalls.length > 0 && <div className="mx-3 mt-3 border-0 bg-emerald-300/[.08] p-3"><div className="flex items-center gap-2 text-xs font-black text-emerald-100"><PhoneCall size={14} /> {isKorean ? '영상 통화 요청' : 'Incoming call'}</div>{incomingCalls.map((request) => <div key={request.id} className="mt-3 flex items-center gap-2"><img src={request.callerImage} alt="" className="h-8 w-8 rounded-lg object-cover" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-black text-white">{request.callerName}</p><p className="text-[10px] text-emerald-100/65">{isKorean ? '친구가 영상 통화를 요청했습니다.' : 'Your friend requested a video call.'}</p></div><button type="button" onClick={() => void answerVideoCall(request, 'accepted')} aria-label={isKorean ? '통화 수락' : 'Accept call'} className="border-0 bg-emerald-300 p-2 text-slate-950"><Check size={14} /></button><button type="button" onClick={() => void answerVideoCall(request, 'declined')} aria-label={isKorean ? '통화 거절' : 'Decline call'} className="border-0 bg-white/10 p-2 text-slate-300"><X size={14} /></button></div>)}</div>}

          {videoCall && <div className="friend-call-video relative mx-3 mb-3 overflow-hidden bg-black"><iframe ref={callFrameRef} key={videoCall.id} title={t('친구 영상 통화', 'Friend video call')} src={`/webrtc?friend=${encodeURIComponent(videoCall.friendId)}&compact=1&callKind=friend&callId=${encodeURIComponent(videoCall.id)}&auto=1&videoOnly=0`} allow="camera; microphone; display-capture; fullscreen; autoplay" allowFullScreen className="h-full w-full border-0" /></div>}

          {friendsLoading && friends.length === 0 ? (
            <div className="px-6 py-5 text-center text-xs font-bold text-slate-400">{isKorean ? '친구 목록을 불러오는 중입니다...' : 'Loading friends...'}</div>
          ) : friends.length === 0 ? (
              <div className="p-8 text-center"><UserRoundCheck size={28} className="mx-auto text-slate-600" /><p className="mt-3 text-sm font-bold text-slate-300">{isKorean ? '아직 매칭된 친구가 없습니다.' : 'No matches yet.'}</p><p className="mt-1 text-xs text-slate-500">{isKorean ? '받은 좋아요는 매칭 카드에 먼저 표시됩니다. 서로 좋아요를 보내면 대화할 수 있어요.' : 'Incoming likes appear first in matching. Like each other to start chatting.'}</p><Link href="/users" className="mt-4 inline-flex items-center gap-2 border border-cyan-200/25 bg-cyan-300/10 px-4 py-2.5 text-xs font-black text-cyan-100 transition hover:bg-cyan-300/20"><UserPlus size={14} />{isKorean ? '매칭 카드 보기' : 'Open matching'}</Link></div>
          ) : (
            <>
              <div className="border-y border-white/10 px-3 py-2 text-[10px] font-black text-slate-400">
                <span>{isKorean ? '친구 목록' : 'Friends'}</span>
              </div>
              <div className="friend-list max-h-40 space-y-1 overflow-y-auto px-2.5 py-2">
                {friends.map((friend) => {
                  const online = onlineFriendIds?.has(friend.id) || false;
                  const statusLabel = onlineFriendIds === null
                    ? (isKorean ? '상태 확인 중' : 'Checking status')
                    : online ? (isKorean ? '온라인' : 'Online') : (isKorean ? '오프라인' : 'Offline');
                  return <div key={friend.id} className="friend-row" data-selected={friend.id === selectedId} role="group" aria-label={`${friend.name || (isKorean ? '친구' : 'Friend')}: ${statusLabel}`}>
                    <button type="button" aria-pressed={friend.id === selectedId} aria-label={`${friend.name || (isKorean ? '친구' : 'Friend')} ${isKorean ? '채팅 선택' : 'select chat'}`} onClick={() => setSelectedId(friend.id)} className="friend-row-select">
                      {friend.image ? <img src={friend.image} alt="" /> : <span className="friend-row-avatar">{friend.name?.slice(0, 1) || '?'}</span>}
                      <span className="friend-row-copy">
                        <span className="friend-row-name">{friend.name || (isKorean ? '친구' : 'Friend')}</span>
                        <span className={`friend-row-status ${onlineFriendIds === null ? 'is-unknown' : online ? 'is-online' : ''}`}>
                          <span aria-hidden="true" />
                          {statusLabel}
                        </span>
                      </span>
                    </button>
                    <span className="friend-row-actions">
                      <button type="button" onClick={() => setSelectedId(friend.id)} aria-label={`${friend.name || (isKorean ? '친구' : 'Friend')} ${isKorean ? '채팅 열기' : 'open chat'}`} title={isKorean ? '채팅 열기' : 'Open chat'} className="friend-row-action"><MessageCircle size={15} /></button>
                      <button type="button" onClick={() => { setSelectedId(friend.id); void requestVideoCall(friend.id); }} disabled={Boolean(pendingCall || videoCall)} aria-label={`${friend.name || (isKorean ? '친구' : 'Friend')} ${isKorean ? '통화 요청' : 'call'}`} title={isKorean ? '통화 요청' : 'Call'} className="friend-row-action"><PhoneCall size={15} /></button>
                    </span>
                  </div>;
                })}
              </div>

            {selected && <div className="p-3">
                {!videoCall && pendingCall?.friendId === selected.id && (
                  <div className="mb-3 flex min-h-12 items-center gap-2 bg-amber-300/[.08] px-3 py-2 text-xs font-bold text-amber-100"><PhoneCall size={15} className="shrink-0" /><span>{t('친구의 통화 수락을 기다리는 중입니다. 1분 후 자동 종료됩니다.', 'Waiting for your friend to accept. The request ends after 1 minute.')}</span></div>
                )}

                <div className="mb-2 flex items-center justify-between text-[10px] font-black uppercase tracking-[.16em] text-slate-500"><span className="flex items-center gap-1.5"><MessageCircle size={13} /> {isKorean ? '친구 채팅' : 'Friend chat'}</span></div>
                   <div className="friend-chat-thread h-48 space-y-1 overflow-y-auto p-3">
                     {messages.length === 0 ? <p className="py-10 text-center text-xs text-slate-600">{t('첫 메시지를 보내보세요.', 'Start the conversation.')}</p> : messages.map((message) => (
                      <div key={message.id} className={`friend-message-bubble px-2 py-1.5 text-xs ${message.authorId === user.id ? 'is-own text-emerald-100' : 'is-other text-amber-100'}`}>
                        <div className="friend-message-line">
                          <span className="friend-message-author" title={message.authorId}>{message.user || message.authorId}:</span>
                          {message.text && <span className="friend-message-text">{message.text}</span>}
                           <time className="friend-message-time" dateTime={message.createdAt}>{formatFriendMessageTime(message.createdAt, language)}</time>
                        </div>
                        {message.attachmentData && (message.attachmentType?.startsWith('image/') ? <a href={message.attachmentData} target="_blank" rel="noreferrer" className="mt-1 block overflow-hidden"><img src={message.attachmentData} alt={message.attachmentName || t('첨부 사진', 'Attached photo')} loading="lazy" className="max-h-28 w-full object-contain" /></a> : <a href={message.attachmentData} download={message.attachmentName} className="mt-1 flex items-center gap-1.5 px-2 py-1.5 text-[10px] underline"><FileText size={13} /> <span className="truncate">{message.attachmentName || t('첨부파일', 'Attachment')}</span></a>)}
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
               {error && <p role="alert" className="mt-2 text-xs font-bold text-rose-300">{error}</p>}
                <form onSubmit={sendMessage} aria-busy={sending} className="mt-2 space-y-2">
                  {attachment && <div className="flex items-center gap-2 bg-white/[.08] px-2 py-1.5 text-[10px] text-slate-200"><span className="grid h-7 w-7 shrink-0 place-items-center bg-black/20">{attachment.type.startsWith('image/') ? <img src={attachment.data} alt={t('첨부 미리보기', 'Attachment preview')} className="h-full w-full object-cover" /> : <FileText size={14} />}</span><span className="min-w-0 flex-1 truncate">{attachment.name}</span><button type="button" onClick={() => setAttachment(null)} aria-label={t('첨부파일 취소', 'Remove attachment')} className="p-1 text-slate-400 hover:text-white"><X size={13} /></button></div>}
                  <div className="flex gap-2"><input value={input} onChange={(event) => setInput(event.target.value)} placeholder={t('친구에게 메시지...', 'Message your friend...')} className="min-w-0 flex-1 border-0 bg-white/[.08] px-3 py-2 text-xs text-white outline-none" /><input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.zip" onChange={handleAttachment} aria-label={t('친구 채팅 첨부파일', 'Attach a file to friend chat')} className="hidden" /><button type="button" onClick={() => fileInputRef.current?.click()} aria-label={t('사진 또는 파일 첨부', 'Attach photo or file')} title={t('사진 또는 파일 첨부', 'Attach photo or file')} className="border-0 bg-white/[.08] px-2.5 text-slate-300 hover:bg-white/[.14]"><Paperclip size={15} /></button><button aria-label={t('친구 메시지 보내기', 'Send friend message')} className="border-0 bg-cyan-300 px-3 text-slate-950"><Send size={15} /></button></div>
               </form>
            </div>}
          </>
        )}
      </aside>
    </>
  );
}
