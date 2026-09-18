'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from 'react';
import { getFreshSessionToken, isMasterUser } from '@/lib/firebase';
import { useGlobalStore } from '@/store/useGlobalStore';
import { EDITORIAL_COUNTRIES } from '@/lib/master/editorialPublishing';
import { normalizeEditorial } from '@/lib/editorialContent';
import { validateEditorialArticle, type EditorialArticle } from '@/lib/master/editorialPublishing';
import { getCountryRoute } from '@/lib/regionRoutes';
import type { AutomationConfig, AutomationControl, AutomationJob } from '@/lib/master/editorialAutomation';
import type { EditorialCandidate, EditorialDiscoveryMode } from '@/lib/master/editorialCandidates';

type Envelope = { control: AutomationControl; jobs: AutomationJob[]; setup: string[] };
type Feed = { rows: EditorialCandidate[]; description: string; count: number; fetchedAt: string };
type DraftMeta = { model?: string; autoPublishEligible?: boolean; issues?: string[]; usage?: { inputTokens?: number; outputTokens?: number; webSearchCalls?: number } };
const field = 'mt-1 w-full min-w-0 rounded-lg border border-white/15 bg-[#101b2e] px-3 py-2.5 text-sm text-slate-100';
const button = 'rounded-lg border border-white/20 px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40';
const modes: { value: EditorialDiscoveryMode; label: string }[] = [
  { value: 'official-topics', label: '공식 교민 생활 주제' }, { value: 'trends', label: 'HOT · 실제 급상승' }, { value: 'ideas', label: 'Google Ads · 검색량/CPC' },
];
const statuses: Record<AutomationJob['status'], string> = { queued: '대기', generating: 'Astra 조사·작성', review: '검토 필요 · 자동 게시 차단', publishing: '게시 대기', published_unverified: '게시됨 · 공개 확인 대기', verified: '게시 완료 · 공개 확인 완료', failed: '실패', cancelled: '운영자 취소' };
const time = (value: string | null) => value ? `${value.replace('T', ' ').slice(0, 19)} UTC` : '없음';

export default function EditorialAutomationWorkspace({ selected }: { selected?: { keyword: string; country: string } }) {
  const user = useGlobalStore((state) => state.user);
  const params = useSearchParams();
  if (!isMasterUser(user)) return <section className="py-12 text-center"><h2 className="text-2xl font-bold">마스터 전용 자동 편집실</h2><p className="my-3">로그인 전에는 대기열을 읽거나 작업을 시작하지 않습니다.</p><Link className="text-cyan-200 underline" href="/login">로그인</Link></section>;
  const seed = selected?.keyword || params.get('automationKeyword') || '';
  const country = getCountryRoute(selected?.country || params.get('automationCountry') || '')?.isoAlpha2 || 'US';
  return <Workspace key={`${user?.id}:${seed}:${country}`} seed={seed.slice(0, 160)} seedCountry={country} />;
}

function Workspace({ seed, seedCountry }: { seed: string; seedCountry: string }) {
  const [state, setState] = useState<Envelope | null>(null);
  const [config, setConfig] = useState<AutomationConfig>({ country: 'KR', discoveryMode: 'trends', enabled: false, autoPublish: false, intervalMinutes: 15, maxDailyArticles: 1, maxDailyGenerations: 1 });
  const [country, setCountry] = useState(seedCountry);
  const [mode, setMode] = useState<EditorialDiscoveryMode>('official-topics');
  const [keyword, setKeyword] = useState(seed);
  const [query, setQuery] = useState('');
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [pausing, setPausing] = useState(false);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [feedError, setFeedError] = useState('');
  const [draft, setDraft] = useState<EditorialArticle | null>(null);
  const [draftMeta, setDraftMeta] = useState<DraftMeta | null>(null);
  const [draftReviewed, setDraftReviewed] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [publishedHref, setPublishedHref] = useState('');
  const initialized = useRef(false);
  const mounted = useRef(false);
  const mutation = useRef(false);
  const reading = useRef(false);
  const feedRequest = useRef<AbortController | null>(null);

  async function request(path: string, body?: Record<string, unknown>, signal?: AbortSignal) {
    const token = await getFreshSessionToken();
    if (!token) throw new Error('로그인 세션을 확인할 수 없습니다. 마스터 계정으로 다시 로그인하세요.');
    const response = await fetch(path, { method: body ? 'POST' : 'GET', cache: 'no-store',
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: signal || AbortSignal.timeout(body?.action === 'tick' ? 210_000 : 25_000) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `요청 실패 (${response.status})`);
    return payload;
  }
  function accept(payload: Envelope) {
    if (!mounted.current) return;
    setState((current) => !current || payload.control.updatedAt >= current.control.updatedAt ? payload : current);
    if (!initialized.current) {
      const c = payload.control;
      setConfig({ country: c.country, discoveryMode: c.discoveryMode || 'trends', enabled: c.enabled, autoPublish: c.autoPublish, intervalMinutes: c.intervalMinutes, maxDailyArticles: c.maxDailyArticles, maxDailyGenerations: c.maxDailyGenerations });
      initialized.current = true;
    }
  }
  async function refresh() {
    if (reading.current || mutation.current) return;
    reading.current = true;
    try { accept(await request('/api/master/editorial-automation')); if (mounted.current) setError(''); }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : '서버 상태 조회 실패'); }
    finally { reading.current = false; }
  }
  const poll = useEffectEvent(() => { if (!document.hidden) void refresh(); });
  useEffect(() => {
    mounted.current = true;
    const first = window.setTimeout(poll, 0);
    const interval = window.setInterval(poll, 15_000);
    return () => { mounted.current = false; window.clearTimeout(first); window.clearInterval(interval); feedRequest.current?.abort(); };
  }, []);

  async function act(body: Record<string, unknown>) {
    const pause = body.action === 'pause';
    if (mutation.current && !pause) return;
    if (pause) setPausing(true); else { mutation.current = true; setBusy(String(body.action)); }
    setError(''); setNotice('');
    try {
      const payload = await request('/api/master/editorial-automation', body);
      accept(payload);
      if (mounted.current) {
        setNotice(pause ? '중지 상태를 저장했습니다. 이미 시작된 유료 요청은 완료될 수 있으나 새 게시 단계는 중지됩니다.'
          : body.action === 'tick' ? `서버 처리 결과: ${payload.result?.status || '상태 확인'}. 자동으로 같은 요청을 재전송하지 않습니다.`
          : body.action === 'enqueue' ? '대기열을 확인했습니다. 같은 국가·키워드는 중복 추가하지 않습니다.'
          : body.action === 'cancel' ? '작업을 취소했습니다. 이미 시작된 생성은 제공자 응답이 늦게 도착해도 게시되지 않습니다.' : '서버 설정을 저장했습니다. 아래 서버 상태를 확인하세요.');
        if (pause) setConfig((c) => ({ ...c, enabled: false }));
      }
    } catch (failure) {
      if (mounted.current) setError(`${failure instanceof Error ? failure.message : '요청 실패'} 결과가 불명확하면 먼저 서버 상태를 조회하세요. 유료 생성은 자동 재시도하지 않습니다.`);
    } finally {
      if (pause) setPausing(false); else { mutation.current = false; setBusy(''); }
    }
  }
  async function loadFeed(event?: FormEvent) {
    event?.preventDefault();
    feedRequest.current?.abort();
    const controller = new AbortController(); feedRequest.current = controller;
    const deadline = window.setTimeout(() => controller.abort(), 45_000);
    setLoadingFeed(true); setFeedError(''); setFeed(null);
    try {
      const result = await request(`/api/master/editorial-candidates?${new URLSearchParams({ country, mode, query: query.trim() })}`, undefined, controller.signal);
      if (!controller.signal.aborted && mounted.current) setFeed(result);
    } catch (failure) {
      if (mounted.current && feedRequest.current === controller) setFeedError(controller.signal.aborted ? '출처 응답 시간이 초과되었습니다.' : failure instanceof Error ? failure.message : '후보 조회 실패');
    } finally { window.clearTimeout(deadline); if (mounted.current && feedRequest.current === controller) setLoadingFeed(false); }
  }
  function resetDraft() {
    setDraft(null); setDraftMeta(null); setDraftReviewed(false); setPublishedHref('');
  }
  async function generateDraft(keywordOverride?: string) {
    const requestedKeyword = (keywordOverride || keyword).trim();
    if (draftLoading || !requestedKeyword || !state) return;
    setDraftLoading(true); setError(''); setNotice('공식 원문을 읽고 키워드 초안을 만드는 중입니다. 생성이 끝나면 게시 전에 화면에서 검토할 수 있습니다.');
    try {
      const token = await getFreshSessionToken();
      if (!token) throw new Error('로그인 세션을 확인할 수 없습니다. 마스터 계정으로 다시 로그인하세요.');
      const response = await fetch('/api/master/keyword-draft', { method: 'POST', cache: 'no-store', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ keyword: requestedKeyword, summary: `${requestedKeyword} 관련 공식 자료와 교민에게 필요한 실용적인 안내를 정리해주세요.`, country, category: 'community' }), signal: AbortSignal.timeout(120_000) });
      const payload = await response.json() as { draft?: Partial<EditorialArticle> & { imageBrief?: string; factsToVerify?: string[] }; error?: string; model?: string; autoPublishEligible?: boolean; issues?: string[]; usage?: DraftMeta['usage'] };
      if (!response.ok || !payload.draft) throw new Error(payload.error || '키워드 초안을 만들지 못했습니다.');
      const raw = payload.draft;
      const article = validateEditorialArticle({ key: typeof raw.key === 'string' && raw.key ? raw.key : `keyword-${crypto.randomUUID()}`,
        country: getCountryRoute(typeof raw.country === 'string' ? raw.country : country)?.id || country, category: typeof raw.category === 'string' ? raw.category : 'community',
        topic: typeof raw.topic === 'string' && raw.topic ? raw.topic : requestedKeyword, keyword: typeof raw.keyword === 'string' ? raw.keyword : requestedKeyword,
        title: raw.title, summary: raw.summary, body: raw.body, seoTitle: raw.seoTitle || '', metaDescription: raw.metaDescription || '', tags: raw.tags || [], editorial: normalizeEditorial(raw.editorial) });
      setDraft(article); setDraftMeta({ model: payload.model, autoPublishEligible: payload.autoPublishEligible, issues: payload.issues, usage: payload.usage }); setDraftReviewed(false); setPublishedHref('');
      setNotice('초안이 준비되었습니다. 제목·본문·원문을 확인하고 체크한 뒤 이 화면에서 바로 게시할 수 있습니다.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : '초안 생성에 실패했습니다.'); }
    finally { setDraftLoading(false); }
  }
  async function publishDraft() {
    if (!draft || !draftReviewed || draftLoading || publishedHref) return;
    setDraftLoading(true); setError(''); setNotice('검토한 초안을 게시하고 저장 결과를 확인하는 중입니다.');
    try {
      const token = await getFreshSessionToken();
      if (!token) throw new Error('로그인 세션을 확인할 수 없습니다.');
      const response = await fetch('/api/master/publish', { method: 'POST', cache: 'no-store', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ workflow: 'public-service', reviewed: true, article: draft }), signal: AbortSignal.timeout(45_000) });
      const payload = await response.json() as { id?: string; href?: string; verified?: boolean; error?: string };
      if (!response.ok || !payload.verified || !payload.href) throw new Error(payload.error || '게시 저장 확인에 실패했습니다.');
      setPublishedHref(payload.href); setNotice('샘플 게시가 완료됐고 서버 저장 결과까지 확인했습니다. 아래 링크에서 공개 화면을 열 수 있습니다.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : '게시에 실패했습니다.'); }
    finally { setDraftLoading(false); }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (config.enabled && config.autoPublish && !window.confirm(`자동 검사 통과 기사를 실제 공개합니다. 하루 생성 최대 ${config.maxDailyGenerations}회, 게시 최대 ${config.maxDailyArticles}건입니다. 사람 검토와 동일하지 않으며 API 비용이 발생할 수 있습니다. 이 설정으로 저장할까요?`)) return;
    void act({ action: 'configure', ...config });
  }
  const storageMissing = !state || state.setup.some((name) => ['FIREBASE_SERVICE_ACCOUNT_JSON', 'EDITORIAL_AUTOMATION_UID'].includes(name));
  const automationProviderMissing = state?.setup.includes('OPENAI_API_KEY');
  const enabled = state?.control.enabled;
  const ready = Boolean(state && !state.setup.length);
  // Manual drafting uses its own endpoint and must remain available when only the scheduler is incomplete.
  const manualDraftReady = Boolean(state);
  const schedulerMissing = state?.setup.includes('EDITORIAL_AUTOMATION_SCHEDULER_HEARTBEAT');
  const listCountries = EDITORIAL_COUNTRIES.map((item) => ({ code: getCountryRoute(item.id)?.isoAlpha2, label: item.label })).filter((item) => item.code);

  return <section id="editorial-automation" className="mb-6 min-w-0 scroll-mt-24 rounded-2xl border border-teal-300/25 bg-[#0b1424] p-4 text-slate-100 sm:p-6">
     <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
       <div><p className="text-xs font-bold uppercase tracking-[.18em] text-teal-300">GYOPO / Astra Editorial</p><h2 className="mt-2 text-2xl font-black sm:text-3xl">키워드에서 공개 확인까지</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">공식 주제·HOT 후보 → AI 조사·작성 → 근거 검사 → 조건부 게시 → 공개 페이지 확인. 이 화면의 조회는 생성이나 게시를 시작하지 않습니다.</p></div>
        <div className="flex flex-wrap justify-end gap-2 text-right"><span className={`rounded-lg px-3 py-2 text-sm font-bold ${manualDraftReady ? 'bg-teal-300/15 text-teal-200' : 'bg-amber-300/10 text-amber-100'}`}>{!state ? '연결 상태 조회 중' : '수동 초안 요청 가능'}</span><span className={`rounded-lg px-3 py-2 text-sm font-bold ${enabled && ready ? 'bg-teal-300/15 text-teal-200' : 'bg-amber-300/10 text-amber-100'}`}>{!state ? '자동 실행 상태 조회 중' : enabled ? ready ? '자동화 활성' : '자동 실행 연결 확인 필요' : '자동화 중지'}</span></div>
     </header>
    <div className="my-4 flex flex-wrap gap-2"><button className={button} disabled={!!busy} onClick={() => void refresh()}>서버 상태 조회</button><button className={`${button} border-rose-300/40 text-rose-200`} disabled={pausing || storageMissing} onClick={() => void act({ action: 'pause' })}>{pausing ? '중지 중...' : '자동화 중지'}</button><Link className={`${button} text-cyan-200`} href="/master/keywords">Google 상세 분석</Link></div>
    {error && <p role="alert" className="my-3 break-words rounded-lg bg-rose-300/10 p-3 text-sm text-rose-100">{error}</p>}
    {notice && <p role="status" className="my-3 rounded-lg bg-teal-300/10 p-3 text-sm text-teal-100">{notice}</p>}
     {state && state.setup.length > 0 && <details open className="mb-5 rounded-lg border border-amber-300/25 p-3 text-sm text-amber-100"><summary className="cursor-pointer font-bold">연결 상태를 분리해 표시합니다</summary><p className="mt-2 text-xs leading-5">키워드 초안·운영자 게시와 5분 주기 무인 자동 실행은 서로 다른 연결입니다. 아래 항목은 서버에 없는 설정만 표시하며 키 값은 여기에 입력하지 않습니다.</p><ul className="mt-2 space-y-1 break-all font-mono text-xs">{state.setup.map((name) => <li key={name}>{name === 'EDITORIAL_AUTOMATION_SCHEDULER_HEARTBEAT' ? '무인 자동 실행: 스케줄러가 아직 신호를 보내지 않음' : name}</li>)}</ul>{schedulerMissing && manualDraftReady && <p className="mt-2 text-xs text-teal-100">수동 키워드 초안과 게시 연결은 사용할 수 있습니다. 무인 자동 실행만 별도 스케줄러 설치 후 활성화됩니다.</p>}</details>}
    <div className="grid min-w-0 gap-6 xl:grid-cols-2">
      <div className="min-w-0">
        <h3 className="text-lg font-bold">01 · 후보 찾기 / 최대 100개</h3>
        <form onSubmit={loadFeed} className="mt-3 space-y-3"><fieldset disabled={loadingFeed} className="min-w-0 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2"><label className="min-w-0 text-xs text-slate-400">조회 국가<select aria-label="후보 국가" className={field} value={country} onChange={(e) => { setCountry(e.target.value); setFeed(null); }}>{listCountries.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label><label className="min-w-0 text-xs text-slate-400">후보 출처<select aria-label="후보 출처" className={field} value={mode} onChange={(e) => { setMode(e.target.value as EditorialDiscoveryMode); setFeed(null); }}>{modes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
          <label className="block text-xs text-slate-400">검색 / Ads 기준 키워드<input className={field} maxLength={80} value={query} onChange={(e) => { setQuery(e.target.value); setFeed(null); }} placeholder="빈칸이면 전체 등록 주제 / 해당 출처 결과" /></label>
          <button className={`${button} bg-teal-300 text-slate-950`} type="submit">{loadingFeed ? '실제 출처 조회 중...' : '후보 조회'}</button>
        </fieldset></form>
        {feedError && <p role="alert" className="mt-3 text-sm text-amber-100">{feedError}</p>}
        {feed && <div className="mt-4"><p className="text-sm font-bold text-teal-200">실제 반환 {feed.count}개 / 최대 100개</p><p className="mt-1 text-xs leading-5 text-slate-400">{feed.description} 조회: {time(feed.fetchedAt)}</p><ul className="mt-3 max-h-80 space-y-2 overflow-y-auto">{feed.rows.map((row) => <li key={`${row.country}:${row.keyword}`} className="rounded-lg border border-white/10 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><span className="min-w-0 flex-1 break-words text-sm font-bold">{row.keyword}</span><button className={button} disabled={!!busy || storageMissing} onClick={() => void act({ action: 'enqueue', country: row.country, keyword: row.keyword, source: row.source })}>대기열 추가</button></div><p className="mt-1 text-xs text-slate-400">{row.metric}</p><a className="mt-1 inline-block text-xs text-cyan-200 underline" href={row.sourceUrl} target="_blank" rel="noopener noreferrer">출처 확인</a></li>)}</ul>{!feed.count && <p className="mt-3 text-sm text-slate-400">등록 주제 또는 일치하는 결과가 없습니다. 가짜 후보로 채우지 않습니다.</p>}</div>}
        <form className="mt-5 border-t border-white/10 pt-4" onSubmit={(e) => { e.preventDefault(); void act({ action: 'enqueue', country, keyword, source: 'manual' }); }}>
          <label className="text-xs text-slate-400">다른 키워드 지정 · 위 조회 국가로 전달<input className={field} aria-label="자동화 키워드" required maxLength={160} value={keyword} onChange={(e) => { setKeyword(e.target.value); resetDraft(); }} placeholder="예: 미국 국립공원 방문 준비" /></label><div className="mt-3 flex flex-wrap gap-2"><button type="submit" className={button} disabled={!!busy || storageMissing || !keyword.trim()}>대기열에만 추가</button><button type="button" className={`${button} bg-amber-300 text-slate-950`} disabled={draftLoading || !manualDraftReady || !keyword.trim()} onClick={() => void generateDraft()}>{draftLoading && !draft ? '공식 원문·AI 초안 생성 중...' : '키워드로 바로 초안 만들기'}</button></div><p className="mt-2 text-xs text-slate-400">대기열 추가는 무인 작업용입니다. 지금 게시할 글은 오른쪽 초안 버튼으로 즉시 만들고 검토 후 게시하세요.</p>
          {draft && <div className="mt-4 rounded-xl border border-amber-300/30 bg-amber-300/5 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-bold text-amber-200">키워드 즉시 초안 · {draft.country} / {draft.category}</p><h4 className="mt-1 break-words text-lg font-black text-white">{draft.title}</h4></div>{publishedHref && <Link target="_blank" className={`${button} text-cyan-200`} href={publishedHref}>게시글 열기</Link>}</div><p className="mt-2 text-sm font-bold text-slate-200">{draft.summary}</p><div className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-7 text-slate-200">{draft.body}</div><details className="mt-3"><summary className="cursor-pointer text-xs font-bold text-teal-200">원문 근거 {draft.editorial.sources.length}개 보기</summary><ul className="mt-2 space-y-2 text-xs">{draft.editorial.sources.map((source, index) => <li key={`${source.url}:${index}`}><a className="break-all text-cyan-200 underline" href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a><p className="mt-1 text-slate-400">{source.publisher} · {source.retrievedAt}</p><p className="mt-1 text-slate-300">{source.excerpt}</p></li>)}</ul></details>{draftMeta?.issues?.length ? <ul className="mt-3 space-y-1 text-xs text-amber-100">{draftMeta.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}<label className="mt-4 flex gap-2 text-xs text-slate-200"><input type="checkbox" checked={draftReviewed} disabled={!!publishedHref || draftLoading} onChange={(event) => setDraftReviewed(event.target.checked)} />제목·본문·원문 근거와 사진 권리를 검토했고, 확인되지 않은 사실은 게시하지 않겠습니다.</label><button type="button" className={`${button} mt-3 w-full bg-teal-300 text-slate-950`} disabled={!draftReviewed || draftLoading || !!publishedHref} onClick={() => void publishDraft()}>{publishedHref ? '게시 완료 · 공개 확인 링크 위' : draftLoading ? '게시 저장 확인 중...' : '검토한 초안 게시'}</button>{draftMeta?.usage && <p className="mt-2 text-xs text-slate-500">확인된 사용량: 입력 {draftMeta.usage.inputTokens || 0} / 출력 {draftMeta.usage.outputTokens || 0} 토큰 · 웹 검색 {draftMeta.usage.webSearchCalls || 0}회. 금액은 이 화면에서 계산하지 않습니다.</p>}</div>}
        </form>
      </div>
      <div className="min-w-0"><h3 className="text-lg font-bold">02 · 서버 실행 설정</h3><form className="mt-3" onSubmit={save}><fieldset disabled={!!busy || storageMissing} className="min-w-0 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2"><label className="min-w-0 text-xs text-slate-400">자동 수집 국가<select aria-label="자동 수집 국가" className={field} value={config.country} onChange={(e) => setConfig({ ...config, country: e.target.value })}>{listCountries.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label><label className="min-w-0 text-xs text-slate-400">자동 수집 출처<select aria-label="자동 수집 출처" className={field} value={config.discoveryMode} onChange={(e) => setConfig({ ...config, discoveryMode: e.target.value as EditorialDiscoveryMode })}>{modes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
        <div className="grid gap-3 sm:grid-cols-3">{([{ key: 'intervalMinutes', label: '단계 간격 (분)', min: 5, max: 1440 }, { key: 'maxDailyGenerations', label: '일일 생성 상한', min: 1, max: 24 }, { key: 'maxDailyArticles', label: '일일 게시 상한', min: 1, max: 24 }] as const).map(({ key, label, min, max }) => <label key={key} className="text-xs text-slate-400">{label}<input className={field} type="number" required min={min} max={max} step={1} value={config[key]} onChange={(e) => setConfig({ ...config, [key]: Number(e.target.value) })} /></label>)}</div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.enabled} onChange={(e) => setConfig({ ...config, enabled: e.target.checked })} /> 지속 실행 활성화</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.autoPublish} onChange={(e) => setConfig({ ...config, autoPublish: e.target.checked })} /> 자동 검사 통과 기사 공개 허용</label>
        <p className="text-xs leading-5 text-slate-400">설정은 저장 후 적용됩니다. 한 단계씩 실행하며 주제 중복과 일일 상한을 검사합니다. 상한은 UTC 자정에 초기화되고 금액 상한이 아닙니다. 공식 주제 목록을 모두 처리하면 새로운 후보가 생길 때까지 기다립니다.</p><button className={`${button} bg-teal-300 text-slate-950`} type="submit">설정 저장</button>
        </fieldset></form><button className={`${button} mt-3`} disabled={!!busy || storageMissing || automationProviderMissing || !enabled} onClick={() => void act({ action: 'tick' })}>{busy === 'tick' ? '서버 단계 실행 중...' : '한 단계 실행'}</button><p className="mt-2 text-xs leading-5 text-slate-400">이 버튼은 실제 AI 생성·게시 단계를 실행합니다. 토큰 사용량만 이 화면에 기록하며 금액을 임의로 계산하지 않습니다. 실제 청구 금액은 연결된 제공자 청구 내역에서 확인하세요. 브라우저 밖의 지속 실행에는 설치된 스케줄러가 필요합니다.</p>
       {state && <dl className="mt-5 grid grid-cols-2 gap-3 rounded-lg border border-white/10 p-3 text-xs"><div><dt className="text-slate-400">오늘 생성 시도 / 게시</dt><dd className="mt-1 text-base font-bold">{state.control.calls} / {state.control.publications}</dd></div><div><dt className="text-slate-400">처리 중 대기열</dt><dd className="mt-1 text-base font-bold">{state.control.activeIds.length} / 24</dd></div><div><dt className="text-slate-400">스케줄러 최종 신호</dt><dd className="mt-1 break-words">{time(state.control.schedulerHeartbeat)}</dd></div><div><dt className="text-slate-400">다음 단계 가능 시각</dt><dd className="mt-1 break-words">{time(state.control.nextRunAt)}</dd></div><div className="col-span-2"><dt className="text-slate-400">확인된 API 사용량 (금액 아님)</dt><dd className="mt-1">입력 {state.control.inputTokens} / 출력 {state.control.outputTokens} 토큰 · 웹 검색 {state.control.webSearchCalls}회</dd><p className="mt-1 text-slate-500">응답이 끊긴 시도는 실제 청구 여부를 이 화면에서 판정하지 않습니다.</p></div></dl>}
      </div>
    </div>
    <section className="mt-6 border-t border-white/10 pt-5"><h3 className="text-lg font-bold">03 · 글쓰기 Workspace / 서버 기록</h3><p className="mt-1 text-xs text-slate-400">현재 작업 최대 24개와 최근 결과 최대 24개. 보관 초안·차단 이유·게시 링크를 확인합니다. 자동 검사는 사람의 취재나 정확성 보장이 아닙니다.</p>
      {state?.control.lastError && <p role="alert" className="mt-3 break-words text-sm text-amber-100">최근 처리: {state.control.lastError}</p>}
      {!state?.jobs.length && <p className="py-8 text-center text-sm text-slate-400">아직 서버 작업 기록이 없습니다.</p>}
       <div className="mt-4 space-y-3">{state?.jobs.map((job) => { const cancellable = ['queued', 'generating', 'review', 'publishing'].includes(job.status) && !job.href; return <article key={job.id} className="min-w-0 rounded-lg border border-white/10 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-teal-200">{job.country} / {job.source}</p><div className="mt-1 flex flex-wrap items-center gap-2"><h4 className="break-words text-base font-bold">{job.draft?.title || job.keyword}</h4><span className={`rounded-full px-2 py-1 text-xs font-bold ${job.status === 'verified' ? 'bg-teal-300/20 text-teal-100' : job.status === 'failed' || job.status === 'cancelled' ? 'bg-rose-300/15 text-rose-100' : 'bg-amber-300/15 text-amber-100'}`}>{statuses[job.status]}</span></div><p className="mt-1 text-xs text-slate-400">{time(job.updatedAt)} · 생성 시도 {job.generationAttempts} / 3</p></div><div className="flex flex-wrap gap-2">{job.href && job.href.startsWith('/') && !job.href.startsWith('//') && <Link target="_blank" className={`${button} text-cyan-200`} href={job.href}>{job.status === 'verified' ? '확인된 공개 기사' : '게시 링크 · 검증 전'}</Link>}{cancellable && <button className={`${button} border-rose-300/40 text-rose-200`} disabled={!!busy || storageMissing} onClick={() => { if (window.confirm('이 작업을 취소할까요? 이미 시작된 AI 생성은 중단 요청이 전달되더라도 과금 여부가 바뀌지 않을 수 있습니다.')) void act({ action: 'cancel', id: job.id }); }}>작업 취소</button>}</div></div>
        {job.error && <p className="mt-2 break-words text-sm text-amber-100">{job.error}</p>}{job.generationResult?.issues.length ? <ul className="mt-2 space-y-1 text-xs text-amber-100">{job.generationResult.issues.map((issue, i) => <li key={i} className="break-words">{issue}</li>)}</ul> : null}
        {job.draft && <details className="mt-3 text-sm"><summary className="cursor-pointer text-teal-200">저장된 AI 초안과 원문 근거</summary><p className="my-3 text-slate-300">{job.draft.summary}</p><div className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-7 text-slate-200">{job.draft.body}</div><ul className="mt-3 space-y-2 text-xs">{job.draft.editorial.sources.map((source, i) => <li key={i}><a className="break-all text-cyan-200 underline" href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a><p className="mt-1 text-slate-400">{source.excerpt}</p></li>)}</ul></details>}
        {job.status === 'failed' && <button className={`${button} mt-3`} disabled={!!busy || storageMissing} onClick={() => { if (window.confirm(job.paidAmbiguous ? '이전 생성의 과금 여부가 불명확합니다. 재시도하면 추가 비용이 발생할 수 있습니다. 계속할까요?' : '저장된 초안은 재사용하고 실패한 단계만 재시도합니다. 초안이 없으면 새 유료 생성이 발생할 수 있습니다. 계속할까요?')) void act({ action: 'enqueue', country: job.country, keyword: job.keyword, source: job.source, retry: true }); }}>실패 작업 재시도</button>}
       </article>; })}</div>
    </section>
  </section>;
}
