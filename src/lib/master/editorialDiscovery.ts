import { CONTENT_SOURCES, type ContentSource } from '../contentSources';
import { editorialUrl, photoLicense, type EditorialContent, type EditorialPhoto } from '../editorialContent';

const plain = (html: string) => html.replace(/<(script|style|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp|quot|lt|gt);/g, (entity) => ({ '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>' }[entity] || '')).replace(/\s+/g, ' ').trim();

export function sourceAllowsUrl(value: string, source: ContentSource): boolean {
  try {
    const url = new URL(value);
    const root = new URL(source.url);
    // Exact origin; shared-host sources are additionally confined to their registered path.
    const scope = root.pathname.endsWith('index.do') ? root.pathname.slice(0, root.pathname.lastIndexOf('/') + 1) : root.pathname.replace(/\/$/, '');
    return Boolean(editorialUrl(value)) && url.origin === root.origin && !url.hash && !/%(?:2f|5c|25)/i.test(url.pathname) && !value.includes('\\')
      && (!scope || scope === '/' || url.pathname === scope || url.pathname.startsWith(`${scope.replace(/\/$/, '')}/`));
  } catch { return false; }
}

// The deadline includes headers AND the body, even if a fetch implementation ignores abort.
export async function fetchEditorialText(url: string, init: RequestInit, fetcher: typeof fetch = fetch, maxBytes = 256_000, timeoutMs = 45_000, contentType = 'application/json'): Promise<string> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new DOMException('Editorial request timed out', 'TimeoutError')); }, timeoutMs);
  });
  try {
    return await Promise.race([expired, (async () => {
      const response = await fetcher(url, { ...init, redirect: 'manual', cache: 'no-store', signal: controller.signal });
      if (controller.signal.aborted || !response.ok || response.redirected || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== contentType || Number(response.headers.get('content-length')) > maxBytes || !response.body) {
        void response.body?.cancel().catch(() => {});
        throw new Error('Editorial upstream unavailable');
      }
      reader = response.body.getReader();
      const charset = response.headers.get('content-type')?.match(/charset=["']?([^\s;"']+)/i)?.[1] || 'utf-8';
      const decoder = new TextDecoder(charset);
      const chunks: string[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new Error('Editorial response too large');
        chunks.push(decoder.decode(value, { stream: true }));
      }
      return chunks.join('') + decoder.decode();
    })()]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    // Do not await cancellation: a hostile or stalled stream can also stall cancel().
    void reader?.cancel().catch(() => {});
  }
}

async function readSource(url: string, source: ContentSource, fetcher: typeof fetch): Promise<string> {
  if (!sourceAllowsUrl(url, source)) throw new Error('Source URL outside registry scope');
  return fetchEditorialText(url, { headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; GYOPO editorial verifier/1.0)' } }, fetcher, 750_000, 6000, 'text/html');
}

export function extractEditorialPage(html: string, url: string, source: ContentSource) {
  const title = plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || source.name).slice(0, 200);
  const main = html.match(/<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i)?.[1] || html;
  const text = plain(main);
  const blocked = /^(?:access denied|just a moment|attention required|request rejected)|enable javascript (?:and cookies )?to continue|verify (?:that )?you are (?:a )?human|checking your browser/i.test(`${title} ${text}`);
  const excerpt = blocked ? '' : text.slice(0, 8000);
  const photos: EditorialPhoto[] = [];
  // Only image-level explicit supported licenses, never an og:image or an article-level license.
  const walk = (value: unknown, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 8 || photos.length >= 4) return;
    if (Array.isArray(value)) { value.slice(0, 30).forEach((item) => walk(item, depth + 1)); return; }
    const row = value as Record<string, unknown>;
    if (row['@type'] === 'ImageObject') {
      const image = editorialUrl(row.contentUrl);
      const license = photoLicense(row.license);
      const creator = typeof row.creator === 'string' ? plain(row.creator) : row.creator && typeof row.creator === 'object' ? plain(String((row.creator as Record<string, unknown>).name || '')) : '';
      if (image && license && creator) photos.push({ url: image, caption: plain(String(row.caption || row.name || title)).slice(0, 240), creator: creator.slice(0, 160), license, sourceUrl: url });
    }
    Object.values(row).slice(0, 40).forEach((item) => walk(item, depth + 1));
  };
  for (const script of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(script[1])); } catch { /* Invalid publisher metadata is not evidence. */ }
  }
  return { source: { title, url, publisher: source.name, retrievedAt: new Date().toISOString(), excerpt }, photos };
}

export async function discoverEditorial(query: string, region: string, officialOnly = false, fetcher: typeof fetch = fetch, referenceUrls: string[] = []): Promise<EditorialContent> {
  const tokens = [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [])].slice(0, 20);
  const score = (text: string) => tokens.reduce((total, token) => total + (text.toLocaleLowerCase().includes(token) ? 1 : 0), 0);
  const eligible = CONTENT_SOURCES.filter((source) => {
    const local = source.region === region || source.regions?.some((item) => item === region);
    return officialOnly ? local && source.trust === 'official' && (source.kind === 'government' || source.id === 'busan-film-festival') : local || source.region === 'Global' && !source.regions?.length;
  });
  const topicPaths = new Map(eligible.map((source) => [source.id, (source.crawlPaths || []).flatMap((entry) => {
    const relevance = score(entry.label);
    if (!relevance) return [];
    try {
      const url = new URL(entry.path, source.url).href;
      return sourceAllowsUrl(url, source) ? [{ url, relevance }] : [];
    } catch { return []; }
  }).sort((a, b) => b.relevance - a.relevance).filter((entry, index, all) => all.findIndex((item) => item.url === entry.url) === index).slice(0, 2)]));
  const matchedTopicUrls = new Set([...topicPaths.values()].flat().map((entry) => entry.url));
  const candidates = referenceUrls.length ? referenceUrls.slice(0, 6).flatMap((url) => {
    const source = eligible.find(item => sourceAllowsUrl(url, item));
    return source ? [{ ...source, url: new URL(url).href }] : [];
  }).filter((source, index, all) => all.findIndex((item) => item.url === source.url) === index)
    : eligible.sort((a, b) => (topicPaths.get(b.id)?.[0]?.relevance || 0) - (topicPaths.get(a.id)?.[0]?.relevance || 0) || Number(b.region === region) - Number(a.region === region) || score(`${b.name} ${b.note}`) - score(`${a.name} ${a.note}`)).slice(0, 3);
  const pages = (await Promise.all(candidates.map(async (source) => {
    try {
      if (!referenceUrls.length) {
        // Verified topic labels bridge Korean requests to English pages without requiring homepage links.
        const direct = (await Promise.all((topicPaths.get(source.id) || []).map(async ({ url }) => {
          try { return extractEditorialPage(await readSource(url, source, fetcher), url, source); } catch { return null; }
        }))).filter((page) => page !== null).filter((page) => page.source.excerpt.length >= 80);
        if (direct.length) return direct;
      }
      const html = await readSource(source.url, source, fetcher);
      if (referenceUrls.length) return [extractEditorialPage(html, source.url, source)];
      const links = new Map<string, number>();
      for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        try {
          const url = new URL(match[1].replace(/&amp;/g, '&'), source.url).href;
          const relevance = score(plain(match[2]));
          if (relevance && sourceAllowsUrl(url, source) && url !== source.url && !/\.(?:pdf|zip|jpg|png)(?:\?|$)/i.test(url)) links.set(url, relevance);
        } catch { /* Ignore malformed source links. */ }
      }
      const details = await Promise.all([...links].sort((a, b) => b[1] - a[1]).slice(0, 2).map(async ([url]) => {
        try { return extractEditorialPage(await readSource(url, source, fetcher), url, source); } catch { return null; }
      }));
      return [extractEditorialPage(html, source.url, source), ...details.filter((page) => page !== null)];
    } catch { return []; }
  }))).flat().filter((page) => page.source.excerpt.length >= 80 && (referenceUrls.length || matchedTopicUrls.has(page.source.url) || score(`${page.source.title} ${page.source.excerpt}`) > 0))
    .sort((a, b) => score(b.source.excerpt) - score(a.source.excerpt)).slice(0, 4);
  const photos = pages.flatMap((page) => page.photos).filter((photo, index, all) => all.findIndex((item) => item.url === photo.url) === index).slice(0, 4);
  return {
    sources: pages.map((page) => page.source), photos, tables: [], contacts: [],
    guidance: [
      '표의 수치·단위·기준일과 연락처를 연결된 원문에서 다시 확인하세요. 검색 지표는 검색량·CPC를 대신하지 않습니다.',
      '출처 자동 탐색은 등록된 사이트의 공개 HTML과 관련 링크만 확인합니다. 전체 웹 검색이나 사실 검증 완료를 뜻하지 않습니다.',
      ...(!pages.length ? ['원문을 읽지 못했습니다. 접근 거부·리디렉션·시간/크기 제한·정적 HTML 본문 부재 또는 관련 자료 부재를 확인하세요. 스크립트 실행 결과나 검색 요약을 원문으로 대체하지 않습니다.'] : []),
      ...(photos.length ? ['사진의 원문·저작자·라이선스를 유지하고 인물·상표 등 별도 권리를 검토하세요.'] : ['지원되는 이미지별 CC 라이선스와 저작자 정보가 없어 사진을 첨부하지 않았습니다. 사용 권한을 확인한 사진을 직접 추가하세요.']),
    ],
  };
}
