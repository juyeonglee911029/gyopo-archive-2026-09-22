import { requireAuthenticatedUser, unauthorizedResponse } from '@/lib/apiSecurity';
import { createKoreanStuffOrder, getAdminJsonDocument, listAdminJsonDocuments } from '@/lib/firebaseAdmin';
import { normalizeKoreanStuffPolicy, productIsSellable, type KoreanStuffOrder, type KoreanStuffProduct } from '@/lib/koreanStuff';

export const runtime = 'edge';

type OrderInput = {
  idempotencyKey?: string;
  productId?: string;
  quantity?: number;
  shippingName?: string;
  shippingPhone?: string;
  shippingAddress?: string;
  shippingPostalCode?: string;
};

function clean(value: unknown, max = 180) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export async function GET(request: Request) {
  let user;
  try { user = await requireAuthenticatedUser(request); } catch (error) { return unauthorizedResponse(error); }
  try {
    const rows = await listAdminJsonDocuments('koreanStuffOrders');
    const orders = rows
      .map((row) => ({ id: row.id, ...(row.data as Omit<KoreanStuffOrder, 'id'>) }))
      .filter((order): order is KoreanStuffOrder => order.userId === user.uid)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return Response.json({ orders }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '배송 현황을 불러오지 못했습니다.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  let user;
  try { user = await requireAuthenticatedUser(request); } catch (error) { return unauthorizedResponse(error); }
  const body = await request.json().catch(() => null) as OrderInput | null;
  const idempotencyKey = clean(body?.idempotencyKey, 64);
  const productId = clean(body?.productId, 128);
  const quantity = Number(body?.quantity || 1);
  const shippingName = clean(body?.shippingName, 100);
  const shippingPhone = clean(body?.shippingPhone, 40);
  const shippingAddress = clean(body?.shippingAddress, 300);
  const shippingPostalCode = clean(body?.shippingPostalCode, 30);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(idempotencyKey) || !productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 10 || !shippingName || !shippingPhone || !shippingAddress || !shippingPostalCode) {
    return Response.json({ error: '상품 수량과 배송지 정보를 모두 입력해주세요.' }, { status: 400 });
  }
  try {
    const orderId = `ks-${idempotencyKey}`;
    const existingRow = await getAdminJsonDocument('koreanStuffOrders', orderId);
    if (existingRow) {
      const existing = { id: existingRow.id, ...existingRow.data } as KoreanStuffOrder;
      const sameRequest = existing.userId === user.uid && existing.productId === productId && existing.quantity === quantity
        && existing.shippingName === shippingName && existing.shippingPhone === shippingPhone && existing.shippingAddress === shippingAddress && existing.shippingPostalCode === shippingPostalCode;
      if (!sameRequest) return Response.json({ error: '같은 주문 재시도 키에 다른 배송지 또는 상품 정보가 사용되었습니다.' }, { status: 409 });
      const result = await createKoreanStuffOrder({ userId: user.uid, orderId, productId, quantity: existing.quantity, total: existing.total, order: existing });
      return Response.json({ ok: true, orderId, total: existing.total, balanceUsd: result.balanceUsd, expectedDeliveryDate: existing.expectedDeliveryDate });
    }
    const [row, settingsRow] = await Promise.all([
      getAdminJsonDocument('koreanStuffProducts', productId),
      getAdminJsonDocument('koreanStuffSettings', 'default'),
    ]);
    const product = row ? ({ id: row.id, ...row.data } as KoreanStuffProduct) : null;
    if (!product || !productIsSellable(product, normalizeKoreanStuffPolicy(settingsRow?.data))) return Response.json({ error: '상품이 더 이상 판매되지 않습니다.' }, { status: 409 });
    if (product.stock < quantity) return Response.json({ error: '요청 수량이 현재 재고보다 많습니다.' }, { status: 409 });
    const total = Math.round(product.salePrice * quantity * 100) / 100;
    const expectedDeliveryDate = new Date(Date.now() + product.shippingDays * 86_400_000).toISOString().slice(0, 10);
    const result = await createKoreanStuffOrder({
      userId: user.uid,
      orderId,
      productId,
      quantity,
      total,
      order: { userId: user.uid, productId, title: product.title, supplierId: product.supplierId, quantity, unitPrice: product.salePrice, shippingName, shippingPhone, shippingAddress, shippingPostalCode, expectedDeliveryDate, status: 'PAID' },
    });
    return Response.json({ ok: true, orderId, total, balanceUsd: result.balanceUsd, expectedDeliveryDate });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '주문을 처리하지 못했습니다.' }, { status: 409 });
  }
}
