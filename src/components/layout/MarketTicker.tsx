'use client';

import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowLeftRight, ArrowUpRight, CandlestickChart, RefreshCw } from 'lucide-react';
import styles from './market-ticker.module.css';

type MarketAsset = { key: string; label: string; value: number | null; change: number | null; currency: string };
type MarketPayload = { updatedAt: string; rates: Record<string, number>; assets: MarketAsset[] };
const currencies = [
  ['KRW', '한국 원'], ['USD', '미국 달러'], ['EUR', '유로'], ['BRL', '브라질 헤알'],
] as const;
type CurrencyCode = (typeof currencies)[number][0];
const majorCoinKeys = new Set(['bitcoin', 'ethereum', 'ripple', 'solana']);
const coinNames: Record<string, string> = { bitcoin: 'Bitcoin', ethereum: 'Ethereum', ripple: 'XRP', solana: 'Solana' };

function formatCurrency(value: number | null, currency: string) {
  if (value === null || !Number.isFinite(value)) return '--';
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency,
    minimumFractionDigits: currency === 'KRW' ? 0 : 2,
    maximumFractionDigits: currency === 'KRW' ? 0 : 2,
  }).format(value);
}

function formatChange(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export default function MarketTicker() {
  const [payload, setPayload] = useState<MarketPayload | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [from, setFrom] = useState<CurrencyCode>('KRW');
  const [to, setTo] = useState<CurrencyCode>('USD');
  const [amount, setAmount] = useState('1000000');
  const [refreshAttempt, setRefreshAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const response = await fetch('/api/content/preview?source=market', { cache: 'no-store' }).catch(() => null);
      if (!response?.ok) {
        if (active) setStatus('error');
        return;
      }
      const next = await response.json().catch(() => null) as MarketPayload | null;
      if (active && next && typeof next.rates === 'object' && Array.isArray(next.assets)) {
        setPayload(next);
        setStatus('ready');
      } else if (active) {
        setStatus('error');
      }
    };
    setStatus('loading');
    void load();
    const timer = window.setInterval(() => void load(), 120_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refreshAttempt]);

  const numericAmount = Number(amount);
  const fromRate = from === 'USD' ? 1 : payload?.rates[from];
  const toRate = to === 'USD' ? 1 : payload?.rates[to];
  const converted = payload && amount.trim() && Number.isFinite(numericAmount) && typeof fromRate === 'number' && fromRate > 0 && typeof toRate === 'number' && toRate > 0
    ? numericAmount * (toRate / fromRate)
    : null;
  const coinAssets = (payload?.assets || []).filter((asset) => majorCoinKeys.has(asset.key));
  const rate = payload?.rates.KRW;
  const updatedDate = payload ? new Date(payload.updatedAt) : null;
  const updatedLabel = updatedDate && !Number.isNaN(updatedDate.getTime())
    ? updatedDate.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <section className={styles.panel} aria-labelledby="market-panel-heading">
      <header className={styles.header}>
        <span className={styles.headerIcon}><CandlestickChart size={18} aria-hidden="true" /></span>
        <div className={styles.headingCopy}><span>MARKET DESK · KRW</span><h2 id="market-panel-heading">코인 시세 & 환율</h2></div>
        <div className={styles.headerActions}>
          <span className={styles.updated}>{updatedLabel ? `기준 ${updatedLabel}` : status === 'error' ? '시세 연결 실패' : '시세 불러오는 중'}</span>
          <button type="button" onClick={() => setRefreshAttempt((attempt) => attempt + 1)} aria-label="시세 새로고침" title="새로고침" className={styles.refresh}><RefreshCw size={14} className={status === 'loading' ? styles.spinning : ''} /></button>
        </div>
      </header>

      <div className={styles.layout}>
        <div className={styles.coinGrid} aria-label="주요 암호화폐">
          {coinAssets.map((asset) => {
            const priceKrw = asset.value === null || typeof rate !== 'number' ? null : asset.value * rate;
            const changeValue = typeof asset.change === 'number' && Number.isFinite(asset.change) ? asset.change : null;
            const positive = (changeValue ?? 0) >= 0;
            return <article key={asset.key} className={styles.coin}>
              <div className={styles.coinTop}><span className={styles.coinSymbol}>{asset.label}</span><span className={styles.coinName}>{coinNames[asset.key] || asset.label}</span></div>
              <strong className={styles.coinPrice}>{formatCurrency(priceKrw, 'KRW')}</strong>
              <span className={`${styles.change} ${changeValue === null ? styles.changeUnavailable : positive ? styles.positive : styles.negative}`}>{changeValue === null ? null : positive ? <ArrowUpRight size={13} aria-hidden="true" /> : <ArrowDownRight size={13} aria-hidden="true" />}{formatChange(changeValue)}</span>
            </article>;
          })}
          {status === 'loading' && !payload && <div className={styles.marketStatus}><RefreshCw size={14} className={styles.spinning} />코인 시세를 불러오고 있어요.</div>}
          {status === 'error' && !payload && <div className={styles.marketStatus}>시세를 불러오지 못했습니다. 새로고침을 눌러 다시 시도하세요.</div>}
          {payload && coinAssets.length === 0 && <div className={styles.marketStatus}>표시할 코인 시세가 없습니다.</div>}
        </div>

        <div className={styles.converter}>
          <div className={styles.converterHeading}><div><span>QUICK CONVERTER</span><strong>간편 환율 계산</strong></div><button type="button" onClick={() => { setFrom(to); setTo(from); }} aria-label="환전 통화 바꾸기" title="통화 바꾸기" className={styles.swap}><ArrowLeftRight size={15} /></button></div>
          <label className={styles.amountField}><span>보유 금액</span><div className={styles.currencyField}><input type="number" min="0" step="any" aria-label="환전 금액" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" /><select aria-label="환전 시작 통화" value={from} onChange={(event) => setFrom(event.target.value as CurrencyCode)}>{currencies.map(([code, label]) => <option key={code} value={code}>{code} · {label}</option>)}</select></div></label>
          <div className={styles.resultField} aria-live="polite"><div className={styles.resultTop}><span>환산 금액</span><select aria-label="환전 대상 통화" value={to} onChange={(event) => setTo(event.target.value as CurrencyCode)}>{currencies.map(([code, label]) => <option key={code} value={code}>{code} · {label}</option>)}</select></div><strong>{converted === null ? '--' : formatCurrency(converted, to)}</strong></div>
          <p className={styles.disclaimer}>{converted === null && payload ? '해당 통화의 환율을 불러오지 못했습니다.' : '참고용 시세 · 환율은 USD 기준'}</p>
        </div>
      </div>
    </section>
  );
}
