'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getFreshSessionToken } from '@/lib/firebase';
import { getCountryRoute } from '@/lib/regionRoutes';
import { getContentDetailPath } from '@/lib/contentDetailPath';
import { useGlobalStore } from '@/store/useGlobalStore';
import EditorialEditor from '@/components/posts/EditorialEditor';
import EditorialBlocks from '@/components/posts/EditorialBlocks';
import { normalizeEditorial } from '@/lib/editorialContent';
import { EDITORIAL_BODY_LIMIT, EDITORIAL_CATEGORIES, EDITORIAL_COUNTRIES, OPERATOR_BYLINE, editorialIdentity, editorialStorageKey, validateEditorialArticle, type EditorialArticle } from '@/lib/master/editorialPublishing';
import { mergeEditorialEntries, newEditorialArticle, restoreEditorialEntries, type EditorialDeskEntry } from '@/lib/master/editorialDesk';

const field = 'mt-1 w-full min-w-0 rounded-xl border border-white/15 bg-black/20 p-3 text-sm text-white';
const button = 'rounded-xl border border-white/20 px-3 py-2 text-xs font-bold disabled:opacity-40';

export default function CountryEditorialWorkspace({ uid }: { uid: string }) {
  const params = useSearchParams();
  const keyword = (params.get('editorKeyword') || '').slice(0, 160);
  const targetCountry = getCountryRoute(params.get('editorCountry') || '')?.id || '';
  const [country, setCountry] = useState(targetCountry);
  const [entries, setEntries] = useState<EditorialDeskEntry[]>([]);
  const [active, setActive] = useState('');
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [storageError, setStorageError] = useState('');
  const current = useRef<EditorialDeskEntry[]>([]);
  const saved = useRef<string | null>(null);
  const publishing = useRef(false);
  const seededKeyword = useRef('');
  const storageKey = editorialStorageKey(uid);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem(storageKey);
        const restored = raw ? restoreEditorialEntries(raw) : [];
        saved.current = raw;
        current.current = restored;
        setEntries(restored);
        setReady(true);
      } catch { setStorageError('저장된 작업대를 읽지 못했습니다. 원본을 지우지 않았습니다. 브라우저 저장소를 확인하세요.'); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  useEffect(() => {
    if (!ready || !country || !keyword) return;
    const seedKey = `${country}:${keyword.toLocaleLowerCase()}`;
    if (seededKeyword.current === seedKey) return;
    seededKeyword.current = seedKey;
    const existing = current.current.find((entry) => entry.article.country === country && entry.article.keyword.toLocaleLowerCase() === keyword.toLocaleLowerCase());
    if (existing) {
      setActive(editorialIdentity(existing.article));
      setMessage('전달된 HOT 키워드의 기존 초안을 열었습니다.');
      return;
    }
    try {
      const article = newEditorialArticle(country, keyword);
      const next = mergeEditorialEntries(current.current, [article]);
      if (store(next)) {
        setActive(editorialIdentity(article));
        setPreview(false);
        setMessage('전달된 HOT 키워드로 국가별 초안을 만들었습니다. 공식 자료 기반 상세 초안을 눌러 원문을 연결하세요.');
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : '키워드 초안을 만들지 못했습니다.'); }
  }, [ready, country, keyword]);

  const store = (next: EditorialDeskEntry[]) => {
    current.current = next;
    setEntries(next);
    try {
      if (localStorage.getItem(storageKey) !== saved.current) throw new Error('다른 탭에서 작업대가 변경되었습니다. 현재 작업을 내보낸 뒤 페이지를 다시 열어 병합하세요.');
      const raw = JSON.stringify({ version: 1, entries: next });
      localStorage.setItem(storageKey, raw);
      saved.current = raw;
      setStorageError('');
      return true;
    } catch (error) { setStorageError(error instanceof Error ? `로컬 저장 실패: ${error.message}` : '로컬 저장 실패. 브라우저 저장소를 확인하세요.'); return false; }
  };

  const add = () => {
    if (!country) return setMessage('게시할 국가를 선택하세요.');
    try {
      const article = newEditorialArticle(country, keyword);
      store(mergeEditorialEntries(current.current, [article]));
      setActive(editorialIdentity(article));
      setPreview(false);
    } catch (error) { setMessage(String(error instanceof Error ? error.message : error)); }
  };

  const selected = entries.find((entry) => editorialIdentity(entry.article) === active);
  const update = (patch: Partial<EditorialArticle>) => {
    store(current.current.map((entry) => editorialIdentity(entry.article) === active ? { ...entry, article: { ...entry.article, ...patch }, reviewed: false, status: 'draft', error: '' } : entry));
    setPreview(false);
  };
  const validationError = (() => { if (!selected) return ''; try { validateEditorialArticle(selected.article); return ''; } catch (error) { return error instanceof Error ? error.message : '기사를 확인하세요.'; } })();

  const publish = async (identities: string[]) => {
    if (publishing.current || !ready || storageError) return;
    publishing.current = true;
    setBusy(true);
    try {
      for (const identity of identities) {
        const entry = current.current.find((item) => editorialIdentity(item.article) === identity);
        if (!entry?.reviewed || entry.status === 'published') continue;
        if (useGlobalStore.getState().user?.id !== uid) throw new Error('로그인 계정이 변경되어 게시를 중단했습니다.');
        if (!store(current.current.map((item) => item === entry ? { ...item, status: 'publishing', attempted: true, error: '' } : item))) break;
        try {
          const article = validateEditorialArticle(entry.article);
          const token = await getFreshSessionToken();
          if (!token || useGlobalStore.getState().user?.id !== uid) throw new Error('로그인 세션을 확인하세요.');
          const response = await fetch('/api/master/publish', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ workflow: 'public-service', reviewed: true, article }), signal: AbortSignal.timeout(45_000) });
          const result = await response.json() as { id?: string; verified?: boolean; error?: string };
          if (!response.ok || !result.verified || !/^editorial-[a-f0-9]{64}$/.test(result.id || '')) throw new Error(result.error || '게시 확인이 실패했습니다.');
          if (!store(current.current.map((item) => editorialIdentity(item.article) === identity ? { ...item, status: 'published', id: result.id, error: '' } : item))) break;
        } catch (error) {
          if (!store(current.current.map((item) => editorialIdentity(item.article) === identity ? { ...item, status: 'error', error: error instanceof Error ? error.message : '게시 실패. 같은 기사로 재시도하세요.' } : item))) break;
        }
      }
      setMessage('게시 작업을 마쳤습니다. 기사별 저장 확인·실패 상태를 확인하세요. 실패한 기사는 편집 내용과 key를 유지합니다.');
    } catch (error) { setMessage(error instanceof Error ? error.message : '게시를 중단했습니다.'); }
    finally { publishing.current = false; setBusy(false); }
  };

  const visible = entries.filter((entry) => entry.article.country === country);
  const reviewed = visible.filter((entry) => entry.reviewed && entry.status !== 'published');
  const article = selected?.article;
  const generate = async () => {
    if (!article || busy || selected?.status === 'published') return;
    const facts = [article.keyword, article.topic, article.summary, article.body].filter(Boolean).join('\n').slice(0, 6000);
    if ([...facts].length < 10) return setMessage('키워드와 기본 설명을 합쳐 10자 이상 입력하세요.');
    if (article.body.trim() && !window.confirm('현재 본문을 AI 초안으로 바꿀까요? 실패하면 기존 내용은 유지됩니다.')) return;
    setBusy(true);
    setMessage('등록된 공식 원문을 읽어 상세 초안을 작성합니다. 사진·표·경험을 만들어내지 않습니다.');
    try {
      const token = await getFreshSessionToken();
      if (!token) throw new Error('다시 로그인하세요.');
      const response = await fetch('/api/master/keyword-draft', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({
        keyword: article.keyword || article.topic,
        summary: facts,
        country: getCountryRoute(article.country)?.isoAlpha2 || article.country,
        category: article.category,
        sourceUrls: article.editorial.sources.map(source => source.url).filter(Boolean),
      }), signal: AbortSignal.timeout(180_000) });
      const payload = await response.json().catch(() => null) as { draft?: Partial<EditorialArticle>; error?: string } | null;
      if (!response.ok || !payload?.draft) throw new Error(payload?.error || '초안 생성에 실패했습니다.');
      const draft = payload.draft;
      if (useGlobalStore.getState().user?.id !== uid) throw new Error('로그인 계정이 변경되었습니다.');
      update({ title: draft.title, summary: draft.summary, body: draft.body, seoTitle: draft.seoTitle, metaDescription: draft.metaDescription, tags: draft.tags, editorial: normalizeEditorial(draft.editorial) });
      setMessage('상세 초안을 불러왔습니다. 원문·표·사진 권리와 누락 자료를 검토한 뒤 게시하세요.');
    } catch (error) {
      const timedOut = error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError');
      setMessage(timedOut ? '공식 원문·AI 응답 시간이 초과되었습니다. 기존 초안은 유지됩니다. 서버 상태와 AI 연결을 확인한 뒤 다시 시도하세요.' : error instanceof Error ? error.message : '초안을 만들지 못했습니다. 기존 내용을 유지합니다.');
    }
    finally { setBusy(false); }
  };
  return <section id="editorial-desk" className="mb-6 min-w-0 rounded-3xl border border-teal-300/25 bg-[#101c29] p-5 text-slate-200">
    <p className="text-xs font-bold uppercase tracking-widest text-teal-200">Public-Service Editorial Desk</p>
    <h2 className="mt-2 text-2xl font-black text-white">국가별 운영자 편집·발행</h2>
     <p className="mt-2 text-sm leading-6 text-slate-400">국가를 선택해 수동 기사를 만들거나 HOT 키워드에서 넘어온 초안을 바로 엽니다. 공식 원문 기반 상세 초안을 만들고 원문·미리보기를 검토한 뒤 발행하세요.</p>
    <p className="mt-2 text-xs text-amber-100">국가별 최대 15개, 작업대 전체 60개. 이 브라우저의 현재 UID별로 편집·검토·진행 상태를 보관합니다. 사실 확인은 운영자 책임이며 자동 검증 완료를 뜻하지 않습니다.</p>
     {keyword && <p className="mt-3 text-sm">전달된 키워드: <strong>{keyword}</strong> · 같은 국가에 기존 초안이 있으면 그 초안을 엽니다.</p>}
    {targetCountry && targetCountry !== country && <button type="button" className={`${button} mt-2`} disabled={busy} onClick={() => setCountry(targetCountry)}>전달된 국가 선택: {targetCountry}</button>}
    {storageError && <p role="alert" className="mt-3 break-words text-sm text-rose-200">{storageError} 게시를 중단했습니다.</p>}
    {message && <p role="status" className="my-3 break-words text-sm text-teal-100">{message}</p>}
    <fieldset disabled={!ready || busy} className="mt-5 min-w-0">
      <div className="flex flex-wrap items-center gap-3 text-xs"><span>선택 국가 {visible.length}/15 · 검토 대기 {visible.filter((entry) => !entry.reviewed).length} · 저장 확인 {visible.filter((entry) => entry.status === 'published').length} · 실패 {visible.filter((entry) => entry.status === 'error').length}</span><button type="button" className={`${button} bg-teal-300 text-slate-950`} disabled={!reviewed.length || Boolean(storageError)} onClick={() => void publish(reviewed.map((entry) => editorialIdentity(entry.article)))}>이 국가의 검토 완료 {reviewed.length}개 게시 / 재시도</button></div>
      <div className="mt-4 grid min-w-0 gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
        <nav aria-label="기사 검토 대기열" className="min-w-0 space-y-2">{visible.map((entry) => <div key={editorialIdentity(entry.article)} className="rounded-xl border border-white/10 p-3"><button type="button" className="w-full break-words text-left text-sm font-bold" aria-current={active === editorialIdentity(entry.article) ? 'true' : undefined} onClick={() => { setActive(editorialIdentity(entry.article)); setPreview(false); }}>{entry.article.title || '제목 없는 초안'}</button><p className="mt-1 text-xs text-teal-200">{entry.status === 'published' ? '저장 확인됨' : entry.status === 'error' ? '실패 · 재시도 가능' : entry.reviewed ? '검토 완료' : '검토 필요'}</p>{entry.id && <Link target="_blank" href={getContentDetailPath('posts', entry.id, { country: entry.article.country, sourceCategory: entry.article.category })} className="mt-1 block text-xs underline">게시글 열기</Link>}</div>)}</nav>
           {!article || !selected ? <p className="py-8 text-sm text-slate-400">수동 기사를 만든 뒤 검토할 기사를 선택하세요.</p> : <div className="min-w-0 space-y-3">
          <p className="break-all text-xs text-slate-400">고정 key: {article.key} · 재시도할 때 변경하지 마세요.</p>
          <fieldset disabled={selected.status === 'published'} className="min-w-0 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs">작성자<input readOnly value={OPERATOR_BYLINE} className={field} /></label><label className="text-xs">국가 (이 기사)<select className={field} value={article.country} onChange={(event) => { const nextCountry = event.target.value; if (current.current.some((entry) => entry !== selected && entry.article.country === nextCountry && entry.article.key === article.key) || current.current.filter((entry) => entry.article.country === nextCountry).length >= 15) return setMessage('해당 국가의 key 중복 또는 15개 제한을 확인하세요.'); update({ country: nextCountry }); setActive(`${nextCountry}:${article.key}`); setCountry(nextCountry); }}>{EDITORIAL_COUNTRIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="text-xs">카테고리<select className={field} value={article.category} onChange={(event) => update({ category: event.target.value })}>{EDITORIAL_CATEGORIES.map((item) => <option key={item.slug} value={item.slug}>{item.label}</option>)}</select></label><label className="text-xs">주제<input className={field} value={article.topic} maxLength={120} onChange={(event) => update({ topic: event.target.value })} placeholder="예: 여권·비자·응급 연락처" /></label></div>
            <label className="block text-xs">키워드 (선택)<input className={field} value={article.keyword} maxLength={160} onChange={(event) => update({ keyword: event.target.value })} /></label>
            <label className="block text-xs">제목<input className={field} value={article.title} maxLength={120} onChange={(event) => update({ title: event.target.value })} /></label>
            <label className="block text-xs">요약<textarea className={field} value={article.summary} rows={3} maxLength={600} onChange={(event) => update({ summary: event.target.value })} /></label>
            <button type="button" className={`${button} bg-amber-300 text-slate-950`} onClick={() => void generate()}>키워드·기본 내용으로 공식 자료 기반 상세 초안 만들기</button><p className="text-xs text-slate-400">원문 URL을 추가하면 등록된 공식 기관의 해당 페이지를 우선 읽습니다. 등록되지 않은 주소는 자동으로 가져오지 않습니다.</p>
            <label className="block text-xs">본문 (80~12,000자)<textarea className={`${field} leading-7`} value={article.body} rows={16} maxLength={EDITORIAL_BODY_LIMIT} onChange={(event) => update({ body: event.target.value })} placeholder="대상·배경, 확인된 절차, 준비사항, 주의점, 독자의 다음 행동을 소제목별로 정리하세요. 확인하지 않은 비용·연락처·체험담은 만들지 마세요." /></label><p className="text-right text-xs">{[...article.body].length.toLocaleString()} / 12,000</p>
            <EditorialEditor value={article.editorial} onChange={(editorial) => update({ editorial })} />
            <details open className="space-y-2"><summary className="text-sm font-bold">원문 근거·확인 시각 / 사진 직접 입력</summary><p className="text-xs">출처 추가는 위 편집기에서 하세요. 원문 발행처는 작성자와 별개입니다. 자료 부족 시 사진·표는 비워두세요.</p>
              {article.editorial.sources.map((source, index) => <div key={index} className="space-y-2 rounded-xl border border-white/10 p-3"><p className="text-sm">{source.title || `출처 ${index + 1}`}</p>{(['publisher', 'retrievedAt', 'excerpt'] as const).map((key) => <label key={key} className="block text-xs">{key === 'publisher' ? '원문 발행처' : key === 'retrievedAt' ? '직접 확인한 UTC 시각 (예: 2026-09-16T10:00:00Z)' : '확인한 원문 발췌 / 근거'}<textarea className={field} rows={key === 'excerpt' ? 4 : 1} value={source[key]} onChange={(event) => update({ editorial: { ...article.editorial, sources: article.editorial.sources.map((row, i) => i === index ? { ...row, [key]: event.target.value } : row) } })} /></label>)}<button type="button" className={button} onClick={() => update({ editorial: { ...article.editorial, sources: article.editorial.sources.filter((_, i) => i !== index) } })}>출처 삭제</button></div>)}
              {article.editorial.photos.map((photo, index) => <div key={index} className="space-y-2 rounded-xl border border-white/10 p-3">{(['url', 'caption', 'creator', 'license', 'sourceUrl'] as const).map((key) => <label key={key} className="block text-xs">사진 {key}<input className={field} value={photo[key]} onChange={(event) => update({ editorial: { ...article.editorial, photos: article.editorial.photos.map((row, i) => i === index ? { ...row, [key]: event.target.value } : row) } })} /></label>)}</div>)}
              <button type="button" className={button} disabled={article.editorial.photos.length >= 4} onClick={() => update({ editorial: { ...article.editorial, photos: [...article.editorial.photos, { url: '', caption: '', creator: '', license: '', sourceUrl: '' }] } })}>권리를 확인한 사진 추가 (선택)</button>
            </details>
          </fieldset>
          {validationError && <p role="alert" className="text-sm text-amber-200">{validationError}</p>}
          {selected.error && <p role="alert" className="break-words text-sm text-rose-200">{selected.error}</p>}
          <div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={() => setPreview(!preview)}>{preview ? '미리보기 접기' : '기사 미리보기 / 검토'}</button><button type="button" className={button} onClick={() => { if (window.confirm('이 기사를 작업대에서만 제거할까요? 게시된 원문은 삭제되지 않습니다. 미게시 편집은 백업 후 정리하세요.')) { store(current.current.filter((entry) => editorialIdentity(entry.article) !== active)); setActive(''); } }}>작업대에서 제거</button></div>
          {preview && <article className="min-w-0 rounded-xl border border-white/15 bg-white/5 p-4"><p className="text-xs">{article.country} · {article.category} · {article.topic} · {OPERATOR_BYLINE}</p><h3 className="mt-3 break-words text-2xl font-black">{article.title}</h3><p className="my-4 whitespace-pre-wrap break-words font-bold">{article.summary}</p><div className="whitespace-pre-wrap break-words leading-8">{article.body}</div><EditorialBlocks value={article.editorial} showGuidance />
            {selected.status !== 'published' && <label className="mt-4 flex gap-2 text-sm"><input type="checkbox" disabled={Boolean(validationError)} checked={selected.reviewed} onChange={(event) => store(current.current.map((entry) => editorialIdentity(entry.article) === active ? { ...entry, reviewed: event.target.checked } : entry))} />이 기사의 원문·기준일·수치·표·연락처와 사진별 권리를 확인했습니다. 확인되지 않은 사실과 꾸며낸 직접 경험은 제거했습니다.</label>}
          </article>}
          <button type="button" className={`${button} w-full bg-teal-300 text-slate-950`} disabled={!selected.reviewed || selected.status === 'published' || Boolean(validationError) || Boolean(storageError)} onClick={() => void publish([active])}>이 기사 게시 / 동일 key로 재시도</button>
        </div>}
      </div>
    </fieldset>
    {busy && <p role="status" className="mt-3 text-sm text-teal-100">기사를 순서대로 게시하고 서버 저장 결과를 읽어 확인하는 중입니다. 페이지를 닫아도 같은 key로 재시도할 수 있습니다.</p>}
  </section>;
}
