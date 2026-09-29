'use client';

import { useState } from 'react';
import Link from 'next/link';
import WriterComposer, { type WriterDraft } from '@/components/posts/WriterComposer';
import { createDocument, getSessionToken } from '@/lib/firebase';
import { editorialForStorage } from '@/lib/editorialContent';
import { useGlobalStore } from '@/store/useGlobalStore';

export default function CategoryPostWriter({ category, onSaved }: { category: 'life' | 'news'; onSaved?: () => void }) {
  const user = useGlobalStore((state) => state.user);
  const selectedCountry = useGlobalStore((state) => state.selectedCountry);
  const [open, setOpen] = useState(false);
  const label = category === 'news' ? '뉴스 작성' : '생활 정보 작성';

  const save = async (draft: WriterDraft) => {
    if (!user) throw new Error('로그인 후 글을 작성할 수 있습니다.');
    const token = getSessionToken();
    if (!token) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
    await createDocument('posts', crypto.randomUUID(), {
      type: category === 'news' ? 'news' : 'general',
      category,
      tag: category === 'news' ? '뉴스' : '생활',
      title: draft.title,
      body: draft.body,
      image: draft.images[0] || '',
      images: draft.images,
      editorial: editorialForStorage(draft.editorial),
      authorId: user.id,
      author: user.name,
      country: selectedCountry,
      createdAt: new Date().toISOString(),
      views: 0,
      likes: 0,
      comments: 0,
    }, token);
    setOpen(false);
    onSaved?.();
  };

  if (!user) return <Link href="/login" className="rounded-xl border border-cyan-300/35 bg-cyan-300/10 px-4 py-2.5 text-xs font-black text-cyan-100">로그인 후 {label}</Link>;
  return <>
    <button type="button" onClick={() => setOpen(true)} className="rounded-xl bg-cyan-300 px-4 py-2.5 text-xs font-black text-slate-950">{label}</button>
    {open && <WriterComposer key={category} userId={user.id} category={category} onClose={() => setOpen(false)} onSave={save} />}
  </>;
}
