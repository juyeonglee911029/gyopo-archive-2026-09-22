'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, Globe2, LockKeyhole, Search, ShieldCheck } from 'lucide-react';
import { getFreshSessionToken, isMasterUser } from '@/lib/firebase';
import { regionLabel } from '@/lib/regions';
import { useGlobalStore } from '@/store/useGlobalStore';
import type { MarketCountry, MarketKeywordsResult, MarketMode, MarketRequest, MarketSort } from '@/lib/master/googleMarketKeywords';

export function GoogleMarketKeywords({ countries }: { countries: MarketCountry[] }) {
  const user = useGlobalStore((state) => state.user);
  if (!isMasterUser(user)) return (
    <section className="mx-auto max-w-xl px-5 py-24 text-center text-slate-200">
      <LockKeyhole className="mx-auto mb-5 text-amber-300" size={38} />
      <h1 className="text-2xl font-bold">마스터 전용 Google 검색 분석</h1>
      <p className="my-4 text-sm text-slate-400">마스터 계정으로 로그인하세요. 인증 전에는 분석 자료를 요청하지 않습니다.</p>
      <Link href="/login" className="text-cyan-300 underline">로그인</Link>
    </section>
  );
  return <KeywordWorkspace key={user?.id} countries={countries} />;
}

const control = 'mt-2 w-full min-w-0 rounded-xl border border-white/15 bg-[#101b2e] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-300';
const count = (value: number | null) => value === null ? '미제공' : value.toLocaleString();
const timestamp = (value: string | null) => value ? `${value.replace('T', ' ').slice(0, 19)} UTC` : '원본에 없음';
const money = (value: number | null, currency: string | null) => value === null || !currency ? '미제공'
  : `${value.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${currency}`;

function KeywordWorkspace({ countries }: { countries: MarketCountry[] }) {
  const preferredCountry = useGlobalStore((state) => state.selectedCountry);
  const [chosenCountry, setChosenCountry] = useState('');
  const country = chosenCountry || countries.find((item) => item.region === preferredCountry || (preferredCountry === 'USA-LA' && item.code === 'US'))?.code || 'US';
  const [mode, setMode] = useState<MarketMode>('trends');
  const [query, setQuery] = useState('');
  const [relevance, setRelevance] = useState<MarketRequest['relevance']>('all');
  const [sort, setSort] = useState<MarketSort>('recent');
  const [data, setData] = useState<MarketKeywordsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [setup, setSetup] = useState<string[]>([]);
  const active = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    const timer = window.setTimeout(() => form.current?.requestSubmit(), 250);
    return () => window.clearTimeout(timer);
  }, []);

  async function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 40_000);
    setLoading(true);
    setData(null);
    setError('');
    setSetup([]);
    try {
      const token = await getFreshSessionToken();
      if (controller.signal.aborted) return;
      if (!token) throw new Error('Your sign-in session is unavailable. Open sign-in and select the Master account again.');
      const params = new URLSearchParams({ mode, country, sort, relevance: mode === 'trends' ? relevance : 'all' });
      if (mode === 'ideas' && query.trim()) params.set('query', query.trim());
      const response = await fetch(`/api/master/market-keywords?${params}`, {
        cache: 'no-store', headers: { authorization: `Bearer ${token}` }, signal: controller.signal,
      });
      const payload = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setSetup(Array.isArray(payload.setup) ? payload.setup.filter((name: unknown) => typeof name === 'string') : []);
        throw new Error(typeof payload.error === 'string' ? payload.error : 'The data source is unavailable.');
      }
      setData(payload as MarketKeywordsResult);
    } catch (failure) {
      if (active.current !== controller) return;
      setError(controller.signal.aborted ? 'The request timed out. Try again later.' : failure instanceof Error ? failure.message : 'Unable to load keyword data.');
    } finally {
      window.clearTimeout(timeout);
      if (active.current === controller) setLoading(false);
    }
  }

  function changeMode(next: MarketMode) {
    setMode(next);
    setSort(next === 'trends' ? 'recent' : 'volume');
    setData(null);
    setError('');
    setSetup([]);
  }

  return (
    <div className="mx-auto min-w-0 max-w-[1400px] px-4 py-8 text-slate-100 sm:px-6">
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-cyan-300"><ShieldCheck size={16} /> Master / Google-wide discovery</p>
          <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Google 검색 키워드 분석</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">내 사이트가 아닌 Google 검색 기준입니다. 최근 급상승 검색어와 과거 월간 검색량·CPC를 구분합니다. GYOPO 노출이나 내 광고 실적으로 순위를 만들지 않습니다.</p>
        </div>
         <Link href="/master/automation" className="rounded-xl border border-white/15 px-4 py-2 text-sm text-cyan-200">Astra 자동 편집실 / 공식 교민 주제</Link>
      </div>

      <form ref={form} onSubmit={load} className="rounded-2xl border border-white/10 bg-[#0b1424] p-4 sm:p-6">
        <fieldset disabled={loading} className="min-w-0 disabled:opacity-65">
          <legend className="sr-only">Google keyword source and filters</legend>
          <div className="mb-5 grid gap-2 sm:grid-cols-2">
            {([{ id: 'trends', title: '최근 급상승 검색어', detail: 'Google Trends 국가별 공개 자료 · 모든 언어' },
              { id: 'ideas', title: '교민 키워드 · 검색량 · CPC', detail: 'Google Keyword Planner · 선택 국가 · 한국어' }] as const).map((item) => (
              <button key={item.id} type="button" aria-pressed={mode === item.id} onClick={() => changeMode(item.id)} className={`rounded-xl border p-4 text-left ${mode === item.id ? 'border-cyan-300 bg-cyan-300/10' : 'border-white/10'}`}>
                <span className="block font-bold">{item.title}</span><span className="mt-1 block text-xs text-slate-400">{item.detail}</span>
              </button>
            ))}
          </div>
          <div className="grid items-end gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="min-w-0 text-xs text-slate-400">검색 대상 국가
              <select value={country} onChange={(event) => { setChosenCountry(event.target.value); setData(null); }} className={control}>
                {countries.map((item) => <option key={item.code} value={item.code}>{regionLabel(item.region)} ({item.code})</option>)}
              </select>
            </label>
            {mode === 'trends' ? <label className="min-w-0 text-xs text-slate-400">표시 범위
              <select value={relevance} onChange={(event) => { setRelevance(event.target.value as MarketRequest['relevance']); setData(null); }} className={control}>
                <option value="all">국가 전체 급상승</option><option value="diaspora">교민 관련 후보 (문구 기반 분류)</option>
              </select>
            </label> : <label className="min-w-0 text-xs text-slate-400">기준 키워드 (선택 · 80자 / 10단어 이내)
              <input value={query} maxLength={80} onChange={(event) => { setQuery(event.target.value); setData(null); }} placeholder="빈칸이면 비자·이민 등 교민 주제" className={control} />
            </label>}
            <label className="min-w-0 text-xs text-slate-400">가져온 결과 내 순위 기준
              <select value={sort} onChange={(event) => { setSort(event.target.value as MarketSort); setData(null); }} className={control}>
                <option value="source">Google 제공 순서</option>
                {mode === 'trends' ? <><option value="recent">최근 업데이트</option><option value="traffic">대략적 검색 규모</option></>
                  : <><option value="volume">월평균 검색량</option><option value="cpc">평균 CPC (동일 통화)</option></>}
              </select>
            </label>
            <button type="submit" className="flex items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-bold text-slate-950"><Search size={17} />{loading ? 'Google 자료 조회 중...' : '최대 100개 조회'}</button>
          </div>
        </fieldset>
        <p className="mt-4 text-xs leading-5 text-slate-400">{mode === 'trends'
          ? '전체 급상승이 모두 교민 관심사는 아닙니다. 교민 필터는 제목과 관련 기사에 나타나는 이민·비자·영사 관련 문구로 후보를 골라내므로 누락과 오분류가 있을 수 있습니다.'
          : '기준 키워드에서 확장한 최대 100개 후보입니다. Google 전체 검색어의 절대 순위가 아닙니다. 월간 검색량은 과거 평균 추정치이며 실시간 검색수가 아닙니다.'}</p>
      </form>

      <div aria-live="polite" className="my-5">
         {error && <div role="alert" className="rounded-xl border border-amber-300/30 bg-[#251f15] p-4 text-sm text-amber-100">
           <div className="flex flex-wrap items-start justify-between gap-3"><p className="min-w-0 flex-1">{error}</p><button type="button" onClick={() => form.current?.requestSubmit()} className="rounded-lg border border-amber-200/40 px-3 py-1.5 text-xs font-bold text-amber-100">다시 시도</button></div>
           <p className="mt-3 text-xs leading-5 text-amber-100/80">{mode === 'trends' ? '최근 급상승 검색어는 Google Trends 공개 RSS를 직접 읽습니다. Ads 계정 설정은 필요하지 않습니다.' : '검색량·CPC 아이디어는 Google Ads Keyword Planner 연결이 필요합니다. Ads 연결 전에는 이 모드가 결과를 만들지 않습니다.'}</p>
           {setup.length > 0 && <><p className="mt-3 font-bold">Missing server configuration names:</p><ul className="mt-2 space-y-1">{setup.map((name) => <li key={name}><code className="break-all text-xs">{name}</code></li>)}</ul></>}
           <p className="mt-3 text-xs">Never paste secrets here. Configure them server-side. <Link href="/login" className="underline">Sign-in</Link></p>
        </div>}
        {loading && <p className="text-sm text-cyan-200">Reading the actual source. No generated metrics or filler rows.</p>}
      </div>

      {data ? <section className="min-w-0 rounded-2xl border border-white/10 bg-[#0b1424]">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 p-5">
          <div><p className="text-xs uppercase tracking-widest text-cyan-300">{data.source} / {data.country.code}</p>
            <h2 className="mt-2 text-2xl font-bold">실제 결과 {data.returnedCount}개 <span className="text-base font-normal text-slate-400">/ 최대 {data.limit}개</span></h2>
            <p className="mt-2 text-xs text-slate-400">{data.rawCount} valid unique source rows in this response{data.mode === 'trends' ? `; ${data.relevantCount} heuristic relevance matches` : ''}. {data.hasMore ? 'Source results extend beyond this displayed sample.' : 'No additional rows reported in this response.'}</p>
          </div>
          <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-cyan-200">{data.mode === 'trends' ? 'Original RSS' : 'Source documentation'} <ArrowUpRight size={16} /></a>
        </div>
        <div className="space-y-2 p-5 text-xs leading-5 text-slate-400">
          <p>Fetched: {timestamp(data.fetchedAt)}. {data.mode === 'trends' ? `Feed updated: ${timestamp(data.sourceUpdatedAt)}. Individual publication dates below are from RSS.` : `API: ${data.apiVersion}. Account currency: ${data.currency}.`}</p>
          {data.mode === 'trends' ? <p>Traffic is the source&apos;s approximate threshold label, not an exact search count, monthly volume or CPC. The RSS does not specify an exact measurement window; publication time is not that window. Feed availability varies by country.</p>
            : <><p>Historical window: Google&apos;s default past 12 months. Returned monthly entries: {data.historicalMonthRange ? `${data.historicalMonthRange.start} to ${data.historicalMonthRange.end}` : 'not provided'}. Per-keyword months may differ. These are not live search counts.</p>
              <p>Average CPC is an optional legacy metric. Low/high top-of-page bids are separate 20th/80th-percentile estimates, not CPC or publisher revenue. Missing metrics remain &quot;Not provided&quot;; zeros are preserved.</p>
              <p className="break-words">Submitted seeds: {data.seeds.join(' / ')}. Network: Google Search only. Language criterion: Korean (1012).</p></>}
        </div>
        {!data.rows.length ? <div className="px-5 pb-8 text-sm text-slate-300">{data.relevance === 'diaspora' ? 'No heuristic matches in this feed. Try the raw country view; no replacement rows were invented.' : 'The source returned no usable rows for this request.'}</div>
          : <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <caption className="sr-only">Actual source rows, sorted within the fetched sample. No automatic publication.</caption>
              <thead className="border-y border-white/10 bg-white/5 text-xs text-slate-400"><tr>
                <th scope="col" className="p-4">순위</th><th scope="col" className="p-4">키워드 / 후보</th>
                {data.mode === 'trends' ? <><th scope="col" className="p-4">검색 규모 (근사치)</th><th scope="col" className="p-4">발표 시각 (UTC)</th></>
                  : <><th scope="col" className="p-4">월평균 검색량</th><th scope="col" className="p-4">평균 CPC</th><th scope="col" className="p-4">상단 입찰가 하위 / 상위</th></>}
                <th scope="col" className="p-4">기사 작성</th>
              </tr></thead>
              <tbody>{data.rows.map((row, index) => <tr key={row.query} className="border-b border-white/5 align-top">
                <td className="p-4 tabular-nums text-cyan-200">{index + 1}</td>
                <th scope="row" className="max-w-sm break-words p-4 font-medium">
                  {row.query}
                  {data.mode === 'trends' && <span className="mt-2 block text-xs font-normal text-slate-400">{row.relevanceMatches.length ? `Text matches: ${row.relevanceMatches.join(', ')}` : 'No diaspora text match'}</span>}
                  {data.mode === 'ideas' && row.monthlySearchVolumes.length > 0 && <details className="mt-2 text-xs font-normal text-slate-400"><summary className="cursor-pointer text-cyan-200">Returned historical months</summary><ul className="mt-2 space-y-1">{row.monthlySearchVolumes.map((entry) => <li key={entry.month}>{entry.month}: {count(entry.searches)}</li>)}</ul></details>}
                </th>
                {data.mode === 'trends' ? <><td className="p-4 tabular-nums">{row.approximateTraffic || 'Not provided'}</td><td className="p-4 text-xs text-slate-400">{timestamp(row.publishedAt)}</td></>
                  : <><td className="p-4 tabular-nums">{count(row.avgMonthlySearches)}</td><td className="p-4 tabular-nums">{money(row.averageCpc, row.currency)}</td><td className="p-4 text-xs leading-6 tabular-nums">{money(row.lowTopOfPageBid, row.currency)}<br />{money(row.highTopOfPageBid, row.currency)}</td></>}
                  <td className="p-4"><Link href={`/master/automation?automationKeyword=${encodeURIComponent(row.query)}&automationCountry=${encodeURIComponent(data.country.code)}#editorial-automation`} className="whitespace-nowrap text-cyan-200 underline">Astra 대기열로 연결</Link></td>
              </tr>)}</tbody>
            </table>
          </div>}
         <p className="p-5 text-xs text-slate-400">키워드와 국가를 공통 서버 작업대로 전달합니다. 대기열 추가와 실행 설정을 확인하세요. 링크 클릭만으로 유료 생성이나 게시를 시작하지 않습니다.</p>
      </section> : !loading && !error && <div className="py-14 text-center text-slate-400"><Globe2 className="mx-auto mb-4 text-cyan-300" size={32} /><p>Choose a source and country, then fetch real data.</p><p className="mt-2 text-xs">A short or empty feed is valid. This page never fills a quota with invented rows.</p></div>}

      <details className="mt-6 rounded-xl border border-white/10 p-4 text-xs leading-6 text-slate-400">
        <summary className="cursor-pointer font-bold text-slate-200">Google Ads connection requirements</summary>
        <p className="mt-3">Server variables: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_API_VERSION. OAuth: GOOGLE_ADS_REFRESH_TOKEN + GOOGLE_ADS_CLIENT_ID + GOOGLE_ADS_CLIENT_SECRET, or temporary GOOGLE_ADS_ACCESS_TOKEN. Scope: https://www.googleapis.com/auth/adwords. Manager access: GOOGLE_ADS_LOGIN_CUSTOMER_ID.</p>
        <p>Use a Google Ads client account and a developer token approved for production Keyword Planner access. Enable Google Ads API in the OAuth project and grant the OAuth user access to that client account. Test accounts, account restrictions, quota and unavailable historical data may prevent results.</p>
        <p>No API version is guessed. Official documentation listed v25 as released when checked on 2026-09-16; check the <a className="text-cyan-200 underline" href="https://developers.google.com/google-ads/api/docs/sunset-dates" target="_blank" rel="noopener noreferrer">current support timetable</a> before configuring GOOGLE_ADS_API_VERSION. Trends remains independent of this connection.</p>
      </details>
    </div>
  );
}
