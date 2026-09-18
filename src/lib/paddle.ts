import { ApiAuthError, authenticateRequest } from '@/lib/apiSecurity';

const firebaseProjectId = 'gyopo-live-portal-506019';

export class PaddleConfigurationError extends Error {
  readonly status = 503;

  constructor(message = 'Paddle 결제가 아직 연결되지 않았습니다. 관리자 환경설정을 확인해주세요.') {
    super(message);
    this.name = 'PaddleConfigurationError';
  }
}

export type PaddleTransaction = {
  id?: string;
  status?: string;
  currency_code?: string;
  custom_data?: Record<string, unknown> | null;
  details?: { totals?: { grand_total?: string | number } };
  checkout?: { url?: string | null };
};

export async function requirePaddleUser(request: Request): Promise<{ userId: string; token: string }> {
  const user = await authenticateRequest(request);
  if (!user) throw new ApiAuthError();
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents/profiles/${encodeURIComponent(user.uid)}`, {
    headers: { authorization: `Bearer ${user.token}` },
  });
  if (!response.ok) throw new Error('로그인 프로필을 확인하지 못했습니다.');
  return { userId: user.uid, token: user.token };
}

export async function paddleRequest(path: string, options: RequestInit = {}): Promise<Response> {
  const apiKey = process.env.PADDLE_API_KEY?.trim();
  if (!apiKey) throw new PaddleConfigurationError('Paddle API 키가 배포 환경에 설정되지 않았습니다.');
  const baseUrl = (process.env.PADDLE_API_BASE_URL?.trim() || 'https://api.paddle.com').replace(/\/$/, '');
  if (!/^https:\/\/(?:sandbox\.)?api\.paddle\.com$/.test(baseUrl)) throw new PaddleConfigurationError('Paddle API 주소가 허용된 주소가 아닙니다.');
  const headers = new Headers(options.headers);
  headers.set('authorization', `Bearer ${apiKey}`);
  headers.set('content-type', 'application/json');
  headers.set('paddle-version', '1');
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

export function amountFromTransaction(transaction: PaddleTransaction): number {
  const total = Number(transaction.details?.totals?.grand_total);
  return Number.isFinite(total) && total > 0 ? Math.round((total / 100) * 100) / 100 : 0;
}

export function compareHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

export async function verifyPaddleSignature(rawBody: string, header: string | null): Promise<boolean> {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const fields = Object.fromEntries(header.split(';').map((part) => {
    const [key, value] = part.split('=');
    return [key, value];
  }));
  const timestamp = fields.ts;
  const provided = fields.h1;
  if (!timestamp || !provided) return false;
  const age = Math.abs(Date.now() - Number(timestamp) * 1_000);
  if (!Number.isFinite(age) || age > 5 * 60 * 1_000) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}:${rawBody}`));
  const expected = Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return compareHex(expected, provided);
}
