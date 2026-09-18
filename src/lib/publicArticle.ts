import { getRegionalCategory, type RegionalCategory } from './regionRoutes';

export function isPublicArticle(record: { status?: unknown; deleted?: unknown; isPublic?: unknown; sourceSnapshot?: unknown; expiresAt?: unknown }): boolean {
  const status = typeof record.status === 'string' ? record.status.trim().toLowerCase() : '';
  return !record.sourceSnapshot && record.deleted !== true && record.isPublic !== false && !record.expiresAt
    && !['draft', 'private', 'deleted', 'hidden', 'pending'].includes(status);
}

// These topic values already exist in the community filters and older stored posts.
export const COMMUNITY_POST_TYPES = ['general', 'notice', 'community', 'question', 'qna', 'life', 'living', 'info', 'information', 'review', 'free', '질문', '생활', '정보', '후기', '자유'];

export function publicArticleCategory(collection: string, record: { type?: unknown; sourceCategory?: unknown }): RegionalCategory | undefined {
  if (collection === 'jobs') return 'jobs';
  if (collection === 'directories') return record.type === 'food' || record.sourceCategory === 'food' ? 'food' : 'directory';
  if (collection === 'marketItems') return 'market';
  if (collection !== 'posts') return undefined;
  const sourceCategory = typeof record.sourceCategory === 'string' ? record.sourceCategory.trim() : '';
  const type = typeof record.type === 'string' ? record.type.trim() : '';
  // Imports historically used type: news for events; their explicit source category wins.
  if (sourceCategory) return getRegionalCategory(sourceCategory)?.slug;
  return getRegionalCategory(type)?.slug || (!type || COMMUNITY_POST_TYPES.includes(type) ? 'community' : undefined);
}
