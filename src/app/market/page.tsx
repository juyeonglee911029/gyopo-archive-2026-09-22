'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { RouteErrorState, RouteSkeleton, useRouteReadiness } from '@/components/layout/RouteExperience';
import { withRouteTimeout } from '@/lib/routeExperience';
import Link from 'next/link';
import { createDocument, deleteDocument, getSessionToken, isMasterUser, listDocuments, listEscrowOrdersForMember, mergeDocument, reserveEscrowPurchase, type EscrowOrder, type EscrowStatus } from '@/lib/firebase';
import { useGlobalStore } from '@/store/useGlobalStore';
import BannerAd from '@/components/ads/BannerAd';

type Product = { id: string; title: string; price: string; location: string; image?: string; country: string; authorId: string; createdAt: string; sourceId?: string; sourceUrl?: string; sourceName?: string; sourceContentId?: string };
const parsePrice = (value: string) => Number(value.replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0] || 0);
const displayPrice = (value: string) => { const amount = parsePrice(value); return amount ? `$${amount.toLocaleString('en-US')}` : value.replace(/\bUSDT\b/gi, '').trim(); };
const isNativeProduct = (item: Product) => item.authorId !== 'source' && !item.sourceId && !item.sourceContentId && !item.sourceUrl;

export default function MarketPage() {
  const { selectedCountry, user } = useGlobalStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [isWriting, setIsWriting] = useState(false);
  const [form, setForm] = useState({ title: '', price: '', location: '', image: '' });
  const [orders, setOrders] = useState<EscrowOrder[]>([]);
  const [orderNotice, setOrderNotice] = useState('');
  const [marketError, setMarketError] = useState('');
  const [loading, setLoading] = useState(true);
  const loadRequest = useRef(0);
  const [orderError, setOrderError] = useState('');
  useRouteReadiness(loading, Boolean(marketError));

  const loadProducts = async () => {
    const request = ++loadRequest.current;
    setLoading(true);
    setMarketError('');
    try {
      const data = await withRouteTimeout(listDocuments<Omit<Product, 'id'>>('marketItems', getSessionToken()));
      if (request !== loadRequest.current) return;
      setProducts(data.filter((item) => item.authorId && isNativeProduct(item)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setMarketError('');
    } catch { if (request === loadRequest.current) setMarketError('장터 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'); }
    finally { if (request === loadRequest.current) setLoading(false); }
  };
  const loadProductsEffect = useEffectEvent(loadProducts);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProductsEffect(), 0);
    return () => { window.clearTimeout(timer); loadRequest.current++; };
  }, [selectedCountry]);
  useEffect(() => {
    if (!user) { setOrders([]); return; }
    let active = true;
    void withRouteTimeout(listEscrowOrdersForMember(user.id, getSessionToken())).then((nextOrders) => {
      if (!active) return;
      setOrders(nextOrders.filter((order) => isMasterUser(user) || order.buyerId !== order.sellerId));
      setOrderError('');
    }).catch(() => { if (active) { setOrders([]); setOrderError('에스크로 진행 내역을 확인하지 못했습니다. 거래 상태가 변경된 것으로 간주하지 마세요.'); } });
    return () => { active = false; };
  }, [user?.id]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return window.alert('로그인 후 물품을 등록할 수 있습니다.');
    const token = getSessionToken();
    if (!token) return;
    try {
      await createDocument('marketItems', crypto.randomUUID(), { ...form, country: selectedCountry, authorId: user.id, createdAt: new Date().toISOString() }, token);
      setForm({ title: '', price: '', location: '', image: '' });
      setIsWriting(false);
      await loadProducts();
    } catch { window.alert('물품을 저장하지 못했습니다.'); }
  };

  const handleBuy = async (item: Product) => {
    if (!user) return window.alert('로그인 후 구매할 수 있습니다.');
    if (item.authorId === user.id) return window.alert('내가 등록한 물품은 구매할 수 없습니다.');
    if (item.sourceUrl) return window.alert('공식 참고 상품은 구매할 수 없습니다. 회원 판매 상품을 선택해주세요.');
    const amount = parsePrice(item.price);
    if (!amount) return window.alert('판매자가 유효한 가격을 등록하지 않았습니다.');
    const token = getSessionToken();
    if (!token) return;
    try {
      const orderId = await reserveEscrowPurchase(user.id, item.id, item.authorId, amount, token);
      setOrderNotice(`$${amount}가 에스크로에 보관되었습니다. 판매자의 배송 시작을 기다립니다.`);
      setOrders((current) => [{ id: orderId, buyerId: user.id, sellerId: item.authorId, productId: item.id, amount, status: 'PAYMENT_HELD', createdAt: new Date().toISOString(), timeline: [{ status: 'PAYMENT_HELD', at: new Date().toISOString(), note: '결제 금액 보관' }] }, ...current]);
    } catch (error) { window.alert(error instanceof Error ? error.message : '구매를 처리하지 못했습니다.'); }
  };

  const updateOrder = async (order: EscrowOrder, status: EscrowStatus, note: string) => {
    const token = getSessionToken();
    if (!token) return;
    const timeline = [...(order.timeline || []), { status, at: new Date().toISOString(), note }];
    try {
      await mergeDocument('escrowOrders', order.id, { status, timeline, updatedAt: new Date() }, token);
      setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status, timeline } : item));
    } catch { window.alert('배송 상태를 변경하지 못했습니다. 잠시 후 다시 시도해주세요.'); }
  };

  const removeOrder = async (order: EscrowOrder) => {
    if (!isMasterUser(user) || !window.confirm('이 잘못된 테스트 주문을 삭제할까요? 환불은 별도로 확인해야 합니다.')) return;
    const token = getSessionToken();
    if (!token) return;
    try { await deleteDocument('escrowOrders', order.id, token); setOrders((current) => current.filter((item) => item.id !== order.id)); } catch { window.alert('운영자 권한이 적용된 뒤 다시 시도해주세요.'); }
  };

  const removeProduct = async (item: Product) => {
    if (!user || !isNativeProduct(item) || (user.id !== item.authorId && !isMasterUser(user)) || !window.confirm('이 매물을 삭제할까요?')) return;
    const token = getSessionToken();
    if (!token) return;
    try { await deleteDocument('marketItems', item.id, token); setProducts((current) => current.filter((product) => product.id !== item.id)); } catch { window.alert('운영자 권한이 적용된 뒤 다시 시도해주세요.'); }
  };

  const filteredProducts = products.filter((product) => (selectedCountry === 'Global' || product.country === selectedCountry) && product.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="category-page market-page container mx-auto max-w-6xl px-4 py-8 text-slate-100">
      <div className="category-header"><div className="category-heading"><h1 className="text-3xl font-black text-gray-800">에스크로 중고장터</h1><p className="mt-2 text-gray-500">등록 물품을 확인하고 안전한 결제 보관 절차로 거래하세요.</p></div><div className="flex w-full flex-wrap gap-2 md:w-auto"><Link href="/theater" className="border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-black text-rose-700 hover:bg-rose-100">LIVE ROOM</Link><input type="text" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="물품 검색..." className="min-w-0 flex-1 border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500 md:w-64" /><button onClick={() => setIsWriting(true)} className="bg-orange-500 px-5 py-2 font-bold text-white hover:bg-orange-600">내 물건 팔기</button></div></div>
      {orderNotice && <div className="mb-5 border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-700">{orderNotice}</div>}
      {loading && <RouteSkeleton label="장터 목록을 불러오는 중입니다." />}
      {!loading && marketError && <RouteErrorState message={marketError} onRetry={() => void loadProducts()} />}
      {user && orderError && <p role="alert" className="ui-state route-state">{orderError}</p>}
      {!loading && filteredProducts.length === 0 && !marketError && <div className="ui-state route-state"><p>선택한 지역과 검색 조건에 맞는 매물이 없습니다.</p><p>검색 조건을 바꾸거나 내 물건 팔기에서 매물을 등록해보세요.</p></div>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 md:gap-6">{filteredProducts.map((item) => <div key={item.id} className="group relative overflow-hidden border border-white/10 bg-white/[.035] shadow-sm transition hover:bg-white/[.06]"><Link href={`/content/${encodeURIComponent(item.id)}?collection=marketItems`} className="group block"><div className="absolute left-2 top-2 z-10"><span className="bg-black/60 px-2 py-1 text-[10px] font-bold text-white">{item.country}</span></div><div className="flex aspect-square items-center justify-center overflow-hidden bg-black/10">{item.image ? <img src={item.image} alt={item.title} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" /> : <span className="text-4xl text-slate-400">📦</span>}</div><div className="space-y-2 p-4"><h3 className="truncate font-medium text-white group-hover:text-orange-300">{item.title}</h3><div className="inline-block bg-emerald-300/10 px-2 py-1 text-lg font-black text-emerald-200">{displayPrice(item.price)}</div><div className="flex justify-between border-t border-white/10 pt-2 text-xs text-slate-400"><span>{item.location}</span><span>{new Date(item.createdAt).toLocaleDateString('ko-KR')}</span></div></div></Link><div className="px-4 pb-4"><button onClick={() => void handleBuy(item)} className="mt-2 w-full bg-orange-500 py-2 text-xs font-black text-white hover:bg-orange-600">구매 · 결제 보관</button>{user && isNativeProduct(item) && (user.id === item.authorId || isMasterUser(user)) && <button onClick={() => void removeProduct(item)} className="w-full py-1 text-xs font-bold text-rose-300">삭제</button>}</div></div>)}</div>
      {orders.length > 0 && <section className="mt-10 border border-white/10 bg-white/[.035] p-5"><h2 className="mb-2 text-xl font-black">내 에스크로 진행 내역</h2>{isMasterUser(user) && orders.some((order) => order.buyerId === order.sellerId) && <p className="mb-4 text-xs font-bold text-amber-300">구매자와 판매자가 같은 테스트 주문이 있습니다.</p>}<div className="space-y-3">{orders.map((order) => <div key={order.id} className="border border-white/10 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-bold">${order.amount} · {order.status}</span><div className="flex gap-2">{order.sellerId === user?.id && order.status === 'PAYMENT_HELD' && order.buyerId !== order.sellerId && <button onClick={() => void updateOrder(order, 'SHIPPING', '판매자가 배송을 시작했습니다.')} className="bg-cyan-500 px-3 py-2 text-xs font-black text-white">배송 시작</button>}{order.sellerId === user?.id && order.status === 'SHIPPING' && <button onClick={() => void updateOrder(order, 'IN_TRANSIT', '상품이 배송 중으로 변경되었습니다.')} className="bg-blue-500 px-3 py-2 text-xs font-black text-white">배송 중으로 변경</button>}{order.buyerId === user?.id && order.status === 'IN_TRANSIT' && <button onClick={() => void updateOrder(order, 'DELIVERED', '구매자가 수령을 확인했습니다.')} className="bg-emerald-500 px-3 py-2 text-xs font-black text-white">수령 확인</button>}{isMasterUser(user) && order.buyerId === order.sellerId && <button onClick={() => void removeOrder(order)} className="border border-rose-200 px-3 py-2 text-xs font-black text-rose-300">운영자 삭제</button>}</div></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400 sm:grid-cols-4">{(['PAYMENT_HELD', 'SHIPPING', 'IN_TRANSIT', 'DELIVERED'] as EscrowStatus[]).map((step) => <div key={step} className={`px-2 py-2 text-center ${order.timeline?.some((item) => item.status === step) || order.status === step ? 'bg-emerald-300/15 font-bold text-emerald-200' : 'bg-white/5'}`}>{step}</div>)}</div></div>)}</div></section>}
      <div className="mx-auto mt-6 max-w-4xl"><BannerAd type="horizontal" /></div>
      {isWriting && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => event.target === event.currentTarget && setIsWriting(false)}><form onSubmit={handleSubmit} className="w-full max-w-lg space-y-3 bg-[#0b1221] p-6 shadow-2xl"><h2 className="text-xl font-black">물품 등록</h2><input required placeholder="물품명" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="w-full border border-white/10 bg-white/[.06] px-4 py-3" /><input required placeholder="가격 (예: 50)" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} className="w-full border border-white/10 bg-white/[.06] px-4 py-3" /><input required placeholder="거래 지역" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} className="w-full border border-white/10 bg-white/[.06] px-4 py-3" /><input type="url" placeholder="상품 이미지 URL (선택)" value={form.image} onChange={(event) => setForm({ ...form, image: event.target.value })} className="w-full border border-white/10 bg-white/[.06] px-4 py-3" /><div className="flex gap-2 pt-2"><button type="button" onClick={() => setIsWriting(false)} className="flex-1 border border-white/10 py-3 font-bold">취소</button><button className="flex-1 bg-orange-500 py-3 font-bold text-white">등록</button></div></form></div>}
    </div>
  );
}
