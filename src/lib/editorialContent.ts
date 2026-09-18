export type EditorialSource = { title: string; url: string; publisher: string; retrievedAt: string; excerpt: string };
export type EditorialPhoto = { url: string; caption: string; creator: string; license: string; sourceUrl: string };
export type EditorialTable = { title: string; columns: string[]; rows: string[][]; sourceUrl: string };
export type EditorialContact = { label: string; value: string; sourceUrl: string };
export type EditorialContent = { sources: EditorialSource[]; photos: EditorialPhoto[]; tables: EditorialTable[]; contacts: EditorialContact[]; guidance: string[] };

export const editorialText = (value: unknown, limit = 500): string => typeof value === 'string' ? [...value.trim()].slice(0, limit).join('') : '';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

// This is a display validator, not permission to fetch a URL on the server.
export function editorialUrl(value: unknown): string {
  try {
    const url = new URL(editorialText(value, 2000));
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.includes('.') || /^(?:\d|\[)/.test(url.hostname) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)) return '';
    return url.href;
  } catch { return ''; }
}

export function photoLicense(value: unknown): string {
  const url = editorialUrl(value);
  return /^https:\/\/creativecommons\.org\/(?:licenses\/by(?:-sa)?\/4\.0|publicdomain\/zero\/1\.0)\/?$/.test(url) ? url : '';
}

export function normalizeEditorial(value: unknown): EditorialContent {
  const data = object(value);
  const sources = list(data.sources).slice(0, 6).map((entry) => {
    const row = object(entry);
    return { title: editorialText(row.title, 200), url: editorialUrl(row.url), publisher: editorialText(row.publisher, 160), retrievedAt: editorialText(row.retrievedAt, 40), excerpt: editorialText(row.excerpt, 8000) };
  }).filter((row) => row.url && row.title);
  const photos = list(data.photos).slice(0, 4).map((entry) => {
    const row = object(entry);
    return { url: editorialUrl(row.url), caption: editorialText(row.caption, 240), creator: editorialText(row.creator, 160), license: photoLicense(row.license), sourceUrl: editorialUrl(row.sourceUrl) };
  }).filter((row) => row.url && row.creator && row.license && row.sourceUrl);
  const tables = list(data.tables).slice(0, 4).map((entry) => {
    const row = object(entry);
    const columns = list(row.columns).slice(0, 6).map((cell) => editorialText(cell, 100));
    const rows = list(row.rows).slice(0, 20).map((cells) => list(object(cells).cells ?? cells).slice(0, 6).map((cell) => editorialText(cell, 300))).filter((cells) => cells.length === columns.length);
    return { title: editorialText(row.title, 160), columns, rows, sourceUrl: editorialUrl(row.sourceUrl) };
  }).filter((row) => row.columns.length > 0 && row.columns.every(Boolean) && row.rows.length > 0 && row.sourceUrl);
  const contacts = list(data.contacts).slice(0, 10).map((entry) => {
    const row = object(entry);
    return { label: editorialText(row.label, 100), value: editorialText(row.value, 300), sourceUrl: editorialUrl(row.sourceUrl) };
  }).filter((row) => row.label && row.value && row.sourceUrl);
  return { sources, photos, tables, contacts, guidance: list(data.guidance).slice(0, 10).map((row) => editorialText(row)).filter(Boolean) };
}

// AI may organize evidence, but it cannot supply its own sources, photos or data cells.
export function groundEditorial(value: unknown, evidence: EditorialContent): EditorialContent {
  const proposed = normalizeEditorial(value);
  const includes = (url: string, text: string) => Boolean(text && evidence.sources.find((source) => source.url === url)?.excerpt.includes(text));
  const result = {
    ...evidence,
    tables: proposed.tables.filter((table) => !hasUnsupportedFacts([table.title, ...table.columns].join(' '), evidence.sources) && table.rows.every((row) => row.every((cell) => includes(table.sourceUrl, cell)))),
    contacts: proposed.contacts.filter((contact) => !hasUnsupportedFacts(contact.label, evidence.sources) && includes(contact.sourceUrl, contact.value)),
    guidance: [...evidence.guidance, ...proposed.guidance].slice(0, 10),
  };
  if (!result.tables.length) result.guidance.push('원문과 일치하는 표·수치 자료가 없어 표를 비워 두었습니다. 관련 자료의 단위·기준일을 확인한 뒤 추가하세요.');
  if (!result.contacts.length) result.guidance.push('원문과 일치하는 연락처 자료가 없어 연락처를 비워 두었습니다. 전화·주소·이메일을 공식 원문에서 확인하세요.');
  return result;
}

export function editorialValidationError(value: EditorialContent): string {
  const normalized = normalizeEditorial(value);
  if (normalized.sources.length !== value.sources.length || normalized.photos.length !== value.photos.length || normalized.tables.length !== value.tables.length || normalized.contacts.length !== value.contacts.length
    || value.tables.some((table) => table.rows.length > 20 || table.columns.length > 6 || table.rows.some((row) => row.length !== table.columns.length || row.some((cell) => !cell.trim())))
    || value.tables.some((table) => !value.sources.some((source) => source.url === table.sourceUrl))
    || value.contacts.some((contact) => !value.sources.some((source) => source.url === contact.sourceUrl))) {
    return '출처 제목·HTTPS URL, 표의 빈 셀, 연락처와 연결 출처를 확인해주세요. 미완성 자료는 삭제하거나 완성한 뒤 저장하세요.';
  }
  return '';
}

export function editorialForStorage(value: unknown) {
  const data = normalizeEditorial(value);
  // Firestore rejects arrays directly nested inside arrays.
  return { ...data, tables: data.tables.map((table) => ({ ...table, rows: table.rows.map((cells) => ({ cells })) })) };
}

export function hasUnsupportedFacts(text: string, sources: EditorialSource[]): boolean {
  const evidence = sources.map((source) => `${source.excerpt} ${source.url}`).join('\n');
  const numbers = text.match(/\d+(?:[.,:/-]\d+)*%?/g) || [];
  const knownNumbers = new Set(evidence.match(/\d+(?:[.,:/-]\d+)*%?/g) || []);
  const urls = text.match(/https?:\/\/[^\s<>"')]+/g) || [];
  const emails = text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) || [];
  return numbers.some((number) => !knownNumbers.has(number)) || urls.some((url) => !sources.some((source) => source.url === url)) || emails.some((email) => !evidence.includes(email));
}
