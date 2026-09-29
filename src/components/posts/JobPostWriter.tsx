'use client';

import { useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, Sparkles, X } from 'lucide-react';
import { createDocument, getSessionToken, type PortalUser } from '@/lib/firebase';
import { useImageAttachments } from './useImageAttachments';

type JobForm = { title: string; company: string; location: string; country: string; salary: string; tag: string; body: string };

export default function JobPostWriter({ user, defaultCountry, onSaved }: { user: PortalUser; defaultCountry: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<JobForm>({ title: '', company: user.name, location: '', country: defaultCountry === 'Global' ? user.country || '' : defaultCountry, salary: '', tag: '정규직', body: '' });
  const fileInput = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const { images, dragging, error: attachmentError, handleInput, handleDragOver, handleDragLeave, handleDrop, removeImage, uploadImages, clearImages } = useImageAttachments(user.id, 'jobs');

  const close = (afterSave = false) => {
    if (savingRef.current && !afterSave) return;
    clearImages();
    setForm({ title: '', company: user.name, location: '', country: defaultCountry === 'Global' ? user.country || '' : defaultCountry, salary: '', tag: '정규직', body: '' });
    setError('');
    setOpen(false);
  };

  const createDraft = async () => {
    if (aiLoading) return;
    const token = getSessionToken();
    if (!token) return setError('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
    setAiLoading(true);
    setError('');
    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mode: 'writerDraft', messages: [{ role: 'user', content: `구인 공고 설명을 작성하세요. 공고 제목: ${form.title || '미정'}\n회사: ${form.company || '미정'}\n근무 지역: ${form.location || form.country || '미정'}\n급여: ${form.salary || '협의'}\n고용 형태: ${form.tag}\n추가 메모: ${form.body || '없음'}\n사실을 만들거나 필수 근무 조건을 추측하지 말고, 제공된 정보와 지원자가 확인할 사항을 명확히 구분해 한국어로 작성하세요.` }] }),
      });
      const result = await response.json() as { answer?: string; error?: string };
      if (!response.ok || !result.answer) throw new Error(result.error || 'AI 초안을 만들지 못했습니다.');
      setForm((current) => ({ ...current, body: result.answer! }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI 초안을 만들지 못했습니다.');
    } finally {
      setAiLoading(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    if (form.title.trim().length < 4 || form.company.trim().length < 2 || form.location.trim().length < 2 || form.country.trim().length < 2 || !form.salary.trim()) {
      setError('공고 제목·회사명·근무 지역·국가·급여를 정확히 입력해주세요.');
      return;
    }
    if (/&lt;[^&]+&gt;|<[^>]+>|javascript:|data:text\/html|https?:\/\//i.test(Object.values(form).join(' '))) {
      setError('공고 내용에 HTML 또는 외부 링크를 입력할 수 없습니다.');
      return;
    }
    const token = getSessionToken();
    if (!token) return setError('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const uploadedImages = await uploadImages();
      await createDocument('jobs', crypto.randomUUID(), {
        ...form,
        title: form.title.trim(),
        company: form.company.trim(),
        location: form.location.trim(),
        country: form.country.trim(),
        salary: form.salary.trim(),
        body: form.body.trim(),
        image: uploadedImages[0] || '',
        images: uploadedImages,
        authorId: user.id,
        createdAt: new Date().toISOString(),
      }, token);
      close(true);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '공고를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return <>
    <button type="button" onClick={() => { setError(''); setOpen(true); }} className="rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-4 py-2.5 text-sm font-black text-cyan-100 hover:bg-cyan-300/20">AI 초안 작성</button>
    {open && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-busy={saving} aria-labelledby="ai-job-composer-title" className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-cyan-200/20 bg-[#0b1221] p-5 text-slate-100 shadow-2xl sm:p-6">
        <header className="mb-5 flex items-start justify-between gap-4 border-b border-white/10 pb-4"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-300">AI Job Studio</p><h2 id="ai-job-composer-title" className="mt-1 text-xl font-black text-white">구인 공고 작성</h2><p className="mt-2 text-xs leading-5 text-slate-400">AI는 내 프로필의 비공개 작성 지침을 적용하며, 급여·자격 조건은 직접 확인해야 합니다.</p></div><button type="button" disabled={saving} onClick={() => close()} aria-label="작성창 닫기" className="rounded-full p-2 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-50"><X size={18} /></button></header>
        {error && <p role="alert" className="mb-4 rounded-xl border border-rose-300/20 bg-rose-300/[.08] px-3 py-2 text-xs font-bold text-rose-200">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2 text-xs font-bold text-slate-300">공고 제목<input required minLength={4} maxLength={120} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="예: LA 한식당 주방 보조" className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300/60" /></label>
          <label className="text-xs font-bold text-slate-300">회사명<input required minLength={2} maxLength={120} value={form.company} onChange={(event) => setForm((current) => ({ ...current, company: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300/60" /></label>
          <label className="text-xs font-bold text-slate-300">근무 지역<input required minLength={2} maxLength={120} value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} placeholder="도시·주" className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300/60" /></label>
          <label className="text-xs font-bold text-slate-300">국가<input required minLength={2} maxLength={80} value={form.country} onChange={(event) => setForm((current) => ({ ...current, country: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300/60" /></label>
          <label className="text-xs font-bold text-slate-300">급여·보상<input required maxLength={100} value={form.salary} onChange={(event) => setForm((current) => ({ ...current, salary: event.target.value }))} placeholder="협의 가능" className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300/60" /></label>
          <label className="text-xs font-bold text-slate-300">고용 형태<select value={form.tag} onChange={(event) => setForm((current) => ({ ...current, tag: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#10182b] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300/60"><option>정규직</option><option>계약직</option><option>파트타임</option><option>인턴</option><option>원격근무</option></select></label>
          <div className="sm:col-span-2"><div className="mb-1.5 flex items-center justify-between gap-2"><label htmlFor="job-description" className="text-xs font-bold text-slate-300">상세 설명</label><button type="button" onClick={() => void createDraft()} disabled={aiLoading} className="inline-flex items-center gap-1.5 rounded-lg bg-fuchsia-300/15 px-3 py-2 text-xs font-black text-fuchsia-100 disabled:opacity-60"><Sparkles size={14} />{aiLoading ? '작성 중...' : 'AI 초안'}</button></div><textarea id="job-description" maxLength={4000} rows={7} value={form.body} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} placeholder="업무 내용, 지원 자격, 근무 시간 등 확인된 조건을 입력하세요." className="w-full resize-y rounded-xl border border-white/10 bg-white/[.04] p-3 text-sm leading-6 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/60" /></div>
          <div className="sm:col-span-2 rounded-xl border border-white/10 p-3" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black text-white">공고 사진</p><p className="mt-1 text-[11px] text-slate-500">이미지를 끌어놓거나 선택하세요 · 최대 8장 · 파일당 5MB</p></div><button type="button" onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-300 px-3 py-2 text-xs font-black text-slate-950"><ImagePlus size={14} />사진 선택</button><input ref={fileInput} type="file" accept="image/*" multiple onChange={handleInput} className="hidden" /></div>{dragging && <p className="mt-3 rounded-lg border border-dashed border-cyan-200 px-3 py-4 text-center text-xs text-cyan-100">여기에 놓아 첨부</p>}{attachmentError && <p role="status" className="mt-2 text-xs text-amber-200">{attachmentError}</p>}{images.length > 0 && <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8">{images.map((image, index) => <div key={`${image}-${index}`} className="relative aspect-square overflow-hidden rounded-lg"><img src={image} alt={`공고 사진 ${index + 1}`} className="h-full w-full object-cover" /><button type="button" aria-label={`공고 사진 ${index + 1} 삭제`} onClick={() => removeImage(index)} className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white"><X size={12} /></button></div>)}</div>}</div>
        </div>
        <footer className="mt-5 flex gap-2 border-t border-white/10 pt-4"><button type="button" disabled={saving} onClick={() => close()} className="flex-1 rounded-xl border border-white/10 py-3 font-bold text-slate-300 disabled:opacity-50">취소</button><button disabled={saving} className="flex-1 rounded-xl bg-cyan-300 py-3 font-black text-slate-950 disabled:cursor-wait disabled:opacity-50">{saving ? <span className="inline-flex items-center gap-2"><LoaderCircle size={16} className="animate-spin" />등록 중...</span> : '공고 등록'}</button></footer>
      </form>
    </div>}
  </>;
}
