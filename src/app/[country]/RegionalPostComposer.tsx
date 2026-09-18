'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createDocument, getFreshSessionToken } from '@/lib/firebase';
import { useGlobalStore } from '@/store/useGlobalStore';
import type { CountryRoute, RegionalCategory } from '@/lib/regionRoutes';

export default function RegionalPostComposer({ country, category, label }: { country: CountryRoute; category: RegionalCategory; label: string }) {
  const user = useGlobalStore((state) => state.user);
  const setSelectedCountry = useGlobalStore((state) => state.setSelectedCountry);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (category === 'directory') return;
    if (saving) return;
    if (!user) return setError('로그인 후 글을 작성할 수 있습니다.');
    if (title.trim().length < 4 || body.trim().length < 10) return setError('제목은 4자 이상, 내용은 10자 이상 입력해주세요.');
    setSaving(true);
    setError('');
    try {
      const token = await getFreshSessionToken();
      if (!token) return setError('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
       const collection = category === 'jobs' ? 'jobs' : category === 'market' ? 'marketItems' : 'posts';
      await createDocument(collection, crypto.randomUUID(), {
        title: title.trim(),
        body: body.trim(),
        authorId: user.id,
        author: user.name,
        authorName: user.name,
        country: country.id,
        type: category,
        sourceCategory: category,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...(category === 'jobs' ? { company: user.name, location: country.label, salary: '협의' } : {}),
      }, token);
      setTitle('');
      setBody('');
      setOpen(false);
      router.refresh();
    } catch {
      setError('게시글을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setSaving(false);
    }
  };

  if (!user) return <Link href="/login" className="inline-block rounded-xl bg-teal-300 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-teal-200">로그인 후 글쓰기</Link>;
  if (category === 'directory') return <Link href="/directory?register=1" onClick={() => setSelectedCountry(country.id)} className="inline-block rounded-xl bg-teal-300 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-teal-200">Google Maps 연결 후 업체 등록</Link>;
  if (!open) return <button type="button" onClick={() => { setError(''); setOpen(true); }} className="rounded-xl bg-teal-300 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-teal-200">{label} 글쓰기</button>;

  return (
    <form onSubmit={submit} className="mt-5 rounded-2xl border border-teal-300/20 bg-teal-300/[.06] p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="font-black text-white">{country.label} {label} 글쓰기</h2><p className="mt-1 text-xs text-slate-400">지역 생활정보를 공유해주세요.</p></div><button type="button" onClick={() => setOpen(false)} className="text-xs font-bold text-slate-400 hover:text-white">취소</button></div>
      <div className="grid gap-2"><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="제목" className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-teal-300" /><textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={5000} rows={5} placeholder="생활정보, 경험, 질문을 적어주세요." className="resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm leading-6 text-white outline-none focus:border-teal-300" /></div>
      {error && <p role="alert" className="mt-2 text-xs font-bold text-rose-300">{error}</p>}
      <button type="submit" disabled={saving} className="mt-3 rounded-xl bg-teal-300 px-4 py-2.5 text-xs font-black text-slate-950 disabled:opacity-50">{saving ? '등록 중...' : '게시글 등록'}</button>
    </form>
  );
}
