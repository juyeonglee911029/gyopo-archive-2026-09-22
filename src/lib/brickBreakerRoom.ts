import { claimBrickBreakerMatch, createDocument, deleteDocument, getDocument, getFreshSessionToken, mergeDocument, queryDocumentsWhere, type BrickBreakerQueueProfile } from './firebase';
import { createGame, WIDTH, HEIGHT, type Game, type Mode, type Drop } from './brickBreaker';
import { rtcConfiguration } from './rtcConfiguration';

export const ROOM_COLLECTION = 'brickBreakerRooms';
export const QUEUE_COLLECTION = 'brickBreakerQueue';
export const ROUND_MS = 180_000;
export const SNAPSHOT_MS = 100; // Data channel only: no database gameplay writes.
const QUEUE_STALE_MS = 45_000;
export type Room = {
  id: string; host: string; guest: string; hostReady: boolean; guestReady: boolean;
  mode: Mode; seed: number; round: number; startAt: number;
  status: 'waiting' | 'playing' | 'finished' | 'closed'; aborted: boolean; createdAt: number;
  betAmount?: number;
  hostBetReady?: boolean;
  guestBetReady?: boolean;
  hostStakeHeld?: boolean;
  guestStakeHeld?: boolean;
  serverAuthoritative?: boolean;
  settlementStatus?: 'HELD' | 'PLAYING' | 'COMPLETED';
};
export type Result = { id: string; actor: string; round: number; score: number; mode: Mode; seed: number; reported: true };
export type QueueProfile = { id: string; name: string; image?: string; country?: string };
export type QueueRecord = QueueProfile & {
  userId?: string;
  mode: Mode;
  status: 'waiting' | 'matched';
  roomCode?: string;
  hostId?: string;
  matchedBy?: string;
  opponent?: QueueProfile;
  updatedAt: string;
};
export type Snapshot = {
  type: 'snapshot'; round: number; seq: number; score: number; lives: number;
  status: Game['status']; paddle: number; ball: Game['ball']; hp: string;
  wide: number; slow: number; narrow: number; level: number; attackTotal: number; drops: Drop[];
};
export type Packet = Snapshot | { type: 'chat'; text: string } | { type: 'ping' } | { type: 'sync' };
export const normalizeCode = (code: string) => code.trim().toUpperCase();
export const validCode = (code: string) => /^[A-F0-9]{24}$/.test(code);
export function roomCode() { return Array.from(crypto.getRandomValues(new Uint8Array(12)), n => n.toString(16).padStart(2, '0')).join('').toUpperCase(); }
export function newSeed() { return crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000 + 1; }
let clock: { server: number; local: number } | null = null;
export const roomNow = () => clock ? clock.server + performance.now() - clock.local : Date.now();
export async function syncRoomClock() {
  const began = performance.now();
  const response = await fetch(`/?brickClock=${crypto.randomUUID()}`, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(5000) });
  const ended = performance.now(), server = Date.parse(response.headers.get('date') || '');
  if (!response.ok || !Number.isFinite(server) || ended - began > 4000) throw new Error('Room clock unavailable');
  // HTTP Date has one-second resolution. This is clock-skew mitigation, not trusted adjudication.
  clock = { server: server + 500 + (ended - began) / 2, local: ended };
}
async function token() { const value = await getFreshSessionToken(); if (!value) throw new Error('로그인이 필요합니다.'); return value; }
export async function readRoom(code: string) { return getDocument<Room>(ROOM_COLLECTION, code, await token()); }
export async function createRoom(uid: string, mode: Mode, id = roomCode()) {
  await syncRoomClock();
  const data: Omit<Room, 'id'> = { host: uid, guest: '', hostReady: false, guestReady: false, mode, seed: newSeed(), round: 1, startAt: 0, status: 'waiting', aborted: false, createdAt: Math.round(roomNow()) };
  await createDocument(ROOM_COLLECTION, id, data, await token());
  return { ...data, id };
}
export async function joinRoom(code: string, uid: string) {
  code = normalizeCode(code);
  if (!validCode(code)) throw new Error('초대 코드 24자리를 확인해주세요.');
  await syncRoomClock();
  // Blind enrollment: outsiders cannot read even a waiting room. Stored-state rules
  // atomically accept only the first guest; a stale/racing join never replaces them.
  await mergeDocument(ROOM_COLLECTION, code, { guest: uid }, await token());
  const room = await readRoom(code);
  if (!room) throw new Error('방을 찾을 수 없습니다.');
  return room;
}

function freshQueueRecord(record: QueueRecord) {
  return record.status === 'waiting' && Date.parse(record.updatedAt) > Date.now() - QUEUE_STALE_MS;
}

export async function readQueue(uid: string) {
  return getDocument<QueueRecord>(QUEUE_COLLECTION, uid, await token());
}

export async function joinMatchmakingQueue(profile: QueueProfile, mode: Mode) {
  const auth = await token();
  const current = await getDocument<QueueRecord>(QUEUE_COLLECTION, profile.id, auth);
  if (current?.status === 'matched' && current.roomCode) {
    const room = await joinRoom(current.roomCode, profile.id);
    return { room, opponent: current.opponent };
  }
  const queued: QueueRecord = { id: profile.id, userId: profile.id, name: profile.name, image: profile.image || '', country: profile.country || 'Global', mode, status: 'waiting', roomCode: '', hostId: '', matchedBy: '', opponent: undefined, updatedAt: new Date().toISOString() };
  await mergeDocument(QUEUE_COLLECTION, profile.id, queued, auth);
  const waiting = await queryDocumentsWhere<QueueRecord>(QUEUE_COLLECTION, [{ field: 'status', op: 'EQUAL', value: 'waiting' }], auth, 40);
  const candidate = waiting.find((item) => item.id !== profile.id && item.mode === mode && freshQueueRecord(item));
  if (!candidate) return null;
   // Use one room ID for the Firestore room and both matched queue records.
   // Generating a second ID here leaves the guest polling a room that does not exist.
   const matchRoomCode = roomCode();
   const room = await createRoom(profile.id, mode, matchRoomCode);
   const claim = await claimBrickBreakerMatch(profile satisfies BrickBreakerQueueProfile, mode, auth, matchRoomCode);
  if (!claim) {
    await mergeDocument(ROOM_COLLECTION, room.id, { status: 'closed', aborted: true }, auth).catch(() => undefined);
    return null;
  }
  const opponent = claim.opponent satisfies QueueProfile;
  const claimedRoom = await readRoom(room.id).catch(() => null);
  return { room: claimedRoom || room, opponent };
}

export async function leaveMatchmakingQueue(uid: string) {
  await deleteDocument(QUEUE_COLLECTION, uid, await token()).catch(() => undefined);
}
export async function updateRoom(room: Room, data: Partial<Omit<Room, 'id'>>) {
  if (data.status === 'playing') {
    await syncRoomClock();
    data = { ...data, startAt: Math.round(roomNow()) + 9000 };
  }
  await mergeDocument(ROOM_COLLECTION, room.id, data, await token());
  return readRoom(room.id);
}
export async function saveResult(room: Room, actor: string, score: number) {
  await createDocument(`${ROOM_COLLECTION}/${room.id}/results`, `${room.round}_${actor}`, { actor, round: room.round, score, mode: room.mode, seed: room.seed, reported: true }, await token());
}
export async function readResults(room: Room) {
  const auth = await token();
  const rows = await Promise.all([room.host, room.guest].filter(Boolean).map(uid => getDocument<Result>(`${ROOM_COLLECTION}/${room.id}/results`, `${room.round}_${uid}`, auth)));
  return rows.filter((row): row is Result => row !== null);
}
export function snapshot(g: Game, round: number, seq: number): Snapshot {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return { type: 'snapshot', round, seq, score: g.score, lives: g.lives, status: g.status, paddle: round2(g.paddle),
    ball: { x: round2(g.ball.x), y: round2(g.ball.y), vx: round2(g.ball.vx), vy: round2(g.ball.vy) },
    hp: g.bricks.map(b => b.hp).join(''), wide: round2(g.wide), slow: round2(g.slow), narrow: round2(g.narrow), level: g.level, attackTotal: g.attackTotal,
    drops: g.drops.map(d => ({ ...d, x: round2(d.x), y: round2(d.y) })) };
}
export function parsePacket(raw: unknown): Packet | null {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  try {
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
    const keys = (allowed: string[]) => Object.keys(d).every(k => allowed.includes(k));
    const num = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
    if (['ping', 'sync'].includes(d.type) && keys(['type'])) return d;
    if (d.type === 'chat' && keys(['type', 'text']) && typeof d.text === 'string' && d.text.trim().length > 0 && d.text.length <= 280) return d;
    if (d.type !== 'snapshot' || !keys(['type', 'round', 'seq', 'score', 'lives', 'status', 'paddle', 'ball', 'hp', 'wide', 'slow', 'narrow', 'level', 'attackTotal', 'drops'])) return null;
    if (!Number.isInteger(d.round) || !num(d.round, 1, 20) || !Number.isInteger(d.seq) || !num(d.seq, 0, 100_000)) return null;
    if (!Number.isInteger(d.score) || !num(d.score, 0, 6400) || !Number.isInteger(d.lives) || !num(d.lives, 0, 5)) return null;
    if (!['ready', 'playing', 'paused', 'lost', 'won'].includes(d.status) || !num(d.paddle, 32, WIDTH - 32) || !num(d.wide, 0, 14) || !num(d.slow, 0, 12) || !num(d.narrow, 0, 20) || !Number.isInteger(d.level) || !num(d.level, 1, 20) || !Number.isInteger(d.attackTotal) || !num(d.attackTotal, 0, 1000)) return null;
    if (typeof d.hp !== 'string' || !/^[012]{60}$/.test(d.hp) || !d.ball || Object.keys(d.ball).sort().join() !== 'vx,vy,x,y') return null;
    if (!num(d.ball.x, 8, WIDTH - 8) || !num(d.ball.y, 8, HEIGHT + 8 + 650 / 120) || !num(d.ball.vx, -650, 650) || !num(d.ball.vy, -650, 650)) return null;
    if (!Array.isArray(d.drops) || d.drops.length > 12 || !d.drops.every((v: Drop) => v && Object.keys(v).sort().join() === 'kind,x,y' && ['wide', 'slow', 'life', 'missile'].includes(v.kind) && num(v.x, 0, WIDTH) && num(v.y, 0, HEIGHT + 20))) return null;
    return d;
  } catch { return null; }
}
export function snapshotGame(s: Snapshot, room: Pick<Room, 'mode' | 'seed'>): Game {
  const game = createGame(room.mode, room.seed);
  Object.assign(game, { score: s.score, lives: s.lives, status: s.status, paddle: s.paddle, ball: s.ball, wide: s.wide, slow: s.slow, narrow: s.narrow, level: s.level, attackTotal: s.attackTotal, drops: s.drops });
  game.bricks.forEach((b, i) => { b.hp = Number(s.hp[i]); });
  return game;
}

export function connectPeer(room: Room, uid: string, receive: (p: Packet) => void, state: (s: string) => void) {
  const host = uid === room.host;
  const pc = new RTCPeerConnection(rtcConfiguration(process.env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS, process.env.NEXT_PUBLIC_TURN_USERNAME, process.env.NEXT_PUBLIC_TURN_CREDENTIAL));
  let channel: RTCDataChannel | null = null, stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  let lastReceived = performance.now(), windowAt = performance.now(), count = 0, lastChat = -Infinity, signalingReady = false;
  let cancelGather: (() => void) | undefined;
  const timers: { watchdog?: ReturnType<typeof setInterval> } = {};
  const close = () => {
    if (stopped) return;
    stopped = true; clearTimeout(timer); if (timers.watchdog) clearInterval(timers.watchdog); cancelGather?.();
    if (channel) { channel.onopen = channel.onclose = channel.onerror = channel.onmessage = null; channel.close(); }
    pc.ondatachannel = null; pc.onconnectionstatechange = null; pc.close();
  };
  const fail = (reason: string) => { if (!stopped) { close(); state(reason); } };
  const began = performance.now();
  const watchdog = setInterval(() => {
    if (stopped) return;
    if (channel?.readyState === 'open') {
      if (performance.now() - lastReceived > 15_000) fail('disconnected');
      else if (channel.bufferedAmount < 8192) { try { channel.send('{"type":"ping"}'); } catch { fail('disconnected'); } }
    } else if (performance.now() - began > 45_000) fail('unavailable');
  }, 3000);
  timers.watchdog = watchdog;
  const connected = () => { if (!stopped && signalingReady && channel?.readyState === 'open') { lastReceived = performance.now(); state('connected'); } };
  const bind = (c: RTCDataChannel) => {
    channel = c;
    c.onopen = connected;
    c.onclose = () => fail('disconnected');
    c.onerror = () => fail('disconnected');
    c.onmessage = e => {
      if (stopped) return;
      if (performance.now() - windowAt > 1000) { windowAt = performance.now(); count = 0; }
      if (++count > 30) return;
      const packet = parsePacket(e.data); if (!packet) return;
      if (packet.type === 'chat') { if (performance.now() - lastChat < 500) return; lastChat = performance.now(); }
      lastReceived = performance.now(); receive(packet);
    };
  };
  if (host) bind(pc.createDataChannel('brick-breaker-v1', { ordered: true }));
  else pc.ondatachannel = event => { if (channel) event.channel.close(); else bind(event.channel); };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') fail('disconnected'); };
  const gathered = () => new Promise<void>((resolve, reject) => {
    if (stopped) return reject(new Error('Peer closed'));
    if (pc.iceGatheringState === 'complete') return resolve();
    const cleanup = () => { clearTimeout(timeout); pc.removeEventListener('icegatheringstatechange', check); cancelGather = undefined; };
    const timeout = setTimeout(() => { cleanup(); reject(new Error('ICE timeout')); }, 12_000);
    cancelGather = () => { cleanup(); reject(new Error('Peer closed')); };
    function check() { if (pc.iceGatheringState === 'complete') { cleanup(); resolve(); } }
    pc.addEventListener('icegatheringstatechange', check);
  });
  const collection = `${ROOM_COLLECTION}/${room.id}/signals`;
  const publish = async () => {
    await gathered(); const auth = await token(); if (stopped) return;
    await createDocument(collection, `${room.round}_${uid}`, { actor: uid, round: room.round, type: host ? 'offer' : 'answer', sdp: pc.localDescription?.sdp || '' }, auth);
  };
  async function poll() {
    if (stopped) return;
    try {
      if (performance.now() - began > 45_000) { fail('unavailable'); return; }
      if (document.hidden) { timer = setTimeout(poll, 3000); return; }
      const auth = await token(); if (stopped) return;
      const remote = await getDocument<{ actor: string; round: number; type: 'offer' | 'answer'; sdp: string }>(collection, `${room.round}_${host ? room.guest : room.host}`, auth);
      if (stopped) return;
      if (!remote) { timer = setTimeout(poll, 2500); return; }
      if (remote.actor !== (host ? room.guest : room.host) || remote.round !== room.round || remote.type !== (host ? 'answer' : 'offer') || typeof remote.sdp !== 'string' || !remote.sdp.length || remote.sdp.length > 20000) throw new Error('Invalid signal');
      await pc.setRemoteDescription({ type: remote.type, sdp: remote.sdp });
      if (stopped) return;
      if (!host) { await pc.setLocalDescription(await pc.createAnswer()); await publish(); }
      signalingReady = true; connected();
    } catch { fail('unavailable'); }
  }
  void (async () => {
    state('connecting');
    try { if (host) { await pc.setLocalDescription(await pc.createOffer()); await publish(); } if (!stopped) await poll(); }
    catch { fail('unavailable'); }
  })();
  return {
    send(packet: Packet) { if (stopped || !signalingReady || channel?.readyState !== 'open' || channel.bufferedAmount > 8192) return false; try { channel.send(JSON.stringify(packet)); return true; } catch { fail('disconnected'); return false; } },
    close,
  };
}
