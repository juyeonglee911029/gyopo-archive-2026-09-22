export type AdminFirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { nullValue: null }
  | { arrayValue: { values?: AdminFirestoreValue[] } }
  | { mapValue: { fields?: Record<string, AdminFirestoreValue> } };

export type AdminFirestoreDocument = {
  name?: string;
  updateTime?: string;
  fields?: Record<string, AdminFirestoreValue>;
};

export type TransactionDocument = { collection: string; id: string };
export type FirestoreWrite = {
  update?: { name: string; fields: Record<string, AdminFirestoreValue> };
  currentDocument?: { updateTime?: string; exists?: boolean };
};

type ServiceAccount = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

const defaultProjectId = 'gyopo-live-portal-506019';

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function encodeJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function pemToBytes(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '').replace(/\s/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function serviceAccount(): ServiceAccount {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON 설정이 필요합니다.');
  const account = JSON.parse(raw) as ServiceAccount;
  if (!account.client_email || !account.private_key) throw new Error('Firebase 서비스 계정 JSON이 올바르지 않습니다.');
  return account;
}

async function accessToken(scope = 'https://www.googleapis.com/auth/datastore'): Promise<{ token: string; projectId: string }> {
  const account = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: 'RS256', typ: 'JWT' });
  const payload = encodeJson({
    iss: account.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3_600,
  });
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(account.private_key!.replaceAll('\\n', '\n')),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`));
  const assertion = `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const result = await response.json() as { access_token?: string; error?: string };
  if (!response.ok || !result.access_token) throw new Error(result.error || 'Firebase 관리자 인증에 실패했습니다.');
  return { token: result.access_token, projectId: account.project_id || process.env.FIREBASE_PROJECT_ID || defaultProjectId };
}

export async function serviceAccountAccessToken(scope: string): Promise<string> {
  return (await accessToken(scope)).token;
}

function documentName(projectId: string, collection: string, id: string): string {
  return `projects/${projectId}/databases/(default)/documents/${collection}/${id}`;
}

export function adminDocumentName(projectId: string, collection: string, id: string): string {
  return documentName(projectId, collection, id);
}

function documentUrl(projectId: string, collection: string, id: string): string {
  return `https://firestore.googleapis.com/v1/${documentName(projectId, collection, encodeURIComponent(id))}`;
}

function transactionDocumentName(projectId: string, document: TransactionDocument): string {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(document.collection) || !/^[A-Za-z0-9_-]{1,128}$/.test(document.id)) {
    throw new Error('Firestore 문서 식별자가 올바르지 않습니다.');
  }
  return documentName(projectId, document.collection, document.id);
}

export function mergeAdminFields(document: AdminFirestoreDocument, fields: Record<string, AdminFirestoreValue>) {
  return { ...(document.fields || {}), ...fields };
}

export async function runFirestoreTransaction<T>(
  documents: TransactionDocument[],
  plan: (context: { projectId: string; get: (document: TransactionDocument) => AdminFirestoreDocument | null }) => { writes: FirestoreWrite[]; result: T },
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const auth = await accessToken();
    const names = documents.map((document) => transactionDocumentName(auth.projectId, document));
    const begin = await fetch(`https://firestore.googleapis.com/v1/projects/${auth.projectId}/databases/(default)/documents:beginTransaction`, {
      method: 'POST',
      headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ options: { readWrite: {} } }),
    });
    const beginBody = await begin.json().catch(() => null) as { transaction?: string; error?: { message?: string } } | null;
    if (!begin.ok || !beginBody?.transaction) throw new Error(beginBody?.error?.message || 'Firebase 거래를 시작하지 못했습니다.');

    const batch = await fetch(`https://firestore.googleapis.com/v1/projects/${auth.projectId}/databases/(default)/documents:batchGet`, {
      method: 'POST',
      headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ documents: names, transaction: beginBody.transaction }),
    });
    const batchBody = await batch.json().catch(() => null) as Array<{ found?: AdminFirestoreDocument; missing?: { name?: string } }> | { error?: { message?: string } } | null;
    if (!batch.ok || !Array.isArray(batchBody)) throw new Error((batchBody && 'error' in batchBody ? batchBody.error?.message : '') || 'Firebase 거래 문서를 읽지 못했습니다.');
    const found = new Map(batchBody.filter((entry) => entry.found?.name).map((entry) => [entry.found!.name!, entry.found!]));
    const get = (document: TransactionDocument) => found.get(transactionDocumentName(auth.projectId, document)) || null;
    const prepared = plan({ projectId: auth.projectId, get });
    const commit = await fetch(`https://firestore.googleapis.com/v1/projects/${auth.projectId}/databases/(default)/documents:commit`, {
      method: 'POST',
      headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ writes: prepared.writes, transaction: beginBody.transaction }),
    });
    if (commit.ok) return prepared.result;
    const body = await commit.text().catch(() => '');
    if (attempt < 2 && /ABORTED|FAILED_PRECONDITION|409/i.test(body)) continue;
    throw new Error(body || 'Firebase 거래를 완료하지 못했습니다.');
  }
  throw new Error('Firebase 거래 재시도 횟수를 초과했습니다.');
}

function firestoreNumber(value?: AdminFirestoreValue): number {
  if (!value) return 0;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  return 0;
}

export function decodeFirestoreValue(value: AdminFirestoreValue | undefined): unknown {
  if (!value) return undefined;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map((item) => decodeFirestoreValue(item));
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decodeFirestoreValue(item)]));
  return undefined;
}

export function firestoreValue(value: unknown): AdminFirestoreValue {
  if (typeof value === 'number' && Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (value === null) return { nullValue: null };
  return { stringValue: String(value) };
}

async function adminRequest(path: (projectId: string) => string, options: RequestInit = {}): Promise<Response> {
  const auth = await accessToken();
  const headers = new Headers(options.headers);
  headers.set('authorization', `Bearer ${auth.token}`);
  headers.set('content-type', 'application/json');
  return fetch(path(auth.projectId), { ...options, headers });
}

async function getDocument(collection: string, id: string): Promise<AdminFirestoreDocument | null> {
  const response = await adminRequest((projectId) => documentUrl(projectId, collection, id));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Firebase 문서 조회 실패: ${response.status}`);
  return await response.json() as AdminFirestoreDocument;
}

export async function getAdminDocument(collection: string, id: string): Promise<AdminFirestoreDocument | null> {
  return getDocument(collection, id);
}

export async function listAdminJsonDocuments(collection: string): Promise<Array<{ id: string; data: Record<string, unknown>; updatedAt?: string }>> {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(collection)) throw new Error('Firestore 컬렉션 이름이 올바르지 않습니다.');
  const response = await adminRequest((projectId) => `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}?pageSize=300`);
  if (!response.ok) throw new Error(`Firebase 문서 목록 조회 실패: ${response.status}`);
  const payload = await response.json() as { documents?: AdminFirestoreDocument[] };
  return (payload.documents || []).map((document) => {
    const id = decodeURIComponent(document.name?.split('/').pop() || '');
    const raw = document.fields?.payload;
    let data: Record<string, unknown> = {};
    if (raw && 'stringValue' in raw) {
      try { data = JSON.parse(raw.stringValue) as Record<string, unknown>; } catch { data = {}; }
    }
    return { id, data, updatedAt: document.fields?.updatedAt && 'timestampValue' in document.fields.updatedAt ? document.fields.updatedAt.timestampValue : undefined };
  });
}

export async function getAdminJsonDocument(collection: string, id: string): Promise<{ id: string; data: Record<string, unknown>; updatedAt?: string } | null> {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(collection) || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Firestore 문서 식별자가 올바르지 않습니다.');
  const document = await getDocument(collection, id);
  if (!document) return null;
  const raw = document.fields?.payload;
  let data: Record<string, unknown> = {};
  if (raw && 'stringValue' in raw) {
    try { data = JSON.parse(raw.stringValue) as Record<string, unknown>; } catch { data = {}; }
  }
  return { id, data, updatedAt: document.fields?.updatedAt && 'timestampValue' in document.fields.updatedAt ? document.fields.updatedAt.timestampValue : undefined };
}

export async function listAdminDocuments(collection: string): Promise<Array<{ id: string; data: Record<string, unknown>; updatedAt?: string }>> {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(collection)) throw new Error('Firestore 컬렉션 이름이 올바르지 않습니다.');
  const response = await adminRequest((projectId) => `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}?pageSize=300`);
  if (!response.ok) throw new Error(`Firebase 문서 목록 조회 실패: ${response.status}`);
  const payload = await response.json() as { documents?: AdminFirestoreDocument[] };
  return (payload.documents || []).map((document) => ({
    id: decodeURIComponent(document.name?.split('/').pop() || ''),
    data: Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decodeFirestoreValue(value)])),
    updatedAt: document.updateTime,
  }));
}

export async function upsertAdminJsonDocument(collection: string, id: string, data: Record<string, unknown>): Promise<void> {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(collection) || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Firestore 문서 식별자가 올바르지 않습니다.');
  const now = new Date().toISOString();
  const response = await adminRequest((projectId) => documentUrl(projectId, collection, id), {
    method: 'PATCH',
    body: JSON.stringify({ fields: { payload: { stringValue: JSON.stringify(data) }, updatedAt: { timestampValue: now } } }),
  });
  if (!response.ok) throw new Error(`Firebase 문서 저장 실패: ${response.status}`);
}

export async function creditUsdBalance(params: { userId: string; transactionId: string; amountUsd: number; currencyCode: string }): Promise<{ amountUsd: number; alreadyCredited: boolean }> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(params.userId)) throw new Error('결제 회원 식별자가 올바르지 않습니다.');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(params.transactionId)) throw new Error('결제 식별자가 올바르지 않습니다.');
  if (!Number.isFinite(params.amountUsd) || params.amountUsd <= 0 || params.amountUsd > 1_000_000) throw new Error('USD 충전 금액이 올바르지 않습니다.');
  if (params.currencyCode !== 'USD') throw new Error('USD 결제만 잔액에 반영할 수 있습니다.');

  const [profile, payment] = await Promise.all([
    getDocument('profiles', params.userId),
    getDocument('paddlePayments', params.transactionId),
  ]);
  if (payment?.name) {
    const creditedAmount = firestoreNumber(payment.fields?.amountUsd);
    if (!Number.isFinite(creditedAmount) || creditedAmount <= 0) throw new Error('기존 결제 원장의 금액이 올바르지 않습니다.');
    return { amountUsd: creditedAmount, alreadyCredited: true };
  }
  if (!profile?.name || !profile.updateTime) throw new Error('결제 회원 프로필을 찾을 수 없습니다.');

   const currentBalance = firestoreNumber(profile.fields?.usdBalance);
  if (!Number.isFinite(currentBalance) || currentBalance < 0) throw new Error('회원 USD 잔액 원장이 올바르지 않습니다.');
  const amountUsd = Math.round(params.amountUsd * 100) / 100;
  const now = new Date().toISOString();
  const auth = await accessToken();
  const paymentName = documentName(auth.projectId, 'paddlePayments', params.transactionId);
  const ledgerName = documentName(auth.projectId, 'walletLedger', `paddle-${params.transactionId}`);
  const profileFields = {
    ...(profile.fields || {}),
    usdBalance: firestoreValue(Math.round((currentBalance + amountUsd) * 100) / 100),
    updatedAt: { timestampValue: now },
  };
  const paymentFields = {
    transactionId: firestoreValue(params.transactionId),
    userId: firestoreValue(params.userId),
     amountUsd: firestoreValue(amountUsd),
    currencyCode: firestoreValue(params.currencyCode),
    status: firestoreValue('COMPLETED'),
    createdAt: { timestampValue: now },
  };
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${auth.projectId}/databases/(default)/documents:commit`, {
    method: 'POST',
    headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      writes: [
        { update: { name: profile.name, fields: profileFields }, currentDocument: { updateTime: profile.updateTime } },
        { update: { name: paymentName, fields: paymentFields }, currentDocument: { exists: false } },
        { update: { name: ledgerName, fields: {
          userId: firestoreValue(params.userId),
          type: firestoreValue('DEPOSIT'),
          direction: firestoreValue('IN'),
           amount: firestoreValue(amountUsd),
          status: firestoreValue('COMPLETED'),
          network: firestoreValue('Paddle'),
          symbol: firestoreValue('USD'),
          requestId: firestoreValue(params.transactionId),
          memo: firestoreValue('Paddle 카드 결제 USD 충전'),
          createdAt: { timestampValue: now },
        } }, currentDocument: { exists: false } },
      ],
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (body.includes('ALREADY_EXISTS')) return { amountUsd, alreadyCredited: true };
    throw new Error('결제 금액을 USD 잔액에 반영하지 못했습니다.');
  }
  return { amountUsd, alreadyCredited: false };
}

function encodeSecretBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeSecretBytes(value: string): Uint8Array {
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function passwordDigest(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: 210_000, hash: 'SHA-256' }, key, 256);
  return encodeSecretBytes(new Uint8Array(bits));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function verifyOrInitializeMasterWalletPassword(password: string): Promise<void> {
  if (!password || [...password].length < 8 || [...password].length > 128) throw new Error('운영자 비밀번호를 확인해주세요.');
  const document = await getDocument('serverSecrets', 'masterWalletPassword');
  if (document?.fields?.salt && document.fields.hash && 'stringValue' in document.fields.salt && 'stringValue' in document.fields.hash) {
    const salt = decodeSecretBytes(document.fields.salt.stringValue);
    const expected = decodeSecretBytes(document.fields.hash.stringValue);
    const actual = decodeSecretBytes(await passwordDigest(password, salt));
    if (!constantTimeEqual(actual, expected)) throw new Error('운영자 비밀번호가 올바르지 않습니다.');
    return;
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await passwordDigest(password, salt);
  const auth = await accessToken();
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${auth.projectId}/databases/(default)/documents:commit`, {
    method: 'POST',
    headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ writes: [{ update: { name: documentName(auth.projectId, 'serverSecrets', 'masterWalletPassword'), fields: { salt: firestoreValue(encodeSecretBytes(salt)), hash: firestoreValue(hash), algorithm: firestoreValue('PBKDF2-SHA256-210000'), updatedAt: { timestampValue: new Date().toISOString() } } }, currentDocument: { exists: false } }] }),
  });
  const body = await response.text().catch(() => '');
  if (!response.ok && !body.includes('ALREADY_EXISTS')) throw new Error('운영자 비밀번호를 서버에 저장하지 못했습니다.');
  if (body.includes('ALREADY_EXISTS')) throw new Error('운영자 비밀번호가 동시에 설정되었습니다. 다시 시도해주세요.');
}

export async function adjustUsdBalance(params: {
  userId: string;
  grantId: string;
  amountUsd: number;
  direction: 'CREDIT' | 'DEBIT';
  password: string;
  memo: string;
  actorId: string;
  actorEmail: string;
}): Promise<{ amountUsd: number; balanceUsd: number; direction: 'CREDIT' | 'DEBIT'; alreadyApplied: boolean }> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(params.userId)) throw new Error('지급 회원 식별자가 올바르지 않습니다.');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(params.grantId)) throw new Error('지급 요청 식별자가 올바르지 않습니다.');
  if (!Number.isFinite(params.amountUsd) || params.amountUsd <= 0 || params.amountUsd > 1_000_000) throw new Error('USD 지급 금액이 올바르지 않습니다.');
  if (params.direction !== 'CREDIT' && params.direction !== 'DEBIT') throw new Error('잔고 조정 방향이 올바르지 않습니다.');
  const amountUsd = Math.round(params.amountUsd * 100) / 100;
  if (!amountUsd) throw new Error('USD 지급 금액은 0보다 커야 합니다.');
  const memo = params.memo.trim().slice(0, 200) || '운영자 USD 지급';
  await verifyOrInitializeMasterWalletPassword(params.password);

  const [profile, existingGrant] = await Promise.all([
    getDocument('profiles', params.userId),
    getDocument('masterUsdAdjustments', `master-${params.grantId}`),
  ]);
  if (existingGrant?.name) {
    const balanceUsd = firestoreNumber(existingGrant.fields?.balanceUsd);
    const creditedAmount = firestoreNumber(existingGrant.fields?.amountUsd);
    const direction = existingGrant.fields?.direction && 'stringValue' in existingGrant.fields.direction && existingGrant.fields.direction.stringValue === 'DEBIT' ? 'DEBIT' : 'CREDIT';
    return { amountUsd: creditedAmount, balanceUsd, direction, alreadyApplied: true };
  }
  if (!profile?.name || !profile.updateTime) throw new Error('지급 대상 회원 프로필을 찾을 수 없습니다.');

  const currentBalance = firestoreNumber(profile.fields?.usdBalance);
  if (!Number.isFinite(currentBalance) || currentBalance < 0) throw new Error('회원 USD 잔액 원장이 올바르지 않습니다.');
  if (params.direction === 'DEBIT' && currentBalance < amountUsd) throw new Error('회원 USD 잔액보다 많이 차감할 수 없습니다.');
  const balanceUsd = Math.round((currentBalance + (params.direction === 'CREDIT' ? amountUsd : -amountUsd)) * 100) / 100;
  const now = new Date().toISOString();
  const auth = await accessToken();
  const grantName = documentName(auth.projectId, 'masterUsdAdjustments', `master-${params.grantId}`);
  const ledgerName = documentName(auth.projectId, 'walletLedger', `master-${params.grantId}`);
  const profileFields = {
    ...(profile.fields || {}),
    usdBalance: firestoreValue(balanceUsd),
    updatedAt: { timestampValue: now },
  };
  const grantFields = {
    userId: firestoreValue(params.userId),
    amountUsd: firestoreValue(amountUsd),
    balanceUsd: firestoreValue(balanceUsd),
    direction: firestoreValue(params.direction),
    memo: firestoreValue(memo),
    actorId: firestoreValue(params.actorId),
    actorEmail: firestoreValue(params.actorEmail),
    status: firestoreValue('COMPLETED'),
    createdAt: { timestampValue: now },
  };
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${auth.projectId}/databases/(default)/documents:commit`, {
    method: 'POST',
    headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      writes: [
        { update: { name: profile.name, fields: profileFields }, currentDocument: { updateTime: profile.updateTime } },
        { update: { name: grantName, fields: grantFields }, currentDocument: { exists: false } },
        { update: { name: ledgerName, fields: {
          userId: firestoreValue(params.userId),
          type: firestoreValue('MASTER_ADJUSTMENT'),
          direction: firestoreValue(params.direction === 'CREDIT' ? 'IN' : 'OUT'),
          amount: firestoreValue(amountUsd),
          status: firestoreValue('COMPLETED'),
          symbol: firestoreValue('USD'),
          requestId: firestoreValue(params.grantId),
          memo: firestoreValue(memo),
          actorId: firestoreValue(params.actorId),
          createdAt: { timestampValue: now },
        } }, currentDocument: { exists: false } },
      ],
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (body.includes('ALREADY_EXISTS')) {
      const completed = await getDocument('masterUsdAdjustments', `master-${params.grantId}`);
      return {
        amountUsd: firestoreNumber(completed?.fields?.amountUsd) || amountUsd,
        balanceUsd: firestoreNumber(completed?.fields?.balanceUsd),
        direction: completed?.fields?.direction && 'stringValue' in completed.fields.direction && completed.fields.direction.stringValue === 'DEBIT' ? 'DEBIT' : 'CREDIT',
        alreadyApplied: true,
      };
    }
    if (body.includes('FAILED_PRECONDITION')) throw new Error('회원 잔액이 동시에 변경되었습니다. 회원 목록을 새로고침한 뒤 다시 시도해주세요.');
    throw new Error('USD 지급 내용을 저장하지 못했습니다.');
  }
  return { amountUsd, balanceUsd, direction: params.direction, alreadyApplied: false };
}

export async function createKoreanStuffOrder(params: {
  userId: string;
  orderId: string;
  productId: string;
  quantity: number;
  total: number;
  order: Record<string, unknown>;
}): Promise<{ balanceUsd: number }> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(params.userId)) throw new Error('주문 회원 식별자가 올바르지 않습니다.');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(params.orderId) || !/^ks-[A-Za-z0-9_-]{16,64}$/.test(params.orderId)) throw new Error('주문 식별자가 올바르지 않습니다.');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(params.productId)) throw new Error('상품 식별자가 올바르지 않습니다.');
  if (!Number.isInteger(params.quantity) || params.quantity < 1 || params.quantity > 10) throw new Error('주문 수량이 올바르지 않습니다.');
  if (!Number.isFinite(params.total) || params.total <= 0 || params.total > 1_000_000) throw new Error('주문 금액이 올바르지 않습니다.');

  return runFirestoreTransaction(
    [
      { collection: 'profiles', id: params.userId },
      { collection: 'koreanStuffProducts', id: params.productId },
      { collection: 'koreanStuffOrders', id: params.orderId },
      { collection: 'walletLedger', id: `korean-stuff-${params.orderId}` },
    ],
    ({ projectId, get }) => {
      const profile = get({ collection: 'profiles', id: params.userId });
      const product = get({ collection: 'koreanStuffProducts', id: params.productId });
      const existingOrder = get({ collection: 'koreanStuffOrders', id: params.orderId });
      const existingLedger = get({ collection: 'walletLedger', id: `korean-stuff-${params.orderId}` });
      const readPayload = (document: AdminFirestoreDocument | null): Record<string, unknown> | null => {
        const raw = document?.fields?.payload;
        if (!raw || !('stringValue' in raw)) return null;
        try { return JSON.parse(raw.stringValue) as Record<string, unknown>; } catch { return null; }
      };

      if (existingOrder) {
        const existing = readPayload(existingOrder);
        if (!existing || existing.userId !== params.userId || existing.productId !== params.productId || Number(existing.total) !== params.total) throw new Error('주문 재시도 식별자가 다른 주문에 사용되었습니다.');
        return { writes: [], result: { balanceUsd: firestoreNumber(profile?.fields?.usdBalance) } };
      }
      if (existingLedger) throw new Error('주문 원장이 이미 사용되었습니다.');
      if (!profile?.name || !profile.updateTime) throw new Error('로그인 회원 프로필을 찾을 수 없습니다.');
      if (!product?.name || !product.updateTime) throw new Error('상품이 더 이상 판매되지 않습니다.');

      const productPayload = readPayload(product);
      if (!productPayload || productPayload.status !== 'APPROVED' || Number(productPayload.stock || 0) < params.quantity) throw new Error('상품 재고가 부족하거나 판매가 종료되었습니다.');
      if (Math.round(Number(productPayload.salePrice || 0) * params.quantity * 100) / 100 !== params.total) throw new Error('상품 금액이 변경되었습니다. 상품을 다시 주문해주세요.');
      const balanceUsd = firestoreNumber(profile.fields?.usdBalance);
      if (!Number.isFinite(balanceUsd) || balanceUsd < params.total) throw new Error('USD 잔액이 부족합니다. 지갑에서 충전 후 다시 시도해주세요.');

      const now = new Date().toISOString();
      const nextBalance = Math.round((balanceUsd - params.total) * 100) / 100;
      const orderName = documentName(projectId, 'koreanStuffOrders', params.orderId);
      const productName = documentName(projectId, 'koreanStuffProducts', params.productId);
      const ledgerName = documentName(projectId, 'walletLedger', `korean-stuff-${params.orderId}`);
      const orderData = { ...params.order, id: params.orderId, total: params.total, currency: 'USD', status: 'PAID', createdAt: now, updatedAt: now };
      const productData = { ...product.fields, payload: { stringValue: JSON.stringify({ ...productPayload, stock: Number(productPayload.stock || 0) - params.quantity, updatedAt: now }) }, updatedAt: { timestampValue: now } };

      return {
        writes: [
          { update: { name: profile.name, fields: { ...(profile.fields || {}), usdBalance: firestoreValue(nextBalance), updatedAt: { timestampValue: now } } }, currentDocument: { updateTime: profile.updateTime } },
          { update: { name: orderName, fields: { payload: { stringValue: JSON.stringify(orderData) }, updatedAt: { timestampValue: now } } }, currentDocument: { exists: false } },
          { update: { name: productName, fields: productData }, currentDocument: { updateTime: product.updateTime } },
          { update: { name: ledgerName, fields: { userId: firestoreValue(params.userId), type: firestoreValue('DEBIT'), direction: firestoreValue('OUT'), amount: firestoreValue(params.total), status: firestoreValue('COMPLETED'), network: firestoreValue('GYOPO'), symbol: firestoreValue('USD'), requestId: firestoreValue(params.orderId), memo: firestoreValue(`Korean Stuff 주문 ${params.productId}`), createdAt: { timestampValue: now } } }, currentDocument: { exists: false } },
        ],
        result: { balanceUsd: nextBalance },
      };
    },
  );
}
