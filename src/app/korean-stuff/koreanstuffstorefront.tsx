'use client';

import Link from 'next/link';
import { useDeferredValue, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ChevronDown, Clock3, ExternalLink as ExternalLinkIcon, Search, ShieldCheck, ShoppingBag, Truck, X } from 'lucide-react';
import { getFreshSessionToken } from '@/lib/firebase';
import { KOREAN_STUFF_CATEGORIES, type KoreanStuffOrder, type KoreanStuffProduct } from '@/lib/koreanStuff';
import { useGlobalStore } from '@/store/useGlobalStore';

type FormState = { quantity: number; shippingName: string; shippingPhone: string; shippingAddress: string; shippingPostalCode: string };

const emptyForm: FormState = { quantity: 1, shippingName: '', shippingPhone: '', shippingAddress: '', shippingPostalCode: '' };
const pendingOrderStorageKey = 'gyopo-korean-stuff-pending-order';

function money(value: number) {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function KoreanStuffStorefront({ initialProductId }: { initialProductId?: string } = {}) {
  const user = useGlobalStore((state) => state.user);
  const setUser = useGlobalStore((state) => state.setUser);
  const [products, setProducts] = useState<KoreanStuffProduct[]>([]);
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<KoreanStuffProduct | null>(null);
  const [view, setView] = useState<'shop' | 'orders'>('shop');
  const [orders, setOrders] = useState<KoreanStuffOrder[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [orderState, setOrderState] = useState('');
  const [ordering, setOrdering] = useState(false);
  const orderAttempt = useRef<string | null>(null);
  const orderAttemptProduct = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (deferredQuery.trim()) params.set('q', deferredQuery.trim());
    fetch(`/api/korean-stuff/catalog?${params}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json() as { products?: KoreanStuffProduct[]; error?: string };
        if (!response.ok) throw new Error(payload.error || '상품을 불러오지 못했습니다.');
        if (active) setProducts(payload.products || []);
      })
      .catch((reason) => {
        if (active) {
          setProducts([]);
          setError(reason instanceof Error ? reason.message : '상품을 불러오지 못했습니다.');
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [category, deferredQuery]);

  useEffect(() => {
    if (view !== 'orders' || !user) return;
    let active = true;
    void getFreshSessionToken()
      .then((token) => token ? fetch('/api/korean-stuff/orders', { cache: 'no-store', headers: { authorization: `Bearer ${token}` } }) : null)
      .then(async (response) => {
        if (!response) return;
        const payload = await response.json() as { orders?: KoreanStuffOrder[]; error?: string };
        if (!response.ok) throw new Error(payload.error || '배송 현황을 불러오지 못했습니다.');
        if (active) setOrders(payload.orders || []);
      })
      .catch((reason) => { if (active) setOrderState(reason instanceof Error ? reason.message : '배송 현황을 불러오지 못했습니다.'); });
    return () => { active = false; };
  }, [view, user?.id]);

  const openCheckout = (product: KoreanStuffProduct) => {
    if (orderAttemptProduct.current && orderAttemptProduct.current !== product.id) orderAttempt.current = null;
    orderAttemptProduct.current = product.id;
    if (typeof window !== 'undefined') {
      try {
        const pending = JSON.parse(window.sessionStorage.getItem(pendingOrderStorageKey) || 'null') as { productId?: string; key?: string } | null;
        orderAttempt.current = pending?.productId === product.id && pending.key && /^[A-Za-z0-9_-]{16,64}$/.test(pending.key) ? pending.key : orderAttempt.current;
      } catch { orderAttempt.current = null; }
    }
    setSelected(product);
    setOrderState('');
    setForm(emptyForm);
  };

  const submitOrder = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    if (!user) { setOrderState('로그인 후 GYOPO USD 잔액으로 결제할 수 있습니다.'); return; }
    setOrdering(true);
    setOrderState('결제 원장과 재고를 확인하는 중입니다.');
    try {
      const token = await getFreshSessionToken();
      if (!token) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
      const idempotencyKey = orderAttempt.current || crypto.randomUUID();
      orderAttempt.current = idempotencyKey;
      window.sessionStorage.setItem(pendingOrderStorageKey, JSON.stringify({ productId: selected.id, key: idempotencyKey }));
      const response = await fetch('/api/korean-stuff/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ idempotencyKey, productId: selected.id, ...form }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; orderId?: string; expectedDeliveryDate?: string; balanceUsd?: number };
      if (!response.ok) throw new Error(payload.error || '주문을 처리하지 못했습니다.');
      if (typeof payload.balanceUsd === 'number') setUser({ ...user, usdBalance: payload.balanceUsd });
      setOrderState(`주문이 접수되었습니다. 주문번호 ${payload.orderId || ''} · 예상 배송일 ${payload.expectedDeliveryDate || '확인 중'}`);
      setSelected(null);
      setView('orders');
      orderAttempt.current = null;
      orderAttemptProduct.current = null;
      window.sessionStorage.removeItem(pendingOrderStorageKey);
    } catch (reason) {
      setOrderState(reason instanceof Error ? reason.message : '주문을 처리하지 못했습니다.');
    } finally {
      setOrdering(false);
    }
  };

  const detailProduct = initialProductId ? products.find((product) => product.id === initialProductId) : null;

  return <div className="korean-stuff-storefront">
    <div className="korean-stuff-topline"><span>GYOPO MEMBER SHOP</span><span>배송 조건을 확인한 상품만 운영 승인됩니다.</span></div>
    <header className="korean-stuff-hero"><div><p className="korean-stuff-kicker">KOREAN STUFF / CURATED COMMERCE</p><h1>한국인의 생활을<br /><em>더 가까이</em></h1><p className="korean-stuff-lede">공식 공급원, 실제 재고, 3일 이내 배송 조건을 확인한 상품만 소개합니다.</p></div><div className="korean-stuff-hero-note"><ShieldCheck size={18} /><span>GYOPO USD 잔액으로 결제<br /><small>상품마다 판매자·배송 조건 공개</small></span></div></header>
    <div className="korean-stuff-view-tabs"><button type="button" className={view === 'shop' ? 'is-active' : ''} onClick={() => setView('shop')}>SHOP</button><button type="button" className={view === 'orders' ? 'is-active' : ''} onClick={() => { if (!user) setOrderState('로그인 후 배송 현황을 확인할 수 있습니다.'); setView('orders'); }}>배송 현황 {orders.length > 0 && <span>{orders.length}</span>}</button></div>
    {orderState && !selected && <div className="korean-stuff-notice" role="status">{orderState}</div>}
    {view === 'shop' ? <>
      {!initialProductId && <nav className="korean-stuff-departments" aria-label="Korean Stuff 카테고리"><button type="button" className={!category ? 'is-active' : ''} onClick={() => setCategory('')}>전체</button>{KOREAN_STUFF_CATEGORIES.map((item) => <button type="button" className={category === item.id ? 'is-active' : ''} key={item.id} onClick={() => setCategory(item.id)}><span>{item.label}</span><small>{item.english}</small></button>)}</nav>}
      {!initialProductId && <div className="korean-stuff-toolbar"><div className="korean-stuff-result"><strong>{category ? KOREAN_STUFF_CATEGORIES.find((item) => item.id === category)?.label : 'ALL ITEMS'}</strong><span>{loading ? '확인 중' : `${products.length}개 운영 상품`}</span></div><label className="korean-stuff-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="상품명·브랜드·공급원 검색" /><kbd>/</kbd></label><button type="button" className="korean-stuff-sort">추천순 <ChevronDown size={15} /></button></div>}
      {!loading && !error && detailProduct && <section className="korean-stuff-detail"><div className="korean-stuff-detail-gallery"><img src={detailProduct.images[0]} alt={detailProduct.title} /><div>{detailProduct.images.slice(1).map((image) => <img key={image} src={image} alt="" />)}</div></div><div className="korean-stuff-detail-copy"><p className="korean-stuff-kicker">{detailProduct.brand || detailProduct.sourceName}</p><h2>{detailProduct.title}</h2><p>{detailProduct.description || '공급원과 배송 조건을 확인한 운영 상품입니다.'}</p><strong>{money(detailProduct.salePrice)}</strong><dl><div><dt>배송</dt><dd>{detailProduct.shippingDays}일 이내</dd></div><div><dt>판매자</dt><dd>{detailProduct.supplierName}</dd></div><div><dt>재고</dt><dd>{detailProduct.stock}개</dd></div><div><dt>배송 권역</dt><dd>{detailProduct.shipsTo.join(', ')}</dd></div></dl><button type="button" onClick={() => openCheckout(detailProduct)}>GYOPO USD로 구매하기 <ArrowRight size={15} /></button><a href={detailProduct.sourceUrl} target="_blank" rel="noreferrer">공식 공급원에서 정보 확인 <ExternalLinkIcon /></a></div></section>}
      {loading && <div className="korean-stuff-empty"><span className="korean-stuff-loader" /> 운영 승인 상품을 확인하는 중입니다.</div>}
      {!loading && error && <div className="korean-stuff-empty"><strong>상품을 불러오지 못했습니다.</strong><span>{error}</span></div>}
      {!loading && !error && initialProductId && !detailProduct && <div className="korean-stuff-empty"><ShoppingBag size={30} /><strong>상품을 찾을 수 없습니다.</strong><span>운영 승인 상품이 아니거나 판매가 종료되었습니다.</span></div>}
      {!initialProductId && !loading && !error && products.length === 0 && <div className="korean-stuff-empty"><ShoppingBag size={30} /><strong>현재 운영 승인 상품이 없습니다.</strong><span>마스터 운영센터에서 공급원·재고·배송 조건을 확인한 상품만 이 화면에 표시됩니다.</span></div>}
      {!initialProductId && !loading && !error && products.length > 0 && <div className="korean-stuff-grid">{products.map((product) => <article className="korean-stuff-card" key={product.id}><Link href={`/korean-stuff/products/${encodeURIComponent(product.id)}`} className="korean-stuff-card-media"><img src={product.images[0]} alt={product.title} /><span className="korean-stuff-card-tag">{product.shippingDays}일 배송</span></Link><div className="korean-stuff-card-body"><p className="korean-stuff-brand">{product.brand || product.sourceName}</p><Link href={`/korean-stuff/products/${encodeURIComponent(product.id)}`} className="korean-stuff-title">{product.title}</Link><div className="korean-stuff-card-meta"><strong>{money(product.salePrice)}</strong><span>{product.supplierName}</span></div><div className="korean-stuff-card-foot"><span><Truck size={14} /> {product.shippingDays}일 이내</span><button type="button" onClick={() => openCheckout(product)}>구매하기 <ArrowRight size={14} /></button></div></div></article>)}</div>}
    </> : <section className="korean-stuff-orders"><div className="korean-stuff-orders-heading"><div><p className="korean-stuff-kicker">ORDER HISTORY</p><h2>주문·배송 현황</h2></div><p>결제 원장에 저장된 실제 주문만 표시됩니다.</p></div>{!user ? <div className="korean-stuff-empty">로그인 후 주문 배송 현황을 확인할 수 있습니다.</div> : orders.length === 0 ? <div className="korean-stuff-empty"><Truck size={30} /><strong>아직 주문이 없습니다.</strong><span>스토어에서 주문한 상품의 배송 상태가 이곳에 표시됩니다.</span></div> : <div className="korean-stuff-order-list">{orders.map((order) => <article key={order.id} className="korean-stuff-order"><div><p>{order.status}</p><h3>{order.title}</h3><span>{order.id} · {order.quantity}개 · {money(order.total)}</span></div><div><strong>예상 배송일</strong><span>{order.expectedDeliveryDate}</span>{order.trackingNumber && <span>송장 {order.trackingNumber}</span>}</div></article>)}</div>}</section>}
    <footer className="korean-stuff-footer"><div><strong>운영 기준</strong><span>공식 공급원 URL · 실제 재고 · 3일 이내 배송 · 평균가 대비 30% 이내</span></div><Link href="/master/korean-stuff">운영센터 <ArrowRight size={15} /></Link></footer>
    {selected && <div className="korean-stuff-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><section className="korean-stuff-checkout" aria-label="Korean Stuff 주문"><button type="button" className="korean-stuff-close" onClick={() => setSelected(null)} aria-label="닫기"><X size={18} /></button><div className="korean-stuff-checkout-product"><img src={selected.images[0]} alt={selected.title} /><div><p>{selected.brand || selected.sourceName}</p><h2>{selected.title}</h2><strong>{money(selected.salePrice)}</strong><span><Clock3 size={14} /> 예상 {selected.shippingDays}일 배송</span></div></div><form onSubmit={submitOrder} className="korean-stuff-checkout-form"><div className="korean-stuff-quantity"><label htmlFor="ks-quantity">수량</label><input id="ks-quantity" type="number" min="1" max={Math.min(10, selected.stock)} value={form.quantity} onChange={(event) => setForm({ ...form, quantity: Math.min(10, Math.max(1, Number(event.target.value) || 1)) })} /><span>재고 {selected.stock}</span></div><input required placeholder="받는 분" value={form.shippingName} onChange={(event) => setForm({ ...form, shippingName: event.target.value })} /><input required placeholder="전화번호" value={form.shippingPhone} onChange={(event) => setForm({ ...form, shippingPhone: event.target.value })} /><input required placeholder="우편번호" value={form.shippingPostalCode} onChange={(event) => setForm({ ...form, shippingPostalCode: event.target.value })} /><textarea required placeholder="배송 주소" value={form.shippingAddress} onChange={(event) => setForm({ ...form, shippingAddress: event.target.value })} rows={3} /><div className="korean-stuff-checkout-total"><span>GYOPO USD 잔액에서 차감</span><strong>{money(selected.salePrice * form.quantity)}</strong></div>{orderState && <p className="korean-stuff-form-message">{orderState}</p>}<button type="submit" disabled={ordering}>{ordering ? '처리 중...' : user ? '주문·결제 확정' : '로그인 후 주문하기'}</button></form></section></div>}
  </div>;
}
