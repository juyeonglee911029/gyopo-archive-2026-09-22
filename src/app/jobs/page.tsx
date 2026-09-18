'use client';

import Link from 'next/link';
import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from 'react';
import { RouteErrorState, RouteSkeleton, useRouteReadiness } from '@/components/layout/RouteExperience';
import { fetchRouteJson, withRouteTimeout } from '@/lib/routeExperience';
import { createDocument, deleteDocument, getDocument, getSessionToken, isMasterUser, listDocuments } from '@/lib/firebase';
import { CONTENT_SOURCES, sourceItemId } from '@/lib/contentSources';
import { curateSourceItems, isGenuineJobListing, normalizeSourceText, normalizeSourceTitle, type LiveSourceItem } from '@/lib/sourcepreview';
import { COUNTRY_LOCATIONS } from '@/lib/locations';
import { REGIONS } from '@/lib/regions';
import { createFilterLocations, EMPTY_JOB_FILTERS, listingLocation, matchesJobFilters, paginateListings, parseSavedJobIds, type JobFilterFields, type JobFilters } from '@/lib/listingFilters';
import { useGlobalStore } from '@/store/useGlobalStore';

type Job = JobFilterFields & { id: string; title: string; company: string; location: string; salary: string; tag: string; category?: string; country: string; authorId: string; createdAt: string; publishedAt?: string; body?: string; image?: string; images?: string[]; sourceId?: string; sourceName?: string; sourceUrl?: string; sourceCategory?: string; sourceContentId?: string; sourceSnapshot?: boolean };
type ContentSourceSettings = { disabledSourceIds?: string[] };
type SourceResponse = { items?: LiveSourceItem[]; sections?: Array<{ category: string; items: LiveSourceItem[] }>; fetchedAt?: string };
const locations = createFilterLocations(COUNTRY_LOCATIONS, REGIONS);
const jobFilterLabels: Array<[keyof JobFilters, string]> = [['local', '내 지역'], ['recent', '신규'], ['korean', '한국어'], ['remote', '원격근무'], ['visa', '비자 지원'], ['saved', '저장한 공고']];

function curateJobs(items: Job[]) {
  const byOrigin = new Map<string, Job>();
  for (const job of items) {
    if (!job.authorId || !isGenuineJobListing(job)) continue;
    byOrigin.set(job.sourceUrl || job.id, { ...job, title: normalizeSourceTitle(job.title), company: normalizeSourceText(job.company), location: normalizeSourceText(job.location), country: normalizeSourceText(job.country) });
  }
  const seen = new Set<string>();
  return [...byOrigin.values()].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)).filter((job) => {
    const key = `${job.title.toLocaleLowerCase()}:${job.company.toLocaleLowerCase()}:${job.location.toLocaleLowerCase()}:${job.country.toLocaleLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function JobsPage() {
  const { user, selectedCountry, setSelectedCountry } = useGlobalStore();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isWriting, setIsWriting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const loadRequest = useRef(0);
  useRouteReadiness(isLoading, Boolean(loadError));
  const [form, setForm] = useState({ title: '', company: '', location: '', country: '', salary: '', tag: '정규직' });
  const [disabledSourceIds, setDisabledSourceIds] = useState<string[]>([]);
  const [filters, setFilters] = useState<JobFilters>(EMPTY_JOB_FILTERS);
  const [cityChoice, setCityChoice] = useState({ country: '', city: '' });
  const [pagination, setPagination] = useState({ key: '', page: 1 });
  const [asOf, setAsOf] = useState(0);
  const favoriteKey = user ? `gyopo-job-favorites:${user.id}` : null;
  const [favorites, setFavorites] = useState<{ key: string | null; ids: string[] | null; error: string }>({ key: null, ids: null, error: '' });
  const favoritesReady = favoriteKey !== null && favorites.key === favoriteKey && favorites.ids !== null;
  const savedIds = favoritesReady ? favorites.ids! : [];
  const baseLocation = listingLocation({ country: selectedCountry }, locations);
  const chosenLocation = { ...baseLocation, city: cityChoice.country === baseLocation.country ? cityChoice.city || undefined : baseLocation.city };
  const chosenCountry = locations.find((country) => country.id === chosenLocation.country);

  useEffect(() => {
    if (!favoriteKey) return;
    const readFavorites = () => {
      try {
        setFavorites({ key: favoriteKey, ids: parseSavedJobIds(window.localStorage.getItem(favoriteKey)), error: '' });
      } catch {
        setFavorites({ key: favoriteKey, ids: null, error: '저장한 공고를 읽지 못했습니다. 기존 저장 데이터는 변경하지 않았습니다.' });
      }
    };
    const timer = window.setTimeout(readFavorites, 0);
    const onStorage = (event: StorageEvent) => { if (event.key === favoriteKey || event.key === null) readFavorites(); };
    window.addEventListener('storage', onStorage);
    return () => { window.clearTimeout(timer); window.removeEventListener('storage', onStorage); };
  }, [favoriteKey]);

  const toggleFavorite = (id: string) => {
    if (!favoriteKey || !favoritesReady) return;
    try {
      const current = parseSavedJobIds(window.localStorage.getItem(favoriteKey));
      const next = current.includes(id) ? current.filter((savedId) => savedId !== id) : [...current, id];
      window.localStorage.setItem(favoriteKey, JSON.stringify(next));
      setFavorites({ key: favoriteKey, ids: next, error: '' });
    } catch {
      setFavorites((current) => ({ ...current, error: '공고를 저장하지 못했습니다. 브라우저 저장소 설정과 용량을 확인해주세요.' }));
    }
  };

  const loadJobs = async () => {
    const request = ++loadRequest.current;
    setIsLoading(true);
    setLoadError('');
    try {
      const result = await withRouteTimeout((async () => {
      const settings = await getDocument<ContentSourceSettings>('adminSettings', 'contentSources').then(value => ({ value, failed: false }), () => ({ value: null, failed: true }));
      const disabled = settings.value?.disabledSourceIds || [];
      const sources = settings.failed ? [] : CONTENT_SOURCES.filter((source) => !disabled.includes(source.id) && source.categories.includes('jobs'));
      const [data, sourceResults] = await Promise.all([
        Promise.allSettled([listDocuments<Omit<Job, 'id'>>('jobs', getSessionToken())]),
        Promise.allSettled(sources.map(async (source) => {
          const snapshot = await fetchRouteJson<SourceResponse>(`/api/content/preview?source=${encodeURIComponent(source.id)}&category=jobs`);
          if (!Array.isArray(snapshot.items) && !Array.isArray(snapshot.sections)) throw new Error('Invalid jobs source');
          return { source, result: { items: curateSourceItems(snapshot.sections?.find((section) => section.category === 'jobs')?.items || snapshot.items || [], 'jobs'), fetchedAt: snapshot.fetchedAt || new Date().toISOString() } };
        })),
      ]);
      const sourceJobs = sourceResults.flatMap((entry) => {
        if (entry.status !== 'fulfilled' || !entry.value.result) return [];
        const { source, result } = entry.value;
        return result.items.map((item) => {
          const id = sourceItemId(source.id, 'jobs', item.url);
          return { id, title: item.title, company: item.company || source.name, location: item.location || item.country || source.region, sourceLocation: item, salary: item.salary || '상세 내용 참조', tag: item.tag || '채용', category: item.category, country: item.country || source.region, authorId: 'source', createdAt: item.publishedAt || result.fetchedAt, publishedAt: item.publishedAt, body: item.body || item.description, image: item.image, images: item.images, sourceId: source.id, sourceName: source.name, sourceUrl: item.url, sourceCategory: 'jobs', sourceContentId: id };
        });
      });
      const stored = data[0];
      const partial = settings.failed || stored.status === 'rejected' || sourceResults.some((entry) => entry.status === 'rejected' || !entry.value.result);
      return { disabled, partial, jobs: curateJobs([...(stored.status === 'fulfilled' ? stored.value : []), ...sourceJobs]).filter((job) => !job.sourceId || !disabled.includes(job.sourceId)) };
      })());
      if (request !== loadRequest.current) return;
      setDisabledSourceIds(result.disabled);
      setJobs(result.jobs);
      if (result.partial) setLoadError('일부 구인 출처를 불러오지 못했습니다. 확인된 공고만 표시합니다.');
      setAsOf(Date.now());
    } catch {
      if (request === loadRequest.current) setLoadError('구인 공고를 불러오지 못했습니다. 연결을 확인하고 다시 시도해주세요.');
    } finally {
      if (request === loadRequest.current) setIsLoading(false);
    }
  };
  const loadJobsEffect = useEffectEvent(loadJobs);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadJobsEffect(), 0);
    return () => { window.clearTimeout(timer); loadRequest.current++; };
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return window.alert('로그인 후 공고를 등록할 수 있습니다.');
    const token = getSessionToken();
    if (!token) return;
    const values = Object.values(form).map((value) => value.trim());
    if (form.title.trim().length < 4 || form.company.trim().length < 2 || form.location.trim().length < 2 || form.country.trim().length < 2 || !form.salary.trim()) return window.alert('공고 제목·회사명·근무 지역·국가·급여를 정확히 입력해주세요.');
    if (values.some((value) => /<[^>]+>|javascript:|data:text\/html|https?:\/\//i.test(value))) return window.alert('공고 내용에 HTML 또는 외부 링크를 입력할 수 없습니다.');
    try {
      await createDocument('jobs', crypto.randomUUID(), { ...form, title: form.title.trim(), company: form.company.trim(), location: form.location.trim(), country: form.country.trim(), salary: form.salary.trim(), authorId: user.id, createdAt: new Date().toISOString() }, token);
      setForm({ title: '', company: '', location: '', country: '', salary: '', tag: '정규직' });
      setIsWriting(false);
      await loadJobs();
    } catch { window.alert('공고를 저장하지 못했습니다.'); }
  };

  const removeJob = async (job: Job) => {
    if (!user || job.sourceId || (user.id !== job.authorId && !isMasterUser(user)) || !window.confirm('이 구인 공고를 삭제할까요?')) return;
    const token = getSessionToken();
    if (!token) return;
    try {
      await deleteDocument('jobs', job.id, token);
      setJobs((current) => current.filter((item) => item.id !== job.id));
    } catch {
      window.alert('구인 공고를 삭제하지 못했습니다.');
    }
  };

  const filteredJobs = jobs.filter((job) => (!job.sourceId || !disabledSourceIds.includes(job.sourceId)) && matchesJobFilters(job, filters, chosenLocation, locations, savedIds, asOf));
  const pageKey = JSON.stringify([filters, chosenLocation, favoriteKey]);
  const page = paginateListings(filteredJobs, pagination.key === pageKey ? pagination.page : 1);

  return (
    <div className="category-page jobs-page min-h-screen bg-transparent px-4 py-8 text-white">
      <div className="category-shell mx-auto max-w-5xl">
        <header className="category-header">
          <div className="category-heading">
            <h1 className="text-3xl font-black text-white">구인/구직</h1>
            <p className="mt-2 text-sm font-bold text-blue-200">실제 구인 정보만 등록해주세요. 지역과 조건을 함께 선택해 공고를 찾아보세요.</p>
          </div>
          <button onClick={() => setIsWriting(true)} className="rounded-lg bg-blue-600 px-5 py-2.5 font-bold text-white shadow-md transition hover:bg-blue-500">구인 글쓰기</button>
        </header>
        <section aria-label="구인 공고 필터" className="mb-5 space-y-3 rounded-xl border border-white/10 p-4">
          <div className="flex flex-wrap gap-2">
            <select aria-label="구인 국가 선택" value={chosenCountry?.id || 'Global'} onChange={(event) => { setSelectedCountry(event.target.value); setCityChoice({ country: '', city: '' }); setPagination({ key: '', page: 1 }); }} className="max-w-full rounded-lg border border-white/20 bg-slate-900 px-3 py-2 text-sm"><option value="Global">국가 선택</option>{locations.map((country) => <option key={country.id} value={country.id}>{country.label}</option>)}</select>
            <select aria-label="구인 도시 선택" value={chosenLocation.city || ''} disabled={!chosenCountry?.cities.length} onChange={(event) => { setCityChoice({ country: chosenCountry?.id || '', city: event.target.value }); setPagination({ key: '', page: 1 }); }} className="max-w-full rounded-lg border border-white/20 bg-slate-900 px-3 py-2 text-sm disabled:opacity-50"><option value="">국가 전체 (도시 미선택)</option>{chosenCountry?.cities.map((city) => <option key={city.slug} value={city.slug}>{city.label}</option>)}</select>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={!Object.values(filters).some(Boolean)} onClick={() => { setFilters(EMPTY_JOB_FILTERS); setPagination({ key: '', page: 1 }); setAsOf(Date.now()); }} className={`rounded-lg border px-3 py-2 text-sm font-bold ${!Object.values(filters).some(Boolean) ? 'border-blue-400 bg-blue-600 text-white' : 'border-white/20 text-slate-300'}`}>전체</button>
            {jobFilterLabels.map(([filter, label]) => <button key={filter} type="button" aria-pressed={filters[filter]} onClick={() => { setFilters((current) => ({ ...current, [filter]: !current[filter] })); setPagination({ key: '', page: 1 }); setAsOf(Date.now()); }} className={`rounded-lg border px-3 py-2 text-sm font-bold ${filters[filter] ? 'border-blue-400 bg-blue-600 text-white' : 'border-white/20 text-slate-300'}`}>{label}</button>)}
          </div>
          <p className="text-xs leading-relaxed text-slate-400">선택한 조건을 모두 충족하는 공고만 표시합니다. 신규는 확인된 게시일 기준 최근 7일이며, 한국어·원격·비자는 명시된 속성이나 태그가 있는 공고만 포함합니다. 지역 미확인 공고는 전체에서 볼 수 있습니다.</p>
          <p className="text-xs text-slate-400">저장한 공고는 로그인 계정별로 이 브라우저에만 보관됩니다.</p>
          {filters.local && !chosenLocation.country && <p role="status" className="text-sm text-amber-200">내 지역을 보려면 위에서 국가를 선택해주세요. 위치를 추측해 공고를 표시하지 않습니다.</p>}
          {filters.saved && !user && <p role="status" className="text-sm text-amber-200">저장한 공고를 보거나 저장하려면 로그인해주세요.</p>}
          {filters.saved && favoriteKey && favorites.key !== favoriteKey && <p role="status" className="text-sm text-slate-300">저장한 공고를 불러오는 중입니다.</p>}
          {favorites.key === favoriteKey && favorites.error && <p role="alert" className="text-sm text-amber-200">{favorites.error}</p>}
          <p role="status" className="text-sm font-bold text-slate-200">{isLoading ? '공고를 불러오는 중입니다.' : filters.saved && favoriteKey && !favoritesReady ? '저장 목록 확인 후 결과 수를 표시합니다.' : `불러온 공고 중 ${page.total}건 · ${page.from}–${page.to}건 표시`}</p>
        </section>
        <main className="space-y-4">
           {isLoading && <RouteSkeleton label="구인 공고를 불러오는 중입니다." />}
           {!isLoading && loadError && <RouteErrorState message={loadError} onRetry={() => void loadJobs()} />}
           {!isLoading && !loadError && !(filters.saved && favoriteKey && !favoritesReady) && filteredJobs.length === 0 && <div className="ui-state route-state"><p>선택한 조건에 맞는 공고가 없습니다. 조건을 해제하거나 전체를 선택해주세요.</p></div>}
           {!isLoading && page.items.map((job) => <div key={job.id} className="job-row"><Link href={job.sourceContentId ? `/content/${job.sourceContentId}?source=${encodeURIComponent(job.sourceId || '')}&category=jobs&url=${encodeURIComponent(job.sourceUrl || '')}` : `/jobs?job=${job.id}`} className="group block"><div className="flex items-center gap-3 px-3 py-3 transition-colors sm:gap-4"><div className="h-14 w-14 shrink-0 overflow-hidden bg-blue-400/10">{job.image ? <img src={job.image} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-xl">💼</div>}</div><div className="min-w-0 flex-1"><div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] font-bold"><span className="bg-blue-400/10 px-2 py-0.5 text-blue-100">{job.country}</span><span className="bg-white/10 px-2 py-0.5 text-slate-200">{job.tag}</span><span className="truncate text-slate-300">{job.company}</span>{job.sourceName && <span className="truncate text-teal-200">출처: {job.sourceName}</span>}</div><h3 className="truncate text-base font-bold text-white transition-colors group-hover:text-blue-200">{job.title}</h3><div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-300"><span>📍 {job.location}</span><span>💰 {job.salary}</span></div></div><span className="hidden shrink-0 text-xs font-black text-teal-200 sm:block">상세 보기 →</span></div></Link><div className="job-row-actions flex flex-wrap items-center gap-3"><button type="button" disabled={!favoritesReady} aria-pressed={savedIds.includes(job.id)} aria-label={`${job.title} ${savedIds.includes(job.id) ? '저장 해제' : '저장'}`} onClick={() => toggleFavorite(job.id)} className="text-xs font-bold text-blue-200 disabled:opacity-50">{savedIds.includes(job.id) ? '저장 해제' : '저장'}{!user && ' (로그인 필요)'}</button>{user && !job.sourceId && (user.id === job.authorId || isMasterUser(user)) && <button type="button" onClick={() => void removeJob(job)} className="delete-action text-xs font-black text-rose-300">삭제</button>}</div></div>)}
        </main>
        {!isLoading && page.total > 0 && <nav aria-label="구인 공고 페이지" className="mt-5 flex items-center justify-center gap-4 text-sm"><button type="button" disabled={page.page === 1} onClick={() => setPagination({ key: pageKey, page: page.page - 1 })} className="rounded-lg border border-white/20 px-4 py-2 disabled:opacity-40">이전</button><span>{page.page} / {page.totalPages}</span><button type="button" disabled={page.page === page.totalPages} onClick={() => setPagination({ key: pageKey, page: page.page + 1 })} className="rounded-lg border border-white/20 px-4 py-2 disabled:opacity-40">다음</button></nav>}
      </div>
      {isWriting && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => event.target === event.currentTarget && setIsWriting(false)}><form onSubmit={handleSubmit} className="w-full max-w-lg space-y-3 rounded-2xl bg-white p-6 shadow-2xl"><h2 className="text-xl font-black text-slate-900">구인 공고 등록</h2><input required placeholder="공고 제목" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full rounded-xl border px-4 py-3" /><input required placeholder="회사명" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className="w-full rounded-xl border px-4 py-3" /><input required placeholder="근무 지역" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="w-full rounded-xl border px-4 py-3" /><input required placeholder="국가 태그 (예: 독일, 미국, 브라질)" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className="w-full rounded-xl border px-4 py-3" /><input required placeholder="급여" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} className="w-full rounded-xl border px-4 py-3" /><select value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} className="w-full rounded-xl border px-4 py-3"><option>정규직</option><option>파트타임</option><option>계약직</option><option>재택근무</option></select><div className="flex gap-2 pt-2"><button type="button" onClick={() => setIsWriting(false)} className="flex-1 rounded-xl border py-3 font-bold">취소</button><button className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white">등록</button></div></form></div>}
    </div>
  );
}
