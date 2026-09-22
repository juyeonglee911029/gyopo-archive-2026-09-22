export const KOREAN_STUFF_CATEGORIES = [
  { id: 'fashion', label: '의류', english: 'Fashion' },
  { id: 'accessories', label: '액세서리', english: 'Accessories' },
  { id: 'travel', label: '여행상품', english: 'Travel' },
  { id: 'electronics', label: '전자제품·가전', english: 'Electronics' },
] as const;

export type KoreanStuffCategory = (typeof KOREAN_STUFF_CATEGORIES)[number]['id'];
export type KoreanStuffProductStatus = 'DRAFT' | 'REVIEW' | 'APPROVED' | 'PAUSED' | 'REJECTED';
export type KoreanStuffSupplierStatus = 'ACTIVE' | 'REVIEW' | 'PAUSED';
export type KoreanStuffOrderStatus = 'PAID' | 'FULFILLMENT_REVIEW' | 'PURCHASED' | 'SHIPPING' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED' | 'REFUND_REVIEW';

export type KoreanStuffProduct = {
  id: string;
  title: string;
  brand?: string;
  category: KoreanStuffCategory;
  description?: string;
  images: string[];
  sourceUrl: string;
  sourceName: string;
  supplierId: string;
  supplierName: string;
  sourcePrice: number;
  salePrice: number;
  currency: 'USD';
  markupRate: number;
  averagePrice?: number;
  priceVariance?: number;
  stock: number;
  shippingDays: number;
  shipsTo: string[];
  status: KoreanStuffProductStatus;
  sourceCheckedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type KoreanStuffSupplier = {
  id: string;
  name: string;
  sourceUrl: string;
  feedUrl?: string;
  defaultCategory?: KoreanStuffCategory;
  country: string;
  shippingDays: number;
  status: KoreanStuffSupplierStatus;
  lastSyncAt?: string;
  lastSyncStatus?: 'CONNECTED' | 'FAILED' | 'NOT_RUN';
  lastSyncMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type KoreanStuffOrder = {
  id: string;
  userId: string;
  productId: string;
  title: string;
  supplierId: string;
  quantity: number;
  unitPrice: number;
  total: number;
  currency: 'USD';
  status: KoreanStuffOrderStatus;
  shippingName: string;
  shippingPhone: string;
  shippingAddress: string;
  shippingPostalCode: string;
  expectedDeliveryDate: string;
  trackingNumber?: string;
  supplierOrderId?: string;
  operatorNote?: string;
  createdAt: string;
  updatedAt: string;
};

export type KoreanStuffSettings = {
  markupRate: number;
  maxPriceVariance: number;
  maxShippingDays: number;
  autoPublishApproved: boolean;
  updatedAt: string;
  updatedBy: string;
};

export type KoreanStuffPolicy = Pick<KoreanStuffSettings, 'maxPriceVariance' | 'maxShippingDays'>;
export const DEFAULT_KOREAN_STUFF_POLICY: KoreanStuffPolicy = { maxPriceVariance: 30, maxShippingDays: 3 };

export function normalizeKoreanStuffPolicy(value?: { maxPriceVariance?: unknown; maxShippingDays?: unknown }): KoreanStuffPolicy {
  const maxPriceVariance = Number(value?.maxPriceVariance);
  const maxShippingDays = Number(value?.maxShippingDays);
  return {
    maxPriceVariance: Math.min(30, Math.max(0, Number.isFinite(maxPriceVariance) ? maxPriceVariance : DEFAULT_KOREAN_STUFF_POLICY.maxPriceVariance)),
    maxShippingDays: Math.min(3, Math.max(1, Math.floor(Number.isFinite(maxShippingDays) ? maxShippingDays : DEFAULT_KOREAN_STUFF_POLICY.maxShippingDays))),
  };
}

export function calculateKoreanStuffSalePrice(sourcePrice: number, markupRate = 0.25): number {
  return Math.round(sourcePrice * (1 + markupRate) * 100) / 100;
}

export function priceVariancePercent(price: number, averagePrice?: number): number | undefined {
  if (!averagePrice || averagePrice <= 0) return undefined;
  return Math.round((Math.abs(price - averagePrice) / averagePrice) * 10000) / 100;
}

export function validateKoreanStuffProduct(product: Partial<KoreanStuffProduct>, settings: KoreanStuffPolicy = DEFAULT_KOREAN_STUFF_POLICY): string[] {
  const errors: string[] = [];
  if (!product.title?.trim()) errors.push('상품명');
  if (!product.category || !KOREAN_STUFF_CATEGORIES.some((item) => item.id === product.category)) errors.push('카테고리');
  if (!product.sourceUrl?.startsWith('https://')) errors.push('공식 공급원 URL');
  if (!product.sourceName?.trim()) errors.push('공급원명');
  if (!product.supplierId?.trim()) errors.push('판매자 연결');
  if (!product.supplierName?.trim()) errors.push('판매자명');
  if (!product.images?.some((image) => image.startsWith('https://'))) errors.push('상품 이미지');
  if (!Number.isFinite(product.sourcePrice) || Number(product.sourcePrice) <= 0) errors.push('공급가');
  if (!Number.isFinite(product.salePrice) || Number(product.salePrice) <= 0) errors.push('판매가');
  if (!Number.isFinite(product.markupRate) || Number(product.markupRate) < 0 || Number(product.markupRate) > 1) errors.push('마진 정책');
  if (!Number.isFinite(product.stock) || Number(product.stock) < 1) errors.push('재고');
  if (!Number.isFinite(product.shippingDays) || Number(product.shippingDays) < 1 || Number(product.shippingDays) > settings.maxShippingDays) errors.push(`${settings.maxShippingDays}일 배송 조건`);
  if (!product.shipsTo?.length) errors.push('배송 가능 지역');
  const variance = priceVariancePercent(Number(product.salePrice || 0), product.averagePrice);
  if (variance !== undefined && variance > settings.maxPriceVariance) errors.push('평균가 대비 가격 차이');
  return errors;
}

export function productIsSellable(product: KoreanStuffProduct, settings: KoreanStuffPolicy = DEFAULT_KOREAN_STUFF_POLICY): boolean {
  return product.status === 'APPROVED' && product.stock > 0 && validateKoreanStuffProduct(product, settings).length === 0;
}
