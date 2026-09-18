import { normalizeEditorial } from '../editorialContent';
import { canonicalEditorialJson, EDITORIAL_BATCH_LIMIT, EDITORIAL_COUNTRY_LIMIT, editorialIdentity, validateEditorialArticle, type EditorialArticle } from './editorialPublishing';

export type EditorialDeskEntry = { article: EditorialArticle; reviewed: boolean; status: 'draft' | 'publishing' | 'published' | 'error'; error: string; id?: string; attempted?: boolean };

export function newEditorialArticle(country: string, keyword = ''): EditorialArticle {
  const seed = keyword.trim();
  return { key: crypto.randomUUID(), country, category: 'community', topic: seed, keyword: seed, title: seed, summary: seed ? `${seed} 관련 공식 자료를 확인하고 교민에게 필요한 절차와 주의점을 정리합니다.` : '', body: '', seoTitle: seed, metaDescription: '', tags: seed ? [seed] : [], editorial: normalizeEditorial(null) };
}

export function mergeEditorialEntries(entries: EditorialDeskEntry[], articles: EditorialArticle[]): EditorialDeskEntry[] {
  const next = [...entries];
  for (const article of articles) {
    const existing = next.find((entry) => editorialIdentity(entry.article) === editorialIdentity(article));
    if (existing) {
      if (canonicalEditorialJson(existing.article) !== canonicalEditorialJson(article)) throw new Error(`${article.key}: 기존 편집 내용과 다릅니다. 기존 작업을 먼저 확인하세요. 덮어쓰지 않았습니다.`);
      continue;
    }
    next.push({ article, reviewed: false, status: 'draft', error: '' });
  }
  if (next.length > EDITORIAL_BATCH_LIMIT) throw new Error(`작업대에는 최대 ${EDITORIAL_BATCH_LIMIT}개 기사를 보관할 수 있습니다. 완료한 작업을 내보낸 뒤 정리하세요.`);
  for (const country of new Set(next.map((entry) => entry.article.country))) {
    if (next.filter((entry) => entry.article.country === country).length > EDITORIAL_COUNTRY_LIMIT) throw new Error(`${country}: 작업대 국가별 최대 ${EDITORIAL_COUNTRY_LIMIT}개입니다.`);
  }
  return next;
}

// Local drafts can be incomplete. Validate their shape without trimming or discarding edits.
export function restoreEditorialEntries(raw: string): EditorialDeskEntry[] {
  const data = JSON.parse(raw);
  if (data?.version !== 1 || !Array.isArray(data.entries) || data.entries.length > EDITORIAL_BATCH_LIMIT) throw new Error('저장된 작업대 형식이 잘못되었습니다.');
  const strings = (value: unknown): boolean => Array.isArray(value) && value.every((item) => typeof item === 'string');
  const records = (value: unknown, fields: string[]): boolean => Array.isArray(value) && value.every((item) => item && fields.every((field) => typeof item[field] === 'string'));
  const entries = data.entries.map((entry: EditorialDeskEntry) => {
    const article = entry?.article;
    const editorial = article?.editorial;
    if (!article || !['key', 'country', 'category', 'topic', 'keyword', 'title', 'summary', 'body', 'seoTitle', 'metaDescription'].every((field) => typeof article[field as keyof EditorialArticle] === 'string') || !strings(article.tags)
      || !editorial || !records(editorial.sources, ['title', 'url', 'publisher', 'retrievedAt', 'excerpt']) || !records(editorial.photos, ['url', 'caption', 'creator', 'license', 'sourceUrl'])
      || !records(editorial.contacts, ['label', 'value', 'sourceUrl']) || !strings(editorial.guidance) || !Array.isArray(editorial.tables)
      || !editorial.tables.every((table) => table && typeof table.title === 'string' && typeof table.sourceUrl === 'string' && strings(table.columns) && Array.isArray(table.rows) && table.rows.every(strings))
      || !['draft', 'publishing', 'published', 'error'].includes(entry.status) || typeof entry.error !== 'string') throw new Error('저장된 기사 형식을 확인할 수 없습니다.');
    if (entry.status === 'published' && !/^editorial-[a-f0-9]{64}$/.test(entry.id || '')) throw new Error('저장된 게시 확인 ID가 잘못되었습니다.');
    let reviewed = entry.reviewed === true;
    try { if (reviewed) validateEditorialArticle(article); } catch { reviewed = false; }
    return { ...entry, reviewed, ...(entry.status === 'publishing' ? { status: 'error' as const, error: '이전 게시 확인이 중단되었습니다. 같은 기사로 재시도하면 중복 없이 확인합니다.' } : {}) };
  });
  const identities = entries.map((entry: EditorialDeskEntry) => editorialIdentity(entry.article));
  if (new Set(identities).size !== identities.length) throw new Error('저장된 기사 key가 중복되었습니다.');
  return mergeEditorialEntries(entries, []);
}
