import { abortBadballMatch, rematchBadballMatch, reserveBadballStake, settleBadballMatch, startBadballMatch, tickBadball } from '@/lib/badballServer';
import { clientAddress, consumeRateLimit, requireAuthenticatedUser, rateLimitResponse, unauthorizedResponse } from '@/lib/apiSecurity';

export const runtime = 'edge';

type Action = 'reserve' | 'start' | 'tick' | 'settle' | 'abort' | 'rematch';
type Body = { action?: unknown; roomId?: unknown; round?: unknown; seq?: unknown; target?: unknown };

function privateJson(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store, private', pragma: 'no-cache', Vary: 'Authorization' } });
}

function errorStatus(message: string) {
  if (message.includes('로그인')) return 401;
  if (message.includes('참가자') || message.includes('호스트만')) return 403;
  if (message.includes('잔액이 부족')) return 402;
  if (message.includes('동시에') || message.includes('이미 처리') || message.includes('이미 시작')) return 409;
  if (message.includes('Firebase') || message.includes('서버')) return 503;
  return 400;
}

export async function POST(request: Request) {
  let user;
  try {
    user = await requireAuthenticatedUser(request);
  } catch (error) {
    return unauthorizedResponse(error);
  }
  const limit = consumeRateLimit(`badball:${user.uid}:${clientAddress(request)}`, 1_200, 60_000);
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterMs);
  const body = await request.json().catch(() => null) as Body | null;
  const action = typeof body?.action === 'string' ? body.action as Action : '';
  const roomId = typeof body?.roomId === 'string' ? body.roomId.trim() : '';
  const round = Number(body?.round);
  if (!['reserve', 'start', 'tick', 'settle', 'abort', 'rematch'].includes(action)) return privateJson({ error: '배드볼 요청 종류가 올바르지 않습니다.' }, 400);
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(roomId) || !Number.isInteger(round) || round < 1 || round > 20) return privateJson({ error: '배드볼 방 정보가 올바르지 않습니다.' }, 400);

  try {
    if (action === 'reserve') return privateJson({ ok: true, ...(await reserveBadballStake({ roomId, round, userId: user.uid })) });
    if (action === 'start') return privateJson({ ok: true, ...(await startBadballMatch({ roomId, round, userId: user.uid })) });
    if (action === 'settle') return privateJson({ ok: true, ...(await settleBadballMatch({ roomId, round, userId: user.uid })) });
    if (action === 'abort') return privateJson({ ok: true, ...(await abortBadballMatch({ roomId, round, userId: user.uid })) });
    if (action === 'rematch') return privateJson({ ok: true, ...(await rematchBadballMatch({ roomId, round, userId: user.uid })) });
    const seq = Number(body?.seq);
    const target = Number(body?.target);
    if (!Number.isInteger(seq) || !Number.isFinite(target)) return privateJson({ error: '배드볼 입력값이 올바르지 않습니다.' }, 400);
    const tick = await tickBadball({ roomId, round, userId: user.uid, seq, target });
    let settlement: { alreadySettled: boolean; outcome: string } | undefined;
    if (tick.shouldSettle) settlement = await settleBadballMatch({ roomId, round, userId: user.uid });
    return privateJson({ ok: true, ...tick, settlement });
  } catch (error) {
    const message = error instanceof Error ? error.message : '배드볼 서버 처리에 실패했습니다.';
    return privateJson({ error: message }, errorStatus(message));
  }
}
