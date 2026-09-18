'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Camera, ChevronLeft, ChevronRight, Eye, Gift, GripHorizontal, Heart, Maximize2, MessageCircle, Minimize2, Radio, Send, ShieldCheck, Sparkles, Users, X } from 'lucide-react';
import { createDocument, deleteDocument, getDocument, getSessionToken, incrementDocument, isMasterUser, listDocuments, mergeDocument, queryDocumentsWhere, refreshStoredUser, reserveEscrowPurchase, sendUserTransfer, type PortalUser } from '@/lib/firebase';
import { useGlobalStore } from '@/store/useGlobalStore';
import { defaultRoomTitle, writeLiveRoom } from './liveRoomShared';

const ROOM_COUNT = 30;
const PAGE_SIZE = 10;
const iceServers = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80', username: process.env.NEXT_PUBLIC_TURN_USERNAME || 'openrelayproject', credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: process.env.NEXT_PUBLIC_TURN_USERNAME || 'openrelayproject', credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: process.env.NEXT_PUBLIC_TURN_USERNAME || 'openrelayproject', credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: process.env.NEXT_PUBLIC_TURN_USERNAME || 'openrelayproject', credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || 'openrelayproject' },
];

type LiveRoom = { id: string; roomNumber: number; title?: string; category?: string; hostId?: string | null; hostName?: string | null; hostImage?: string | null; status?: 'offline' | 'live'; viewers?: number; likes?: number; liked?: boolean; thumbnail?: string | null; sessionId?: string | null; updatedAt?: string };
type LiveMessage = { id: string; roomId: string; sessionId?: string; authorId: string; user: string; text: string; createdAt: string };
type ViewerSignal = { id: string; roomId: string; sessionId?: string; viewerId: string; hostId: string; status: 'offer' | 'answer' | 'connected' | 'ended'; offer?: string; answer?: string; updatedAt?: string };

const waitForIce = (peer: RTCPeerConnection) => new Promise<void>((resolve) => {
  if (peer.iceGatheringState === 'complete') return resolve();
  const finish = () => { if (peer.iceGatheringState === 'complete') { peer.removeEventListener('icegatheringstatechange', finish); resolve(); } };
  peer.addEventListener('icegatheringstatechange', finish);
  window.setTimeout(() => { peer.removeEventListener('icegatheringstatechange', finish); resolve(); }, 4_000);
});

function LiveRoomPlayer({ room, user, compact = false }: { room: LiveRoom; user: PortalUser | null; compact?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewerIdRef = useRef('');
  const [status, setStatus] = useState('시청 연결 준비 중');
  const [needsPlay, setNeedsPlay] = useState(false);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    if (!user || room.status !== 'live' || !room.hostId) return;
    const token = getSessionToken();
    if (!token) return;
    let active = true;
    viewerIdRef.current = `viewer-${user.id}-${room.id}-${Math.random().toString(36).slice(2)}`;
    const peer = new RTCPeerConnection({ iceServers });
    peer.addTransceiver('video', { direction: 'recvonly' });
    peer.addTransceiver('audio', { direction: 'recvonly' });
    peer.ontrack = (event) => {
      const video = videoRef.current;
      if (!video) return;
      const remoteStream = event.streams[0] || (video.srcObject instanceof MediaStream ? video.srcObject : new MediaStream());
      if (!event.streams[0] && !remoteStream.getTracks().some((track) => track.id === event.track.id)) remoteStream.addTrack(event.track);
      video.srcObject = remoteStream;
      void (async () => {
        try {
          video.muted = true;
          await video.play();
          setNeedsPlay(false);
          setStatus('LIVE 수신 중 · 화면을 누르면 소리 켜기');
        } catch {
          video.muted = true;
          try {
            await video.play();
            setNeedsPlay(false);
          setStatus('LIVE 수신 중 · 음소거 자동재생');
          } catch {
            setNeedsPlay(true);
          }
        }
      })();
    };
    peer.onconnectionstatechange = () => {
      if (!active) return;
      if (peer.connectionState === 'connected') setStatus('방송 연결 완료');
      if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') setStatus('재연결 중');
    };
    const touchPresence = (nextStatus: ViewerSignal['status']) => mergeDocument('liveRoomViewers', viewerIdRef.current, { roomId: room.id, sessionId: room.sessionId, viewerId: user.id, hostId: room.hostId, status: nextStatus, updatedAt: new Date() }, token).catch(() => undefined);
    const signal = async () => {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIce(peer);
      const created = await mergeDocument('liveRoomViewers', viewerIdRef.current, { roomId: room.id, sessionId: room.sessionId, viewerId: user.id, hostId: room.hostId, status: 'offer', offer: JSON.stringify(peer.localDescription), updatedAt: new Date() }, token).then(() => true).catch(() => false);
      if (!created) { setStatus('라이브 권한을 확인하는 중'); return; }
      for (let attempt = 0; active && attempt < 40; attempt += 1) {
        const current = await getDocument<ViewerSignal>('liveRoomViewers', viewerIdRef.current, token).catch(() => null);
        if (current?.answer && !peer.currentRemoteDescription) {
          await peer.setRemoteDescription(JSON.parse(current.answer) as RTCSessionDescriptionInit);
          await touchPresence('connected');
          setStatus('방송 연결 완료');
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      }
    };
    void signal();
    const presenceTimer = window.setInterval(() => { if (active) void touchPresence(peer.connectionState === 'connected' ? 'connected' : 'offer'); }, 5_000);
    return () => {
      active = false;
      window.clearInterval(presenceTimer);
      peer.close();
      void mergeDocument('liveRoomViewers', viewerIdRef.current, { sessionId: room.sessionId, status: 'ended', updatedAt: new Date() }, token).catch(() => undefined);
    };
  }, [room.id, room.hostId, room.sessionId, room.status, user?.id]);

  if (!user) return <div className={`live-room-player live-room-player-empty ${compact ? 'live-room-player-compact' : ''}`}>로그인 후 방송을 시청할 수 있습니다.</div>;
  if (room.status !== 'live' || !room.hostId) return <div className={`live-room-player live-room-player-empty ${compact ? 'live-room-player-compact' : ''}`}>방송 상태를 확인하는 중입니다.<br />방송이 시작되면 자동으로 연결됩니다.</div>;
  return <div className={`live-room-player ${compact ? 'live-room-player-compact' : ''}`}><video ref={videoRef} autoPlay playsInline muted={compact || muted} controls={!compact} onClick={() => { const video = videoRef.current; if (!video || compact) return; const nextMuted = !video.muted; video.muted = nextMuted; setMuted(nextMuted); void video.play().catch(() => undefined); }} className="h-full w-full object-cover" />{needsPlay && <button type="button" onClick={() => { const video = videoRef.current; if (!video) return; video.muted = true; setMuted(true); void video.play().then(() => setNeedsPlay(false)); }} className="live-room-play-button">영상 재생</button>}<div className="live-room-player-status"><span />{room.viewers || 0}명 온라인 · {status}</div></div>;
}

function LiveRoomCard({ room, user, onOpen, isMaster, onTerminate }: { room: LiveRoom; user: PortalUser | null; onOpen: () => void; isMaster?: boolean; onTerminate?: () => void }) {
  const [previewing, setPreviewing] = useState(false);
  const master = isMaster ?? isMasterUser(user);
  const liked = Boolean(room.liked);
  const terminate = onTerminate || (() => window.dispatchEvent(new CustomEvent('gyopo-master-room-terminate', { detail: room })));
   return <article className="live-room-card overflow-hidden" onMouseEnter={() => setPreviewing(true)} onMouseLeave={() => setPreviewing(false)}><div className={`live-room-preview ${room.status === 'live' ? 'is-live' : ''}`} style={room.thumbnail ? { backgroundImage: `url(${room.thumbnail})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}><div className="relative z-10 flex items-center justify-between"><span className={`live-room-status ${room.status === 'live' ? 'live' : ''}`}>{room.status === 'live' ? 'LIVE' : 'OFFLINE'}</span><div className="flex items-center gap-1.5"><span className="text-[10px] font-bold text-white/75"><Users size={12} className="mr-1 inline" />{room.viewers || 0}</span>{master && <button type="button" onClick={terminate} aria-label={`${room.title} 강제 종료`} title="Master: 방 종료 및 초기화" className="live-room-master-close"><X size={13} /></button>}</div></div>{room.status === 'live' && previewing && user ? <LiveRoomPlayer room={room} user={user} compact /> : room.thumbnail ? <img src={room.thumbnail} alt={`${room.title || 'LIVE ROOM'} 방송 썸네일`} className="live-room-preview-media" /> : <div className="live-room-preview-fallback"><Camera size={28} className="text-white/65" /><span>웹캠 미리보기</span></div>}</div><div className="p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><h2 className="truncate text-sm font-black">{room.title}</h2><p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">{room.category} · ROOM {String(room.roomNumber).padStart(2, '0')}</p></div><button type="button" onClick={(event) => { event.stopPropagation(); window.dispatchEvent(new CustomEvent('gyopo-live-room-like', { detail: room })); }} aria-label={liked ? `${room.title} 좋아요 취소` : `${room.title} 좋아요`} className={`inline-flex shrink-0 items-center gap-1 text-xs font-black ${liked ? 'text-rose-300' : 'text-slate-500 hover:text-rose-200'}`}><Heart size={15} fill={liked ? 'currentColor' : 'none'} />{room.likes || 0}</button></div><button type="button" onClick={onOpen} className="mt-3 flex w-full items-center justify-center gap-2 bg-rose-400 px-3 py-2 text-xs font-black text-slate-950 hover:bg-rose-300"><Eye size={14} /> {room.status === 'live' ? '입장하기' : '방송방 열기'}</button></div></article>;
}

function RoomChatPanel({ room, user, messages, message, onMessageChange, onSubmit }: { room: LiveRoom; user: PortalUser | null; messages: LiveMessage[]; message: string; onMessageChange: (value: string) => void; onSubmit: (event: React.FormEvent) => void }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);
  return <div className="live-room-chat-panel"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-sm font-black"><MessageCircle size={16} className="text-rose-300" />{room.title} 채팅</div><span className="text-[10px] font-bold text-slate-500">{room.viewers || 0}명 온라인</span></div><div className="mt-3 h-52 space-y-2 overflow-y-auto rounded-sm bg-black/10 p-2">{messages.length ? messages.map((item) => <div key={item.id} className={`text-xs ${item.authorId === user?.id ? 'live-chat-own' : 'live-chat-other'}`}><b>{item.user}</b> {item.text}</div>) : <p className="py-10 text-center text-xs text-slate-600">아직 메시지가 없습니다.</p>}<div ref={endRef} /></div><form onSubmit={onSubmit} className="mt-3 flex gap-2"><input value={message} onChange={(event) => onMessageChange(event.target.value)} disabled={!user} placeholder={user ? '방송인에게 메시지 보내기' : '로그인 후 채팅할 수 있습니다'} className="live-room-input" /><button type="submit" disabled={!user} aria-label="메시지 보내기" className="live-room-send disabled:cursor-not-allowed disabled:opacity-40"><Send size={14} /></button></form></div>;
}

const fallbackRooms: LiveRoom[] = Array.from({ length: ROOM_COUNT }, (_, index) => ({ id: `live-room-${String(index + 1).padStart(2, '0')}`, roomNumber: index + 1, title: defaultRoomTitle(index + 1), category: index % 3 === 0 ? 'K-POP' : index % 3 === 1 ? '교민 라이브' : '토크', status: 'offline', viewers: 0 }));
const roomNumber = (id: string, fallback: number) => Number(id.match(/(\d+)$/)?.[1] || fallback);

export default function LiveRoomPage() {
  const user = useGlobalStore((state) => state.user) as PortalUser | null;
  const setUser = useGlobalStore((state) => state.setUser);
  const [rooms, setRooms] = useState<LiveRoom[]>(fallbackRooms);
  const [page, setPage] = useState(0);
  const [selectedRoom, setSelectedRoom] = useState<LiveRoom | null>(null);
  const [entryRoom, setEntryRoom] = useState<LiveRoom | null>(null);
  const [roomOpen, setRoomOpen] = useState(false);
  const [roomMinimized, setRoomMinimized] = useState(false);
  const [roomOffset, setRoomOffset] = useState({ x: 0, y: 0 });
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [message, setMessage] = useState('');
  const [giftAmount, setGiftAmount] = useState('1');
  const [giftMessage, setGiftMessage] = useState('');
  const [helperAmount, setHelperAmount] = useState('5');
  const [helperText, setHelperText] = useState('방송 세팅과 채팅을 도와주세요.');
  const [helperMessage, setHelperMessage] = useState('');
  const [roomError, setRoomError] = useState('');
  const [busy, setBusy] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resetLiveRoomRef = useRef<(room: LiveRoom) => void>(() => undefined);

  const loadRooms = async () => {
    try {
      const rows = await listDocuments<Omit<LiveRoom, 'id'>>('liveRooms', getSessionToken());
      const now = Date.now();
      const nextRooms = fallbackRooms.map((room) => {
        const remote = rows.find((row) => row.id === room.id);
        const lastSeen = remote?.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
        const fresh = remote?.status === 'live' && Number.isFinite(lastSeen) && now - lastSeen < 20_000;
        return { ...room, ...remote, title: fresh ? remote?.title || defaultRoomTitle(room.id) : defaultRoomTitle(room.id), status: fresh ? ('live' as const) : ('offline' as const) };
      });
      setRooms(nextRooms);
      setSelectedRoom((current) => current ? nextRooms.find((room) => room.id === current.id) || current : current);
      setRoomError('');
    } catch {
      setRoomError('라이브 상태 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.');
    }
  };

  const toggleRoomLike = async (room: LiveRoom) => {
    if (!user) return setRoomError('좋아요를 누르려면 로그인해주세요.');
    const token = getSessionToken();
    if (!token) return setRoomError('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
    const likeId = `${room.id}-${user.id}`;
    const liked = Boolean(await getDocument('liveRoomLikes', likeId, token).catch(() => null));
    try {
      if (liked) {
        await deleteDocument('liveRoomLikes', likeId, token);
        await incrementDocument('liveRooms', room.id, 'likes', -1, token);
      } else {
        await createDocument('liveRoomLikes', likeId, { roomId: room.id, userId: user.id, createdAt: new Date() }, token);
        await incrementDocument('liveRooms', room.id, 'likes', 1, token);
      }
      setRooms((current) => current.map((item) => item.id === room.id ? { ...item, likes: Math.max(0, (item.likes || 0) + (liked ? -1 : 1)), liked: !liked } : item));
      setSelectedRoom((current) => current?.id === room.id ? { ...current, likes: Math.max(0, (current.likes || 0) + (liked ? -1 : 1)) } : current);
    } catch {
      setRoomError('좋아요를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.');
    }
  };

  useEffect(() => {
    const handleLike = (event: Event) => {
      const room = (event as CustomEvent<LiveRoom>).detail;
      if (room?.id) void toggleRoomLike(room);
    };
    window.addEventListener('gyopo-live-room-like', handleLike);
    return () => window.removeEventListener('gyopo-live-room-like', handleLike);
  }, [user?.id]);

  useEffect(() => { void loadRooms(); const timer = window.setInterval(() => void loadRooms(), 1_500); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!selectedRoom) return;
    const load = async () => {
      if (!selectedRoom.sessionId) { setMessages([]); return; }
      const rows = await queryDocumentsWhere<LiveMessage>('liveRoomMessages', [{ field: 'roomId', op: 'EQUAL', value: selectedRoom.id }, { field: 'sessionId', op: 'EQUAL', value: selectedRoom.sessionId }], getSessionToken(), 100).catch(() => []);
      setMessages(rows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
    };
    void load();
    const timer = window.setInterval(load, 1_000);
    return () => window.clearInterval(timer);
  }, [selectedRoom?.id, selectedRoom?.sessionId]);

  const visibleRooms = useMemo(() => rooms.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE), [page, rooms]);
  const maxPage = Math.ceil(rooms.length / PAGE_SIZE) - 1;
  const closeRoom = () => { setRoomOpen(false); setRoomMinimized(false); setSelectedRoom(null); };
  const enterRoom = (room: LiveRoom, mode: 'watch' | 'broadcast') => {
    if (mode === 'broadcast') {
      if (room.status === 'live' && room.hostId && room.hostId !== user?.id) {
        window.alert('이 방은 현재 다른 방송자가 방송 중입니다. 방송이 끝난 뒤 다시 입장해주세요.');
        setEntryRoom(null);
        return;
      }
      window.location.assign(`/theater/broadcast?room=${encodeURIComponent(room.id)}`);
      return;
    }
    window.dispatchEvent(new CustomEvent('gyopo-live-room-open', { detail: room }));
    setSelectedRoom(room);
    setRoomOffset({ x: 0, y: 0 });
    setRoomMinimized(false);
    setRoomOpen(false);
    setEntryRoom(null);
  };
  const openRoomEntry = (room: LiveRoom) => {
    if (room.status === 'live') enterRoom(room, 'watch');
    else setEntryRoom(room);
  };
  const resetLiveRoom = async (room: LiveRoom) => {
    if (!isMasterUser(user)) return setRoomError('Master 권한이 필요한 작업입니다.');
    setRoomError(`${room.title} 방 초기화 중...`);
    const token = getSessionToken();
    if (!token) return setRoomError('Master 로그인 세션이 만료되었습니다.');
    try {
      const [viewers, messages] = await Promise.all([
        queryDocumentsWhere<{ roomId?: string }>('liveRoomViewers', [{ field: 'roomId', op: 'EQUAL', value: room.id }], token, 200).catch(() => []),
        room.sessionId ? queryDocumentsWhere<{ roomId?: string; sessionId?: string }>('liveRoomMessages', [{ field: 'roomId', op: 'EQUAL', value: room.id }, { field: 'sessionId', op: 'EQUAL', value: room.sessionId }], token, 200).catch(() => []) : Promise.resolve([]),
      ]);
         await writeLiveRoom(room.id, user!, room.sessionId || null, 'reset');
       await Promise.allSettled([...viewers.map((item) => deleteDocument('liveRoomViewers', item.id, token)), ...messages.map((item) => deleteDocument('liveRoomMessages', item.id, token))]);
      if (selectedRoom?.id === room.id) closeRoom();
      setRoomError(`${room.title} 방을 종료하고 썸네일·채팅·시청자 연결을 초기화했습니다.`);
      await loadRooms();
    } catch {
      setRoomError('방 초기화에 실패했습니다. Firebase Rules가 최신인지 확인해주세요.');
    }
  };
  useEffect(() => {
    resetLiveRoomRef.current = (room) => { void resetLiveRoom(room); };
  }, [resetLiveRoom]);
  useEffect(() => {
    const handleMasterTerminate = (event: Event) => {
      const room = (event as CustomEvent<LiveRoom>).detail;
      if (room?.id) resetLiveRoomRef.current(room);
    };
    window.addEventListener('gyopo-master-room-terminate', handleMasterTerminate);
    return () => window.removeEventListener('gyopo-master-room-terminate', handleMasterTerminate);
  }, []);
  useEffect(() => {
    if (entryRoom?.status !== 'live') return;
    const room = entryRoom;
    setEntryRoom(null);
    enterRoom(room, 'watch');
  }, [entryRoom?.id, entryRoom?.status]);
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => { event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { startX: event.clientX, startY: event.clientY, originX: roomOffset.x, originY: roomOffset.y }; };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => { if (!dragRef.current) return; setRoomOffset({ x: dragRef.current.originX + event.clientX - dragRef.current.startX, y: dragRef.current.originY + event.clientY - dragRef.current.startY }); };
  const stopDrag = () => { dragRef.current = null; };

  const sendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !selectedRoom?.sessionId || !message.trim()) return;
    const token = getSessionToken();
    if (!token) return;
    const text = message.trim();
    try { await createDocument('liveRoomMessages', crypto.randomUUID(), { roomId: selectedRoom.id, sessionId: selectedRoom.sessionId, authorId: user.id, user: user.name, text, createdAt: new Date() }, token); setMessage(''); } catch { setHelperMessage('채팅 서버에 연결하지 못했습니다.'); }
  };

  const sendGift = async () => {
    if (!user || !selectedRoom?.hostId || selectedRoom.hostId === user.id) return setGiftMessage('방송자에게만 선물을 보낼 수 있습니다.');
    const amount = Number(giftAmount);
    const token = getSessionToken();
    if (!token || !Number.isFinite(amount) || amount <= 0) return setGiftMessage('올바른 USDT 금액을 입력해주세요.');
    if (amount > user.usdtBalance) return setGiftMessage('현재 USDT 잔고보다 큰 금액은 선물할 수 없습니다.');
    try { await sendUserTransfer(user.id, selectedRoom.hostId, amount, 0, token, { kind: 'LIVE_GIFT', roomId: selectedRoom.id, memo: `${selectedRoom.title} 방송 USDT 선물` }); const refreshed = await refreshStoredUser().catch(() => null); setUser(refreshed || { ...user, usdtBalance: user.usdtBalance - amount }); setGiftMessage(`${amount} USDT 선물을 방송인에게 보냈습니다. 잔고에 반영되었습니다.`); } catch { setGiftMessage('선물 요청을 저장하지 못했습니다. Firebase Rules와 잔고를 확인해주세요.'); }
  };

  const requestHelper = async () => {
    if (!user || !selectedRoom?.hostId || selectedRoom.hostId === user.id) return setHelperMessage('방송자가 있는 라이브 방에서만 도우미를 요청할 수 있습니다.');
    const amount = Number(helperAmount);
    const token = getSessionToken();
    if (!token || !Number.isFinite(amount) || amount <= 0 || !helperText.trim()) return setHelperMessage('요청 내용과 올바른 USDT 금액을 입력해주세요.');
    setBusy(true);
    try { const orderId = await reserveEscrowPurchase(user.id, `live-helper-${selectedRoom.id}`, selectedRoom.hostId, amount, token); await createDocument('liveRoomRequests', crypto.randomUUID(), { roomId: selectedRoom.id, requesterId: user.id, helperId: selectedRoom.hostId, amount, requestText: helperText.trim(), orderId, status: 'PAYMENT_HELD', createdAt: new Date() }, token); setHelperMessage(`${amount} USDT가 홀딩되었습니다. 방송자가 요청을 수락하면 진행됩니다.`); } catch (error) { setHelperMessage(error instanceof Error ? error.message : '도우미 요청을 저장하지 못했습니다.'); } finally { setBusy(false); }
  };

  return <div className="category-page live-room-page min-h-[calc(100vh-7rem)] px-3 py-6 text-white sm:px-5 lg:px-8"><div className="category-shell mx-auto max-w-[1500px]">
    <header className="category-header"><div className="category-heading"><div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.28em] text-rose-400"><Radio size={15} /> LIVE BROADCAST</div><h1 className="text-3xl font-black tracking-[-0.04em] text-rose-400 sm:text-4xl">LIVE ROOM</h1><p className="mt-2 max-w-2xl text-sm text-slate-400">방송하기와 시청하기를 선택하고, 방 안에서 방송인과 실시간으로 소통하세요.</p></div><div className="flex items-center gap-3 text-xs font-bold text-slate-300"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-400 shadow-[0_0_14px_rgba(251,113,133,.9)]" />30개 방 · 페이지당 10개</div></header>
    {roomError && <div role="status" className="mb-4 bg-emerald-300/[.08] px-3 py-2 text-xs font-bold text-emerald-100">{roomError}</div>}
    <section className="live-room-frame grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]"><div className="min-w-0"><div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-black"><Sparkles size={16} className="text-rose-300" />방송방 목록</div><div className="flex items-center gap-1"><button type="button" aria-label="이전 방" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} className="live-room-icon-button"><ChevronLeft size={16} /></button><span className="px-2 text-[11px] font-black text-slate-400">{page + 1} / {maxPage + 1}</span><button type="button" aria-label="다음 방" disabled={page >= maxPage} onClick={() => setPage((value) => Math.min(maxPage, value + 1))} className="live-room-icon-button"><ChevronRight size={16} /></button></div></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">{visibleRooms.map((room) => <LiveRoomCard key={room.id} room={room} user={user} onOpen={() => setEntryRoom(room)} />)}</div></div><aside className="live-room-side space-y-3"><div className="live-room-side-panel"><div className="flex items-center gap-2 text-sm font-black"><MessageCircle size={16} className="text-rose-300" />개별 방 채팅</div><p className="mt-3 text-xs leading-5 text-slate-500">방송방에 입장하면 해당 방의 방송인과 시청자만 보는 채팅이 열립니다.</p></div><div className="live-room-side-panel"><div className="flex items-center gap-2 text-sm font-black"><Gift size={16} className="text-pink-300" />방송 USDT 선물</div><p className="mt-2 text-xs leading-5 text-slate-500">방 안에서 방송자에게 USDT를 즉시 보낼 수 있습니다.</p></div><div className="live-room-side-panel"><div className="flex items-center gap-2 text-sm font-black"><ShieldCheck size={16} className="text-amber-300" />도우미 요청</div><p className="mt-2 text-xs leading-5 text-slate-500">방송 세팅, 번역, 채팅 관리 요청 금액은 먼저 홀딩됩니다.</p><div className="mt-3 grid gap-2">{['방송 세팅 도우미', '번역·채팅 도우미', '화면 모니터링 도우미'].map((label) => <button key={label} type="button" onClick={() => setHelperText(label)} className="live-room-helper-card"><span>{label}</span><b>요청</b></button>)}</div></div></aside></section>
    {entryRoom && <div className="fixed inset-0 z-[90] grid place-items-center bg-black/75 p-4" onMouseDown={(event) => event.target === event.currentTarget && setEntryRoom(null)}><section className="live-room-modal w-full max-w-md p-5"><div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-300">ROOM {String(roomNumber(entryRoom.id, entryRoom.roomNumber)).padStart(2, '0')}</div><h2 className="mt-1 text-2xl font-black">{entryRoom.title}</h2><p className="mt-2 text-sm text-slate-400">입장 방식을 선택하세요.</p></div><button type="button" onClick={() => setEntryRoom(null)} className="live-room-icon-button"><X size={16} /></button></div><div className="mt-5 grid grid-cols-2 gap-2"><button type="button" onClick={() => enterRoom(entryRoom, 'broadcast')} className="flex items-center justify-center gap-2 bg-rose-400 px-3 py-3 text-sm font-black text-slate-950"><Camera size={16} />방송하기</button><button type="button" onClick={() => enterRoom(entryRoom, 'watch')} className="flex items-center justify-center gap-2 border border-white/10 bg-white/5 px-3 py-3 text-sm font-black text-white"><Eye size={16} />시청하기</button></div></section></div>}
    {roomOpen && selectedRoom && !roomMinimized && <div className="live-room-window-layer"><section className="live-room-window live-room-modal w-full max-w-6xl p-4 sm:p-6" style={{ transform: `translate(${roomOffset.x}px, ${roomOffset.y}px)` }}><header className="mb-4 flex items-start justify-between gap-3"><div className="live-room-drag-handle min-w-0 flex-1" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag}><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-rose-300"><GripHorizontal size={15} />ROOM {String(roomNumber(selectedRoom.id, selectedRoom.roomNumber)).padStart(2, '0')} · {selectedRoom.status === 'live' ? 'LIVE' : 'OFFLINE'}</div><h2 className="mt-1 text-2xl font-black">{selectedRoom.title}</h2><p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Users size={13} />{selectedRoom.viewers || 0}명 온라인 · 창을 잡고 이동할 수 있습니다.</p></div><div className="flex gap-2"><button type="button" aria-label="라이브 창 최소화" onClick={() => setRoomMinimized(true)} className="live-room-icon-button"><Minimize2 size={16} /></button><button type="button" aria-label="라이브 창 닫기" onClick={closeRoom} className="live-room-icon-button"><X size={16} /></button></div></header><div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">{selectedRoom.status === 'live' && selectedRoom.hostId ? <LiveRoomPlayer room={selectedRoom} user={user} /> : <div className="live-room-player live-room-player-empty">현재 방송이 시작되지 않았습니다.<br />방송자가 방송을 시작하면 자동으로 LIVE 화면으로 전환됩니다.</div>}<div className="space-y-3"><RoomChatPanel room={selectedRoom} user={user} messages={messages} message={message} onMessageChange={setMessage} onSubmit={sendMessage} /><div className="live-room-gift-panel"><div className="flex items-center gap-2 text-xs font-black"><Gift size={14} className="text-pink-300" />USDT 선물</div><div className="mt-2 flex gap-2"><input type="number" min="1" step="1" value={giftAmount} onChange={(event) => setGiftAmount(event.target.value)} className="live-room-input" /><button type="button" onClick={() => void sendGift()} className="live-room-gift-button">보내기</button></div>{giftMessage && <p className="mt-2 text-[11px] leading-4 text-pink-200">{giftMessage}</p>}</div><div className="live-room-helper-panel"><div className="text-xs font-black">도우미 요청</div><input value={helperText} onChange={(event) => setHelperText(event.target.value)} className="live-room-input mt-2" /><div className="mt-2 flex gap-2"><input type="number" min="1" step="1" value={helperAmount} onChange={(event) => setHelperAmount(event.target.value)} className="live-room-input" /><button type="button" disabled={busy} onClick={() => void requestHelper()} className="live-room-gift-button">요청</button></div>{helperMessage && <p className="mt-2 text-[11px] leading-4 text-amber-200">{helperMessage}</p>}</div></div></div></section></div>}
    {roomOpen && selectedRoom && roomMinimized && <div className="live-room-mini-window"><div className="live-room-mini-header"><button type="button" onClick={() => setRoomMinimized(false)} className="min-w-0 flex-1 truncate text-left text-xs font-black"><Radio size={13} className="mr-1 inline text-rose-300" />{selectedRoom.title}</button><div className="flex gap-1"><button type="button" aria-label="라이브 창 복원" onClick={() => setRoomMinimized(false)} className="live-room-icon-button"><Maximize2 size={14} /></button><button type="button" aria-label="라이브 창 닫기" onClick={closeRoom} className="live-room-icon-button"><X size={14} /></button></div></div><div role="button" tabIndex={0} onClick={() => setRoomMinimized(false)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setRoomMinimized(false); }} className="live-room-mini-video"><LiveRoomPlayer room={selectedRoom} user={user} compact /></div></div>}
  </div></div>;
}
