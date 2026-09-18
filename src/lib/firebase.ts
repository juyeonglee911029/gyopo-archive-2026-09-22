const firebaseConfig = {
  apiKey: 'AIzaSyAne5XuEzN2sL3px0oY5Wxsgf3m0nHHIoY',
  authDomain: 'gyopo-live-portal-506019.firebaseapp.com',
  projectId: 'gyopo-live-portal-506019',
  storageBucket: 'gyopo-live-portal-506019.firebasestorage.app',
  messagingSenderId: '376649492363',
  appId: '1:376649492363:web:10e20f97af4ee5d2fc318e',
};

const firebaseStorageBucket = firebaseConfig.storageBucket;

export const googleClientId =
  '376649492363-lgc1jrll9434im7ehi7o3o86ctrklr5u.apps.googleusercontent.com';
export const MASTER_EMAIL = 'juyeonglee911029@gmail.com';
export const MASTER_DEPOSIT_ADDRESS = 'TY6EaRPm511DzBnJEQEAetE67LXgRtzEwg';
export const MASTER_NETWORK = 'TRX';
export const USDT_NETWORK = 'TRC20';

export type Gender = 'male' | 'female';
export type GenderPreference = 'any' | Gender;

export type PortalUser = {
  id: string;
  name: string;
  email: string;
  image: string;
  usdtBalance: number;
  usdBalance: number;
  isSubscribed: boolean;
  gender?: Gender;
  genderPreference?: GenderPreference;
  premiumExpiresAt?: string;
  age?: number;
  country?: string;
  walletAddress?: string;
  walletNetwork?: string;
  walletPublic?: boolean;
  walletPinHash?: string;
  walletPinSalt?: string;
  transferPinHash?: string;
  transferPinSalt?: string;
  musicFavorites?: Array<{ id: string; title: string; artist: string; videoId: string; keywords: string[]; views?: string; published?: string; thumbnail?: string }>;
};

export type LedgerTransaction = {
  id: string;
  userId: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'P2P_SEND' | 'P2P_RECEIVE' | 'FEE' | 'GAME_STAKE' | 'GAME_PAYOUT' | 'GAME_REFUND';
  amount: number;
  fee?: number;
  status: string;
  direction: 'CREDIT' | 'DEBIT';
  details: string;
  requestId?: string;
  walletAddress?: string;
  counterpartyWalletAddress?: string;
  txHash?: string;
  network?: string;
  createdAt: string;
};

export function isMasterUser(user?: Pick<PortalUser, 'email'> | null): boolean {
  return user?.email?.toLowerCase() === MASTER_EMAIL;
}

export type OnlineUser = {
  id: string;
  userId: string;
  name: string;
  image: string;
  gender?: Gender;
  age?: number;
  country?: string;
  lastSeenAt: string;
};

export type PublicProfile = {
  name: string;
  image: string;
  gender: Gender;
  country: string;
  isPublic: true;
  age?: number;
  isSubscribed?: boolean;
  walletAddress?: string;
  walletNetwork?: string;
  walletPublic?: boolean;
  updatedAt?: string;
};

export type WalletLedgerEntry = {
  userId: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'INTERNAL_TRANSFER' | 'ONCHAIN_SEND' | 'ONCHAIN_RECEIVE' | 'MASTER_GRANT' | 'MASTER_ADJUSTMENT' | 'GAME_STAKE' | 'GAME_PAYOUT' | 'GAME_REFUND' | 'FEE';
  direction: 'IN' | 'OUT' | 'NONE';
  amount: number;
  fee?: number;
  status: 'PENDING' | 'SUBMITTED' | 'COMPLETED' | 'FAILED' | 'REJECTED';
  network?: string;
  symbol?: string;
  txHash?: string;
  fromAddress?: string;
  toAddress?: string;
  counterpartyId?: string;
  requestId?: string;
  memo?: string;
  createdAt: string | Date;
};

export type EscrowStatus = 'PAYMENT_HELD' | 'SHIPPING' | 'IN_TRANSIT' | 'DELIVERED';

export type EscrowOrder = {
  id: string;
  buyerId: string;
  sellerId: string;
  productId: string;
  amount: number;
  status: EscrowStatus;
  createdAt: string;
  updatedAt?: string;
  timeline?: Array<{ status: EscrowStatus; at: string; note?: string }>;
};

export function hasCompletedProfile(profile?: Pick<PortalUser, 'gender' | 'country' | 'age'> | null): profile is Pick<PortalUser, 'gender' | 'country' | 'age'> & { gender: Gender; country: string; age: number } {
  return (profile?.gender === 'male' || profile?.gender === 'female')
    && typeof profile.country === 'string'
    && profile.country.trim().length > 0
    && profile.country.trim() !== 'Global'
    && typeof profile.age === 'number'
    && profile.age >= 13
    && profile.age <= 130;
}

type StoredSession = {
  idToken: string;
  refreshToken?: string;
  user: PortalUser;
};

type RefreshResponse = {
  id_token: string;
  refresh_token?: string;
};

type FirestoreValue = {
  nullValue?: null;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  stringValue?: string;
  timestampValue?: string;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
};

type FirestoreDocument = {
  name?: string;
  fields?: Record<string, FirestoreValue>;
  updateTime?: string;
};

export type FirestoreFilter = {
  field: string;
  op: 'EQUAL' | 'GREATER_THAN' | 'GREATER_THAN_OR_EQUAL' | 'LESS_THAN' | 'LESS_THAN_OR_EQUAL' | 'ARRAY_CONTAINS';
  value: unknown;
};

const sessionKey = 'gyopo-auth-session';
const firestoreBase = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;
const firestoreDocumentBase = `projects/${firebaseConfig.projectId}/databases/(default)/documents`;
const serverOnlyCollections = new Set([
  'ledgerTransactions',
  'walletLedger',
  'transferRequests',
  'gameStakes',
  'gamePayouts',
  'genderMatchStakes',
  'premiumSubscriptions',
  'paddlePayments',
  'escrowOrders',
]);
const serverOnlyFinancialError = '이 금융 작업은 검증된 서버에서만 처리됩니다. 현재 클라이언트 정산 경로는 보안상 비활성화되어 있습니다.';
let refreshPromise: Promise<string | undefined> | null = null;

function assertClientWriteAllowed(collection: string): void {
  if (serverOnlyCollections.has(collection)) throw new Error(serverOnlyFinancialError);
}

function firestoreDocumentName(collection: string, id: string) {
  return `${firestoreDocumentBase}/${collection}/${encodeURIComponent(id)}`;
}

function toFirestoreValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([key, item]) => [
            key,
            toFirestoreValue(item),
          ]),
        ),
      },
    };
  }
  return { stringValue: String(value) };
}

function fromFirestoreValue(value: FirestoreValue | undefined): unknown {
  if (!value) return null;
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(fromFirestoreValue);
  if ('mapValue' in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue?.fields || {}).map(([key, item]) => [
        key,
        fromFirestoreValue(item),
      ]),
    );
  }
  return null;
}

function decodeDocument<T>(document: { name?: string; fields?: Record<string, FirestoreValue> }): T & { id: string } {
  const name = document.name || '';
  const id = name.split('/').pop() || '';
  const data = Object.fromEntries(
    Object.entries(document.fields || {}).map(([key, value]) => [key, fromFirestoreValue(value)]),
  );
  return { ...(data as T), id };
}

function encodeFields(data: Record<string, unknown>): Record<string, FirestoreValue> {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, toFirestoreValue(value)]));
}

async function getRawDocument(collection: string, id: string, token?: string): Promise<FirestoreDocument | null> {
  const response = await authenticatedFetch(`${firestoreBase}/${collection}/${encodeURIComponent(id)}`, {}, token);
  if (response.status === 404) return null;
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(errorBody?.error?.message || `Firebase 인증 요청이 거절되었습니다. (${response.status})`);
  }
  return response.json() as Promise<FirestoreDocument>;
}

function buildFieldFilter(filter: FirestoreFilter) {
  return {
    fieldFilter: {
      field: { fieldPath: filter.field },
      op: filter.op,
      value: toFirestoreValue(filter.value),
    },
  };
}

async function runQueryDocuments(collection: string, filters: FirestoreFilter[], token?: string, limit?: number): Promise<FirestoreDocument[]> {
  const structuredQuery: Record<string, unknown> = { from: [{ collectionId: collection }] };
  if (filters.length === 1) structuredQuery.where = buildFieldFilter(filters[0]);
  if (filters.length > 1) structuredQuery.where = { compositeFilter: { op: 'AND', filters: filters.map(buildFieldFilter) } };
  if (limit) structuredQuery.limit = limit;
  const data = await firestoreRequest<Array<{ document?: FirestoreDocument }>>(
    `${firestoreBase}:runQuery`,
    { method: 'POST', body: JSON.stringify({ structuredQuery }) },
    token,
  );
  return data.flatMap((item) => item.document ? [item.document] : []);
}

async function refreshStoredSessionToken(): Promise<string | undefined> {
  if (refreshPromise) return refreshPromise;
  const session = getStoredSession();
  if (!session?.refreshToken) return undefined;
  refreshPromise = fetch(`https://securetoken.googleapis.com/v1/token?key=${firebaseConfig.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(session.refreshToken)}`,
  })
    .then(async (response) => {
      if (!response.ok) return undefined;
      const data = (await response.json()) as RefreshResponse;
      if (!data.id_token) return undefined;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(sessionKey, JSON.stringify({
          ...session,
          idToken: data.id_token,
          refreshToken: data.refresh_token || session.refreshToken,
        }));
      }
      return data.id_token;
    })
    .catch(() => undefined)
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

async function authenticatedFetch(url: string, options: RequestInit = {}, token?: string): Promise<Response> {
  const send = (requestToken?: string) => fetch(url, {
    ...options,
    // A blocked Firestore request must not keep AppRuntime from restoring the
    // cached authenticated profile and rendering protected screens.
    signal: options.signal || AbortSignal.timeout(10_000),
    headers: {
      ...(options.headers || {}),
      ...(requestToken ? { Authorization: `Bearer ${requestToken}` } : {}),
    },
  });
  let response = await send(token);
  if (response.status === 401 && token) {
    const refreshed = await refreshStoredSessionToken();
    if (refreshed) response = await send(refreshed);
  }
  return response;
}

async function firestoreRequest<T>(url: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await authenticatedFetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  }, token);
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `Firestore request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export async function listDocuments<T>(collection: string, token?: string): Promise<Array<T & { id: string }>> {
  const response = await authenticatedFetch(`${firestoreBase}/${collection}`, {}, token);
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(await response.text());
  const data = (await response.json()) as { documents?: Array<{ name?: string; fields?: Record<string, FirestoreValue> }> };
  return (data.documents || []).map((document) => decodeDocument<T>(document));
}

export async function queryDocuments<T>(collection: string, field: string, value: unknown, token?: string): Promise<Array<T & { id: string }>> {
  return (await runQueryDocuments(collection, [{ field, op: 'EQUAL', value }], token)).map((document) => decodeDocument<T>(document));
}

export async function queryDocumentsWhere<T>(collection: string, filters: FirestoreFilter[], token?: string, limit?: number): Promise<Array<T & { id: string }>> {
  return (await runQueryDocuments(collection, filters, token, limit)).map((document) => decodeDocument<T>(document));
}

export async function getDocument<T>(collection: string, id: string, token?: string): Promise<(T & { id: string }) | null> {
  const response = await authenticatedFetch(`${firestoreBase}/${collection}/${encodeURIComponent(id)}`, {}, token);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await response.text());
  return decodeDocument<T>(await response.json());
}

export async function createDocument<T extends Record<string, unknown>>(
  collection: string,
  id: string,
  data: T,
  token?: string,
): Promise<void> {
  assertClientWriteAllowed(collection);
  await firestoreRequest(
    `${firestoreBase}/${collection}?documentId=${encodeURIComponent(id)}`,
    {
      method: 'POST',
      body: JSON.stringify({
        fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, toFirestoreValue(value)])),
      }),
    },
    token,
  );
}

export async function uploadStorageFile(file: Blob, path: string, token?: string): Promise<string> {
  if (!token) throw new Error('로그인 세션이 없어 파일을 업로드할 수 없습니다.');
  const response = await fetch(`https://firebasestorage.googleapis.com/v0/b/${firebaseStorageBucket}/o?uploadType=media&name=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });
  const result = await response.json().catch(() => null) as { name?: string; downloadTokens?: string } | null;
  if (!response.ok || !result?.name) throw new Error('파일 업로드에 실패했습니다.');
  const downloadToken = result.downloadTokens?.split(',')[0];
  const query = downloadToken ? `&token=${encodeURIComponent(downloadToken)}` : '';
  return `https://firebasestorage.googleapis.com/v0/b/${firebaseStorageBucket}/o/${encodeURIComponent(result.name)}?alt=media${query}`;
}

export async function recordLedgerTransaction(entry: Omit<LedgerTransaction, 'createdAt'> & { id: string; createdAt?: string }, token?: string): Promise<void> {
  void entry;
  void token;
  throw new Error(serverOnlyFinancialError);
}

export async function listLedgerTransactions(userId: string, token?: string): Promise<LedgerTransaction[]> {
  return queryDocuments<LedgerTransaction>('ledgerTransactions', 'userId', userId, token);
}

export async function publishDocument<T extends Record<string, unknown>>(
  collection: string,
  id: string,
  data: T,
  token?: string,
): Promise<void> {
  assertClientWriteAllowed(collection);
  const fields = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, toFirestoreValue(value)]));
  const createResponse = await authenticatedFetch(`${firestoreBase}/${collection}?documentId=${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  }, token);
  if (createResponse.ok) return;
  // Firestore can reject the create attempt with 403 when the document
  // already exists but its rules only allow an update.
  if (createResponse.status !== 409 && createResponse.status !== 403) throw new Error(await createResponse.text());

  const updateResponse = await authenticatedFetch(`${firestoreBase}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      writes: [{
        update: { name: firestoreDocumentName(collection, id), fields },
        updateMask: { fieldPaths: Object.keys(data) },
      }],
    }),
  }, token);
  if (!updateResponse.ok) throw new Error(await updateResponse.text());
}

export async function upsertDocument<T extends Record<string, unknown>>(
  collection: string,
  id: string,
  data: T,
  token?: string,
): Promise<void> {
  await publishDocument(collection, id, data, token);
}

export async function mergeDocument<T extends Record<string, unknown>>(
  collection: string,
  id: string,
  data: T,
  token?: string,
): Promise<void> {
  assertClientWriteAllowed(collection);
  await firestoreRequest(`${firestoreBase}:commit`, {
    method: 'POST',
    body: JSON.stringify({
      writes: [{
        update: { name: firestoreDocumentName(collection, id), fields: encodeFields(data) },
        updateMask: { fieldPaths: Object.keys(data) },
      }],
    }),
  }, token);
}

async function replaceDocument<T extends Record<string, unknown>>(
  collection: string,
  id: string,
  data: T,
  token?: string,
): Promise<void> {
  await firestoreRequest(`${firestoreBase}:commit`, {
    method: 'POST',
    body: JSON.stringify({
      writes: [{
        update: {
          name: firestoreDocumentName(collection, id),
          fields: encodeFields(data),
        },
      }],
    }),
  }, token);
}

export async function incrementDocument(collection: string, id: string, field: string, amount: number, token?: string): Promise<void> {
  assertClientWriteAllowed(collection);
  await firestoreRequest(`${firestoreBase}:commit`, {
    method: 'POST',
    body: JSON.stringify({
      writes: [{
        transform: {
          document: firestoreDocumentName(collection, id),
          fieldTransforms: [{ fieldPath: field, increment: toFirestoreValue(amount) }],
        },
      }],
    }),
  }, token);
}

export async function approveDepositRequest(requestId: string, userId: string, reviewedBy: string, token?: string): Promise<void> {
  void requestId;
  void userId;
  void reviewedBy;
  void token;
  throw new Error(serverOnlyFinancialError);
}

export async function reviewDepositRequest(requestId: string, status: 'REJECTED', reviewedBy: string, token?: string): Promise<void> {
  const requestDocument = await getRawDocument('depositRequests', requestId, token);
  if (!requestDocument?.name || !requestDocument.updateTime) throw new Error('입금 신청을 찾을 수 없습니다.');
  const request = decodeDocument<{ status?: string }>(requestDocument);
  if (request.status !== 'PENDING') throw new Error('이미 처리된 입금 신청입니다.');
  const response = await authenticatedFetch(`${firestoreBase}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      writes: [{
        update: {
          name: requestDocument.name,
          fields: { ...(requestDocument.fields || {}), ...encodeFields({ status, reviewedAt: new Date(), reviewedBy }) },
        },
        currentDocument: { updateTime: requestDocument.updateTime },
      }],
    }),
  }, token);
  if (!response.ok) throw new Error('거절 처리 중 서버 원장 충돌이 발생했습니다. 목록을 새로고침해주세요.');
}

export async function approveTransferRequest(requestId: string, reviewedBy: string, token?: string): Promise<void> {
  void requestId;
  void reviewedBy;
  void token;
  throw new Error(serverOnlyFinancialError);
}

export async function sendUserTransfer(
  senderId: string,
  recipientId: string,
  amount: number,
  fee = 0,
  token = getSessionToken(),
  options: { kind?: string; roomId?: string; memo?: string } = {},
): Promise<string> {
  void senderId;
  void recipientId;
  void amount;
  void fee;
  void token;
  void options;
  throw new Error(serverOnlyFinancialError);
}

export async function reviewTransferRequest(requestId: string, status: 'REJECTED', reviewedBy: string, token?: string): Promise<void> {
  void requestId;
  void status;
  void reviewedBy;
  void token;
  throw new Error(serverOnlyFinancialError);
}

export type TetrisQueueProfile = {
  id: string;
  name: string;
  image: string;
  country?: string;
  age?: number;
  gender?: string;
  genderPreference?: GenderPreference;
  ageMin?: number;
  ageMax?: number;
  isSubscribed?: boolean;
  targetUserId?: string;
  queueKind?: 'random' | 'friend' | 'game';
};
export type TetrisMatchClaim = { matchId: string; role: 'A' | 'B'; opponent: TetrisQueueProfile };
export type TetrisLobbyRoom = {
  roomNumber?: number;
  status?: 'idle' | 'waiting' | 'occupied';
  activeMatchId?: string;
  inviteOnly?: boolean;
  invitedUserId?: string;
  waitingUserId?: string;
  waitingUser?: TetrisQueueProfile;
  playerAId?: string;
  playerA?: TetrisQueueProfile;
  playerBId?: string;
  playerB?: TetrisQueueProfile;
  updatedAt?: string;
};
export type TetrisLobbyClaim = { roomNumber: number; matchId: string; role: 'A' | 'B'; opponent?: TetrisQueueProfile };
export type WebrtcMatchClaim = { callId: string; opponent: TetrisQueueProfile; initiator: boolean };
export type BrickBreakerQueueProfile = { id: string; name: string; image?: string; country?: string };
export type BrickBreakerMatchClaim = { roomCode: string; opponent: BrickBreakerQueueProfile };

export type AccountModeration = {
  userId: string;
  status: 'active' | 'suspended' | 'banned';
  reason?: string;
  until?: string;
  updatedAt?: string;
  updatedBy?: string;
};

export type SafetyReport = {
  reporterId: string;
  reportedUserId: string;
  callId?: string;
  category: 'sexual_content' | 'minor_safety' | 'harassment' | 'privacy' | 'spam' | 'other';
  details?: string;
  createdAt: Date;
  status: 'open';
};

export async function getAccountModeration(userId: string, token = getSessionToken()): Promise<AccountModeration | null> {
  if (!token || !userId) return null;
  return getDocument<AccountModeration>('accountModeration', userId, token).catch(() => null);
}

export async function listBlockedUserIds(userId: string, token = getSessionToken()): Promise<string[]> {
  if (!token || !userId) return [];
  const rows = await queryDocumentsWhere<{ ownerId: string; blockedUserId: string }>('userBlocks', [{ field: 'ownerId', op: 'EQUAL', value: userId }], token, 500).catch(() => []);
  return rows.map((row) => row.blockedUserId).filter((value): value is string => typeof value === 'string' && value.length > 0);
}

export async function createUserBlock(ownerId: string, blockedUserId: string, blockedName: string, callId?: string, token = getSessionToken()): Promise<void> {
  if (!token || !ownerId || !blockedUserId || ownerId === blockedUserId) throw new Error('차단할 상대를 확인해주세요.');
  await createDocument('userBlocks', `${ownerId}-${blockedUserId}`, { ownerId, blockedUserId, blockedName: blockedName.slice(0, 80), callId: callId || null, createdAt: new Date() }, token);
}

export async function createSafetyReport(report: SafetyReport, token = getSessionToken()): Promise<string> {
  if (!token || !report.reporterId || !report.reportedUserId || report.reporterId === report.reportedUserId) throw new Error('신고 대상을 확인해주세요.');
  const id = `safety-report-${crypto.randomUUID()}`;
  await createDocument('safetyReports', id, { ...report, details: report.details?.slice(0, 500) || '' }, token);
  return id;
}

export async function createSafetyAuditLog(data: { actorId: string; action: 'report' | 'block' | 'call_start' | 'call_end'; targetUserId?: string; callId?: string; metadata?: string }, token = getSessionToken()): Promise<void> {
  if (!token || !data.actorId) return;
  await createDocument('safetyAuditLogs', `audit-${crypto.randomUUID()}`, { ...data, metadata: data.metadata?.slice(0, 500) || '', createdAt: new Date() }, token).catch(() => undefined);
}

const TETRIS_LOBBY_ROOM_COUNT = 10;
const TETRIS_LOBBY_STALE_MS = 30_000;
const TETRIS_COUNTDOWN_MS = 3_000;

function tetrisLobbyId(roomNumber: number) {
  return `room-${roomNumber}`;
}

function tetrisProfile(profile: TetrisQueueProfile): TetrisQueueProfile {
  return { id: profile.id, name: profile.name, image: profile.image, country: profile.country || 'Global' };
}

function isFreshTetrisLobbyRoom(room: TetrisLobbyRoom | null): boolean {
  if (!room?.updatedAt) return false;
  const timestamp = new Date(room.updatedAt).getTime();
  return Number.isFinite(timestamp) && timestamp > Date.now() - TETRIS_LOBBY_STALE_MS;
}

async function compareAndMergeTetrisLobbyRoom(
  roomNumber: number,
  data: Record<string, unknown>,
  token: string | undefined,
  updateTime?: string,
): Promise<boolean> {
  const response = await authenticatedFetch(`${firestoreBase}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      writes: [{
        update: { name: firestoreDocumentName('tetrisLobby', tetrisLobbyId(roomNumber)), fields: encodeFields(data) },
        updateMask: { fieldPaths: Object.keys(data) },
        currentDocument: updateTime ? { updateTime } : { exists: false },
      }],
    }),
  }, token);
  return response.ok;
}

function waitingLobbyData(roomNumber: number, matchId: string, profile: TetrisQueueProfile, invitedUserId?: string): Record<string, unknown> {
  const member = tetrisProfile(profile);
  return {
    roomNumber,
    status: 'waiting',
    activeMatchId: matchId,
    inviteOnly: Boolean(invitedUserId),
    invitedUserId: invitedUserId || null,
    waitingUserId: member.id,
    waitingUser: member,
    playerAId: member.id,
    playerA: member,
    playerBId: null,
    playerB: null,
    updatedAt: new Date(),
  };
}

async function setTetrisRoomAccess(
  roomNumber: number,
  matchId: string,
  playerAId: string | null | undefined,
  playerBId: string | null | undefined,
  token?: string,
  active = true,
): Promise<void> {
  await mergeDocument('tetrisRoomAccess', matchId, {
    roomNumber,
    matchId,
    playerAId: playerAId || null,
    playerBId: playerBId || null,
    active,
    updatedAt: new Date(),
  }, token);
}

export async function claimTetrisLobbyRoom(profile: TetrisQueueProfile, token?: string): Promise<TetrisLobbyClaim | null> {
  const member = tetrisProfile(profile);
  for (let roomNumber = 1; roomNumber <= TETRIS_LOBBY_ROOM_COUNT; roomNumber += 1) {
    const document = await getRawDocument('tetrisLobby', tetrisLobbyId(roomNumber), token).catch(() => null);
    const room = document ? decodeDocument<TetrisLobbyRoom>(document) : null;
    if (room?.status === 'occupied' && isFreshTetrisLobbyRoom(room)) {
      if (room.playerAId === member.id && room.activeMatchId) {
        await setTetrisRoomAccess(roomNumber, room.activeMatchId, room.playerAId, room.playerBId, token).catch(() => undefined);
        return { roomNumber, matchId: room.activeMatchId, role: 'A', opponent: room.playerB };
      }
      if (room.playerBId === member.id && room.activeMatchId) {
        await setTetrisRoomAccess(roomNumber, room.activeMatchId, room.playerAId, room.playerBId, token).catch(() => undefined);
        return { roomNumber, matchId: room.activeMatchId, role: 'B', opponent: room.playerA };
      }
      continue;
    }
    if (room?.status === 'waiting' && room.waitingUserId === member.id && room.activeMatchId) {
      await compareAndMergeTetrisLobbyRoom(roomNumber, { updatedAt: new Date() }, token, document?.updateTime);
      await setTetrisRoomAccess(roomNumber, room.activeMatchId, room.playerAId || member.id, room.playerBId, token).catch(() => undefined);
      return { roomNumber, matchId: room.activeMatchId, role: 'A' };
    }
    if (room?.status === 'waiting' && room.inviteOnly) continue;
    if (room?.status === 'waiting' && room.waitingUserId && isFreshTetrisLobbyRoom(room)) {
      const matchId = room.activeMatchId || `tetris-room-${roomNumber}-${crypto.randomUUID()}`;
      const joined = await compareAndMergeTetrisLobbyRoom(roomNumber, {
        roomNumber,
        status: 'occupied',
        activeMatchId: matchId,
        inviteOnly: false,
        invitedUserId: null,
        waitingUserId: null,
        waitingUser: null,
        playerAId: room.playerAId || room.waitingUserId,
        playerA: room.playerA || room.waitingUser,
        playerBId: member.id,
        playerB: member,
        updatedAt: new Date(),
      }, token, document?.updateTime);
       if (joined) {
         await setTetrisRoomAccess(roomNumber, matchId, room.playerAId || room.waitingUserId, member.id, token).catch(() => undefined);
         return { roomNumber, matchId, role: 'B', opponent: room.playerA || room.waitingUser };
       }
      continue;
    }
    const matchId = `tetris-room-${roomNumber}-${crypto.randomUUID()}`;
    const claimed = await compareAndMergeTetrisLobbyRoom(roomNumber, waitingLobbyData(roomNumber, matchId, member), token, document?.updateTime);
    if (claimed) {
      await setTetrisRoomAccess(roomNumber, matchId, member.id, null, token).catch(() => undefined);
      return { roomNumber, matchId, role: 'A' };
    }
  }
  return null;
}

export async function reserveTetrisLobbyRoom(profile: TetrisQueueProfile, matchId: string, token?: string, invitedUserId?: string): Promise<number | null> {
  const member = tetrisProfile(profile);
  for (let roomNumber = 1; roomNumber <= TETRIS_LOBBY_ROOM_COUNT; roomNumber += 1) {
    const document = await getRawDocument('tetrisLobby', tetrisLobbyId(roomNumber), token).catch(() => null);
    const room = document ? decodeDocument<TetrisLobbyRoom>(document) : null;
    if (room?.status === 'occupied') continue;
    if (room?.status === 'waiting') {
      if (room.waitingUserId === member.id) continue;
      if (room.inviteOnly) continue;
      if (isFreshTetrisLobbyRoom(room)) continue;
    }
    const claimed = await compareAndMergeTetrisLobbyRoom(roomNumber, waitingLobbyData(roomNumber, matchId, member, invitedUserId), token, document?.updateTime);
    if (claimed) {
      await setTetrisRoomAccess(roomNumber, matchId, member.id, null, token);
      return roomNumber;
    }
  }
  return null;
}

export async function joinTetrisLobbyRoom(roomNumber: number, matchId: string, profile: TetrisQueueProfile, token?: string): Promise<boolean> {
  const document = await getRawDocument('tetrisLobby', tetrisLobbyId(roomNumber), token).catch(() => null);
  if (!document) return false;
  const room = decodeDocument<TetrisLobbyRoom>(document);
  if (room.status !== 'waiting' || room.activeMatchId !== matchId || !room.waitingUserId || !room.inviteOnly || room.invitedUserId !== profile.id || !isFreshTetrisLobbyRoom(room)) return false;
  const member = tetrisProfile(profile);
  const joined = await compareAndMergeTetrisLobbyRoom(roomNumber, {
    roomNumber,
    status: 'occupied',
    activeMatchId: matchId,
    inviteOnly: false,
    invitedUserId: null,
    waitingUserId: null,
    waitingUser: null,
    playerAId: room.playerAId || room.waitingUserId,
    playerA: room.playerA || room.waitingUser,
    playerBId: member.id,
    playerB: member,
    updatedAt: new Date(),
  }, token, document.updateTime);
  if (joined) await setTetrisRoomAccess(roomNumber, matchId, room.playerAId || room.waitingUserId, member.id, token);
  return joined;
}

export async function heartbeatTetrisLobbyRoom(
  roomNumber: number,
  matchId: string,
  profile: TetrisQueueProfile,
  role: 'A' | 'B',
  token?: string,
): Promise<boolean> {
  const document = await getRawDocument('tetrisLobby', tetrisLobbyId(roomNumber), token).catch(() => null);
  if (!document) return false;
  const room = decodeDocument<TetrisLobbyRoom>(document);
  if (room.activeMatchId !== matchId) return false;
  const member = tetrisProfile(profile);
  return compareAndMergeTetrisLobbyRoom(roomNumber, {
    updatedAt: new Date(),
    ...(role === 'A' ? { playerAId: member.id, playerA: member, ...(room.status === 'waiting' ? { waitingUserId: member.id, waitingUser: member } : {}) } : { playerBId: member.id, playerB: member }),
  }, token, document.updateTime);
}

export async function releaseTetrisLobbyRoom(roomNumber: number, matchId: string, role: 'A' | 'B', token?: string, keepRemaining = true): Promise<string | null> {
  const document = await getRawDocument('tetrisLobby', tetrisLobbyId(roomNumber), token).catch(() => null);
  if (!document) return null;
  const room = decodeDocument<TetrisLobbyRoom>(document);
  if (room.activeMatchId !== matchId) return null;
  const remaining = role === 'A' ? room.playerB : room.playerA;
  if (keepRemaining && remaining?.id) {
    const nextMatchId = `tetris-room-${roomNumber}-${crypto.randomUUID()}`;
    const released = await compareAndMergeTetrisLobbyRoom(roomNumber, waitingLobbyData(roomNumber, nextMatchId, remaining), token, document.updateTime);
    await setTetrisRoomAccess(roomNumber, matchId, room.playerAId, room.playerBId, token, false).catch(() => undefined);
    if (released) await setTetrisRoomAccess(roomNumber, nextMatchId, remaining.id, null, token).catch(() => undefined);
    return released ? nextMatchId : null;
  }
  const released = await compareAndMergeTetrisLobbyRoom(roomNumber, {
    roomNumber,
    status: 'idle',
    activeMatchId: null,
    waitingUserId: null,
    waitingUser: null,
    playerAId: null,
    playerA: null,
    playerBId: null,
    playerB: null,
    updatedAt: new Date(),
  }, token, document.updateTime);
  await setTetrisRoomAccess(roomNumber, matchId, room.playerAId, room.playerBId, token, false).catch(() => undefined);
  return released ? '' : null;
}

async function getWaitingQueueDocuments(collection: string, token?: string): Promise<FirestoreDocument[]> {
  try {
    const queried = await runQueryDocuments(collection, [{ field: 'status', op: 'EQUAL', value: 'waiting' }], token, 50);
    if (queried.length) return queried;
  } catch {
    // The collection read below keeps matching alive when a REST query briefly fails.
  }
  const response = await authenticatedFetch(`${firestoreBase}/${collection}`, {}, token);
  if (!response.ok) return [];
  const data = (await response.json()) as { documents?: FirestoreDocument[] };
  return (data.documents || []).filter((row) => fromFirestoreValue(row.fields?.status) === 'waiting');
}

export async function claimBrickBreakerMatch(profile: BrickBreakerQueueProfile, mode: 'classic' | 'items', token?: string, requestedRoomCode?: string): Promise<BrickBreakerMatchClaim | null> {
  const waiting = await getWaitingQueueDocuments('brickBreakerQueue', token);
  const ownRow = waiting.find((row) => {
    const value = decodeDocument<{ userId?: string }>(row);
    return (value.userId || value.id) === profile.id && row.updateTime;
  });
  if (!ownRow?.name || !ownRow.updateTime) return null;
  const candidateRow = waiting.find((row) => {
    const candidate = decodeDocument<{ userId?: string; mode?: string; status?: string; updatedAt?: string }>(row);
    const candidateId = candidate.userId || candidate.id;
    return candidateId !== profile.id && candidate.mode === mode && candidate.status === 'waiting'
      && typeof candidate.updatedAt === 'string' && Date.parse(candidate.updatedAt) > Date.now() - 45_000 && Boolean(row.updateTime);
  });
  if (!candidateRow?.name || !candidateRow.updateTime) return null;
  const candidate = decodeDocument<BrickBreakerQueueProfile & { userId?: string; mode: 'classic' | 'items'; status: 'waiting'; }>(candidateRow);
  const candidateId = candidate.userId || candidate.id;
  const roomCode = requestedRoomCode || Array.from(crypto.getRandomValues(new Uint8Array(12)), (value) => value.toString(16).padStart(2, '0')).join('').toUpperCase();
  const now = new Date();
  const opponent: BrickBreakerQueueProfile = { id: candidateId, name: candidate.name, image: candidate.image, country: candidate.country };
  const candidateFields = {
    ...(candidateRow.fields || {}),
    ...encodeFields({ status: 'matched', roomCode, hostId: profile.id, matchedBy: profile.id, opponent: profile, updatedAt: now }),
  };
  const ownFields = {
    ...(ownRow.fields || {}),
    ...encodeFields({ id: profile.id, userId: profile.id, name: profile.name, image: profile.image || '', country: profile.country || 'Global', mode, status: 'matched', roomCode, hostId: profile.id, matchedBy: profile.id, opponent, updatedAt: now }),
  };
  const response = await authenticatedFetch(`${firestoreBase}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes: [
      { update: { name: candidateRow.name, fields: candidateFields }, currentDocument: { updateTime: candidateRow.updateTime } },
      { update: { name: ownRow.name, fields: ownFields }, currentDocument: { updateTime: ownRow.updateTime } },
    ] }),
  }, token);
  if (!response.ok) {
    if (response.status === 409 || response.status === 412) return null;
    const result = await response.json().catch(() => null) as { error?: { message?: string; status?: string } } | null;
    if (response.status === 400 && result?.error?.status === 'FAILED_PRECONDITION') return null;
    throw new Error(result?.error?.message || `매칭 요청이 거절되었습니다. (${response.status})`);
  }
  return { roomCode, opponent };
}

function isFreshQueueDocument(row: FirestoreDocument, maxAgeMs: number): boolean {
  const lastSeenAt = fromFirestoreValue(row.fields?.lastSeenAt);
  return typeof lastSeenAt === 'string' && new Date(lastSeenAt).getTime() > Date.now() - maxAgeMs && Boolean(row.name && row.updateTime);
}

export async function claimTetrisMatch(profile: TetrisQueueProfile, token?: string): Promise<TetrisMatchClaim | null> {
  const waiting = await getWaitingQueueDocuments('tetrisQueue', token);
  const candidateRow = waiting.find((row) => {
    const candidate = decodeDocument<{ userId?: string }>(row);
    const candidateId = candidate.userId || candidate.id;
    return candidateId !== profile.id && isFreshQueueDocument(row, 120_000);
  });
  if (!candidateRow?.name || !candidateRow.updateTime) return null;

  const candidate = decodeDocument<TetrisQueueProfile & { userId: string }>(candidateRow);
  candidate.userId = candidate.userId || candidate.id;
  const matchId = `tetris-${profile.id}-${candidate.userId}-${crypto.randomUUID()}`;
  const opponent: TetrisQueueProfile = { id: candidate.userId, name: candidate.name, image: candidate.image, country: candidate.country };
  const candidateData = {
    status: 'matched',
    matchedBy: profile.id,
    matchId,
    role: 'B',
    opponent: profile,
    lastSeenAt: new Date(),
    updatedAt: new Date(),
  };
  const ownData = {
    userId: profile.id,
    name: profile.name,
    image: profile.image,
    country: profile.country || 'Global',
    status: 'matched',
    matchedBy: profile.id,
    matchId,
    role: 'A',
    opponent,
    lastSeenAt: new Date(),
    updatedAt: new Date(),
  };
  const candidateFields = { ...(candidateRow.fields || {}), ...encodeFields(candidateData) };
   const ownName = firestoreDocumentName('tetrisQueue', profile.id);
  const response = await authenticatedFetch(`${firestoreBase}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      writes: [
        { update: { name: candidateRow.name, fields: candidateFields }, currentDocument: { updateTime: candidateRow.updateTime } },
        { update: { name: ownName, fields: encodeFields(ownData) } },
      ],
    }),
  }, token);
  if (!response.ok) return null;
  return { matchId, role: 'A', opponent };
}

export async function claimWebrtcMatch(profile: TetrisQueueProfile, token?: string, blockedUserIds: string[] = []): Promise<WebrtcMatchClaim | null> {
  const waiting = await getWaitingQueueDocuments('webrtcQueue', token);
  const ownRow = waiting.find((row) => decodeDocument<{ userId?: string }>(row).userId === profile.id);
  if (!ownRow?.updateTime || !isFreshQueueDocument(ownRow, 120_000)) return null;
  const blocked = new Set(blockedUserIds);
  const candidateRow = waiting.find((row) => {
    const candidate = decodeDocument<TetrisQueueProfile & { userId?: string }>(row);
    const candidateId = candidate.userId || candidate.id;
    const requesterKind = profile.queueKind || (profile.targetUserId ? 'friend' : 'random');
    const candidateKind = candidate.queueKind || (candidate.targetUserId ? 'friend' : 'random');
    const requesterPreference = profile.genderPreference || 'any';
    const candidatePreference = candidate.genderPreference || 'any';
    const requesterMatches = requesterPreference === 'any' || candidate.gender === requesterPreference;
    const candidateMatches = candidatePreference === 'any' || profile.gender === candidatePreference;
    const candidateAge = Number(candidate.age || 0);
    const targetMatches = (!profile.targetUserId || candidateId === profile.targetUserId)
      && (!candidate.targetUserId || candidate.targetUserId === profile.id);
    const directCall = Boolean(profile.targetUserId || candidate.targetUserId);
    const requesterAgeMatches = directCall || ((!profile.ageMin && !profile.ageMax)
      || (candidateAge >= (profile.ageMin || 18) && candidateAge <= (profile.ageMax || 60)));
    const candidateAgeMatches = directCall || ((!candidate.ageMin && !candidate.ageMax)
      || (Number(profile.age || 0) >= (candidate.ageMin || 18) && Number(profile.age || 0) <= (candidate.ageMax || 60)));
    return candidateId !== profile.id && !blocked.has(candidateId) && candidateKind === requesterKind && isFreshQueueDocument(row, 120_000) && requesterMatches && candidateMatches && requesterAgeMatches && candidateAgeMatches && targetMatches;
  });
  if (!candidateRow?.name || !candidateRow.updateTime) return null;
  const candidate = decodeDocument<TetrisQueueProfile & { userId: string }>(candidateRow);
  candidate.userId = candidate.userId || candidate.id;
  const callId = `webrtc-${profile.id}-${candidate.userId}-${crypto.randomUUID()}`;
  const opponent: TetrisQueueProfile = {
    id: candidate.userId,
    name: candidate.name,
    image: candidate.image,
    country: candidate.country,
    age: candidate.age,
    gender: candidate.gender,
    genderPreference: candidate.genderPreference,
    isSubscribed: candidate.isSubscribed,
    targetUserId: candidate.targetUserId,
  };
  const candidateFields = {
    ...(candidateRow.fields || {}),
    ...encodeFields({ status: 'matched', matchedBy: profile.id, callId, opponent: profile, lastSeenAt: new Date(), updatedAt: new Date() }),
  };
   const ownName = firestoreDocumentName('webrtcQueue', profile.id);
  const response = await authenticatedFetch(`${firestoreBase}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      writes: [
        { update: { name: candidateRow.name, fields: candidateFields }, currentDocument: { updateTime: candidateRow.updateTime } },
        { update: { name: ownName, fields: { ...(ownRow.fields || {}), ...encodeFields({ userId: profile.id, name: profile.name, image: profile.image, country: profile.country || 'Global', age: profile.age || 0, status: 'matched', matchedBy: profile.id, callId, opponent, lastSeenAt: new Date(), updatedAt: new Date() }) } }, currentDocument: { updateTime: ownRow.updateTime } },
      ],
    }),
  }, token);
  if (!response.ok) {
    // Concurrent queue heartbeats/claims are retryable; permission/server failures are not "no peer".
    if (response.status === 409 || response.status === 412) return null;
    const result = await response.json().catch(() => null) as { error?: { message?: string; status?: string } } | null;
    if (response.status === 400 && result?.error?.status === 'FAILED_PRECONDITION') return null;
    throw new Error(result?.error?.message || `매칭 요청이 거절되었습니다. (${response.status})`);
  }
  return { callId, opponent, initiator: profile.id < candidate.userId };
}

export async function reserveGameStake(userId: string, matchId: string, amount: number, token?: string): Promise<void> {
  void userId;
  void matchId;
  void amount;
  void token;
  throw new Error(serverOnlyFinancialError);
}

export async function refundGameStake(userId: string, matchId: string, token?: string): Promise<void> {
  void userId;
  void matchId;
  void token;
  throw new Error(serverOnlyFinancialError);
}

export async function startTetrisCountdown(matchId: string, token?: string): Promise<string | null> {
  const roomDocument = await getRawDocument('tetrisRooms', matchId, token).catch(() => null);
  if (!roomDocument?.name || !roomDocument.updateTime) return null;
  const room = decodeDocument<{
    phase?: string;
    readyA?: boolean;
    readyB?: boolean;
    stakeHeldA?: boolean;
    stakeHeldB?: boolean;
    startAt?: string;
  }>(roomDocument);
  if (room.startAt) return room.startAt;
  if (room.phase === 'finished' || !room.readyA || !room.readyB || !room.stakeHeldA || !room.stakeHeldB) return null;

   const startAt = new Date(Date.now() + TETRIS_COUNTDOWN_MS).toISOString();
  const response = await authenticatedFetch(`${firestoreBase}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      writes: [{
        update: {
          name: roomDocument.name,
          fields: { ...(roomDocument.fields || {}), ...encodeFields({ phase: 'countdown', startAt, updatedAt: new Date() }) },
        },
        currentDocument: { updateTime: roomDocument.updateTime },
      }],
    }),
  }, token);
  if (response.ok) return startAt;
  const current = await getRawDocument('tetrisRooms', matchId, token).catch(() => null);
  return current ? String(fromFirestoreValue(current.fields?.startAt) || '') || null : null;
}

export async function settleTetrisMatch(
  matchId: string,
  winnerId: string,
  loserId: string,
  amount: number,
  token?: string,
): Promise<void> {
  void matchId;
  void winnerId;
  void loserId;
  void amount;
  void token;
  throw new Error(serverOnlyFinancialError);
}

export async function reserveGenderMatchStake(userId: string, callId: string, amount: number, token?: string): Promise<void> {
  void userId;
  void callId;
  void amount;
  void token;
  throw new Error(serverOnlyFinancialError);
}

export async function purchasePremiumSubscription(userId: string, token?: string): Promise<PortalUser> {
  void userId;
  void token;
  throw new Error(serverOnlyFinancialError);
}

export async function reserveEscrowPurchase(
  buyerId: string,
  productId: string,
  sellerId: string,
  amount: number,
  token?: string,
): Promise<string> {
  void buyerId;
  void productId;
  void sellerId;
  void amount;
  void token;
  throw new Error(serverOnlyFinancialError);
}

export async function listEscrowOrdersForMember(memberId: string, token = getSessionToken()): Promise<EscrowOrder[]> {
  const viewerId = getTokenUserId(token);
  if (!viewerId || !token) return [];
  const [purchases, sales] = await Promise.all([
    queryDocuments<Omit<EscrowOrder, 'id'>>('escrowOrders', 'buyerId', viewerId, token),
    queryDocuments<Omit<EscrowOrder, 'id'>>('escrowOrders', 'sellerId', viewerId, token),
  ]);
  const unique = new Map([...purchases, ...sales].map((order) => [order.id, order]));
  return [...unique.values()]
    .filter((order) => memberId === viewerId || order.buyerId === memberId || order.sellerId === memberId)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
}

export type FriendStatus = 'pending' | 'accepted' | 'declined';
export async function listFriendMessages<T>(userId: string, friendshipId: string): Promise<Array<T & { id: string }>> {
  const token = await getFreshSessionToken();
  if (!token || getTokenUserId(token) !== userId) throw new Error('다시 로그인해주세요.');
  // A single friendship scope lets Firestore evaluate the stored membership rule.
  return queryDocumentsWhere<T>('friendMessages', [
    { field: 'friendshipId', op: 'EQUAL', value: friendshipId },
    { field: 'participants', op: 'ARRAY_CONTAINS', value: userId },
  ], token);
}

export type FriendConnection = {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: FriendStatus;
  createdAt: string;
  updatedAt: string;
  sourceCollection?: 'friendships' | 'webrtcCalls';
};

const friendConnectionCollection = 'friendships';
const legacyFriendConnectionCollection = 'webrtcCalls';

function friendshipId(first: string, second: string) {
  return `friend-${[first, second].sort().join('-')}`;
}

export async function listFriendConnections(userId: string, token = getSessionToken()): Promise<FriendConnection[]> {
  const viewerId = getTokenUserId(token);
  if (!token || (viewerId && viewerId !== userId)) return [];
  const collections = [friendConnectionCollection, legacyFriendConnectionCollection] as const;
  const rows = await Promise.all(collections.flatMap((collection) => [
    queryDocumentsWhere<Omit<FriendConnection, 'id'>>(collection, [{ field: 'requesterId', op: 'EQUAL', value: userId }], token).then((items) => items.map((item) => ({ ...item, sourceCollection: collection }))).catch(() => []),
    queryDocumentsWhere<Omit<FriendConnection, 'id'>>(collection, [{ field: 'addresseeId', op: 'EQUAL', value: userId }], token).then((items) => items.map((item) => ({ ...item, sourceCollection: collection }))).catch(() => []),
  ]));
  return [...new Map(rows.flat().map((item) => [item.id, item])).values()]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function sendFriendRequest(addresseeId: string, token = getSessionToken()): Promise<void> {
  const requesterId = getTokenUserId(token);
  if (!token || !requesterId || !addresseeId || requesterId === addresseeId) throw new Error('친구 요청 대상을 확인해주세요.');
  const id = friendshipId(requesterId, addresseeId);
  const existing = await Promise.all(collectionsForFriendship().map((collection) => getDocument<FriendConnection>(collection, id, token).then((item) => item ? { ...item, sourceCollection: collection } : null).catch(() => null))).then((items) => items.find(Boolean) || null);
  if (existing?.status === 'accepted' || existing?.status === 'pending') return;
  if (existing?.status === 'declined') {
    await deleteDocument(existing.sourceCollection || friendConnectionCollection, id, token);
  }
  const now = new Date();
  try {
    await createDocument(friendConnectionCollection, id, { requesterId, addresseeId, status: 'pending', createdAt: now, updatedAt: now }, token);
  } catch (error) {
    await createDocument(legacyFriendConnectionCollection, id, { requesterId, addresseeId, status: 'pending', createdAt: now, updatedAt: now }, token).catch(async (legacyError) => {
      const current = await getDocument<FriendConnection>(legacyFriendConnectionCollection, id, token).catch(() => null);
      if (!current) throw legacyError || error;
    });
  }
}

function collectionsForFriendship() {
  return [friendConnectionCollection, legacyFriendConnectionCollection] as const;
}

export async function respondToFriendRequest(connection: FriendConnection, status: Extract<FriendStatus, 'accepted' | 'declined'>, token = getSessionToken()): Promise<void> {
  const viewerId = getTokenUserId(token);
  if (!token || !viewerId || ![connection.requesterId, connection.addresseeId].includes(viewerId)) throw new Error('친구 요청 권한을 확인해주세요.');
  await mergeDocument(connection.sourceCollection || friendConnectionCollection, connection.id, { status, updatedAt: new Date() }, token);
}

export type FriendCallRequest = {
  id: string;
  callerId: string;
  callerName: string;
  callerImage: string;
  calleeId: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  createdAt: string;
  expiresAt: string;
  sourceCollection?: string;
};

const friendCallRequestCollection = 'friendCallRequests';

export async function createFriendCallRequest(calleeId: string, caller: Pick<PortalUser, 'id' | 'name' | 'image'>, token = getSessionToken()): Promise<string> {
  if (!token || !caller.id || !calleeId || caller.id === calleeId) throw new Error('통화 요청 대상을 확인해주세요.');
  const id = `call-request-${caller.id}-${calleeId}-${crypto.randomUUID()}`;
  const createdAt = new Date();
  const request = {
    callerId: caller.id,
    callerName: caller.name,
    callerImage: caller.image,
    calleeId,
    status: 'pending',
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 60_000),
  };
  try {
    await createDocument(friendCallRequestCollection, id, request, token);
  } catch (error) {
    // Older deployments may not have the dedicated collection rule yet.
    await createDocument(legacyFriendConnectionCollection, id, { ...request, kind: 'friendCallRequest' }, token).catch(() => { throw error; });
  }
  return id;
}

export async function getFriendCallRequest(requestId: string, token = getSessionToken()): Promise<FriendCallRequest | null> {
  if (!token || !requestId) return null;
  const [dedicated, legacy] = await Promise.all([
    getDocument<Omit<FriendCallRequest, 'id'>>('friendCallRequests', requestId, token).catch(() => null),
    getDocument<Omit<FriendCallRequest, 'id'> & { kind?: string }>(legacyFriendConnectionCollection, requestId, token).catch(() => null),
  ]);
  const request = dedicated || (legacy?.kind === 'friendCallRequest' ? legacy : null);
  if (!request) return null;
  return {
    id: requestId,
    callerId: request.callerId,
    callerName: request.callerName,
    callerImage: request.callerImage,
    calleeId: request.calleeId,
    status: request.status,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    sourceCollection: dedicated ? friendCallRequestCollection : legacyFriendConnectionCollection,
  };
}

export async function listIncomingFriendCallRequests(userId: string, token = getSessionToken()): Promise<FriendCallRequest[]> {
  if (!token) return [];
  const rows = await Promise.all([
    queryDocumentsWhere<Omit<FriendCallRequest, 'id'>>(friendCallRequestCollection, [{ field: 'calleeId', op: 'EQUAL', value: userId }], token, 20).then((items) => items.map((item) => ({ ...item, sourceCollection: friendCallRequestCollection }))).catch(() => []),
    queryDocumentsWhere<Omit<FriendCallRequest, 'id'> & { kind?: string }>(legacyFriendConnectionCollection, [{ field: 'calleeId', op: 'EQUAL', value: userId }], token, 20).then((items) => items.filter((item) => item.kind === 'friendCallRequest').map((item) => ({ ...item, sourceCollection: legacyFriendConnectionCollection }))).catch(() => []),
  ]);
  return [...new Map(rows.flat().map((request) => [request.id, request])).values()].filter((request) => request.status === 'pending' && new Date(request.expiresAt).getTime() > Date.now());
}

export async function respondToFriendCallRequest(request: FriendCallRequest, status: Extract<FriendCallRequest['status'], 'accepted' | 'declined'>, token = getSessionToken()): Promise<void> {
  const viewerId = getTokenUserId(token);
  if (!token || viewerId !== request.calleeId) throw new Error('통화 요청 권한을 확인해주세요.');
  try {
    await mergeDocument(request.sourceCollection || friendCallRequestCollection, request.id, { status, respondedAt: new Date() }, token);
  } catch (error) {
    if (request.sourceCollection) throw error;
    await mergeDocument(legacyFriendConnectionCollection, request.id, { status, respondedAt: new Date() }, token);
  }
}

export function getStoredSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(sessionKey);
    return value ? (JSON.parse(value) as StoredSession) : null;
  } catch {
    return null;
  }
}

function getTokenUserId(token?: string): string | undefined {
  if (!token) return undefined;
  try {
    const encoded = token.split('.')[1];
    if (!encoded) return undefined;
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    const payload = JSON.parse(atob(normalized + padding)) as { user_id?: string; sub?: string };
    return payload.user_id || payload.sub;
  } catch {
    return undefined;
  }
}

function tokenExpiresAt(token?: string): number | null {
  if (!token) return null;
  try {
    const encoded = token.split('.')[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    const payload = JSON.parse(atob(normalized + padding)) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp * 1_000 : null;
  } catch {
    return null;
  }
}

async function refreshSessionToken(session: StoredSession): Promise<string | undefined> {
  if (!session.refreshToken) return undefined;
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(firebaseConfig.apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken! }),
    }).catch(() => null);
    if (!response?.ok) return undefined;
    const result = await response.json().catch(() => null) as { id_token?: string; refresh_token?: string } | null;
    if (!result?.id_token) return undefined;
    const nextSession = { ...session, idToken: result.id_token, refreshToken: result.refresh_token || session.refreshToken };
    window.localStorage.setItem(sessionKey, JSON.stringify(nextSession));
    return nextSession.idToken;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export async function getFreshSessionToken(force = false): Promise<string | undefined> {
  const session = getStoredSession();
  if (!session) return undefined;
  const expiresAt = tokenExpiresAt(session.idToken);
  if (!force && expiresAt && expiresAt > Date.now() + 2 * 60_000) return session.idToken;
  return refreshSessionToken(session);
}

export async function refreshStoredUser(): Promise<PortalUser | null> {
  const session = getStoredSession();
  if (!session) return null;
  const token = await getFreshSessionToken();
  if (!token) {
    signOut();
    return null;
  }
  const userId = getTokenUserId(token) || session.user.id;
  const profile = await getDocument<PortalUser>('profiles', userId, token).catch(() => null);
  if (!profile) return { ...session.user, id: userId };
  const premiumExpiresAt = profile.premiumExpiresAt || session.user.premiumExpiresAt;
  const isSubscribed = Boolean(profile.isSubscribed && (!premiumExpiresAt || new Date(premiumExpiresAt).getTime() > Date.now()));
  const user = { ...session.user, ...profile, id: userId, isSubscribed, premiumExpiresAt };
  if (typeof window !== 'undefined') window.localStorage.setItem(sessionKey, JSON.stringify({ ...getStoredSession(), user }));
  return user;
}

export function getSessionToken(): string | undefined {
  return getStoredSession()?.idToken;
}

export function getSessionUserId(): string | undefined {
  const session = getStoredSession();
  return getTokenUserId(session?.idToken) || session?.user.id;
}

export function signOut(): void {
  if (typeof window !== 'undefined') window.localStorage.removeItem(sessionKey);
}

function isGender(value: unknown): value is Gender {
  return value === 'male' || value === 'female';
}

function isCountry(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim() !== 'Global';
}

export function isValidTronAddress(value: string): boolean {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value.trim());
}

export async function hashTransferPin(pin: string, salt: string): Promise<string> {
  if (!/^\d{4}$/.test(pin)) throw new Error('송금 PIN은 숫자 4자리여야 합니다.');
  const bytes = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function privateProfileData(user: PortalUser): Record<string, unknown> {
  return {
    name: user.name,
    email: user.email,
    image: user.image,
    usdtBalance: Number(user.usdtBalance || 0),
    usdBalance: Number(user.usdBalance || 0),
    isSubscribed: Boolean(user.isSubscribed),
    ...(isGender(user.gender) ? { gender: user.gender } : {}),
    ...(user.genderPreference ? { genderPreference: user.genderPreference } : {}),
    ...(user.premiumExpiresAt ? { premiumExpiresAt: user.premiumExpiresAt } : {}),
    ...(user.age ? { age: user.age } : {}),
    ...(isCountry(user.country) ? { country: user.country.trim() } : {}),
    ...(user.walletAddress ? { walletAddress: user.walletAddress.trim() } : {}),
    ...(user.walletNetwork ? { walletNetwork: user.walletNetwork.trim() } : {}),
    ...(user.walletPublic && user.walletAddress ? { walletPublic: true } : {}),
    ...(user.walletPinHash ? { walletPinHash: user.walletPinHash } : {}),
    ...(user.walletPinSalt ? { walletPinSalt: user.walletPinSalt } : {}),
    ...(user.transferPinHash ? { transferPinHash: user.transferPinHash } : {}),
    ...(user.transferPinSalt ? { transferPinSalt: user.transferPinSalt } : {}),
    musicFavorites: user.musicFavorites || [],
    updatedAt: new Date(),
  };
}

function publicProfileData(user: PortalUser & { gender: Gender; country: string }): Record<string, unknown> {
  return {
    name: user.name,
    image: user.image,
    gender: user.gender,
    country: user.country.trim(),
    isPublic: true,
    ...(user.age ? { age: user.age } : {}),
    isSubscribed: Boolean(user.isSubscribed),
    ...(user.walletPublic && user.walletAddress ? { walletAddress: user.walletAddress.trim(), walletNetwork: user.walletNetwork || USDT_NETWORK, walletPublic: true } : {}),
    updatedAt: new Date(),
  };
}

function storeSessionUser(user: PortalUser): void {
  if (typeof window === 'undefined') return;
  const session = getStoredSession();
  if (session?.user.id === user.id) {
    window.localStorage.setItem(sessionKey, JSON.stringify({ ...session, user }));
  }
}

export async function completeProfileOnboarding(
  user: PortalUser,
  gender: Gender,
  country: string,
  age: number,
  token = getSessionToken(),
): Promise<PortalUser> {
  const authUserId = getTokenUserId(token);
  const selectedCountry = country.trim();
  if (!token || authUserId !== user.id) throw new Error('로그인 세션을 다시 확인해주세요.');
  if (!isGender(gender) || !isCountry(selectedCountry) || !Number.isInteger(age) || age < 13 || age > 130) throw new Error('성별·나이·국가를 모두 정확히 선택해주세요.');

  const [profileDocument, publicDocument] = await Promise.all([
    getRawDocument('profiles', user.id, token),
    getRawDocument('publicProfiles', user.id, token).catch(() => null),
  ]);
  const savedProfile = profileDocument ? decodeDocument<Partial<PortalUser>>(profileDocument) : null;
  const savedPublic = publicDocument ? decodeDocument<Partial<PublicProfile>>(publicDocument) : null;
  const profileGender = savedProfile?.gender;
  const publicGender = savedPublic?.gender;
  const profileCountry = savedProfile?.country;
  const publicCountry = savedPublic?.country;
  const savedAge = Number(savedProfile?.age || savedPublic?.age || 0);
  const savedGender = isGender(profileGender) ? profileGender : isGender(publicGender) ? publicGender : undefined;
  const savedCountry = isCountry(profileCountry) ? profileCountry.trim() : isCountry(publicCountry) ? publicCountry.trim() : undefined;
  if (savedGender && savedGender !== gender) throw new Error('이미 저장된 성별은 변경할 수 없습니다.');
  if (savedCountry && savedCountry !== selectedCountry) throw new Error('이미 저장된 국가는 변경할 수 없습니다.');
  if (savedAge && savedAge !== age) throw new Error('이미 저장된 나이는 변경할 수 없습니다.');

  const completedUser: PortalUser & { gender: Gender; country: string } = {
    ...user,
    gender: savedGender || gender,
    country: savedCountry || selectedCountry,
    age: savedAge || age,
  };
  const response = await authenticatedFetch(`${firestoreBase}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      writes: [
        {
          update: {
            name: firestoreDocumentName('profiles', user.id),
            fields: { ...(profileDocument?.fields || {}), ...encodeFields(privateProfileData(completedUser)) },
          },
          currentDocument: profileDocument?.updateTime
            ? { updateTime: profileDocument.updateTime }
            : { exists: false },
        },
        {
          update: {
            name: firestoreDocumentName('publicProfiles', user.id),
            fields: encodeFields(publicProfileData(completedUser)),
          },
        },
      ],
    }),
  }, token);
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    const current = await refreshStoredUser();
    if (hasCompletedProfile(current)) return current;
    if (response.status === 403) throw new Error('프로필 저장 권한이 없습니다. 잠시 후 다시 시도해주세요.');
    throw new Error(errorBody || '프로필을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.');
  }
  storeSessionUser(completedUser);
  return completedUser;
}

export async function signInWithGoogleCredential(credential: string): Promise<PortalUser> {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${firebaseConfig.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postBody: `id_token=${encodeURIComponent(credential)}&providerId=google.com`,
        requestUri: window.location.origin,
        returnIdpCredential: true,
        returnSecureToken: true,
      }),
    },
  );
  if (!response.ok) throw new Error(await response.text());
  const result = (await response.json()) as {
    localId: string;
    email?: string;
    displayName?: string;
    photoUrl?: string;
    idToken: string;
    refreshToken?: string;
  };
  const savedProfile = await getDocument<Partial<PortalUser>>('profiles', result.localId, result.idToken).catch(() => null);
  const user: PortalUser = {
    id: result.localId,
    name: savedProfile?.name || result.displayName || result.email?.split('@')[0] || '교민 회원',
    email: savedProfile?.email || result.email || '',
    image: savedProfile?.image || result.photoUrl || 'https://www.gravatar.com/avatar/?d=mp',
    usdtBalance: Number(savedProfile?.usdtBalance || 0),
    usdBalance: Number(savedProfile?.usdBalance || 0),
    isSubscribed: Boolean(savedProfile?.isSubscribed),
    gender: savedProfile?.gender,
    genderPreference: savedProfile?.genderPreference,
    premiumExpiresAt: savedProfile?.premiumExpiresAt,
    age: savedProfile?.age,
    country: savedProfile?.country,
    walletAddress: savedProfile?.walletAddress,
    walletNetwork: savedProfile?.walletNetwork,
    walletPublic: Boolean(savedProfile?.walletPublic),
    walletPinHash: savedProfile?.walletPinHash,
    walletPinSalt: savedProfile?.walletPinSalt,
    transferPinHash: savedProfile?.transferPinHash,
    transferPinSalt: savedProfile?.transferPinSalt,
  };
  window.localStorage.setItem(sessionKey, JSON.stringify({ idToken: result.idToken, refreshToken: result.refreshToken, user }));
  await upsertDocument('profiles', user.id, privateProfileData(user), result.idToken).catch(() => undefined);
  if (hasCompletedProfile(user)) {
    await replaceDocument('publicProfiles', user.id, publicProfileData(user), result.idToken).catch(() => undefined);
  }
  return user;
}

export async function saveProfile(user: PortalUser, token = getSessionToken()): Promise<void> {
  const savedProfile = await getDocument<Partial<PortalUser>>('profiles', user.id, token);
  const savedGender = savedProfile?.gender;
  const savedCountry = savedProfile?.country;
  const savedAge = Number(savedProfile?.age || 0);
  const persistedUser: PortalUser = {
    ...user,
    usdtBalance: Number(savedProfile?.usdtBalance ?? user.usdtBalance ?? 0),
    usdBalance: Number(savedProfile?.usdBalance ?? user.usdBalance ?? 0),
    gender: isGender(savedGender) ? savedGender : user.gender,
    age: Number.isInteger(savedAge) && savedAge >= 13 && savedAge <= 130 ? savedAge : user.age,
    country: isCountry(user.country) ? user.country.trim() : isCountry(savedCountry) ? savedCountry.trim() : String(user.country ?? '').trim(),
    walletPublic: Boolean(user.walletPublic && user.walletAddress),
    walletPinHash: user.walletPinHash,
    walletPinSalt: user.walletPinSalt,
    transferPinHash: user.transferPinHash,
    transferPinSalt: user.transferPinSalt,
  };
  if (!hasCompletedProfile(persistedUser)) throw new Error('먼저 성별·나이·국가 설정을 완료해주세요.');
  await upsertDocument('profiles', user.id, privateProfileData(persistedUser), token);
  await replaceDocument('publicProfiles', user.id, publicProfileData(persistedUser), token);
  storeSessionUser(persistedUser);
}

export function loadGoogleIdentityScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.getElementById('google-identity-script');
    if (existing) {
      if (existing.dataset.loaded === '1' || window.google?.accounts?.id) return resolve();
      let settled = false;
      let poll = 0;
      let timeout = 0;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        window.clearInterval(poll);
        if (error) reject(error);
        else resolve();
      };
      const check = () => {
        if (!window.google?.accounts?.id) return;
        existing.dataset.loaded = '1';
        finish();
      };
      timeout = window.setTimeout(() => finish(new Error('Google 로그인 시간이 초과되었습니다.')), 10_000);
      poll = window.setInterval(check, 100);
      existing.addEventListener('load', check, { once: true });
      existing.addEventListener('error', () => finish(new Error('Google 로그인 스크립트를 불러오지 못했습니다.')), { once: true });
      check();
      return;
    }
    const script = document.createElement('script');
    script.id = 'google-identity-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    const timeout = window.setTimeout(() => reject(new Error('Google 로그인 시간이 초과되었습니다.')), 10_000);
    script.onload = () => {
      if (window.google?.accounts?.id) {
        window.clearTimeout(timeout);
        script.dataset.loaded = '1';
        resolve();
        return;
      }
      window.clearTimeout(timeout);
      reject(new Error('Google 로그인 스크립트를 초기화하지 못했습니다.'));
    };
    script.onerror = () => { window.clearTimeout(timeout); reject(new Error('Google 로그인 스크립트를 불러오지 못했습니다.')); };
    document.head.appendChild(script);
  });
}

export type SiteStats = {
  today: number;
  month: number;
  total: number;
  updatedAt?: string;
};

export async function recordVisit(user?: PortalUser | null): Promise<void> {
  if (typeof window === 'undefined') return;
  const visitorKey = window.localStorage.getItem('gyopo-visitor-id') || crypto.randomUUID();
  window.localStorage.setItem('gyopo-visitor-id', visitorKey);
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const visitMarker = `gyopo-visited-${day}`;
  try {
    const publicUser = hasCompletedProfile(user) ? user : null;
    await replaceDocument(publicUser ? 'publicPresence' : 'presence', publicUser?.id || visitorKey, {
      lastSeenAt: now,
      updatedAt: now,
      ...(publicUser
        ? {
            userId: publicUser.id,
            name: publicUser.name,
            image: publicUser.image,
            gender: publicUser.gender,
            age: publicUser.age || 0,
            country: publicUser.country,
          }
        : {}),
    }, user ? getSessionToken() : undefined);
    if (window.localStorage.getItem(visitMarker)) return;
    await createDocument('visits', `${visitorKey}-${day}`, { visitorKey, day, month, createdAt: now });
    const current = await getDocument<SiteStats>('stats', 'summary');
    await upsertDocument('stats', 'summary', {
      today: Number(current?.today || 0) + 1,
      month: Number(current?.month || 0) + 1,
      total: Number(current?.total || 0) + 1,
      updatedAt: now,
    });
    window.localStorage.setItem(visitMarker, '1');
  } catch {
    // The portal remains usable if anonymous statistics are temporarily unavailable.
  }
}

export async function getSiteStats(): Promise<SiteStats> {
  const stats = await getDocument<SiteStats>('stats', 'summary');
  return { today: stats?.today || 0, month: stats?.month || 0, total: stats?.total || 0, updatedAt: stats?.updatedAt };
}

export async function getOnlineCount(): Promise<number> {
  const presence = await queryDocumentsWhere<{ lastSeenAt?: string; userId?: string }>('publicPresence', [{ field: 'lastSeenAt', op: 'GREATER_THAN', value: new Date(Date.now() - 90_000) }]);
  return presence.filter((item) => item.userId).length;
}

export async function listOnlineUsers(): Promise<OnlineUser[]> {
  const presence = await queryDocumentsWhere<Omit<OnlineUser, 'id'>>('publicPresence', [{ field: 'lastSeenAt', op: 'GREATER_THAN', value: new Date(Date.now() - 90_000) }]);
  return presence
    .filter((item) => item.userId)
    .map((item) => ({ ...item, id: item.userId as string, userId: item.userId as string }))
    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
}

export async function deleteDocument(collection: string, id: string, token?: string): Promise<void> {
  assertClientWriteAllowed(collection);
  const response = await authenticatedFetch(`${firestoreBase}/${collection}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }, token);
  if (!response.ok && response.status !== 404) throw new Error(await response.text());
}

export async function deleteWebrtcRoomData(callId: string, token?: string): Promise<void> {
  if (!callId || !token) return;
  const [candidates, messages] = await Promise.all([
    queryDocumentsWhere<{ callId?: string }>('webrtcCandidates', [{ field: 'callId', op: 'EQUAL', value: callId }], token).catch(() => []),
    queryDocumentsWhere<{ callId?: string }>('webrtcChatMessages', [{ field: 'callId', op: 'EQUAL', value: callId }], token).catch(() => []),
  ]);
  await Promise.all([
    ...candidates.map((item) => deleteDocument('webrtcCandidates', item.id, token).catch(() => undefined)),
    ...messages.map((item) => deleteDocument('webrtcChatMessages', item.id, token).catch(() => undefined)),
  ]);
  await deleteDocument('webrtcCalls', callId, token).catch(() => undefined);
}

export async function deleteExpiredChatMessages(token?: string, collection = 'chatMessages'): Promise<number> {
  if (!token) return 0;
  const rows = await firestoreRequest<Array<{ document?: { name?: string; fields?: Record<string, FirestoreValue> } }>>(
    `${firestoreBase}:runQuery`,
    {
      method: 'POST',
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: collection }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'expiresAt' },
              op: 'LESS_THAN_OR_EQUAL',
              value: toFirestoreValue(new Date()),
            },
          },
        },
      }),
    },
    token,
  );
  const expired = rows
    .filter((row) => row.document)
    .map((row) => decodeDocument<Record<string, unknown>>(row.document as { name: string; fields?: Record<string, FirestoreValue> }));
  await Promise.all(expired.map((message) => deleteDocument(collection, message.id, token)));
  return expired.length;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void;
          renderButton: (element: HTMLElement, options: Record<string, string | number | boolean>) => void;
          prompt: () => void;
        };
      };
    };
  }
}
