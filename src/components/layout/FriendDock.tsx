'use client';

import { type ChangeEvent, type FormEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { Check, FileText, MessageCircle, Paperclip, PhoneCall, Send, UserRoundCheck, Video, X } from 'lucide-react';
import { createDocument, createFriendCallRequest, getDocument, getFriendCallRequest, getFreshSessionToken, listFriendConnections, listFriendMessages, listIncomingFriendCallRequests, respondToFriendCallRequest, type FriendCallRequest, type PublicProfile } from '@/lib/firebase';
import { useGlobalStore } from '@/store/useGlobalStore';

type FriendMember = Partial<PublicProfile> & { id: string; friendshipId: string };
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

export default function FriendDock() {
  const user = useGlobalStore((state) => state.user);
  const language = useGlobalStore((state) => state.language);
  const isKorean = language === 'ko';
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState<FriendMember[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [videoCall, setVideoCall] = useState<{ id: string; friendId: string } | null>(null);
  const [videoClosing, setVideoClosing] = useState(false);
  const [messages, setMessages] = useState<FriendMessage[]>([]);
  const [input, setInput] = useState('');
  const [attachment, setAttachment] = useState<FriendAttachment | null>(null);
  const [error, setError] = useState('');
  const [messageError, setMessageError] = useState('');
  const [messageReadError, setMessageReadError] = useState('');
  const [messageNotice, setMessageNotice] = useState('');
  const [sending, setSending] = useState(false);
  const sendBusyRef = useRef(false);
  const messageContextRef = useRef('');
  const [incomingCalls, setIncomingCalls] = useState<FriendCallRequest[]>([]);
  const [pendingCall, setPendingCall] = useState<{ id: string; friendId: string; expiresAt: string } | null>(null);
  const [dockPosition, setDockPosition] = useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ offsetX: number; offsetY: number; width: number; height: number } | null>(null);
  const callFrameRef = useRef<HTMLIFrameElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const latestMessageIdRef = useRef('');
  const callOperationRef = useRef(0);
  const callBusyRef = useRef(false);
  const closingRef = useRef(false);

  const closeVideoCall = () => {
    if (!videoCall || closingRef.current) return;
    closingRef.current = true;
    callOperationRef.current += 1;
    callFrameRef.current?.contentWindow?.postMessage({ type: 'gyopo-call-end', callKind: 'friend', callId: videoCall.id }, window.location.origin);
    setVideoClosing(true);
    setOpen(false);
  };

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
  }, [videoCall?.id]);

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
      const friendId = (event as CustomEvent<{ friendId?: string }>).detail?.friendId;
      if (friendId) setSelectedId(friendId);
      setOpen(true);
    };
    window.addEventListener('gyopo-friends-open', show);
    return () => window.removeEventListener('gyopo-friends-open', show);
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      const panel = document.getElementById('friend-dock');
      const launcher = document.getElementById('friend-dock-launch');
      if (panel?.contains(target) || launcher?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsideClick);
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setFriends([]);
      setSelectedId('');
      setVideoCall(null);
      setPendingCall(null);
      return;
    }
    let active = true;
    const load = async () => {
      const token = await getFreshSessionToken();
      if (!token) {
        if (active) setMessageError('다시 로그인해주세요.');
        return;
      }
      const connections = await listFriendConnections(user.id, token).catch(() => []);
      const accepted = connections.filter((item) => item.status === 'accepted');
      const rows = await Promise.all(accepted.map(async (connection) => {
        const id = connection.requesterId === user.id ? connection.addresseeId : connection.requesterId;
        const profile = await getDocument<PublicProfile>('publicProfiles', id, token).catch(() => null);
        return { id, friendshipId: connection.id, ...(profile || {}) } as FriendMember;
      }));
      if (!active) return;
      setFriends(rows);
      setSelectedId((current) => rows.some((friend) => friend.id === current) ? current : rows[0]?.id || '');
    };
    void load();
    const timer = window.setInterval(load, 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user || !pendingCall) return;
    let active = true;
    const check = async () => {
      if (Date.now() >= new Date(pendingCall.expiresAt).getTime()) {
        if (active) {
          setPendingCall(null);
          setError('통화 요청이 1분 동안 응답이 없어 자동 종료되었습니다.');
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
        setError('통화가 수락되었습니다. 연결 중입니다.');
      } else if (request.status === 'declined' || request.status === 'expired') {
        setPendingCall(null);
        setError('친구가 통화를 받지 않아 종료되었습니다.');
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [pendingCall?.id, user?.id]);

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
      setError('첨부파일은 700KB 이하만 보낼 수 있습니다.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAttachment({ data: String(reader.result || ''), name: file.name, type: file.type || 'application/octet-stream', size: file.size });
      setError('');
    };
    reader.onerror = () => setError('파일을 읽지 못했습니다. 다시 선택해주세요.');
    reader.readAsDataURL(file);
  };

  const startDockDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    const panel = document.getElementById('friend-dock');
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
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
    setMessageNotice('');
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
              setMessageNotice(`${latest.user}: 새 메시지`);
              window.setTimeout(() => setMessageNotice(''), 4_000);
            }
          }
          setMessages(sorted);
          setMessageReadError('');
        }
      } catch (error) {
        if (active) setMessageReadError(error instanceof Error ? error.message : '메시지를 불러오지 못했습니다.');
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
  }, [open, selected?.friendshipId, user?.id]);

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
      if (!token) throw new Error('다시 로그인해주세요.');
      const id = crypto.randomUUID();
      await createDocument('friendMessages', id, message, token);
      if (messageContextRef.current !== context) return;
      setMessages((rows) => [...rows.filter((row) => row.id !== id), { id, ...message }]);
      setInput((current) => current === draft ? '' : current);
      setAttachment((current) => current === sentAttachment ? null : current);
      setMessageError('');
    } catch (error) {
      if (messageContextRef.current === context) setMessageError(error instanceof Error ? error.message : '메시지를 보내지 못했습니다. 다시 시도해주세요.');
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
    setError('친구의 통화 수락을 기다리는 중입니다. (최대 1분)');
    try {
       const token = await getFreshSessionToken();
       if (!token) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
       const requestId = await createFriendCallRequest(friendId, user, token);
      if (operation !== callOperationRef.current) return;
      setPendingCall({ id: requestId, friendId, expiresAt: new Date(Date.now() + 60_000).toISOString() });
      setError('통화 요청을 보냈습니다. 친구가 수락하면 바로 연결됩니다.');
    } catch (error) {
      if (operation !== callOperationRef.current) return;
      setPendingCall(null);
      setError(error instanceof Error ? error.message : '통화 요청을 보내지 못했습니다. 다시 시도해주세요.');
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
        setError('통화를 연결하는 중입니다.');
      }
    } catch {
      if (operation !== callOperationRef.current) return;
      setError('통화 요청을 처리하지 못했습니다. 다시 시도해주세요.');
    } finally {
      callBusyRef.current = false;
    }
  };

  if (!user) return null;

  return (
    <>
       <button id="friend-dock-launch" type="button" onClick={() => setOpen(true)} aria-label="친구 채팅과 통화 열기" className="fixed bottom-4 right-4 z-[75] inline-flex min-h-12 items-center gap-2 rounded-full border border-cyan-300/30 bg-[#0b1729] px-4 text-cyan-100 shadow-[0_12px_40px_rgba(0,0,0,.45)] transition hover:border-cyan-200/60 hover:bg-[#10213b]">
         <UserRoundCheck size={19} />
         <span className="hidden text-xs font-black sm:inline">친구·통화</span>
         {messageNotice && <span className="absolute bottom-14 right-0 whitespace-nowrap rounded-lg bg-emerald-300 px-3 py-2 text-[11px] font-black text-slate-950 shadow-lg">{messageNotice}</span>}
       </button>

       <aside id="friend-dock" style={dockPosition ? { left: dockPosition.left, top: dockPosition.top, right: 'auto', bottom: 'auto' } : undefined} className={`gyopo-friend-dock fixed bottom-4 left-3 right-3 z-[70] overflow-hidden rounded-[1.5rem] border-0 bg-[#091120] text-white shadow-[0_25px_100px_rgba(0,0,0,.7)] transition ${dragging ? 'cursor-grabbing select-none transition-none' : 'cursor-default'} lg:left-[17rem] lg:right-auto lg:w-[430px] ${videoCall ? 'friend-dock-call-active' : ''} ${videoClosing ? 'friend-dock-call-closing' : ''} ${open ? 'visible translate-y-0 opacity-100' : videoClosing ? 'visible translate-y-5 opacity-0' : 'invisible translate-y-5 opacity-0'}`}>
           <header onPointerDown={startDockDrag} onPointerMove={moveDock} onPointerUp={stopDockDrag} onPointerCancel={stopDockDrag} className={`flex items-center justify-between border-0 px-4 py-3 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}>
            <div className="flex items-center gap-2 text-sm font-black"><UserRoundCheck size={17} className="text-cyan-300" /> {isKorean ? '친구 채팅·통화' : 'Friends Chat & Call'}</div>
            <button type="button" onClick={() => videoCall ? closeVideoCall() : setOpen(false)} aria-label="친구 패널 닫기" className="border-0 p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"><X size={17} /></button>
          </header>
          {(messageError || messageReadError) && <p role="alert" className="px-3 py-2 text-xs font-bold text-rose-300">{messageError || messageReadError}</p>}

          {incomingCalls.length > 0 && <div className="mx-3 mt-3 border-0 bg-emerald-300/[.08] p-3"><div className="flex items-center gap-2 text-xs font-black text-emerald-100"><PhoneCall size={14} /> {isKorean ? '영상 통화 요청' : 'Incoming call'}</div>{incomingCalls.map((request) => <div key={request.id} className="mt-3 flex items-center gap-2"><img src={request.callerImage} alt="" className="h-8 w-8 rounded-lg object-cover" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-black text-white">{request.callerName}</p><p className="text-[10px] text-emerald-100/65">{isKorean ? '친구가 영상 통화를 요청했습니다.' : 'Your friend requested a video call.'}</p></div><button type="button" onClick={() => void answerVideoCall(request, 'accepted')} aria-label={isKorean ? '통화 수락' : 'Accept call'} className="border-0 bg-emerald-300 p-2 text-slate-950"><Check size={14} /></button><button type="button" onClick={() => void answerVideoCall(request, 'declined')} aria-label={isKorean ? '통화 거절' : 'Decline call'} className="border-0 bg-white/10 p-2 text-slate-300"><X size={14} /></button></div>)}</div>}

         {videoCall && <div className="friend-call-video relative mx-3 mb-3 overflow-hidden rounded-xl bg-black"><iframe ref={callFrameRef} key={videoCall.id} title="친구 영상 통화" src={`/webrtc?friend=${encodeURIComponent(videoCall.friendId)}&auto=1&compact=1&callKind=friend&callId=${encodeURIComponent(videoCall.id)}`} allow="camera; microphone; autoplay; display-capture" className="h-full w-full border-0" /></div>}

         {friends.length === 0 ? (
           <div className="p-8 text-center"><UserRoundCheck size={28} className="mx-auto text-slate-600" /><p className="mt-3 text-sm font-bold text-slate-300">수락된 친구가 없습니다.</p><p className="mt-1 text-xs text-slate-500">유저 목록에서 친구 요청을 보내보세요.</p></div>
         ) : (
           <>
              <div className="flex gap-2 overflow-x-auto border-0 p-2.5">
               {friends.map((friend) => <button key={friend.id} type="button" onClick={() => setSelectedId(friend.id)} className={`flex shrink-0 items-center gap-2 border-0 px-2.5 py-2 text-xs font-black ${friend.id === selectedId ? 'bg-cyan-300 text-slate-950' : 'bg-white/5 text-slate-300'}`}>{friend.image ? <img src={friend.image} alt="" className="h-6 w-6 rounded-lg object-cover" /> : <span className="grid h-6 w-6 place-items-center bg-white/10">{friend.name?.slice(0, 1) || '?'}</span>}<span className="max-w-24 truncate">{friend.name || '친구'}</span></button>)}
            </div>

            {selected && <div className="p-3">
               {videoCall ? null : pendingCall?.friendId === selected.id ? (
                 <div className="mb-3 flex min-h-12 items-center gap-2 bg-amber-300/[.08] px-3 py-2 text-xs font-bold text-amber-100"><PhoneCall size={15} className="shrink-0" /><span>친구의 통화 수락을 기다리는 중입니다. 1분 후 자동 종료됩니다.</span></div>
               ) : (
                   <button type="button" onClick={() => void requestVideoCall(selected.id)} className="mb-3 flex w-full items-center justify-center gap-2 border-0 bg-cyan-300 py-2.5 text-xs font-black text-slate-950"><Video size={15} /> {isKorean ? `${selected.name || '친구'} 통화 요청` : `Call ${selected.name || 'friend'}`}</button>
              )}

                <div className="mb-2 flex items-center justify-between text-[10px] font-black uppercase tracking-[.16em] text-slate-500"><span className="flex items-center gap-1.5"><MessageCircle size={13} /> {isKorean ? '친구 채팅' : 'Friend chat'}</span></div>
                <div className="h-32 space-y-1.5 overflow-y-auto bg-black/20 p-2">{messages.length === 0 ? <p className="py-10 text-center text-xs text-slate-600">첫 메시지를 보내보세요.</p> : messages.map((message) => <div key={message.id} className={`max-w-[85%] px-2.5 py-1.5 text-xs ${message.authorId === user.id ? 'ml-auto bg-emerald-300 text-slate-950' : 'bg-amber-300/15 text-amber-100'}`}><b className="block text-[9px] opacity-65">{message.user}</b>{message.attachmentData && (message.attachmentType?.startsWith('image/') ? <a href={message.attachmentData} target="_blank" rel="noreferrer" className="mt-1 block overflow-hidden bg-black/10"><img src={message.attachmentData} alt={message.attachmentName || '첨부 사진'} loading="lazy" className="max-h-28 w-full object-contain" /></a> : <a href={message.attachmentData} download={message.attachmentName} className="mt-1 flex items-center gap-1.5 bg-black/10 px-2 py-1.5 text-[10px] underline"><FileText size={13} /> <span className="truncate">{message.attachmentName || '첨부파일'}</span></a>)}{message.text && <span className="mt-1 block break-words">{message.text}</span>}</div>)}<div ref={messagesEndRef} /></div>
               {error && <p role="alert" className="mt-2 text-xs font-bold text-rose-300">{error}</p>}
                <form onSubmit={sendMessage} aria-busy={sending} className="mt-2 space-y-2">
                 {attachment && <div className="flex items-center gap-2 bg-white/[.08] px-2 py-1.5 text-[10px] text-slate-200"><span className="grid h-7 w-7 shrink-0 place-items-center bg-black/20">{attachment.type.startsWith('image/') ? <img src={attachment.data} alt="첨부 미리보기" className="h-full w-full object-cover" /> : <FileText size={14} />}</span><span className="min-w-0 flex-1 truncate">{attachment.name}</span><button type="button" onClick={() => setAttachment(null)} aria-label="첨부파일 취소" className="p-1 text-slate-400 hover:text-white"><X size={13} /></button></div>}
                 <div className="flex gap-2"><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="친구에게 메시지..." className="min-w-0 flex-1 border-0 bg-white/[.08] px-3 py-2 text-xs text-white outline-none" /><input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.zip" onChange={handleAttachment} className="hidden" /><button type="button" onClick={() => fileInputRef.current?.click()} aria-label="사진 또는 파일 첨부" title="사진 또는 파일 첨부" className="border-0 bg-white/[.08] px-2.5 text-slate-300 hover:bg-white/[.14]"><Paperclip size={15} /></button><button aria-label="친구 메시지 보내기" className="border-0 bg-cyan-300 px-3 text-slate-950"><Send size={15} /></button></div>
               </form>
            </div>}
          </>
        )}
      </aside>
    </>
  );
}
