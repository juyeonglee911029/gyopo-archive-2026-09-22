import { requireMasterUser, unauthorizedResponse } from '@/lib/apiSecurity';
import { getAdminJsonDocument, listAdminJsonDocuments, upsertAdminJsonDocument } from '@/lib/firebaseAdmin';
import { calculateKoreanStuffSalePrice, KOREAN_STUFF_CATEGORIES, normalizeKoreanStuffPolicy, priceVariancePercent, validateKoreanStuffProduct, type KoreanStuffCategory, type KoreanStuffOrder, type KoreanStuffProduct, type KoreanStuffSettings, type KoreanStuffSupplier } from '@/lib/koreanStuff';

export const runtime = 'edge';

const collections = ['koreanStuffProducts', 'koreanStuffSuppliers', 'koreanStuffOrders', 'koreanStuffSettings'] as const;

function text(value: unknown, max = 300) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function id(value: unknown, fallback: string) { const candidate = text(value, 128); return /^[A-Za-z0-9_-]{1,128}$/.test(candidate) ? candidate : fallback; }
function category(value: unknown): KoreanStuffCategory | undefined { return KOREAN_STUFF_CATEGORIES.some((item) => item.id === value) ? value as KoreanStuffCategory : undefined; }
function productStatus(value: unknown): KoreanStuffProduct['status'] { return ['DRAFT', 'REVIEW', 'APPROVED', 'PAUSED', 'REJECTED'].includes(String(value)) ? value as KoreanStuffProduct['status'] : 'DRAFT'; }
function supplierStatus(value: unknown): KoreanStuffSupplier['status'] { return ['ACTIVE', 'REVIEW', 'PAUSED'].includes(String(value)) ? value as KoreanStuffSupplier['status'] : 'REVIEW'; }

function isSafeHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (!url.port || url.port === '443') && !['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(url.hostname) && !url.hostname.endsWith('.local');
  } catch { return false; }
}

async function stableProductId(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return `feed-${Array.from(new Uint8Array(digest)).slice(0, 12).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function GET(request: Request) {
  try { await requireMasterUser(request); } catch (error) { return unauthorizedResponse(error); }
  try {
    const [products, suppliers, orders, settings] = await Promise.all(collections.map((collection) => listAdminJsonDocuments(collection)));
    return Response.json({ products: products.map((row) => ({ id: row.id, ...row.data })), suppliers: suppliers.map((row) => ({ id: row.id, ...row.data })), orders: orders.map((row) => ({ id: row.id, ...row.data })), settings: settings.find((row) => row.id === 'default')?.data || null, generatedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Korean Stuff 운영 데이터를 불러오지 못했습니다.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  let user;
  try { user = await requireMasterUser(request); } catch (error) { return unauthorizedResponse(error); }
  const body = await request.json().catch(() => null) as { action?: string; product?: Partial<KoreanStuffProduct>; supplier?: Partial<KoreanStuffSupplier>; settings?: Partial<KoreanStuffSettings>; order?: Partial<KoreanStuffOrder>; supplierId?: string } | null;
  const now = new Date().toISOString();
  try {
    if (body?.action === 'saveProduct' && body.product) {
      const product = body.product;
      const productId = id(product.id, `product-${crypto.randomUUID()}`);
      const existingProduct = await getAdminJsonDocument('koreanStuffProducts', productId);
      const markupRate = Math.min(1, Math.max(0, Number.isFinite(Number(product.markupRate)) ? Number(product.markupRate) : 0.25));
      const sourcePrice = Number(product.sourcePrice || 0);
      const averagePrice = product.averagePrice ? Number(product.averagePrice) : undefined;
      const salePrice = calculateKoreanStuffSalePrice(sourcePrice, markupRate);
      const normalized: KoreanStuffProduct = { id: productId, title: text(product.title, 180), brand: text(product.brand, 120) || undefined, category: product.category as KoreanStuffProduct['category'], description: text(product.description, 2_000) || text(existingProduct?.data.description, 2_000) || undefined, images: Array.isArray(product.images) ? product.images.map((image) => text(image, 500)).filter(Boolean).slice(0, 8) : [], sourceUrl: text(product.sourceUrl, 500), sourceName: text(product.sourceName, 160), supplierId: text(product.supplierId, 128), supplierName: text(product.supplierName, 160), sourcePrice, salePrice, currency: 'USD', markupRate, averagePrice, priceVariance: priceVariancePercent(salePrice, averagePrice), stock: Math.max(0, Math.floor(Number(product.stock || 0))), shippingDays: Math.max(0, Math.floor(Number(product.shippingDays || 0))), shipsTo: Array.isArray(product.shipsTo) ? product.shipsTo.map((item) => text(item, 80)).filter(Boolean).slice(0, 100) : [], status: productStatus(product.status), sourceCheckedAt: text(product.sourceCheckedAt, 80) || text(existingProduct?.data.sourceCheckedAt, 80) || undefined, createdAt: text(product.createdAt, 80) || text(existingProduct?.data.createdAt, 80) || now, updatedAt: now };
      if (normalized.status === 'APPROVED') {
        const policyRow = await getAdminJsonDocument('koreanStuffSettings', 'default');
        const errors = validateKoreanStuffProduct(normalized, normalizeKoreanStuffPolicy(policyRow?.data));
        if (errors.length) return Response.json({ error: `승인 조건을 완성해주세요: ${errors.join(', ')}`, missing: errors }, { status: 422 });
      }
      await upsertAdminJsonDocument('koreanStuffProducts', productId, normalized as unknown as Record<string, unknown>);
      return Response.json({ ok: true, record: normalized });
    }
    if (body?.action === 'saveSupplier' && body.supplier) {
      const supplier = body.supplier;
      const supplierId = id(supplier.id, `supplier-${crypto.randomUUID()}`);
      const existingSupplier = await getAdminJsonDocument('koreanStuffSuppliers', supplierId);
      const normalized: KoreanStuffSupplier = { id: supplierId, name: text(supplier.name, 160), sourceUrl: text(supplier.sourceUrl, 500), feedUrl: text(supplier.feedUrl, 500) || undefined, defaultCategory: category(supplier.defaultCategory), country: text(supplier.country, 80), shippingDays: Math.max(0, Math.floor(Number(supplier.shippingDays || 0))), status: supplierStatus(supplier.status), lastSyncAt: supplier.lastSyncAt || text(existingSupplier?.data.lastSyncAt, 80) || undefined, lastSyncStatus: supplier.lastSyncStatus || (existingSupplier?.data.lastSyncStatus as KoreanStuffSupplier['lastSyncStatus'] | undefined) || 'NOT_RUN', lastSyncMessage: text(supplier.lastSyncMessage, 300) || text(existingSupplier?.data.lastSyncMessage, 300) || undefined, createdAt: text(supplier.createdAt, 80) || text(existingSupplier?.data.createdAt, 80) || now, updatedAt: now };
      if (!normalized.name || !isSafeHttpsUrl(normalized.sourceUrl) || (normalized.feedUrl && !isSafeHttpsUrl(normalized.feedUrl)) || normalized.shippingDays < 1 || normalized.shippingDays > 3) return Response.json({ error: '판매자명·공식 HTTPS URL·1~3일 배송 조건을 확인해주세요.' }, { status: 422 });
      await upsertAdminJsonDocument('koreanStuffSuppliers', supplierId, normalized as unknown as Record<string, unknown>);
      return Response.json({ ok: true, record: normalized });
    }
    if (body?.action === 'syncSupplier' && body.supplierId) {
      const supplierRow = await getAdminJsonDocument('koreanStuffSuppliers', id(body.supplierId, ''));
      const supplier = supplierRow?.data as Partial<KoreanStuffSupplier> | undefined;
      if (!supplier?.feedUrl || !isSafeHttpsUrl(supplier.feedUrl)) return Response.json({ error: 'JSON 상품 피드 HTTPS URL을 먼저 등록해주세요.' }, { status: 422 });
      const response = await fetch(supplier.feedUrl, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error(`공급원 피드가 응답하지 않습니다. (${response.status})`);
      const payload = await response.json().catch(() => null) as { products?: Array<Record<string, unknown>> } | Array<Record<string, unknown>> | null;
      const items = Array.isArray(payload) ? payload : payload?.products;
      if (!items?.length) throw new Error('공급원 피드에 상품이 없습니다.');
      const settingsRow = await getAdminJsonDocument('koreanStuffSettings', 'default');
      const settings = (settingsRow?.data || { maxPriceVariance: 30, maxShippingDays: 3, markupRate: 0.25, autoPublishApproved: false }) as KoreanStuffSettings;
      const policy = normalizeKoreanStuffPolicy(settings);
      let imported = 0;
      let review = 0;
      const existingProducts = new Map((await listAdminJsonDocuments('koreanStuffProducts')).map((row) => [row.id, row.data]));
      for (const item of items.slice(0, 300)) {
        const sourceUrl = text(item.url || item.sourceUrl, 500);
        const title = text(item.title || item.name, 180);
        const itemCategory = category(item.category) || category(supplier.defaultCategory);
        if (!isSafeHttpsUrl(sourceUrl) || !title || !itemCategory) { review += 1; continue; }
        const sourcePrice = Number(item.price || item.sourcePrice || 0);
        const averagePrice = Number(item.averagePrice || 0) || undefined;
        const markupRate = Math.min(1, Math.max(0, Number.isFinite(Number(settings.markupRate)) ? Number(settings.markupRate) : 0.25));
        const productId = await stableProductId(sourceUrl);
        const salePrice = calculateKoreanStuffSalePrice(sourcePrice, markupRate);
        const candidate: KoreanStuffProduct = { id: productId, title, brand: text(item.brand, 120) || undefined, category: itemCategory, description: text(item.description, 2_000) || undefined, images: Array.isArray(item.images) ? item.images.map((image) => text(image, 500)).filter(Boolean).slice(0, 8) : [text(item.image, 500)].filter(Boolean), sourceUrl, sourceName: text(item.sourceName, 160) || text(supplier.name, 160), supplierId: String(supplier.id || body.supplierId), supplierName: text(supplier.name, 160), sourcePrice, salePrice, currency: 'USD', markupRate, averagePrice, priceVariance: priceVariancePercent(salePrice, averagePrice), stock: Math.max(0, Math.floor(Number(item.stock || 0))), shippingDays: Math.max(0, Math.floor(Number(item.shippingDays || supplier.shippingDays || 0))), shipsTo: Array.isArray(item.shipsTo) ? item.shipsTo.map((value) => text(value, 80)).filter(Boolean) : [], status: 'REVIEW', sourceCheckedAt: now, createdAt: text(existingProducts.get(productId)?.createdAt, 80) || now, updatedAt: now };
        const valid = validateKoreanStuffProduct(candidate, policy);
        candidate.status = settings.autoPublishApproved && valid.length === 0 ? 'APPROVED' : 'REVIEW';
        if (candidate.status === 'APPROVED') imported += 1; else review += 1;
        await upsertAdminJsonDocument('koreanStuffProducts', productId, candidate as unknown as Record<string, unknown>);
      }
      const syncMessage = `${items.slice(0, 300).length}개 확인 · ${imported}개 자동 승인 · ${review}개 검토 대기`;
      const updatedSupplier = { ...supplier, id: supplier.id || body.supplierId, lastSyncAt: now, lastSyncStatus: 'CONNECTED', lastSyncMessage: syncMessage, updatedAt: now };
      await upsertAdminJsonDocument('koreanStuffSuppliers', String(body.supplierId), updatedSupplier as Record<string, unknown>);
      return Response.json({ ok: true, imported, review, message: syncMessage });
    }
    if (body?.action === 'saveSettings' && body.settings) {
      const policy = normalizeKoreanStuffPolicy(body.settings);
      const markupRate = Number(body.settings.markupRate);
      const settings: KoreanStuffSettings = { markupRate: Math.min(1, Math.max(0, Number.isFinite(markupRate) ? markupRate : 0.25)), ...policy, autoPublishApproved: Boolean(body.settings.autoPublishApproved), updatedAt: now, updatedBy: user.email || user.uid };
      await upsertAdminJsonDocument('koreanStuffSettings', 'default', settings as unknown as Record<string, unknown>);
      return Response.json({ ok: true, record: settings });
    }
    if (body?.action === 'updateOrder' && body.order?.id) {
      const orderId = id(body.order.id, '');
      if (!orderId) return Response.json({ error: '주문 번호가 올바르지 않습니다.' }, { status: 400 });
      const status = body.order.status;
      const allowed = new Set(['PAID', 'FULFILLMENT_REVIEW', 'PURCHASED', 'SHIPPING', 'IN_TRANSIT', 'DELIVERED', 'REFUND_REVIEW']);
      if (!status || !allowed.has(status)) return Response.json({ error: '주문 상태가 올바르지 않습니다.' }, { status: 422 });
      const record = { ...body.order, id: orderId, status, trackingNumber: text(body.order.trackingNumber, 120) || undefined, supplierOrderId: text(body.order.supplierOrderId, 120) || undefined, operatorNote: text(body.order.operatorNote, 500) || undefined, updatedAt: now };
      await upsertAdminJsonDocument('koreanStuffOrders', orderId, record as unknown as Record<string, unknown>);
      return Response.json({ ok: true, record });
    }
    return Response.json({ error: 'Korean Stuff 운영 요청 형식이 올바르지 않습니다.' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '운영 데이터를 저장하지 못했습니다.' }, { status: 500 });
  }
}
