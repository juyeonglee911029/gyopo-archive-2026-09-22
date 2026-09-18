'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MessageCircle, Send } from 'lucide-react';
import { getDocument, getFreshSessionToken, getSessionToken, isMasterUser, mergeDocument, type PortalUser } from '@/lib/firebase';

export type LiveRoom = { id: string; roomNumber: number; title?: string; category?: string; hostId?: string | null; hostName?: string | null; hostImage?: string | null; status?: 'offline' | 'live'; viewers?: number; thumbnail?: string | null; sessionId?: string | null; updatedAt?: string; startedAt?: string | null; endedAt?: string | null };
export const defaultRoomTitle = (room: string | number) => `ROOM ${Number(String(room).match(/\d+$/)?.[0] || 1)}`;
export const limitRoomTitle = (value: string) => Array.from(value).slice(0, 10).join('');

// CAS prevents a late heartbeat/title/stop from modifying a successor session.
export async function writeLiveRoom(roomId: string, user: PortalUser, sessionId: string | null, action: 'start' | 'update' | 'stop' | 'reset', data: Record<string, string | number | null> = {}) {
  if (!/^live-room-(0[1-9]|[12]\d|30)$/.test(roomId)) throw new Error('Invalid room.');
  const token = await getFreshSessionToken();
  if (!token) throw new Error('Login required.');
  if (Object.keys(data).some((key) => !['title', 'category', 'quality', 'thumbnail', 'viewers'].includes(key))) throw new Error('Unsupported room update.');
  if ('title' in data) data = { ...data, title: limitRoomTitle(String(data.title || '').trim()) || defaultRoomTitle(roomId) };
  const name = `projects/gyopo-live-portal-506019/databases/(default)/documents/liveRooms/${roomId}`;
  const base = 'https://firestore.googleapis.com/v1/';
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  for (let attempt = 0; attempt < 3; attempt += 1) {
  const response = await fetch(base + name, { headers, cache: 'no-store' });
  if (!response.ok && response.status !== 404) throw new Error('Room read failed.');
  const current = response.ok ? await response.json() : null;
  const fields = current?.fields || {};
  const host = fields.hostId?.stringValue;
  const existingSession = fields.sessionId?.stringValue;
  if (action === 'reset') {
    if (!isMasterUser(user)) throw new Error('Master required.');
  } else if (action === 'start') {
    const lastSeen = Date.parse(fields.updatedAt?.timestampValue || '');
    if (!sessionId || (fields.status?.stringValue === 'live' && (!Number.isFinite(lastSeen) || Date.now() - lastSeen <= 20_000))) throw new Error('Room is already live.');
  } else if (host !== user.id || !sessionId || existingSession !== sessionId || fields.status?.stringValue !== 'live') {
    throw new Error('Only the current broadcast host may update this room.');
  }
  const stopping = action === 'stop' || action === 'reset';
  const number = Number(roomId.slice(-2));
  const patch = stopping
    ? { title: defaultRoomTitle(number), roomNumber: number, status: 'offline', hostId: null, hostName: null, hostImage: null, sessionId: null, viewers: 0, thumbnail: null, startedAt: null }
    : action === 'start'
      ? { ...data, roomNumber: number, status: 'live', hostId: user.id, hostName: user.name, hostImage: user.image || null, sessionId, viewers: 0, endedAt: null }
      : data;
  const encoded = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value === null ? { nullValue: null } : typeof value === 'number' ? { integerValue: String(value) } : { stringValue: value }]));
  const timestamps = ['updatedAt', ...(action === 'start' ? ['startedAt'] : stopping ? ['endedAt'] : [])];
  const committed = await fetch(`${base}projects/gyopo-live-portal-506019/databases/(default)/documents:commit`, {
    method: 'POST', headers, body: JSON.stringify({ writes: [{ update: { name, fields: encoded }, updateMask: { fieldPaths: Object.keys(patch) }, currentDocument: current ? { updateTime: current.updateTime } : { exists: false }, updateTransforms: timestamps.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) }] }),
  });
  if (!committed.ok) {
    const failure = await committed.json().catch(() => null);
    if (attempt < 2 && ([409, 412].includes(committed.status) || ['ABORTED', 'FAILED_PRECONDITION'].includes(failure?.error?.status))) continue;
    throw new Error('Room changed or permission denied. Please retry.');
  }
  const result = await committed.json();
  return result.commitTime as string;
  }
  throw new Error('Room changed. Please retry.');
}

export function LiveElapsed({ startedAt }: { startedAt?: string | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [startedAt]);
  const start = Date.parse(startedAt || '');
  const seconds = now !== null && Number.isFinite(start) ? Math.max(0, Math.floor((now - start) / 1000)) : 0;
  return <span aria-label="방송 경과 시간">{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</span>;
}

export function FloatingRoomTitle({ room, onRoomChange }: { room: LiveRoom; onRoomChange: (room: LiveRoom) => void }) {
  const onChangeRef = useRef(onRoomChange);
  useEffect(() => { onChangeRef.current = onRoomChange; }, [onRoomChange]);
  useEffect(() => {
    let active = true;
    let busy = false;
    const load = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const next = await getDocument<LiveRoom>('liveRooms', room.id, getSessionToken());
        if (active) onChangeRef.current(next ? { ...next, title: next.status === 'live' ? next.title : defaultRoomTitle(room.id) } : { id: room.id, roomNumber: room.roomNumber, status: 'offline', title: defaultRoomTitle(room.id), sessionId: null, hostId: null });
      } catch { /* Keep the last confirmed room during a transient read failure. */ }
      finally { busy = false; }
    };
    void load();
    const timer = window.setInterval(() => void load(), 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [room.id, room.roomNumber]);
  return <>{room.title || defaultRoomTitle(room.id)}{room.status === 'live' && <> · <LiveElapsed startedAt={room.startedAt} /></>}</>;
}
export type LiveMessage = { id: string; roomId: string; sessionId?: string; authorId: string; user: string; text: string; createdAt: string };
type ViewerSignal = { id: string; roomId: string; sessionId?: string; viewerId: string; hostId: string; status: 'offer' | 'answer' | 'connected' | 'ended'; offer?: string; answer?: string; updatedAt?: string };

const iceServers = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80', username: process.env.NEXT_PUBLIC_TURN_USERNAME || 'openrelayproject', credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: process.env.NEXT_PUBLIC_TURN_USERNAME || 'openrelayproject', credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: process.env.NEXT_PUBLIC_TURN_USERNAME || 'openrelayproject', credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: process.env.NEXT_PUBLIC_TURN_USERNAME || 'openrelayproject', credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || 'openrelayproject' },
];

const waitForIce = (peer: RTCPeerConnection) => new Promise<void>((resolve) => {
  if (peer.iceGatheringState === 'complete') return resolve();
  const finish = () => { if (peer.iceGatheringState === 'complete') { peer.removeEventListener('icegatheringstatechange', finish); resolve(); } };
  peer.addEventListener('icegatheringstatechange', finish);
  window.setTimeout(() => { peer.removeEventListener('icegatheringstatechange', finish); resolve(); }, 4_000);
});

export function LiveRoomPlayer({ room, user, compact = false }: { room: LiveRoom; user: PortalUser | null; compact?: boolean }) {
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

export function RoomChatPanel({ room, user, messages, message, onMessageChange, onSubmit }: { room: LiveRoom; user: PortalUser | null; messages: LiveMessage[]; message: string; onMessageChange: (value: string) => void; onSubmit: (event: FormEvent) => void }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);
  return <div className="live-room-chat-panel"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-sm font-black"><MessageCircle size={16} className="text-rose-300" />{room.title} 채팅</div><span className="text-[10px] font-bold text-slate-500">{room.viewers || 0}명 온라인</span></div><div className="mt-3 h-52 space-y-2 overflow-y-auto rounded-sm bg-black/10 p-2">{messages.length ? messages.map((item) => <div key={item.id} className={`text-xs ${item.authorId === user?.id ? 'live-chat-own' : 'live-chat-other'}`}><b>{item.user}</b> {item.text}</div>) : <p className="py-10 text-center text-xs text-slate-600">아직 메시지가 없습니다.</p>}<div ref={endRef} /></div><form onSubmit={onSubmit} className="mt-3 flex gap-2"><input value={message} onChange={(event) => onMessageChange(event.target.value)} disabled={!user} placeholder={user ? '방송인에게 메시지 보내기' : '로그인 후 채팅할 수 있습니다'} className="live-room-input" /><button type="submit" disabled={!user} aria-label="메시지 보내기" className="live-room-send disabled:cursor-not-allowed disabled:opacity-40"><Send size={14} /></button></form></div>;
}
