import { normalizeAiWritingPrompt } from './writerPreferences';

const FIREBASE_PROJECT_ID = 'gyopo-live-portal-506019';
const FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyAne5XuEzN2sL3px0oY5Wxsgf3m0nHHIoY';

const verifiedTokenCache = new Map<string, { user: VerifiedUser; expiresAt: number }>();
const rateLimitBuckets = new Map<string, number[]>();

export type VerifiedUser = {
  uid: string;
  email?: string;
  token: string;
};

export class ApiAuthError extends Error {
  readonly status = 401;

  constructor(message = '로그인 세션이 필요합니다.') {
    super(message);
    this.name = 'ApiAuthError';
  }
}

export class AuthServiceUnavailableError extends Error {
  readonly status = 503;

  constructor() {
    super('로그인 확인 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.');
    this.name = 'AuthServiceUnavailableError';
  }
}

export function clientAddress(request: Request): string {
  return request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
}

function bearerToken(request: Request): string {
  const value = request.headers.get('authorization') || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

function tokenExpiry(token: string): number | null {
  const encodedPayload = token.split('.')[1];
  if (!encodedPayload) return null;
  try {
    const base64Payload = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64Payload.padEnd(base64Payload.length + ((4 - (base64Payload.length % 4)) % 4), '='))) as { exp?: unknown };
    const expiresAt = typeof payload.exp === 'number' ? payload.exp * 1_000 : NaN;
    return Number.isFinite(expiresAt) ? expiresAt : null;
  } catch {
    return null;
  }
}

export async function authenticateRequest(request: Request): Promise<VerifiedUser | null> {
  const token = bearerToken(request);
  if (!token || token.length > 4096) return null;
  const expiresAt = tokenExpiry(token);
  if (!expiresAt || expiresAt <= Date.now()) return null;

  const cached = verifiedTokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.user;
  if (cached) verifiedTokenCache.delete(token);

  let response: Response;
  try {
    response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
      signal: AbortSignal.timeout(4_000),
    });
  } catch {
    throw new AuthServiceUnavailableError();
  }
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    const code = failure?.error?.message?.split(/[ :]/, 1)[0];
    if (response.status === 401 || ['INVALID_ID_TOKEN', 'USER_DISABLED', 'USER_NOT_FOUND'].includes(code || '')) return null;
    throw new AuthServiceUnavailableError();
  }

  const payload = await response.json().catch(() => { throw new AuthServiceUnavailableError(); }) as { users?: Array<{ localId?: string; email?: string }> };
  const record = payload?.users?.[0];
  if (!record?.localId || !/^[A-Za-z0-9_-]{1,128}$/.test(record.localId)) return null;

  const user = { uid: record.localId, email: record.email?.toLowerCase(), token };
  verifiedTokenCache.set(token, { user, expiresAt: Math.min(expiresAt, Date.now() + 5 * 60_000) });
  return user;
}

export async function requireAuthenticatedUser(request: Request): Promise<VerifiedUser> {
  const user = await authenticateRequest(request);
  if (!user) throw new ApiAuthError();
  return user;
}

export async function requireMasterUser(request: Request): Promise<VerifiedUser> {
  const user = await requireAuthenticatedUser(request);
  if (user.email !== 'juyeonglee911029@gmail.com') throw new ApiAuthError('관리자 권한이 필요합니다.');
  return user;
}

export async function readProfileWalletAddress(user: VerifiedUser): Promise<string | null> {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/profiles/${encodeURIComponent(user.uid)}`, {
    headers: { authorization: `Bearer ${user.token}` },
    signal: AbortSignal.timeout(4_000),
  }).catch(() => null);
  if (!response?.ok) return null;
  const document = await response.json().catch(() => null) as { fields?: { walletAddress?: { stringValue?: string } } } | null;
  return document?.fields?.walletAddress?.stringValue?.trim() || null;
}

export async function readProfileAiWritingPrompt(user: VerifiedUser): Promise<string> {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/profiles/${encodeURIComponent(user.uid)}`, {
    headers: { authorization: `Bearer ${user.token}` },
    signal: AbortSignal.timeout(4_000),
  }).catch(() => null);
  if (!response?.ok) return '';
  const document = await response.json().catch(() => null) as { fields?: { defaultAiWritingPrompt?: { stringValue?: string } } } | null;
  return normalizeAiWritingPrompt(document?.fields?.defaultAiWritingPrompt?.stringValue);
}

export function unauthorizedResponse(error: unknown) {
  if (error instanceof AuthServiceUnavailableError) {
    return Response.json(
      { error: error.message },
      { status: error.status, headers: { 'cache-control': 'no-store, private', 'retry-after': '5' } },
    );
  }
  const message = error instanceof ApiAuthError ? error.message : '로그인 세션을 확인하지 못했습니다.';
  return Response.json({ error: message }, { status: 401 });
}

export function consumeRateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const timestamps = (rateLimitBuckets.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
  if (timestamps.length >= limit) {
    const retryAfterMs = Math.max(windowMs - (now - timestamps[0]), 1_000);
    rateLimitBuckets.set(key, timestamps);
    return { allowed: false, retryAfterMs };
  }
  timestamps.push(now);
  rateLimitBuckets.set(key, timestamps);
  if (rateLimitBuckets.size > 2_000) {
    for (const [bucketKey, bucket] of rateLimitBuckets) {
      if (!bucket.length || now - bucket[bucket.length - 1] >= windowMs) rateLimitBuckets.delete(bucketKey);
    }
  }
  return { allowed: true, retryAfterMs: 0 };
}

export function rateLimitResponse(retryAfterMs: number) {
  return Response.json(
    { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', retryAfterMs },
    { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1_000)) } },
  );
}

export { FIREBASE_PROJECT_ID };
