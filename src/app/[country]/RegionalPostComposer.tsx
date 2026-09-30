'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import JobPostWriter from '@/components/posts/JobPostWriter';
import WriterComposer, { type WriterDraft } from '@/components/posts/WriterComposer';
import { createDocument, getFreshSessionToken } from '@/lib/firebase';
import { editorialForStorage } from '@/lib/editorialContent';
import { useGlobalStore } from '@/store/useGlobalStore';
import type { WriterDraftCategory } from '@/lib/writerPreferences';
import type { CountryRoute, RegionalCategory } from '@/lib/regionRoutes';

export default function RegionalPostComposer({ country, category, label }: { country: CountryRoute; category: RegionalCategory; label: string }) {
  const user = useGlobalStore((state) => state.user);
  const setSelectedCountry = useGlobalStore((state) => state.setSelectedCountry);
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const save = async (draft: WriterDraft) => {
    if (!user) throw new Error('로그인 후 글을 작성할 수 있습니다.');
    const token = await getFreshSessionToken();
    if (!token) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
    const createdAt = new Date().toISOString();
    await createDocument('posts', crypto.randomUUID(), {
      type: category === 'news' ? 'news' : 'general',
      category,
      tag: label,
      sourceCategory: category,
      title: draft.title,
      body: draft.body,
      image: draft.images[0] || '',
      images: draft.images,
      editorial: editorialForStorage(draft.editorial),
      authorId: user.id,
      author: user.name,
      authorName: user.name,
      country: country.id,
      createdAt,
      updatedAt: createdAt,
      views: 0,
      likes: 0,
      comments: 0,
    }, token);
    setOpen(false);
    router.refresh();
  };

  if (!user) return <Link href="/login" className="inline-block rounded-xl bg-teal-300 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-teal-200">로그인 후 글쓰기</Link>;
  if (category === 'directory') return <Link href="/directory?register=1" onClick={() => setSelectedCountry(country.id)} className="inline-block rounded-xl bg-teal-300 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-teal-200">Google Maps 연결 후 업체 등록</Link>;
  if (category === 'jobs') return <JobPostWriter user={user} defaultCountry={country.id} onSaved={() => router.refresh()} />;
  if (category === 'market') return <Link href="/market" onClick={() => setSelectedCountry(country.id)} className="inline-block rounded-xl bg-teal-300 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-teal-200">장터 상품 등록</Link>;

  const writerCategory: WriterDraftCategory = category === 'news'
    ? 'news'
    : category === 'community' || category === 'freeboard' || category === 'events'
      ? 'community'
      : 'life';

  return <>
    <button type="button" onClick={() => setOpen(true)} className="rounded-xl bg-teal-300 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-teal-200">{label} 글쓰기</button>
    {open && <WriterComposer key={category} userId={user.id} category={writerCategory} onClose={() => setOpen(false)} onSave={save} />}
  </>;
}
