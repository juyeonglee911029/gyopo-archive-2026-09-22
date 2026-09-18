'use client';

import Link from 'next/link';
import { notFound, useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { deleteDocument, getDocument, getSessionToken, incrementDocument, isMasterUser, mergeDocument } from '@/lib/firebase';
import { useGlobalStore } from '@/store/useGlobalStore';
import ImageCarousel from '@/components/media/ImageCarousel';
import EditorialBlocks from '@/components/posts/EditorialBlocks';
import WriterComposer, { type WriterDraft } from '@/components/posts/WriterComposer';
import { editorialForStorage, normalizeEditorial, type EditorialContent } from '@/lib/editorialContent';
import { isPublicArticle } from '@/lib/publicArticle';
import { isRegionalPostId } from '@/lib/regionRoutes';
import '@/styles/posts.css';

export const runtime = 'edge';

type Post = {
  id: string;
  title: string;
  body: string;
  author: string;
  country: string;
  createdAt: string;
  authorId: string;
  views?: number;
  image?: string;
  images?: string[];
  sourceName?: string;
  sourceUrl?: string;
  editorial?: EditorialContent;
  desc?: string;
  description?: string;
  authorName?: string;
  status?: string;
  deleted?: boolean;
  isPublic?: boolean;
  sourceSnapshot?: boolean;
  expiresAt?: unknown;
};

export default function CommunityPostPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  if (!isRegionalPostId(id)) notFound();
  return <CommunityPost key={id} id={id} />;
}

function CommunityPost({ id }: { id: string }) {
  const router = useRouter();
  const user = useGlobalStore((state) => state.user);
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const stored = await getDocument<Omit<Post, 'id'>>('posts', id, getSessionToken());
        if (!active) return;
        const next = stored && isPublicArticle(stored) ? { ...stored, id, body: stored.body || stored.desc || stored.description || '', author: stored.author || stored.authorName || '' } : null;
        setPost(next);
        if (next) {
          void incrementDocument('posts', id, 'views', 1, getSessionToken()).then(() => {
            if (active) setPost((current) => current ? { ...current, views: Number(current.views || 0) + 1 } : current);
          }).catch(() => undefined);
        }
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [id]);

  if (loading) return <div className="container mx-auto px-4 py-20 text-center text-gray-400">게시글을 불러오는 중입니다...</div>;
  if (error) return <div role="alert" className="container mx-auto px-4 py-20 text-center text-amber-100">게시글을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</div>;
  if (!post) notFound();

  const canEdit = Boolean(user && user.id === post.authorId);
  const canDelete = Boolean(user && (user.id === post.authorId || isMasterUser(user)));
  const saveEdit = async (draft: WriterDraft) => {
    const token = getSessionToken();
    if (!token || !canEdit) throw new Error('작성자 로그인 상태를 확인해주세요.');
    const changes = { title: draft.title.trim(), body: draft.body.trim(), images: draft.images, image: draft.images[0] || '', editorial: normalizeEditorial(draft.editorial) };
    await mergeDocument('posts', post.id, { ...changes, editorial: editorialForStorage(changes.editorial), updatedAt: new Date() }, token);
    setPost({ ...post, ...changes });
    setEditing(false);
  };

  const removePost = async () => {
    const token = getSessionToken();
    if (!token || !canDelete || !window.confirm('이 게시글을 삭제할까요?')) return;
    await deleteDocument('posts', post.id, token);
    router.push('/community');
  };

  return (
    <article className="public-article container mx-auto px-4 py-8 max-w-3xl text-slate-100">
      <Link href="/community" className="text-sm font-bold text-teal-200">← 커뮤니티</Link>
      <div className="article-mosaic mt-4 p-6 md:p-10">
         <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mb-4"><span className="article-mosaic-tile px-2 py-1 font-bold text-slate-200">{post.country}</span><span>{post.author}</span><span>·</span><span>{new Date(post.createdAt).toLocaleString('ko-KR')}</span><span>· 조회 {post.views || 0}</span>{post.sourceName && <span>· 출처 {post.sourceName}</span>}</div>
          <h1 className="text-3xl font-black text-white mb-8">{post.title}</h1>
          {(post.images?.length || post.image) && <ImageCarousel images={post.images || (post.image ? [post.image] : [])} alt={post.title} className="mb-8 max-h-[32rem] rounded-2xl" />}
          <div className="whitespace-pre-wrap text-slate-200 leading-8">{post.body}</div>
          <EditorialBlocks value={post.editorial} />
          {(canEdit || canDelete) && <div className="mt-10 flex flex-wrap gap-2 pt-5">{canEdit && <button onClick={() => setEditing(true)} className="article-mosaic-tile px-4 py-2 text-sm font-bold text-teal-200">수정</button>}{canDelete && <button onClick={() => void removePost()} className="article-mosaic-tile px-4 py-2 text-sm font-bold text-rose-300">삭제</button>}</div>}
      </div>
      {editing && user && canEdit && <WriterComposer userId={user.id} editing initial={{ title: post.title, body: post.body, images: post.images || (post.image ? [post.image] : []), editorial: normalizeEditorial(post.editorial) }} onClose={() => setEditing(false)} onSave={saveEdit} />}
    </article>
  );
}
