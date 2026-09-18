import { getDocument, getSessionToken } from '@/lib/firebase';
import { POST_COLLECTIONS, isPostCollection, postThreadKey, type PostCollection } from '@/lib/comments';
import { sourceItemId } from '@/lib/contentSources';
import { isPublicArticle, publicArticleCategory } from '@/lib/publicArticle';
import { isRegionalPostId } from '@/lib/regionRoutes';

type ContentRecord = {
  id: string;
  title?: string;
  name?: string;
  body?: string;
  desc?: string;
  description?: string;
  summary?: string;
  image?: string;
  images?: string[];
  editorial?: unknown;
  sourceUrl?: string;
  sourceId?: string;
  sourceContentId?: string;
  sourceName?: string;
  sourceCategory?: string;
  authorId?: string;
  authorName?: string;
  author?: string;
  type?: string;
  country?: string;
  location?: string;
  company?: string;
  salary?: string;
  price?: string;
  address?: string;
  tel?: string;
  createdAt?: string;
  status?: string;
  deleted?: boolean;
  isPublic?: boolean;
  sourceSnapshot?: boolean;
  expiresAt?: unknown;
};

export type ResolvedContent = ContentRecord & { collection: PostCollection | 'source'; threadKey: string };
type SourceItem = Omit<ContentRecord, 'id'> & { title: string; url: string; publishedAt?: string; phone?: string };

async function findLiveContent(id: string, sourceId: string, category: string, sourceUrl: string): Promise<ResolvedContent | null> {
  if (!['news', 'directory', 'jobs', 'market', 'events', 'community'].includes(category) || sourceItemId(sourceId, category, sourceUrl) !== id) return null;
  const query = sourceId.startsWith('regional-')
    ? `region=${encodeURIComponent(sourceId.replace(/^regional-/, ''))}`
    : `source=${encodeURIComponent(sourceId)}&category=${encodeURIComponent(category)}`;
  const response = await fetch(`/api/content/preview?${query}`);
  if (!response.ok) throw new Error('Source unavailable');
  const snapshot = await response.json() as { sourceName?: string; region?: string; fetchedAt?: string; items?: SourceItem[]; sections?: Array<{ category: string; items: SourceItem[] }> };
  if (!snapshot || (!Array.isArray(snapshot.items) && !Array.isArray(snapshot.sections))) throw new Error('Invalid source response');
  const entries = [...(snapshot.items || []), ...(snapshot.sections || []).filter((section) => section.category === category).flatMap((section) => section.items)];
  const entry = entries.find((item) => item.url === sourceUrl);
  if (!entry || !isPublicArticle(entry)) return null;
  return { ...entry, id, collection: 'source', threadKey: postThreadKey('source', id), sourceId, sourceContentId: id, body: entry.body || '', description: entry.description || '', tel: entry.tel || entry.phone, sourceName: snapshot.sourceName, country: entry.country || snapshot.region, sourceCategory: category, sourceUrl: entry.url, createdAt: entry.publishedAt || snapshot.fetchedAt };
}

export async function findContent(id: string, requestedCollection: string | null, sourceId: string | null, category: string | null, sourceUrl: string | null): Promise<ResolvedContent | null> {
  if (!isRegionalPostId(id) || (requestedCollection !== null && !isPostCollection(requestedCollection))) return null;
  let failure: unknown;
  const token = getSessionToken();
  const collections = requestedCollection && isPostCollection(requestedCollection) ? [requestedCollection] : POST_COLLECTIONS;
  // Published records are authoritative even when a rolling source feed drops or changes an item.
  for (const collection of collections) {
    const record = await getDocument<Omit<ContentRecord, 'id'>>(collection, id, token).catch((error: unknown) => { failure = error; return null; });
    if (record) {
      if (!isPublicArticle(record)) return null;
      const sourceContentId = record.sourceContentId || (record.sourceId ? id : undefined);
      return { ...record, id, collection, threadKey: postThreadKey(collection, id, sourceContentId), sourceCategory: publicArticleCategory(collection, record) || record.sourceCategory };
    }
  }
  if (!requestedCollection && sourceId && category && sourceUrl) {
    const live = await findLiveContent(id, sourceId, category, sourceUrl).catch((error: unknown) => { failure = error; return null; });
    if (live) return live;
  }
  if (failure) throw failure;
  return null;
}
