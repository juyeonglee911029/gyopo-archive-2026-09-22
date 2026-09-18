import { adjustUsdBalance } from '@/lib/firebaseAdmin';
import { ApiAuthError, clientAddress, consumeRateLimit, rateLimitResponse, requireMasterUser, unauthorizedResponse } from '@/lib/apiSecurity';

export const runtime = 'edge';

type GrantBody = { userId?: unknown; grantId?: unknown; amountUsd?: unknown; direction?: unknown; password?: unknown; memo?: unknown };

function privateJson(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store, private', pragma: 'no-cache', Vary: 'Authorization' } });
}

function invalid(message: string) {
  return privateJson({ error: message }, 400);
}

export async function POST(request: Request) {
  let actor;
  try {
    actor = await requireMasterUser(request);
  } catch (error) {
    return unauthorizedResponse(error);
  }

  const limit = consumeRateLimit(`master-usd-adjust:${actor.uid}:${clientAddress(request)}`, 5, 60_000);
  if (!limit.allowed) {
    const response = rateLimitResponse(limit.retryAfterMs);
    response.headers.set('cache-control', 'no-store, private');
    response.headers.set('Vary', 'Authorization');
    return response;
  }
  const body = await request.json().catch(() => null) as GrantBody | null;
  const userId = typeof body?.userId === 'string' ? body.userId.trim() : '';
  const grantId = typeof body?.grantId === 'string' ? body.grantId.trim() : '';
  const amountUsd = typeof body?.amountUsd === 'number' ? body.amountUsd : Number(body?.amountUsd);
  const direction = body?.direction === 'DEBIT' ? 'DEBIT' : body?.direction === 'CREDIT' ? 'CREDIT' : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const memo = typeof body?.memo === 'string' ? body.memo.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId)) return invalid('지급 대상 회원을 선택해주세요.');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(grantId)) return invalid('지급 요청을 다시 시도해주세요.');
  if (!Number.isFinite(amountUsd) || amountUsd <= 0 || amountUsd > 1_000_000) return invalid('USD 지급 금액은 0보다 크고 1,000,000 이하로 입력해주세요.');
  if (!direction) return invalid('잔고 조정 방향을 선택해주세요.');
  if (!password || password.length > 128) return invalid('운영자 비밀번호를 입력해주세요.');
  if (memo.length > 200) return invalid('지급 사유는 200자 이내로 입력해주세요.');

  try {
    const result = await adjustUsdBalance({ userId, grantId, amountUsd, direction, password, memo, actorId: actor.uid, actorEmail: actor.email || 'master' });
    return privateJson({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ApiAuthError) return unauthorizedResponse(error);
    const message = error instanceof Error ? error.message : 'USD 지급에 실패했습니다.';
    const status = message.includes('찾을 수 없습니다') ? 404 : message.includes('동시에 변경') ? 409 : message.includes('서버에 저장') ? 503 : 400;
    return privateJson({ error: message }, status);
  }
}
