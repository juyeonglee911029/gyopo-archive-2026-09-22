import { applyAttack, createGame, launch, stepGame, type Game, type Mode } from './brickBreaker';
import {
  adminDocumentName,
  decodeFirestoreValue,
  firestoreValue,
  getAdminDocument,
  mergeAdminFields,
  runFirestoreTransaction,
  type AdminFirestoreDocument,
  type FirestoreWrite,
} from './firebaseAdmin';

const ROOM_COLLECTION = 'brickBreakerRooms';
const STATE_COLLECTION = 'badballMatchStates';
const STAKE_COLLECTION = 'gameStakes';
const PAYOUT_COLLECTION = 'gamePayouts';
const LEDGER_COLLECTION = 'walletLedger';
const ROUND_MS = 180_000;
const STEP_MS = 1_000 / 120;
const MAX_CATCHUP_MS = 250;
const WIDTH = 720;

type RoomData = {
  host?: string;
  guest?: string;
  hostReady?: boolean;
  guestReady?: boolean;
  hostBetReady?: boolean;
  guestBetReady?: boolean;
  hostStakeHeld?: boolean;
  guestStakeHeld?: boolean;
  betAmount?: number;
  mode?: Mode;
  seed?: number;
  round?: number;
  startAt?: number;
  status?: string;
  aborted?: boolean;
  settlementStatus?: string;
};

type MatchState = {
  version: 1;
  roomId: string;
  round: number;
  mode: Mode;
  seed: number;
  startAt: number;
  lastTickAt: number;
  status: 'playing' | 'finished' | 'aborted';
  hostTarget: number;
  guestTarget: number;
  hostSeq: number;
  guestSeq: number;
  host: Game;
  guest: Game;
  winnerId?: string;
  loserId?: string;
  outcome?: 'HOST_WIN' | 'GUEST_WIN' | 'DRAW' | 'ABORTED';
  completedAt?: number;
};

type MemberParams = { roomId: string; round: number; userId: string };
type TickParams = MemberParams & { seq: number; target: number };

function readData(document: AdminFirestoreDocument | null): Record<string, unknown> {
  if (!document?.fields) return {};
  return Object.fromEntries(Object.entries(document.fields).map(([key, value]) => [key, decodeFirestoreValue(value)]));
}

function readJson<T>(document: AdminFirestoreDocument | null): T | null {
  const payload = document?.fields?.payload;
  if (!payload || !('stringValue' in payload)) return null;
  try { return JSON.parse(payload.stringValue) as T; } catch { return null; }
}

function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
function numberValue(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : Number(value); }
function boolValue(value: unknown): boolean { return value === true; }
function roundMoney(value: number): number { return Math.round(value * 100) / 100; }
function matchId(roomId: string, round: number): string { return `${roomId}-${round}`; }
function stakeId(id: string, userId: string): string { return `${id}-${userId}`; }
function ledgerId(prefix: string, id: string, userId?: string): string { return `${prefix}-${id}${userId ? `-${userId}` : ''}`; }
function isMember(room: RoomData, userId: string): boolean { return room.host === userId || room.guest === userId; }
function memberFlag(room: RoomData, userId: string, suffix: 'StakeHeld'): 'hostStakeHeld' | 'guestStakeHeld' {
  return room.host === userId ? `host${suffix}` : `guest${suffix}`;
}
function compactGame(game: Game): Game {
  return { ...game, particles: [], trail: [], shake: 0 };
}
function publicState(state: MatchState) {
  return {
    status: state.status,
    startAt: state.startAt,
    lastTickAt: state.lastTickAt,
    hostTarget: state.hostTarget,
    guestTarget: state.guestTarget,
    hostSeq: state.hostSeq,
    guestSeq: state.guestSeq,
    host: compactGame(state.host),
    guest: compactGame(state.guest),
    winnerId: state.winnerId || '',
    loserId: state.loserId || '',
    outcome: state.outcome || '',
    completedAt: state.completedAt || 0,
  };
}
function payloadFields(value: unknown, updatedAt = new Date().toISOString()) {
  return { payload: firestoreValue(JSON.stringify(value)), updatedAt: firestoreValue(updatedAt) };
}
function updateDocument(document: AdminFirestoreDocument, fields: Record<string, ReturnType<typeof firestoreValue>>): FirestoreWrite {
  if (!document.name || !document.updateTime) throw new Error('Firebase 문서 버전이 없습니다.');
  return { update: { name: document.name, fields: mergeAdminFields(document, fields) }, currentDocument: { updateTime: document.updateTime } };
}
function createDocument(projectId: string, collection: string, id: string, fields: Record<string, ReturnType<typeof firestoreValue>>): FirestoreWrite {
  return { update: { name: adminDocumentName(projectId, collection, id), fields }, currentDocument: { exists: false } };
}

function roomDocument(roomId: string): { collection: string; id: string } { return { collection: ROOM_COLLECTION, id: roomId }; }
function profileDocument(userId: string): { collection: string; id: string } { return { collection: 'profiles', id: userId }; }
function stateDocument(id: string): { collection: string; id: string } { return { collection: STATE_COLLECTION, id }; }
function stakeDocument(id: string, userId: string): { collection: string; id: string } { return { collection: STAKE_COLLECTION, id: stakeId(id, userId) }; }
function payoutDocument(id: string): { collection: string; id: string } { return { collection: PAYOUT_COLLECTION, id }; }

function validateMember(room: RoomData, userId: string, round: number) {
  if (!isMember(room, userId)) throw new Error('이 배드볼 방의 참가자가 아닙니다.');
  if (numberValue(room.round) !== round) throw new Error('배드볼 라운드가 이미 변경되었습니다.');
}

export async function reserveBadballStake(params: MemberParams): Promise<{ amountUsd: number; alreadyHeld: boolean }> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(params.roomId) || !Number.isInteger(params.round) || params.round < 1 || params.round > 20) throw new Error('배드볼 방 식별자가 올바르지 않습니다.');
  const id = matchId(params.roomId, params.round);
  return runFirestoreTransaction<{ amountUsd: number; alreadyHeld: boolean }>([
    roomDocument(params.roomId),
    profileDocument(params.userId),
    stakeDocument(id, params.userId),
  ], ({ projectId, get }) => {
    const roomDoc = get(roomDocument(params.roomId));
    const room = readData(roomDoc) as RoomData;
    validateMember(room, params.userId, params.round);
    if (room.status !== 'waiting' || !boolValue(room.hostBetReady) || !boolValue(room.guestBetReady)) throw new Error('두 플레이어가 먼저 배팅을 확정해야 합니다.');
    const amountUsd = roundMoney(numberValue(room.betAmount));
    if (!Number.isFinite(amountUsd) || amountUsd < 1 || amountUsd > 100) throw new Error('배팅 금액은 1~100 USD 사이여야 합니다.');
    const stakeDoc = get(stakeDocument(id, params.userId));
    const existing = readData(stakeDoc);
    if (stakeDoc && stringValue(existing.status) === 'HELD' && roundMoney(numberValue(existing.amountUsd)) === amountUsd) {
      const flag = memberFlag(room, params.userId, 'StakeHeld');
      const writes = boolValue(room[flag]) ? [] : [updateDocument(roomDoc!, { [flag]: firestoreValue(true), settlementStatus: firestoreValue('HELD') })];
      return { writes, result: { amountUsd, alreadyHeld: true } };
    }
    if (stakeDoc) throw new Error('이 배드볼 배팅은 이미 처리되었습니다.');
    const profileDoc = get(profileDocument(params.userId));
    const profile = readData(profileDoc);
    if (!profileDoc?.name || !profileDoc.updateTime) throw new Error('회원 지갑을 찾을 수 없습니다.');
    const currentBalance = roundMoney(numberValue(profile.usdBalance));
    if (!Number.isFinite(currentBalance) || currentBalance < amountUsd) throw new Error('USD 서비스 잔액이 부족합니다. 지갑에서 먼저 충전해주세요.');
    const now = new Date().toISOString();
    const flag = memberFlag(room, params.userId, 'StakeHeld');
    const nextProfile = mergeAdminFields(profileDoc, { usdBalance: firestoreValue(roundMoney(currentBalance - amountUsd)), updatedAt: firestoreValue(now) });
    const writes: FirestoreWrite[] = [
      { update: { name: profileDoc.name, fields: nextProfile }, currentDocument: { updateTime: profileDoc.updateTime } },
      createDocument(projectId, STAKE_COLLECTION, stakeId(id, params.userId), {
        matchId: firestoreValue(id), roomId: firestoreValue(params.roomId), round: firestoreValue(params.round), userId: firestoreValue(params.userId), amountUsd: firestoreValue(amountUsd), status: firestoreValue('HELD'), createdAt: firestoreValue(now),
      }),
      createDocument(projectId, LEDGER_COLLECTION, ledgerId('game-stake', id, params.userId), {
        userId: firestoreValue(params.userId), type: firestoreValue('GAME_STAKE'), direction: firestoreValue('OUT'), amount: firestoreValue(amountUsd), status: firestoreValue('COMPLETED'), symbol: firestoreValue('USD'), requestId: firestoreValue(id), memo: firestoreValue('배드볼 배팅 금액 보관'), createdAt: firestoreValue(now),
      }),
      updateDocument(roomDoc!, { [flag]: firestoreValue(true), settlementStatus: firestoreValue('HELD'), updatedAt: firestoreValue(now) }),
    ];
    return { writes, result: { amountUsd, alreadyHeld: false } };
  });
}

export async function startBadballMatch(params: MemberParams): Promise<{ startAt: number; state: ReturnType<typeof publicState> }> {
  const id = matchId(params.roomId, params.round);
  const initialRoom = await getAdminDocument(ROOM_COLLECTION, params.roomId);
  const initialRoomData = readData(initialRoom) as RoomData;
  const hostId = stringValue(initialRoomData.host);
  const guestId = stringValue(initialRoomData.guest);
  if (!hostId || !guestId) throw new Error('배드볼 참가자 정보가 완전하지 않습니다.');
  return runFirestoreTransaction([
    roomDocument(params.roomId),
    stateDocument(id),
    stakeDocument(id, hostId),
    stakeDocument(id, guestId),
  ], ({ projectId, get }) => {
    const roomDoc = get(roomDocument(params.roomId));
    const room = readData(roomDoc) as RoomData;
    validateMember(room, params.userId, params.round);
    if (room.host !== params.userId) throw new Error('호스트만 대전을 시작할 수 있습니다.');
    if (room.status === 'playing') {
      const current = readJson<MatchState>(get(stateDocument(id)));
      if (current) return { writes: [], result: { startAt: current.startAt, state: publicState(current) } };
    }
    if (room.status !== 'waiting' || !boolValue(room.hostReady) || !boolValue(room.guestReady) || !boolValue(room.hostStakeHeld) || !boolValue(room.guestStakeHeld)) throw new Error('양쪽의 준비와 배팅 보관이 모두 완료되어야 합니다.');
    const hostStake = readData(get(stakeDocument(id, hostId)));
    const guestStake = readData(get(stakeDocument(id, guestId)));
    if (stringValue(hostStake.status) !== 'HELD' || stringValue(guestStake.status) !== 'HELD') throw new Error('배드볼 배팅 보관 상태를 확인하지 못했습니다.');
    const mode = room.mode === 'items' ? 'items' : 'classic';
    const seed = numberValue(room.seed) || 1;
    const startAt = Date.now() + 9_000;
    const state: MatchState = {
      version: 1, roomId: params.roomId, round: params.round, mode, seed, startAt, lastTickAt: startAt, status: 'playing',
      hostTarget: WIDTH / 2, guestTarget: WIDTH / 2, hostSeq: -1, guestSeq: -1,
      host: compactGame(createGame(mode, seed)), guest: compactGame(createGame(mode, seed)),
    };
    const stateDoc = get(stateDocument(id));
    if (stateDoc) throw new Error('배드볼 대전이 이미 시작되었습니다.');
    const now = new Date().toISOString();
    const writes: FirestoreWrite[] = [
      updateDocument(roomDoc!, { status: firestoreValue('playing'), startAt: firestoreValue(startAt), serverAuthoritative: firestoreValue(true), settlementStatus: firestoreValue('PLAYING'), updatedAt: firestoreValue(now) }),
      createDocument(projectId, STATE_COLLECTION, id, payloadFields(state, now)),
    ];
    return { writes, result: { startAt, state: publicState(state) } };
  });
}

export async function rematchBadballMatch(params: MemberParams): Promise<{ round: number; seed: number }> {
  return runFirestoreTransaction([roomDocument(params.roomId)], ({ get }) => {
    const roomDoc = get(roomDocument(params.roomId));
    const room = readData(roomDoc) as RoomData;
    validateMember(room, params.userId, params.round);
    if (room.host !== params.userId) throw new Error('호스트만 리매치를 시작할 수 있습니다.');
    if (room.status !== 'finished' || room.settlementStatus !== 'COMPLETED') throw new Error('정산이 끝난 경기만 리매치할 수 있습니다.');
    const round = params.round + 1;
    if (round > 20) throw new Error('최대 라운드 수에 도달했습니다.');
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000 + 1;
    const now = new Date().toISOString();
    const writes = [updateDocument(roomDoc!, {
      round: firestoreValue(round), seed: firestoreValue(seed), startAt: firestoreValue(0), status: firestoreValue('waiting'), aborted: firestoreValue(false),
      hostReady: firestoreValue(false), guestReady: firestoreValue(false), betAmount: firestoreValue(0), hostBetReady: firestoreValue(false), guestBetReady: firestoreValue(false),
      hostStakeHeld: firestoreValue(false), guestStakeHeld: firestoreValue(false), serverAuthoritative: firestoreValue(false), settlementStatus: firestoreValue(''), updatedAt: firestoreValue(now),
    })];
    return { writes, result: { round, seed } };
  });
}

function finishState(state: MatchState, now: number): MatchState {
  const hostWins = state.host.status === 'won' || state.guest.status === 'lost' || state.host.score > state.guest.score;
  const guestWins = state.guest.status === 'won' || state.host.status === 'lost' || state.guest.score > state.host.score;
  if (hostWins && !guestWins) state.outcome = 'HOST_WIN';
  else if (guestWins && !hostWins) state.outcome = 'GUEST_WIN';
  else state.outcome = 'DRAW';
  state.status = 'finished'; state.completedAt = now;
  return state;
}

function setWinnerIds(state: MatchState, hostId: string, guestId: string) {
  if (state.outcome === 'HOST_WIN') { state.winnerId = hostId; state.loserId = guestId; }
  if (state.outcome === 'GUEST_WIN') { state.winnerId = guestId; state.loserId = hostId; }
}

export async function tickBadball(params: TickParams): Promise<{ state: ReturnType<typeof publicState>; shouldSettle: boolean }> {
  const id = matchId(params.roomId, params.round);
  if (!Number.isInteger(params.seq) || params.seq < 0 || params.seq > 1_000_000) throw new Error('배드볼 입력 순서가 올바르지 않습니다.');
  if (!Number.isFinite(params.target) || params.target < 0 || params.target > WIDTH) throw new Error('배드볼 조작 위치가 올바르지 않습니다.');
  return runFirestoreTransaction([roomDocument(params.roomId), stateDocument(id)], ({ get }) => {
    const room = readData(get(roomDocument(params.roomId))) as RoomData;
    validateMember(room, params.userId, params.round);
    const stateDoc = get(stateDocument(id));
    const state = readJson<MatchState>(stateDoc);
    if (!state || !stateDoc) throw new Error('서버 대전 상태를 찾을 수 없습니다.');
    if (state.status === 'finished') return { writes: [], result: { state: publicState(state), shouldSettle: true } };
    if (state.status !== 'playing') throw new Error('배드볼 대전이 진행 중이 아닙니다.');
    const host = room.host === params.userId;
    const sequence = host ? state.hostSeq : state.guestSeq;
    if (params.seq <= sequence) return { writes: [], result: { state: publicState(state), shouldSettle: false } };
    if (host) { state.hostSeq = params.seq; state.hostTarget = params.target; } else { state.guestSeq = params.seq; state.guestTarget = params.target; }
    const now = Date.now();
    const endAt = state.startAt + ROUND_MS;
    const cursor = Math.min(now, endAt);
    let elapsed = Math.max(0, cursor - state.lastTickAt);
    elapsed = Math.min(elapsed, MAX_CATCHUP_MS);
    let steps = Math.floor(elapsed / STEP_MS);
    state.lastTickAt += steps * STEP_MS;
    while (steps > 0 && state.status === 'playing') {
      if (state.host.status === 'ready') launch(state.host);
      if (state.guest.status === 'ready') launch(state.guest);
      state.host.target = state.hostTarget;
      state.guest.target = state.guestTarget;
      stepGame(state.host);
      stepGame(state.guest);
      const hostAttacks = state.host.attackTotal - state.guest.attacksReceived;
      const guestAttacks = state.guest.attackTotal - state.host.attacksReceived;
      if (hostAttacks > 0) applyAttack(state.guest, hostAttacks);
      if (guestAttacks > 0) applyAttack(state.host, guestAttacks);
      state.host = compactGame(state.host);
      state.guest = compactGame(state.guest);
      steps -= 1;
    }
    const timedOut = state.lastTickAt >= endAt;
    const terminal = ['lost', 'won'].includes(state.host.status) || ['lost', 'won'].includes(state.guest.status);
    const finished = timedOut || terminal;
    if (finished) {
      finishState(state, Math.min(now, endAt));
      setWinnerIds(state, room.host || '', room.guest || '');
    }
    const nextFields = payloadFields(state, new Date().toISOString());
    return { writes: [updateDocument(stateDoc, nextFields)], result: { state: publicState(state), shouldSettle: finished } };
  });
}

function settlementWrites(
  projectId: string,
  roomId: string,
  round: number,
  roomDoc: AdminFirestoreDocument,
  stateDoc: AdminFirestoreDocument | null,
  payoutDoc: AdminFirestoreDocument | null,
  hostStake: AdminFirestoreDocument | null,
  guestStake: AdminFirestoreDocument | null,
  hostProfile: AdminFirestoreDocument | null,
  guestProfile: AdminFirestoreDocument | null,
  outcome: 'HOST_WIN' | 'GUEST_WIN' | 'DRAW' | 'ABORTED',
  amountUsd: number,
  winnerId: string,
  loserId: string,
): FirestoreWrite[] {
  const match = matchId(roomId, round);
  if (payoutDoc) return [];
  if (!hostStake?.name || !guestStake?.name || !hostProfile?.name || !guestProfile?.name) throw new Error('배드볼 배팅 원장을 찾지 못했습니다.');
  const hostStakeData = readData(hostStake), guestStakeData = readData(guestStake);
  if (stringValue(hostStakeData.status) !== 'HELD' || stringValue(guestStakeData.status) !== 'HELD') throw new Error('배드볼 배팅이 이미 정산되었습니다.');
  const hostProfileData = readData(hostProfile), guestProfileData = readData(guestProfile);
  const roomData = readData(roomDoc);
  const hostId = stringValue(roomData.host), guestId = stringValue(roomData.guest);
  const hostBalance = roundMoney(numberValue(hostProfileData.usdBalance)), guestBalance = roundMoney(numberValue(guestProfileData.usdBalance));
  const payoutToWinner = outcome === 'HOST_WIN' || outcome === 'GUEST_WIN' ? roundMoney(amountUsd * 2) : amountUsd;
  const now = new Date().toISOString();
  const writes: FirestoreWrite[] = [];
  const credit = (profile: AdminFirestoreDocument, balance: number, amount: number) => updateDocument(profile, { usdBalance: firestoreValue(roundMoney(balance + amount)), updatedAt: firestoreValue(now) });
  if (outcome === 'HOST_WIN') writes.push(credit(hostProfile, hostBalance, payoutToWinner));
  else if (outcome === 'GUEST_WIN') writes.push(credit(guestProfile, guestBalance, payoutToWinner));
  else { writes.push(credit(hostProfile, hostBalance, amountUsd), credit(guestProfile, guestBalance, amountUsd)); }
  writes.push(
    updateDocument(hostStake, { status: firestoreValue(outcome === 'ABORTED' || outcome === 'DRAW' ? 'REFUNDED' : 'SETTLED'), settledAt: firestoreValue(now) }),
    updateDocument(guestStake, { status: firestoreValue(outcome === 'ABORTED' || outcome === 'DRAW' ? 'REFUNDED' : 'SETTLED'), settledAt: firestoreValue(now) }),
    createDocument(projectId, PAYOUT_COLLECTION, match, { matchId: firestoreValue(match), roomId: firestoreValue(roomId), round: firestoreValue(round), outcome: firestoreValue(outcome), winnerId: firestoreValue(winnerId), loserId: firestoreValue(loserId), amountUsd: firestoreValue(amountUsd), payoutUsd: firestoreValue(payoutToWinner), status: firestoreValue('COMPLETED'), createdAt: firestoreValue(now) }),
  );
  if (outcome === 'DRAW' || outcome === 'ABORTED') {
    writes.push(
      createDocument(projectId, LEDGER_COLLECTION, ledgerId('game-refund', match, hostId), { userId: firestoreValue(hostId), type: firestoreValue('GAME_REFUND'), direction: firestoreValue('IN'), amount: firestoreValue(amountUsd), status: firestoreValue('COMPLETED'), symbol: firestoreValue('USD'), requestId: firestoreValue(`${match}-host`), memo: firestoreValue('배드볼 무효 경기 환불'), createdAt: firestoreValue(now) }),
      createDocument(projectId, LEDGER_COLLECTION, ledgerId('game-refund', match, guestId), { userId: firestoreValue(guestId), type: firestoreValue('GAME_REFUND'), direction: firestoreValue('IN'), amount: firestoreValue(amountUsd), status: firestoreValue('COMPLETED'), symbol: firestoreValue('USD'), requestId: firestoreValue(`${match}-guest`), memo: firestoreValue('배드볼 무효 경기 환불'), createdAt: firestoreValue(now) }),
    );
  } else {
    writes.push(createDocument(projectId, LEDGER_COLLECTION, ledgerId('game-payout', match, winnerId), { userId: firestoreValue(winnerId), type: firestoreValue('GAME_PAYOUT'), direction: firestoreValue('IN'), amount: firestoreValue(payoutToWinner), status: firestoreValue('COMPLETED'), symbol: firestoreValue('USD'), requestId: firestoreValue(match), memo: firestoreValue('배드볼 승리 정산'), createdAt: firestoreValue(now) }));
  }
  const state = readJson<MatchState>(stateDoc);
  const resultWrites = state ? [
    createDocument(projectId, `${ROOM_COLLECTION}/${roomId}/results`, `${round}_${hostId}`, { actor: firestoreValue(hostId), round: firestoreValue(round), score: firestoreValue(state.host.score), mode: firestoreValue(state.mode), seed: firestoreValue(state.seed), reported: firestoreValue(true), verified: firestoreValue(true) }),
    createDocument(projectId, `${ROOM_COLLECTION}/${roomId}/results`, `${round}_${guestId}`, { actor: firestoreValue(guestId), round: firestoreValue(round), score: firestoreValue(state.guest.score), mode: firestoreValue(state.mode), seed: firestoreValue(state.seed), reported: firestoreValue(true), verified: firestoreValue(true) }),
  ] : [];
  writes.push(...resultWrites);
  const roomFields: Record<string, ReturnType<typeof firestoreValue>> = { status: firestoreValue(outcome === 'ABORTED' ? 'closed' : 'finished'), aborted: firestoreValue(outcome === 'ABORTED'), settlementStatus: firestoreValue('COMPLETED'), updatedAt: firestoreValue(now) };
  writes.push(updateDocument(roomDoc, roomFields));
  return writes;
}

export async function settleBadballMatch(params: MemberParams & { aborted?: boolean }): Promise<{ alreadySettled: boolean; outcome: string }> {
  const id = matchId(params.roomId, params.round);
  const initialRoom = await getAdminDocument(ROOM_COLLECTION, params.roomId);
  const initialRoomData = readData(initialRoom) as RoomData;
  const hostId = stringValue(initialRoomData.host);
  const guestId = stringValue(initialRoomData.guest);
  if (!hostId || !guestId) throw new Error('배드볼 참가자 정보가 완전하지 않습니다.');
  const result = await runFirestoreTransaction([
    roomDocument(params.roomId), stateDocument(id), payoutDocument(id), stakeDocument(id, hostId), stakeDocument(id, guestId), profileDocument(hostId), profileDocument(guestId),
  ], ({ projectId, get }) => {
    const roomDoc = get(roomDocument(params.roomId));
    const room = readData(roomDoc) as RoomData;
    validateMember(room, params.userId, params.round);
    const stateDoc = get(stateDocument(id));
    const state = readJson<MatchState>(stateDoc);
    const payoutDoc = get(payoutDocument(id));
    if (payoutDoc) return { writes: [], result: { alreadySettled: true, outcome: stringValue(readData(payoutDoc).outcome) } };
    if (!stateDoc || !state || (!params.aborted && state.status !== 'finished')) throw new Error('아직 서버가 경기 결과를 확정하지 않았습니다.');
    if (params.aborted && state.status === 'finished') throw new Error('이미 서버가 경기 결과를 확정했습니다.');
    const outcome = params.aborted ? 'ABORTED' : state.outcome || 'DRAW';
    const amountUsd = roundMoney(numberValue(room.betAmount));
    if (!amountUsd) throw new Error('배드볼 배팅 금액이 없습니다.');
    const winnerId = outcome === 'HOST_WIN' ? room.host || '' : outcome === 'GUEST_WIN' ? room.guest || '' : '';
    const loserId = outcome === 'HOST_WIN' ? room.guest || '' : outcome === 'GUEST_WIN' ? room.host || '' : '';
    const writes = settlementWrites(projectId, params.roomId, params.round, roomDoc!, stateDoc, payoutDoc, get(stakeDocument(id, hostId)), get(stakeDocument(id, guestId)), get(profileDocument(hostId)), get(profileDocument(guestId)), outcome, amountUsd, winnerId, loserId);
    return { writes, result: { alreadySettled: false, outcome } };
  });
  return result;
}

export async function abortBadballMatch(params: MemberParams): Promise<{ alreadySettled: boolean }> {
  await settleBadballMatch({ ...params, aborted: true });
  return { alreadySettled: false };
}
