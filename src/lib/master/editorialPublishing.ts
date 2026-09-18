import { editorialUrl, photoLicense, type EditorialContent } from '../editorialContent';
import { COUNTRY_ROUTES, REGIONAL_CATEGORIES, getCountryRoute } from '../regionRoutes';

export const OPERATOR_BYLINE = '운영자';
export const EDITORIAL_BODY_LIMIT = 12_000;
export const EDITORIAL_COUNTRY_LIMIT = 15;
export const EDITORIAL_BATCH_LIMIT = 60;
export const EDITORIAL_IMPORT_LIMIT = 4_000_000;
export const EDITORIAL_CATEGORIES = REGIONAL_CATEGORIES.filter((item) => !['jobs', 'directory', 'market'].includes(item.slug));
export { COUNTRY_ROUTES as EDITORIAL_COUNTRIES };

export type EditorialArticle = {
  key: string;
  country: string;
  category: string;
  topic: string;
  keyword: string;
  title: string;
  summary: string;
  body: string;
  seoTitle: string;
  metaDescription: string;
  tags: string[];
  editorial: EditorialContent;
};
export type EditorialBatch = { version: 1; articles: EditorialArticle[] };

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: 객체가 필요합니다.`);
  return value as Record<string, unknown>;
}

function keys(row: Record<string, unknown>, allowed: string[], path: string) {
  const extra = Object.keys(row).find((key) => !allowed.includes(key));
  if (extra) throw new Error(`${path}.${extra}: 지원하지 않는 필드입니다.`);
}

function text(value: unknown, path: string, max: number, min = 1): string {
  if (typeof value !== 'string' || [...value.trim()].length < min || [...value.trim()].length > max) throw new Error(`${path}: ${min}~${max}자의 문자열을 입력하세요.`);
  return value.trim();
}

function list(value: unknown, path: string, max: number, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${path}: ${min}~${max}개 배열이 필요합니다.`);
  return value;
}

function url(value: unknown, path: string): string {
  const result = editorialUrl(text(value, path, 2000));
  if (!result) throw new Error(`${path}: 공개 HTTPS URL을 입력하세요.`);
  return result;
}

export function validateEditorialArticle(value: unknown): EditorialArticle {
  const row = object(value, 'article');
  keys(row, ['key', 'country', 'category', 'topic', 'keyword', 'title', 'summary', 'body', 'seoTitle', 'metaDescription', 'tags', 'editorial'], 'article');
  const key = text(row.key, 'key', 80);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(key)) throw new Error('key: 영문·숫자로 시작하는 영문·숫자·밑줄·하이픈만 사용하세요.');
  const country = getCountryRoute(text(row.country, 'country', 80));
  if (!country) throw new Error('country: 지원하는 국가 ID 또는 국가 코드를 선택하세요.');
  const category = text(row.category, 'category', 40);
  if (!EDITORIAL_CATEGORIES.some((item) => item.slug === category)) throw new Error('category: 지원하는 기사 카테고리를 선택하세요. 채용·업소·판매 등록은 전용 양식을 사용하세요.');
  const data = object(row.editorial, 'editorial');
  keys(data, ['sources', 'photos', 'tables', 'contacts', 'guidance'], 'editorial');
  const sources = list(data.sources, 'sources', 6, 1).map((entry, index) => {
    const source = object(entry, `sources[${index}]`);
    keys(source, ['title', 'url', 'publisher', 'retrievedAt', 'excerpt'], 'source');
    const retrievedAt = text(source.retrievedAt, 'source.retrievedAt', 40);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(retrievedAt) || !Number.isFinite(Date.parse(retrievedAt)) || new Date(retrievedAt).toISOString().slice(0, 19) !== retrievedAt.slice(0, 19)) throw new Error('source.retrievedAt: 실제 확인 시각을 UTC ISO 형식으로 입력하세요.');
    return { title: text(source.title, 'source.title', 200), url: url(source.url, 'source.url'), publisher: text(source.publisher, 'source.publisher', 160), retrievedAt, excerpt: text(source.excerpt, 'source.excerpt', 8000) };
  });
  if (new Set(sources.map((source) => source.url)).size !== sources.length) throw new Error('sources: 동일한 URL이 중복되었습니다.');
  const sourceUrl = (value: unknown) => {
    const result = url(value, 'sourceUrl');
    if (!sources.some((source) => source.url === result)) throw new Error('표·연락처의 sourceUrl은 sources에 등록된 URL이어야 합니다.');
    return result;
  };
  const photos = list(data.photos ?? [], 'photos', 4).map((entry) => {
    const photo = object(entry, 'photo');
    keys(photo, ['url', 'caption', 'creator', 'license', 'sourceUrl'], 'photo');
    const license = photoLicense(text(photo.license, 'photo.license', 2000));
    if (!license) throw new Error('photo.license: 이미지별 CC BY 4.0, CC BY-SA 4.0 또는 CC0 1.0 URL이 필요합니다.');
    return { url: url(photo.url, 'photo.url'), caption: text(photo.caption, 'photo.caption', 240), creator: text(photo.creator, 'photo.creator', 160), license, sourceUrl: url(photo.sourceUrl, 'photo.sourceUrl') };
  });
  const tables = list(data.tables ?? [], 'tables', 4).map((entry) => {
    const table = object(entry, 'table');
    keys(table, ['title', 'columns', 'rows', 'sourceUrl'], 'table');
    const columns = list(table.columns, 'table.columns', 6, 1).map((cell) => text(cell, 'column', 100));
    const rows = list(table.rows, 'table.rows', 20, 1).map((cells) => list(cells, 'table.row', columns.length, columns.length).map((cell) => text(cell, 'cell', 300)));
    return { title: text(table.title, 'table.title', 160), columns, rows, sourceUrl: sourceUrl(table.sourceUrl) };
  });
  const contacts = list(data.contacts ?? [], 'contacts', 10).map((entry) => {
    const contact = object(entry, 'contact');
    keys(contact, ['label', 'value', 'sourceUrl'], 'contact');
    return { label: text(contact.label, 'contact.label', 100), value: text(contact.value, 'contact.value', 300), sourceUrl: sourceUrl(contact.sourceUrl) };
  });
  return {
    key, country: country.id, category, topic: text(row.topic, 'topic', 120), keyword: text(row.keyword ?? '', 'keyword', 160, 0),
    title: text(row.title, 'title', 120), summary: text(row.summary, 'summary', 600), body: text(row.body, 'body', EDITORIAL_BODY_LIMIT, 80),
    seoTitle: text(row.seoTitle ?? '', 'seoTitle', 70, 0), metaDescription: text(row.metaDescription ?? '', 'metaDescription', 160, 0),
    tags: list(row.tags ?? [], 'tags', 8).map((tag) => text(tag, 'tag', 60)),
    editorial: { sources, photos, tables, contacts, guidance: list(data.guidance ?? [], 'guidance', 10).map((item) => text(item, 'guidance', 500)) },
  };
}

export function validateEditorialBatch(value: unknown): EditorialBatch {
  const batch = object(value, 'batch');
  keys(batch, ['version', 'articles'], 'batch');
  if (batch.version !== 1) throw new Error('batch.version: 1이어야 합니다.');
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  const articles = list(batch.articles, 'articles', EDITORIAL_BATCH_LIMIT, 1).map((value, index) => {
    try {
      const article = validateEditorialArticle(value);
      const identity = editorialIdentity(article);
      if (seen.has(identity)) throw new Error('동일 국가의 key가 중복되었습니다.');
      seen.add(identity);
      const count = (counts.get(article.country) || 0) + 1;
      if (count > EDITORIAL_COUNTRY_LIMIT) throw new Error(`국가별 최대 ${EDITORIAL_COUNTRY_LIMIT}개입니다.`);
      counts.set(article.country, count);
      return article;
    } catch (error) { throw new Error(`articles[${index}]: ${error instanceof Error ? error.message : '잘못된 기사입니다.'}`); }
  });
  return { version: 1, articles };
}

export function editorialIdentity(article: Pick<EditorialArticle, 'country' | 'key'>) {
  return `${article.country}:${article.key}`;
}

export function editorialStorageKey(uid: string) { return `gyopo-editorial-desk:v1:${uid}`; }

export function canonicalEditorialJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalEditorialJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalEditorialJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function editorialDigest(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalEditorialJson(value)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
