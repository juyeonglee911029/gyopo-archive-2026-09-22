'use client';

import { Bold, Eye, ImagePlus, Italic, List, LoaderCircle, Quote, Sparkles, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { getSessionToken } from '@/lib/firebase';
import { editorialValidationError, normalizeEditorial, type EditorialContent } from '@/lib/editorialContent';
import EditorialEditor from './EditorialEditor';
import EditorialBlocks from './EditorialBlocks';
import { useImageAttachments } from './useImageAttachments';

export type WriterDraft = { title: string; body: string; images: string[]; editorial?: EditorialContent };
type WriterComposerProps = { userId: string; initial?: WriterDraft; editing?: boolean; onClose: () => void; onSave: (draft: WriterDraft) => Promise<void> };

export default function WriterComposer({ userId, initial, editing = false, onClose, onSave }: WriterComposerProps) {
  const [title, setTitle] = useState(initial?.title || '');
  const [body, setBody] = useState(initial?.body || '');
  const { images, setImages, dragging, error: attachmentError, handleInput, handleDragOver, handleDragLeave, handleDrop, removeImage, uploadImages } = useImageAttachments(userId, 'posts', initial?.images || []);
  const [editorial, setEditorial] = useState(() => normalizeEditorial(initial?.editorial));
  const [imageUrl, setImageUrl] = useState('');
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const insert = (value: string, selection = value.length) => {
    const textarea = document.querySelector<HTMLTextAreaElement>('[data-writer-body]');
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${body.slice(0, start)}${value}${body.slice(end)}`;
    setBody(next);
    window.requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(start + selection, start + selection); });
  };

  const createDraft = async () => {
    if (aiLoading) return;
    setAiLoading(true);
    try {
      const token = getSessionToken();
      const response = await fetch('/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ mode: 'writerDraft', messages: [{ role: 'user', content: `제목: ${title || '미정'}\n메모: ${body || '아직 없음'}\n요청: 제목에 맞는 도입, 소제목 3개, 구체적인 본문, 독자가 실행할 체크리스트를 포함한 초안을 작성하세요. 근거가 없는 정보는 추가하지 말고, 확인이 필요한 부분은 표시하세요.` }] }) });
      const result = await response.json() as { answer?: string; error?: string };
      if (!response.ok || !result.answer) throw new Error(result.error || 'AI 초안을 만들지 못했습니다.');
      setBody(result.answer);
    } catch (error) { window.alert(error instanceof Error ? error.message : 'AI 초안을 만들지 못했습니다.'); }
    finally { setAiLoading(false); }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !body.trim() || saving) return;
    const editorialError = editorialValidationError(editorial);
    if (editorialError) return window.alert(editorialError);
    setSaving(true);
    try {
      const uploaded = await uploadImages();
      await onSave({ title: title.trim(), body: body.trim(), images: uploaded, editorial: normalizeEditorial(editorial) });
    } catch (error) { window.alert(error instanceof Error ? error.message : '게시글을 저장하지 못했습니다.'); }
    finally { setSaving(false); }
  };

  return <div className="fixed inset-0 flex items-center justify-center bg-black/70 p-3 sm:p-6" style={{ zIndex: 280 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form onSubmit={save} className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0f172a] shadow-2xl">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-300">Writer Studio</p><h2 className="mt-1 text-xl font-black text-white">{editing ? '게시글 다듬기' : '작가용 새 글 작성'}</h2></div><button type="button" onClick={onClose} aria-label="작성창 닫기" className="rounded-full p-2 text-slate-400 hover:bg-white/10 hover:text-white"><X size={20} /></button></div>
      <div className="grid min-h-0 gap-5 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4"><input value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="제목을 입력하세요" className="w-full border-b border-white/15 bg-transparent px-1 py-3 text-2xl font-black text-white outline-none placeholder:text-slate-600 focus:border-cyan-300" /><div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[.04] p-2"><button type="button" onClick={() => insert('**굵게**', 2)} title="굵게" className="toolbar-button"><Bold size={16} /></button><button type="button" onClick={() => insert('_기울임_', 1)} title="기울임" className="toolbar-button"><Italic size={16} /></button><button type="button" onClick={() => insert('\n> 인용문\n', 7)} title="인용" className="toolbar-button"><Quote size={16} /></button><button type="button" onClick={() => insert('\n- 목록 항목\n', 8)} title="목록" className="toolbar-button"><List size={16} /></button><span className="h-5 w-px bg-white/10" /><button type="button" onClick={() => setPreview((value) => !value)} className="toolbar-button"><Eye size={16} />{preview ? '편집' : '미리보기'}</button><button type="button" onClick={() => void createDraft()} disabled={aiLoading} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-fuchsia-300/15 px-3 py-2 text-xs font-black text-fuchsia-100 disabled:opacity-60"><Sparkles size={14} />{aiLoading ? '작성 중...' : 'AI 초안'}</button></div>{preview ? <div className="min-h-72 whitespace-pre-wrap rounded-2xl border border-white/10 bg-white/[.03] p-5 text-[16px] leading-8 text-slate-200">{body || '본문 미리보기'}</div> : <textarea data-writer-body value={body} onChange={(event) => setBody(event.target.value)} required rows={16} placeholder="독자가 이해할 수 있도록 핵심부터 써보세요. 메모를 넣고 AI 초안으로 확장할 수도 있습니다." className="min-h-72 w-full resize-y rounded-2xl border border-white/10 bg-white/[.03] p-5 text-[16px] leading-8 text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-300/60" />}</div>
         <aside className="space-y-4"><div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} className={`rounded-2xl border p-4 transition ${dragging ? 'border-cyan-200 bg-cyan-300/10' : 'border-white/10 bg-white/[.04]'}`}><div className="flex items-center justify-between gap-3"><div><h3 className="font-black text-white">사진 첨부</h3><p className="mt-1 text-xs leading-5 text-slate-500">JPG, PNG · 파일당 5MB · 최대 8장</p></div><button type="button" onClick={() => fileInput.current?.click()} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-cyan-300 px-3 py-2 text-xs font-black text-slate-950"><ImagePlus size={14} />파일 선택</button><input ref={fileInput} type="file" accept="image/*" multiple onChange={handleInput} className="hidden" /></div><p className="mt-3 rounded-xl border border-dashed border-white/15 px-3 py-4 text-center text-xs text-slate-400">사진 파일을 이곳에 끌어놓으세요</p>{attachmentError && <p role="status" className="mt-2 text-xs text-amber-200">{attachmentError}</p>}<div className="mt-4 grid grid-cols-3 gap-2">{images.map((image, index) => <div key={`${image}-${index}`} className="relative aspect-square overflow-hidden rounded-lg bg-black/30"><img src={image} alt={`첨부 ${index + 1}`} className="h-full w-full object-cover" /><button type="button" onClick={() => removeImage(index)} aria-label={`첨부 ${index + 1} 삭제`} className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white"><X size={12} /></button></div>)}</div><div className="mt-3 flex gap-2"><input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} type="url" placeholder="이미지 URL 추가" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none" /><button type="button" onClick={() => { if (imageUrl.trim() && images.length < 8) { setImages((current) => [...current, imageUrl.trim()]); setImageUrl(''); } }} className="rounded-lg border border-white/10 px-3 text-xs font-bold text-slate-300">추가</button></div></div><div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[.06] p-4 text-xs leading-6 text-slate-300"><strong className="text-cyan-100">작가 팁</strong><br />사실·출처·작성 시점을 분리해 쓰면 검색과 독자 신뢰에 도움이 됩니다. AI 초안은 게시 전 반드시 직접 확인하세요.</div></aside>
        <div className="min-w-0 text-slate-200 lg:col-span-2">{preview ? <EditorialBlocks value={editorial} showGuidance /> : <EditorialEditor value={editorial} onChange={setEditorial} />}</div>
      </div>
      <div className="flex gap-2 border-t border-white/10 p-4"><button type="button" onClick={onClose} className="flex-1 rounded-xl border border-white/10 py-3 font-bold text-slate-300">취소</button><button disabled={saving} className="flex-1 rounded-xl bg-cyan-300 py-3 font-black text-slate-950 disabled:cursor-wait disabled:opacity-60">{saving ? <span className="inline-flex items-center gap-2"><LoaderCircle size={16} className="animate-spin" />업로드 중...</span> : editing ? '수정 저장' : '게시하기'}</button></div>
    </form>
  </div>;
}
