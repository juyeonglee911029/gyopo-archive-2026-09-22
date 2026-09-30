import { CONTENT_SOURCES } from '@/lib/contentSources';
import type { ContentCategory, ContentSource } from '@/lib/contentSources';
import { curateSourceItems, normalizeSourceBody, normalizeSourceText, normalizeSourceTitle, normalizeSourceUrl } from '@/lib/sourcepreview';
import type { LiveSourceItem } from '@/lib/sourcepreview';
import { SITE_URL } from '@/lib/seo';
import { REGIONS } from '@/lib/regions';
import { clientAddress, consumeRateLimit, rateLimitResponse } from '@/lib/apiSecurity';

export const runtime = 'edge';

type MarketAsset = { key: string; label: string; symbol: string; currency: string };
type YahooChart = { meta?: { regularMarketPrice?: number; chartPreviousClose?: number; currency?: string } };
type CryptoQuote = { quotes?: { USD?: { price?: number; percent_change_24h?: number } } };
type CoinGeckoQuote = Record<string, { usd?: number; usd_24h_change?: number }>;
type BinanceQuote = { lastPrice?: string; priceChangePercent?: string };
type CoinbaseQuote = { data?: { amount?: string } };

const marketAssets: MarketAsset[] = [
  { key: 'bitcoin', label: 'BTC', symbol: 'bitcoin', currency: 'USD' },
  { key: 'ethereum', label: 'ETH', symbol: 'ethereum', currency: 'USD' },
  { key: 'ripple', label: 'XRP', symbol: 'ripple', currency: 'USD' },
  { key: 'solana', label: 'SOL', symbol: 'solana', currency: 'USD' },
  { key: 'hynix', label: 'SK Hynix', symbol: '000660.KS', currency: 'KRW' },
  { key: 'samsung', label: 'Samsung', symbol: '005930.KS', currency: 'KRW' },
  { key: 'nvidia', label: 'NVIDIA', symbol: 'NVDA', currency: 'USD' },
  { key: 'apple', label: 'Apple', symbol: 'AAPL', currency: 'USD' },
  { key: 'kospi', label: 'KOSPI', symbol: '^KS11', currency: 'KRW' },
  { key: 'nasdaq', label: 'NASDAQ', symbol: '^IXIC', currency: 'USD' },
];

async function marketJson<T>(url: string) {
  const response = await fetch(url, { cache: 'no-store', headers: { 'User-Agent': `GYOPO-Market/1.0 (+${SITE_URL})` }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`시세 출처 응답 ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchMarketAsset(asset: MarketAsset) {
  try {
    const result = await marketJson<{ chart?: { result?: YahooChart[] } }>(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.symbol)}?range=1d&interval=1d&includePrePost=false`);
    const meta = result.chart?.result?.[0]?.meta;
    const value = typeof meta?.regularMarketPrice === 'number' ? meta.regularMarketPrice : null;
    const previous = typeof meta?.chartPreviousClose === 'number' ? meta.chartPreviousClose : null;
    return { key: asset.key, label: asset.label, value, change: value !== null && previous ? ((value - previous) / previous) * 100 : null, currency: meta?.currency || asset.currency };
  } catch {
    return { key: asset.key, label: asset.label, value: null, change: null, currency: asset.currency };
  }
}

const cryptoTickers: Record<string, string> = {
  bitcoin: 'btc-bitcoin',
  ethereum: 'eth-ethereum',
  ripple: 'xrp-xrp',
  solana: 'sol-solana',
};
const coinGeckoIds: Record<string, string> = { bitcoin: 'bitcoin', ethereum: 'ethereum', ripple: 'ripple', solana: 'solana' };
const binanceSymbols: Record<string, string> = { bitcoin: 'BTCUSDT', ethereum: 'ETHUSDT', ripple: 'XRPUSDT', solana: 'SOLUSDT' };
const coinbaseSymbols: Record<string, string> = { bitcoin: 'BTC', ethereum: 'ETH', ripple: 'XRP', solana: 'SOL' };

async function fetchCryptoAsset(asset: MarketAsset) {
  try {
    const quote = await marketJson<CryptoQuote>(`https://api.coinpaprika.com/v1/tickers/${cryptoTickers[asset.symbol]}?quotes=USD`);
    const usd = quote.quotes?.USD;
    if (typeof usd?.price === 'number') return { key: asset.key, label: asset.label, value: usd.price, change: usd.percent_change_24h ?? null, currency: asset.currency };
  } catch {
    // Try a second provider below when the primary crypto feed is unavailable.
  }
  try {
    const quote = await marketJson<CoinGeckoQuote>(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinGeckoIds[asset.symbol])}&vs_currencies=usd&include_24hr_change=true`);
    const usd = quote[coinGeckoIds[asset.symbol]];
    if (typeof usd?.usd === 'number') return { key: asset.key, label: asset.label, value: usd.usd, change: usd.usd_24h_change ?? null, currency: asset.currency };
  } catch {
    // Continue to the exchange feed.
  }
  try {
    const quote = await marketJson<BinanceQuote>(`https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSymbols[asset.symbol]}`);
    const value = Number(quote.lastPrice);
    if (Number.isFinite(value)) return { key: asset.key, label: asset.label, value, change: Number(quote.priceChangePercent) || null, currency: asset.currency };
  } catch {
    // Try the spot feed below when the exchange feed is unavailable.
  }
  try {
    const quote = await marketJson<CoinbaseQuote>(`https://api.coinbase.com/v2/prices/${coinbaseSymbols[asset.symbol]}-USD/spot`);
    const value = Number(quote.data?.amount);
    if (Number.isFinite(value)) return { key: asset.key, label: asset.label, value, change: null, currency: asset.currency };
  } catch {
    // Return an explicit empty value so the ticker remains stable.
  }
  return { key: asset.key, label: asset.label, value: null, change: null, currency: asset.currency };
}

async function fetchMarket() {
  const [ratesResult, cryptoResult, equityResults] = await Promise.all([
    marketJson<{ rates?: Record<string, number> }>('https://api.frankfurter.app/latest?from=USD&to=KRW,EUR,JPY,BRL,CAD,GBP').catch(() => ({ rates: {} as Record<string, number> })),
    Promise.all(marketAssets.slice(0, 4).map(fetchCryptoAsset)),
    Promise.all(marketAssets.slice(4).map(fetchMarketAsset)),
  ]);
  return { updatedAt: new Date().toISOString(), rates: ratesResult.rates || {}, assets: [...cryptoResult, ...equityResults] };
}

function clean(value: string | undefined) {
  return (value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(x?[0-9a-f]+);/gi, (_, code: string) => {
      const value = code.toLowerCase().startsWith('x') ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return Number.isNaN(value) ? '' : String.fromCodePoint(value);
    })
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textContent(value: string) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function cleanArticleBody(value: string) {
  const lines = value
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line && !/^(기사 듣기|재생|공유|WhatsApp|TALK|KakaoTalk|f Facebook|링크 복사|AD)$/i.test(line));
  const body = lines.join('\n\n');
  return body
    .replace(/\n\n(?:Story Timeline|이 뉴스의 흐름)[\s\S]*$/i, '')
    .replace(/\n\n(?:SPONSORED(?: · AD)?|AD)\b[\s\S]*$/i, '')
    .trim()
    .slice(0, 16_000);
}

type CrawlItem = LiveSourceItem & { category: ContentCategory };
type StructuredData = { headline?: string; description?: string; articleBody?: string; image?: string[]; datePublished?: string; url?: string };

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: { 'User-Agent': `GYOPO-Content-Crawler/1.0 (+${SITE_URL})` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`출처 응답 ${response.status}`);
  return response.text();
}

function escapePattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function classValues(html: string, className: string) {
  const values: string[] = [];
  const pattern = new RegExp(`<[^>]+class=["'][^"']*${escapePattern(className)}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'gi');
  for (const match of html.matchAll(pattern)) values.push(clean(match[1]));
  return values.filter(Boolean);
}

function classBlock(html: string, className: string, endMarkers: string[]) {
  const start = html.search(new RegExp(`<[^>]+class=["'][^"']*${escapePattern(className)}[^"']*["']`, 'i'));
  if (start < 0) return '';
  const ends = endMarkers.map((marker) => html.indexOf(marker, start + 1)).filter((index) => index > start);
  return html.slice(start, ends.length ? Math.min(...ends) : Math.min(html.length, start + 24_000));
}

function bodyFromBlock(value: string) {
  return normalizeSourceBody(value
    .replace(/<(script|style|noscript|nav|header|footer)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|td|table)>/gi, '\n')
    .replace(/<[^>]*$/g, ' '));
}

function publishedDate(value: string | undefined) {
  const match = normalizeSourceText(value).match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})(?:\D+(\d{1,2})\D+(\d{1,2}))?/);
  if (!match) return undefined;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0))).toISOString();
}

const countryIds: Record<string, string> = {
  독일: 'Germany', 네덜란드: 'Netherlands', 헝가리: 'Hungary', 스페인: 'Spain', 포르투갈: 'Portugal', 루마니아: 'Romania', 몰타: 'Malta', 벨기에: 'Belgium', 폴란드: 'Poland', 프랑스: 'France', 체코: 'Czechia', 슬로바키아: 'Slovakia', 오스트리아: 'Austria', 이탈리아: 'Italy', 튀르키예: 'Turkey', 터키: 'Turkey', 키프로스: 'Cyprus', 태국: 'Thailand', 브라질: 'Brazil',
};

const categoryLabels: Record<ContentCategory, string> = { news: '뉴스', directory: '업소록', jobs: '구인구직', market: '장터', events: '행사', community: '커뮤니티' };

function titleCountry(title: string) {
  const label = title.match(/^\s*\[([^\]]+)]/)?.[1]?.trim();
  return { country: label ? countryIds[label] || label : undefined, location: label };
}

function kbaCompany(title: string) {
  const value = normalizeSourceTitle(title).replace(/^\[[^\]]+]\s*/, '');
  const named = value.match(/^(.+?(?:법인|사무소|무역관|지사|센터|SRL|GmbH|Co\.,?\s*Ltd\.?))/i)?.[1];
  return normalizeSourceText(named || value.split(/[,，]|에서\s/)[0] || 'KBA Europe 등록 기업').replace(/\([^)]*근무[^)]*\)/g, '').trim();
}

function fieldValue(body: string, labels: string[]) {
  const labelPattern = labels.map(escapePattern).join('|');
  const nextField = '(?:회사명|업체명|업종|소재지|근무지|지역|\\[?구인\\s*정보\\]?|주요\\s*업무|필수사항|우대사항|모집(?:직무|인원)?|지원(?:자격|방법)?|급여|연봉|월급|시급|제출|문의|연락처)';
  return normalizeSourceText(body.match(new RegExp(`(?:${labelPattern})\\s*[:：]\\s*([\\s\\S]{2,160}?)(?=${nextField}\\s*[:：-]?|$)`, 'i'))?.[1]);
}

function extractKbaJobs(html: string, pageUrl: string): CrawlItem[] {
  const items: CrawlItem[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(clean(match[1]), pageUrl);
      if (url.pathname !== '/member/eu-job-search/' || url.searchParams.get('mod') !== 'document' || !url.searchParams.get('uid')) continue;
      const title = normalizeSourceTitle(match[2]);
      if (!title || seen.has(url.searchParams.get('uid')!)) continue;
      seen.add(url.searchParams.get('uid')!);
      const place = titleCountry(title);
      items.push({ title, url: normalizeSourceUrl(url.href), category: 'jobs', company: kbaCompany(title), location: place.location || '유럽', country: place.country || 'Global', salary: '원문 확인', tag: normalizeSourceText(title.match(/(?:정규직|계약직|임시직|인턴|경력직|현지\s*채용)/)?.[0] || '채용') });
      if (items.length >= 12) break;
    } catch {
      // Ignore malformed board links.
    }
  }
  return items;
}

async function enrichKbaJobs(items: CrawlItem[]) {
  const enriched = await Promise.all(items.map(async (item) => {
    try {
      const html = await fetchHtml(item.url);
      const bodyHtml = classBlock(html, 'content-view', ['kboard-document-action', 'kboard-attach']);
      const body = bodyFromBlock(bodyHtml);
      const images = extractImages(bodyHtml, item.url);
      const detailValues = classValues(classBlock(html, 'kboard-detail', ['kboard-content']), 'detail-value');
      return { ...item, body, description: body.slice(0, 320), image: images[0], images, publishedAt: publishedDate(detailValues.find((value) => /^20\d{2}/.test(value))) };
    } catch {
      return item;
    }
  }));
  return curateSourceItems(enriched, 'jobs');
}

function extractHanasiaList(html: string, pageUrl: string, category: ContentCategory): CrawlItem[] {
  const records = new Map<string, { index: number; texts: string[] }>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']*\/forum\/view\/(\d+))[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = normalizeSourceTitle(match[3]);
    if (!text) continue;
    const record = records.get(match[2]) || { index: match.index || 0, texts: [] };
    if (!record.texts.includes(text)) record.texts.push(text);
    records.set(match[2], record);
  }
  return [...records.entries()].map(([id, record]) => {
    const title = record.texts[0];
    const description = [...record.texts].sort((a, b) => b.length - a.length).find((value) => value !== title && value.length > title.length + 20);
    const before = html.slice(Math.max(0, record.index - 2_000), record.index);
    const after = html.slice(record.index, record.index + 4_000);
    const boardCategory = classValues(before, 'tpl-forum-list-category').at(-1) || '';
    return {
      title,
      url: new URL(`/forum/view/${id}`, pageUrl).href,
      description,
      body: description,
      category,
      tag: boardCategory,
      author: classValues(after, 'tpl-forum-list-name')[0],
      publishedAt: publishedDate(classValues(after, 'tpl-forum-list-date')[0]),
      country: 'Thailand',
      location: '태국',
    };
  }).filter((item) => item.title.length >= 4).slice(0, 12);
}

async function enrichHanasiaItems(items: CrawlItem[], category: ContentCategory) {
  const enriched = await Promise.all(items.map(async (item) => {
    try {
      const html = await fetchHtml(item.url);
      const bodyHtml = classBlock(html, 'tpl-forum-content', ['tpl-forum-list-footer', 'tpl-forum-pn-row', 'page-comments']);
      const body = bodyFromBlock(bodyHtml) || normalizeSourceBody(meta(html, 'description')) || item.body || '';
      const images = extractImages(bodyHtml, item.url);
      const boardCategory = category === 'jobs' ? classValues(html, 'tpl-forum-category')[0] || item.tag : 'community';
      const author = classValues(html, 'tpl-forum-name')[0] || item.author;
      const titleCompany = normalizeSourceTitle(item.title).match(/^(.+?)(?=\s*(?:한국인\s*)?(?:직원|인재)?\s*(?:채용|구인|모집))/)?.[1];
      const company = category === 'jobs' ? fieldValue(body, ['회사명', '업체명']) || (boardCategory === '구인' ? titleCompany || author : `구직자 · ${author || '한아시아 회원'}`) : undefined;
      const location = category === 'jobs' ? fieldValue(body, ['근무지', '소재지', '지역']) || '태국' : undefined;
      const salary = category === 'jobs' ? fieldValue(body, ['급여', '연봉', '월급', '시급']) || '원문 확인' : undefined;
      return {
        ...item,
        title: classValues(html, 'tpl-forum-title')[0] || item.title,
        body,
        description: body.slice(0, 320),
        author,
        company,
        location,
        salary,
        tag: boardCategory || (category === 'jobs' ? '구인구직' : '커뮤니티'),
        publishedAt: publishedDate(classValues(html, 'tpl-forum-date')[0]) || item.publishedAt,
        image: images[0],
        images,
      };
    } catch {
      return item;
    }
  }));
  return curateSourceItems(enriched, category);
}

async function fetchKbaSource(source: ContentSource) {
  const items = await enrichKbaJobs(extractKbaJobs(await fetchHtml(source.url), source.url));
  return { sourceId: source.id, sourceName: source.name, region: source.region, url: source.url, title: 'KBA Europe EU 채용 공고', description: '유럽한국기업연합회가 게시한 유럽 현지 채용 공고입니다.', items, sections: [{ category: 'jobs' as ContentCategory, label: 'EU 구인구직', url: source.url, items }], status: items.length ? 'ready' : 'unavailable', warnings: items.length ? [] : ['유효한 채용 공고를 찾지 못했습니다.'], fetchedAt: new Date().toISOString(), verified: true };
}

async function fetchHanasiaSource(source: ContentSource, requestedCategory: ContentCategory | null) {
  const paths: Array<{ category: ContentCategory; label: string; path: string }> = requestedCategory
    ? [{ category: requestedCategory, label: requestedCategory === 'jobs' ? '구인구직' : '게시판', path: requestedCategory === 'jobs' ? '/구인구직' : '/게시판' }]
    : [{ category: 'jobs', label: '구인구직', path: '/구인구직' }, { category: 'community', label: '게시판', path: '/게시판' }];
  const sections = await Promise.all(paths.map(async ({ category, label, path }) => {
    const url = new URL(path, source.url).href;
    const list = extractHanasiaList(await fetchHtml(url), url, category);
    return { category, label, url, items: await enrichHanasiaItems(list, category) };
  }));
  const items = requestedCategory ? sections[0]?.items || [] : [];
  const count = sections.reduce((sum, section) => sum + section.items.length, 0);
  return { sourceId: source.id, sourceName: source.name, region: source.region, url: source.url, title: '한아시아 태국 교민 게시판', description: '한아시아 회원이 작성한 실제 구인구직과 선별된 생활 커뮤니티 글입니다.', items, sections, status: count ? 'ready' : 'unavailable', warnings: count ? [] : ['조건에 맞는 게시물을 찾지 못했습니다.'], fetchedAt: new Date().toISOString(), verified: true };
}

async function fetchHaninCommunity(source: ContentSource) {
      const response = await fetch('https://hanintoday.com.br/api/community/posts', { headers: { 'User-Agent': `GYOPO-Content-Crawler/1.0 (+${SITE_URL})` }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`한인광장 API 응답 ${response.status}`);
  const payload = await response.json() as { posts?: Array<{ id?: string; slug?: string; title?: string; body?: string; imageUrls?: string[]; status?: string; moderationReason?: string | null; createdAt?: string; authorName?: string; category?: { slug?: string; nameKo?: string } }> };
  const candidates = (payload.posts || []).filter((post) => post.id && post.slug && post.title && post.status === 'published' && !post.moderationReason).map((post) => {
    const body = normalizeSourceBody(post.body);
    return {
      title: normalizeSourceTitle(post.title),
      url: `https://hanintoday.com.br/community/${post.slug}`,
      description: body.slice(0, 320),
      body,
      image: post.imageUrls?.[0],
      images: post.imageUrls || [],
      publishedAt: post.createdAt,
      category: 'community' as ContentCategory,
      tag: post.category?.slug || post.category?.nameKo || 'community',
      author: normalizeSourceText(post.authorName || '한인광장 회원'),
      country: 'Brazil',
    };
  });
  const items = curateSourceItems(candidates, 'community');
  const url = 'https://hanintoday.com.br/community';
  return { sourceId: source.id, sourceName: source.name, region: source.region, url, title: '한인투데이 · 한인광장', description: '브라질 한인 회원이 작성한 생활 질문, 정보 공유, 경험담과 유머 글입니다.', items, sections: [{ category: 'community' as ContentCategory, label: '한인광장', url, items }], status: items.length ? 'ready' : 'unavailable', warnings: items.length ? [] : ['조건에 맞는 한인광장 글을 찾지 못했습니다.'], fetchedAt: new Date().toISOString(), verified: true };
}

function extractLinks(html: string, pageUrl: string, pathPrefix: string, category: ContentCategory): CrawlItem[] {
  const items: CrawlItem[] = [];
  const seen = new Set<string>();
  const pageOrigin = new URL(pageUrl).origin;
  const prefixUrl = new URL(pathPrefix, pageUrl);
  const prefixPath = prefixUrl.pathname.replace(/\/+$/, '') || '/';
  const rootArticlePattern = /\/(?:article|articles|blog|news|noticia|noticias|post|posts|story|stories|view|read|detail|entry)(?:\/|$)/i;
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    let url: URL;
    try {
      url = new URL(clean(match[1]), pageUrl);
    } catch {
      continue;
    }
    const heading = match[2].match(/<(h[1-6]|strong|b)[^>]*>([\s\S]*?)<\/\1>/i)?.[2];
    const title = clean(heading || match[2]);
    const isRootArticle = prefixPath === '/' && (rootArticlePattern.test(url.pathname) || url.searchParams.has('p') || url.searchParams.has('post_id'));
    const isPathArticle = prefixPath !== '/' && url.pathname.startsWith(`${prefixPath}/`) && url.pathname !== prefixPath;
    if (url.origin !== pageOrigin || (!isRootArticle && !isPathArticle) || url.hash || title.length < 4 || title.length > 280) continue;
    if (seen.has(url.href) || /^(로그인|회원가입|전체보기|전체 상품|더보기|기사 보기|상품 등록|공고 등록|업체 등록|관심 상품|내 거래|글쓰기|이용약관|개인정보처리방침|커뮤니티 운영정책|편집·정정정책|제보·문의|검색|앱 설치하기|한인회소개|임원소개|역대 회장|찾아오시는 길|주요 연락처|공지사항|한인회 소식지|대사관소식)$/i.test(title) || /(운영정책|이용약관|개인정보|편집·정정|제보·문의)/i.test(title)) continue;
    seen.add(url.href);
    items.push({ title, url: url.href, category });
    if (items.length >= 8) break;
  }
  return items;
}

function meta(html: string, key: string) {
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i');
  const reverse = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i');
  return clean(html.match(pattern)?.[1] || html.match(reverse)?.[1]);
}

function tag(block: string, name: string) {
  return clean(block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1]);
}

function structuredData(html: string): StructuredData {
  const records: Array<Record<string, unknown>> = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].trim()) as unknown;
      const values = Array.isArray(parsed) ? parsed : [parsed];
      for (const value of values) {
        if (!value || typeof value !== 'object') continue;
        const record = value as Record<string, unknown>;
        const graph = Array.isArray(record['@graph']) ? record['@graph'] : [];
        records.push(record, ...graph.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')));
      }
    } catch {
      // Ignore malformed structured data and continue with HTML metadata.
    }
  }
  const article = records.find((record) => ['Article', 'NewsArticle', 'BlogPosting', 'Product', 'LocalBusiness'].some((kind) => String(record['@type'] || '').includes(kind)))
    || records.find((record) => typeof record.headline === 'string')
    || records.find((record) => typeof record.name === 'string' && !['PostalAddress', 'Organization', 'WebSite', 'WebPage'].includes(String(record['@type'])))
    || records[0];
  if (!article) return {};
  const images = Array.isArray(article.image) ? article.image : article.image ? [article.image] : [];
  return {
    headline: typeof article.headline === 'string' ? clean(article.headline) : typeof article.name === 'string' ? clean(article.name) : undefined,
    description: typeof article.description === 'string' ? clean(article.description) : undefined,
    articleBody: typeof article.articleBody === 'string' ? cleanArticleBody(textContent(article.articleBody)) : undefined,
    image: images.map((image) => typeof image === 'string' ? image : image && typeof image === 'object' && typeof image.url === 'string' ? image.url : '').filter(Boolean),
    datePublished: typeof article.datePublished === 'string' ? article.datePublished : undefined,
    url: typeof article.url === 'string' ? article.url : undefined,
  };
}

function extractImages(html: string, pageUrl: string, data: StructuredData = {}) {
  const images: string[] = [];
  const contentBlock = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/i)?.[0]
    || html.match(/<(?:main|div|section)\b[^>]*(?:articleBody|article-body|post-content|entry-content|article-content)[^>]*>[\s\S]*?<\/(?:main|div|section)>/i)?.[0]
    || '';
  const bodyCandidates: string[] = [];
  const imagePattern = /<(?:img|source)\b[^>]*(?:src|data-src|data-lazy-src|data-original|data-image|srcset|data-srcset)=["']([^"']+)["']/gi;
  for (const match of contentBlock.matchAll(imagePattern)) bodyCandidates.push(...match[1].split(',').map((value) => value.trim().split(/\s+/)[0]));
  const candidates = [...(data.image || []), ...bodyCandidates, meta(html, 'og:image'), meta(html, 'twitter:image')];
  for (const match of html.matchAll(imagePattern)) candidates.push(...match[1].split(',').map((value) => value.trim().split(/\s+/)[0]));
  for (const candidate of candidates) {
    if (!candidate || candidate.startsWith('data:')) continue;
    try {
      const url = new URL(candidate, pageUrl);
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || images.includes(url.href) || /(?:logo|favicon|sprite|placeholder|avatar|banner|advert|\/icon[/.])/i.test(url.pathname)) continue;
      images.push(url.href);
      if (images.length >= 8) break;
    } catch {
      // Ignore malformed image URLs.
    }
  }
  return images;
}

function extractBody(html: string, data: StructuredData = {}) {
  if (data.articleBody && data.articleBody.length > 80) return data.articleBody;
  const block = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
    || html.match(/<(?:div|section)\b[^>]*(?:itemprop|class|id)=["'][^"']*(?:articleBody|article-body|post-content|entry-content|article-content)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i)?.[1]
    || html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]
    || html.match(/<div\b[^>]*(?:class|id)=["'][^"']*(?:article|post|content|entry)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]
    || '';
  return cleanArticleBody(textContent(block.replace(/<(script|style|noscript|nav|header|footer)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n\n')));
}

function extractImage(html: string, pageUrl: string, data: StructuredData = {}) {
  return extractImages(html, pageUrl, data)[0];
}

function fallbackItem(sourceName: string, sourceUrl: string, category: ContentCategory, title: string, description: string, body: string, image: string | undefined, images: string[]) {
  return { title: title || sourceName, url: sourceUrl, description, body, image, images, category };
}

const regionNames: Record<string, string> = {
  Global: '글로벌', USA: '미국', 'USA-LA': '로스앤젤레스', Brazil: '브라질', Argentina: '아르헨티나', Chile: '칠레', Colombia: '콜롬비아', Bolivia: '볼리비아', Paraguay: '파라과이', Uruguay: '우루과이', Panama: '파나마', Mexico: '멕시코', Portugal: '포르투갈', Spain: '스페인', Italy: '이탈리아', Netherlands: '네덜란드', Germany: '독일', Romania: '루마니아', Hungary: '헝가리', Turkey: '튀르키예', Cyprus: '키프로스', Malta: '몰타', Thailand: '태국', Vietnam: '베트남',
};

async function fetchRegionalNews(region: string) {
  const label = regionNames[region] || region;
  const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(`한인 ${label}`)}&hl=ko&gl=KR&ceid=KR:ko`;
  const feed = await fetchHtml(feedUrl);
  const blocks = feed.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  const items = blocks.slice(0, 12).map((block) => {
    const title = tag(block, 'title');
    const url = tag(block, 'link');
    const description = textContent(tag(block, 'description') || '');
    const image = block.match(/<(?:media:content|media:thumbnail)[^>]+url=["']([^"']+)["']/i)?.[1];
    return { title, url, description, body: description, image, images: image ? [image] : [], publishedAt: tag(block, 'pubDate'), category: 'news' as ContentCategory };
  }).filter((item) => item.title && item.url);
  return { sourceId: `regional-${region}`, sourceName: `${label} 지역 뉴스 검색`, region, url: feedUrl, title: `${label} 오늘의 뉴스`, description: `${label} 관련 최신 공개 뉴스 피드입니다.`, items, sections: [], status: items.length ? 'ready' : 'unavailable', warnings: items.length ? [] : ['지역 뉴스 피드를 찾지 못했습니다.'], fetchedAt: new Date().toISOString(), verified: false };
}

async function enrichItems(items: CrawlItem[]) {
  return Promise.all(items.map(async (item) => {
    try {
      const detail = await fetchHtml(item.url);
      const data = structuredData(detail);
      const body = extractBody(detail, data);
      const images = extractImages(detail, item.url, data);
      return {
        ...item,
        // The list card title is more specific than the site's shared og:title.
        title: item.title || data.headline || meta(detail, 'og:title') || '출처 콘텐츠',
        description: item.description || data.description || meta(detail, 'og:description') || '',
        body: data.articleBody || body || item.description || '',
        image: extractImage(detail, item.url, data),
        images,
        publishedAt: item.publishedAt || data.datePublished,
      };
    } catch {
      return item;
    }
  }));
}

function discoveredCategory(value: string, fallback: ContentCategory) {
  const text = normalizeSourceText(value).toLocaleLowerCase();
  if (/(?:구인|구직|채용|jobs?|stellen|karriere|career|vacanc)/i.test(text)) return 'jobs' as ContentCategory;
  if (/(?:업소|업체|식당|병원|directory|business|branchenbuch|unternehmen|restaurant)/i.test(text)) return 'directory' as ContentCategory;
  if (/(?:커뮤니티|게시판|community|forum|광장|생활정보)/i.test(text)) return 'community' as ContentCategory;
  if (/(?:행사|이벤트|event|veranstaltung|전시)/i.test(text)) return 'events' as ContentCategory;
  if (/(?:뉴스|news|nachrichten|기사|소식|noticia|noticias)/i.test(text)) return 'news' as ContentCategory;
  return fallback;
}

function extractDiscoveredLinks(html: string, pageUrl: string, fallback: ContentCategory) {
  const items: CrawlItem[] = [];
  const seen = new Set<string>();
  const origin = new URL(pageUrl).origin;
  const blocked = /(?:login|register|signup|privacy|impressum|datenschutz|terms|kontakt|contact|about|sitemap|search|suche|tag|author|page=|#)/i;
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL;
    try { url = new URL(clean(match[1]), pageUrl); } catch { continue; }
    const title = normalizeSourceTitle(match[2].match(/<(?:h[1-6]|strong|b)[^>]*>([\s\S]*?)<\/(?:h[1-6]|strong|b)>/i)?.[1] || match[2]);
    if (url.origin !== origin || url.href === pageUrl || url.hash || title.length < 6 || title.length > 240 || blocked.test(url.pathname + url.search) || /^(?:home|menu|more|read more|weiterlesen|로그인|회원가입|검색|더보기|전체보기)$/i.test(title)) continue;
    const category = discoveredCategory(`${url.pathname} ${title}`, fallback);
    if (category === 'news' && !/(?:article|news|nachricht|noticia|post|story|view|detail|read|\d{3,})/i.test(url.pathname + title) && url.pathname !== new URL(pageUrl).pathname) continue;
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    items.push({ title, url: normalizeSourceUrl(url.href), category });
    if (items.length >= 36) break;
  }
  return items;
}

function isSpainAgainJob(title: string) {
  return /(?:구인|구직|채용|모집|통역.*구합니다|가이드.*구합니다|운영 요원|파트너를 찾|강사.*되는법|사례비)/i.test(title);
}

function extractSpainAgainItems(html: string, pageUrl: string) {
  const items: CrawlItem[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']*\?[^"']*mod=document[^"']*uid=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL;
    try { url = new URL(clean(match[1]), pageUrl); } catch { continue; }
    const title = normalizeSourceTitle(match[2].replace(/<[^>]+>/g, ' '));
    if (!title || title.length < 4 || seen.has(url.href)) continue;
    const rowStart = html.lastIndexOf('<tr', match.index || 0);
    const rowEnd = html.indexOf('</tr>', match.index || 0);
    const row = rowStart >= 0 && rowEnd > rowStart ? html.slice(rowStart, rowEnd) : '';
    const category = isSpainAgainJob(title) ? 'jobs' : 'community';
    seen.add(url.href);
    items.push({
      title,
      url: normalizeSourceUrl(url.href),
      category,
      author: normalizeSourceText(row.match(/class=["'][^"']*kboard-list-user[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] || 'SpainAgain 회원'),
      publishedAt: publishedDate(row.match(/class=["'][^"']*kboard-list-date[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1]),
      country: 'Spain',
      location: '스페인',
      tag: category === 'jobs' ? '스페인 구인구직' : '스페인 한인 커뮤니티',
    });
  }
  return items;
}

async function fetchSpainAgainSource(source: ContentSource, requestedCategory: ContentCategory | null) {
  const html = await fetchHtml(source.url);
  const rawItems = extractSpainAgainItems(html, source.url);
  const categories: ContentCategory[] = ['community', 'jobs'];
  const sections = await Promise.all(categories.map(async (category) => {
    const candidates = rawItems.filter((item) => item.category === category).slice(0, 20);
    const items = curateSourceItems(await enrichSpainAgainItems(candidates), category);
    return { category, label: category === 'jobs' ? '스페인 구인구직' : '스페인 한인 커뮤니티', url: source.url, items };
  }));
  const selected = requestedCategory ? sections.find((section) => section.category === requestedCategory)?.items || [] : sections.flatMap((section) => section.items);
  return { sourceId: source.id, sourceName: source.name, region: source.region, url: source.url, title: 'Spain Again 최신 커뮤니티·구인구직', description: source.note, items: selected, sections, status: selected.length ? 'ready' : 'unavailable', warnings: selected.length ? [] : ['Spain Again에서 조건에 맞는 글을 찾지 못했습니다.'], fetchedAt: new Date().toISOString(), verified: true };
}

async function enrichSpainAgainItems(items: CrawlItem[]) {
  return Promise.all(items.map(async (item) => {
    try {
      const detail = await fetchHtml(item.url);
      const data = structuredData(detail);
      const bodyHtml = classBlock(detail, 'kboard-content', ['kboard-document-action', 'kboard-comments']);
      const body = bodyFromBlock(bodyHtml) || extractBody(detail, data);
      const images = extractImages(bodyHtml, item.url, data);
      return { ...item, body, description: body.slice(0, 320), image: images[0], images };
    } catch {
      return item;
    }
  }));
}

async function fetchDiscoveredSource(source: ContentSource, requestedCategory: ContentCategory | null) {
  const rootHtml = await fetchHtml(source.url);
  const rootItems = extractDiscoveredLinks(rootHtml, source.url, source.categories[0] || 'news');
  const seedPages = new Map<string, { category: ContentCategory; label: string; url: string }>();
  for (const item of rootItems) {
    const category = item.category || source.categories[0] || 'news';
    if (category === 'news' && /(?:article|news|nachricht|noticia|post|story|view|detail|read|\d{3,})/i.test(new URL(item.url).pathname)) continue;
    if (requestedCategory && category !== requestedCategory) continue;
    if (seedPages.has(item.url)) continue;
    seedPages.set(item.url, { category, label: item.title, url: item.url });
  }
  const seeds = [...seedPages.values()].slice(0, 10);
  const directItems = rootItems.filter((item) => !seedPages.has(item.url));
  const sections = new Map<ContentCategory, CrawlItem[]>();
  for (const item of directItems) {
    if (!requestedCategory || item.category === requestedCategory) (sections.get(item.category) || (sections.set(item.category, []), sections.get(item.category)!)).push(item);
  }
  await Promise.all(seeds.map(async (seed) => {
    try {
      const html = await fetchHtml(seed.url);
      const links = extractDiscoveredLinks(html, seed.url, seed.category).filter((item) => !requestedCategory || item.category === requestedCategory || seed.category === requestedCategory);
      const enriched = await enrichItems(links);
      const list = sections.get(seed.category) || [];
      sections.set(seed.category, [...list, ...enriched.map((item) => ({ ...item, category: seed.category }))]);
    } catch {
      // A single unavailable category must not hide the other source sections.
    }
  }));
  const outputSections = await Promise.all([...sections.entries()].map(async ([category, values]) => ({
    category,
    label: category === 'news' ? '뉴스' : categoryLabels[category],
    url: source.url,
    items: curateSourceItems(await enrichItems(values.slice(0, 12)), category),
  })));
  const items = requestedCategory ? outputSections.find((section) => section.category === requestedCategory)?.items || [] : [];
  const count = outputSections.reduce((sum, section) => sum + section.items.length, 0);
  return { sourceId: source.id, sourceName: source.name, region: source.region, url: source.url, title: `${source.name} 최신 출처 콘텐츠`, description: source.note, items, sections: outputSections, status: count ? 'ready' : 'unavailable', warnings: count ? [] : ['분류 가능한 원문 콘텐츠를 찾지 못했습니다.'], fetchedAt: new Date().toISOString(), verified: true };
}

async function fetchNaverSource(source: ContentSource, requestedCategory: ContentCategory | null) {
  const paths = source.crawlPaths?.filter((item) => !requestedCategory || item.category === requestedCategory) || [];
  const sections = await Promise.all(paths.map(async (path) => {
    try {
      const url = new URL(path.path, source.url).href;
      const html = await fetchHtml(url);
      const links: CrawlItem[] = [];
      const seen = new Set<string>();
      for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']*\/article\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        let articleUrl: URL;
        try { articleUrl = new URL(clean(match[1]), url); } catch { continue; }
        const title = normalizeSourceTitle(match[2].replace(/<[^>]+>/g, ' '));
        if (title.length < 8 || seen.has(articleUrl.href) || /^(?:포토|동영상|더보기|전체기사)$/i.test(title)) continue;
        seen.add(articleUrl.href);
        links.push({ title, url: articleUrl.href, category: 'news' });
        if (links.length >= 10) break;
      }
      const items = curateSourceItems(await enrichItems(links), 'news');
      return { category: 'news' as ContentCategory, label: path.label, url, items };
    } catch {
      return { category: 'news' as ContentCategory, label: path.label, url: new URL(path.path, source.url).href, items: [] };
    }
  }));
  const items = sections.flatMap((section) => section.items).filter((item, index, all) => all.findIndex((other) => other.url === item.url) === index).slice(0, 40);
  return { sourceId: source.id, sourceName: source.name, region: source.region, url: source.url, title: '네이버 뉴스 최신 기사', description: source.note, items: requestedCategory ? items : [], sections, status: items.length ? 'ready' : 'unavailable', warnings: items.length ? [] : ['네이버 뉴스 섹션을 읽지 못했습니다.'], fetchedAt: new Date().toISOString(), verified: true };
}

// This endpoint is public by design for the portal's public content pages. It never accepts an arbitrary URL:
// source, region, and category are bounded identifiers resolved against local allowlists below.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const sourceParam = params.get('source') || '';
  const regionParam = params.get('region') || '';
  const categoryParam = params.get('category') || '';
  if (sourceParam.length > 80 || regionParam.length > 80 || categoryParam.length > 20) {
    return Response.json({ error: '콘텐츠 조회 입력값이 너무 깁니다.' }, { status: 400 });
  }
  const rate = consumeRateLimit(`content-preview:${clientAddress(request)}`, 20, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterMs);
  if (sourceParam === 'market') return Response.json(await fetchMarket(), { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=120' } });
  const region = regionParam || null;
  if (region) {
    if (!REGIONS.some((item) => item.id === region)) return Response.json({ error: '지원하지 않는 지역입니다.' }, { status: 400 });
    try {
      return Response.json(await fetchRegionalNews(region));
    } catch (error) {
      return Response.json({ sourceId: `regional-${region}`, sourceName: `${region} 지역 뉴스 검색`, region, items: [], sections: [], status: 'unavailable', warnings: [error instanceof Error ? error.message : '지역 뉴스 피드를 확인하지 못했습니다.'], fetchedAt: new Date().toISOString() }, { status: 200 });
    }
  }
  const id = sourceParam;
  const requestedCategory = categoryParam as ContentCategory | null;
  if (requestedCategory && !['news', 'directory', 'jobs', 'market', 'events', 'community'].includes(requestedCategory)) {
    return Response.json({ error: '지원하지 않는 콘텐츠 카테고리입니다.' }, { status: 400 });
  }
  const source = CONTENT_SOURCES.find((item) => item.id === id);
  if (!source) return Response.json({ error: '등록되지 않은 출처입니다.' }, { status: 404 });
  if (requestedCategory && !source.categories.includes(requestedCategory)) return Response.json({ error: '이 출처에서 지원하지 않는 카테고리입니다.' }, { status: 400 });

  try {
    if (source.id === 'kba-europe-jobs') return Response.json(await fetchKbaSource(source));
    if (source.id === 'hanasia-thailand') return Response.json(await fetchHanasiaSource(source, requestedCategory));
     if (source.id === 'naver-news') return Response.json(await fetchNaverSource(source, requestedCategory));
     if (source.id === 'spainagain-koreans' && (!requestedCategory || requestedCategory === 'community' || requestedCategory === 'jobs')) return Response.json(await fetchSpainAgainSource(source, requestedCategory));
     if (source.id === 'gutentag-korea') return Response.json(await fetchDiscoveredSource(source, requestedCategory));
    if (source.id === 'hanintoday-brazil' && requestedCategory === 'community') return Response.json(await fetchHaninCommunity(source));
    if (source.id === 'hanintoday-brazil' && requestedCategory === 'jobs') {
      const response = await fetch('https://hanintoday.com.br/api/jobs', { headers: { 'User-Agent': `GYOPO-Content-Crawler/1.0 (+${SITE_URL})` }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error(`구인 API 응답 ${response.status}`);
      const payload = await response.json() as { jobs?: Array<{ id?: string; title?: string; company?: string; area?: string; category?: string; employmentType?: string; salaryType?: string; salary?: number; description?: string; requirements?: string; contact?: string; createdAt?: string; details?: { workplaceAddress?: string; salaryConditions?: string } }> };
      const items = curateSourceItems((payload.jobs || []).filter((job) => job.id && job.title).slice(0, 50).map((job) => ({
        title: clean(job.title),
        url: `https://hanintoday.com.br/jobs/${job.id}`,
        description: clean(job.description || ''),
        body: normalizeSourceBody([job.description, job.requirements, job.details?.workplaceAddress, job.details?.salaryConditions, job.contact].filter(Boolean).join('\n\n')),
        publishedAt: job.createdAt,
        category: 'jobs' as ContentCategory,
        company: clean(job.company || ''),
        location: clean(job.area || ''),
        salary: job.details?.salaryConditions || (job.salary ? `${job.salary} · ${job.salaryType || ''}` : '상세 내용 참조'),
        tag: clean(job.category || job.employmentType || '구인구직'),
        country: 'Brazil',
      })), 'jobs');
      return Response.json({ sourceId: source.id, sourceName: source.name, region: source.region, url: 'https://hanintoday.com.br/jobs', title: '한인투데이 구인구직', description: '한인투데이에서 확인된 최신 구인구직 공고입니다.', items, sections: [{ category: 'jobs', label: '구인구직', url: 'https://hanintoday.com.br/jobs', items }], status: items.length ? 'ready' : 'unavailable', warnings: items.length ? [] : ['구인구직 공고가 없습니다.'], fetchedAt: new Date().toISOString(), verified: true });
    }
    if (source.id === 'hanintoday-brazil' && requestedCategory === 'directory') {
      const response = await fetch('https://hanintoday.com.br/api/businesses', { headers: { 'User-Agent': `GYOPO-Content-Crawler/1.0 (+${SITE_URL})` }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error(`업소 API 응답 ${response.status}`);
      const payload = await response.json() as { businesses?: Array<{ id?: string; tradeName?: string; entityType?: string; category?: string; phone?: string; whatsapp?: string; area?: string; address?: string; description?: string; logoUrl?: string; coverImageUrl?: string; latitude?: number; longitude?: number }> };
      const categoryLabels: Record<string, string> = { health_clinic: '병원·의료', grocery_market: '마트·식품', restaurant_cafe: '음식점·카페', it_services: 'IT·서비스', other: '기타', buddhist_temple: '종교·단체', consulate_organization: '공공기관·단체' };
      const items = curateSourceItems((payload.businesses || []).filter((business) => business.id && business.tradeName && business.entityType !== 'job').slice(0, 100).map((business) => ({
        title: clean(business.tradeName),
        url: `https://hanintoday.com.br/businesses/${business.id}`,
        description: clean(business.description || ''),
        body: clean([business.description, business.address, business.phone || business.whatsapp].filter(Boolean).join('\n\n')),
        category: 'directory' as ContentCategory,
        entityType: clean(business.entityType || ''),
        company: clean(business.tradeName),
        tag: categoryLabels[business.category || ''] || '기타',
        phone: clean(business.phone || business.whatsapp || ''),
        address: clean([business.area, business.address].filter(Boolean).join(' · ')),
        image: business.coverImageUrl || business.logoUrl,
        images: [business.coverImageUrl, business.logoUrl].filter(Boolean) as string[],
        lat: business.latitude,
        lng: business.longitude,
        country: 'Brazil',
      })), 'directory');
      return Response.json({ sourceId: source.id, sourceName: source.name, region: source.region, url: 'https://hanintoday.com.br/businesses', title: '한인투데이 업소록', description: '한인투데이에서 확인된 실제 업소 정보입니다.', items, sections: [{ category: 'directory', label: '업소', url: 'https://hanintoday.com.br/businesses', items }], status: items.length ? 'ready' : 'unavailable', warnings: items.length ? [] : ['업소 정보가 없습니다.'], fetchedAt: new Date().toISOString(), verified: true });
    }
    const html = await fetchHtml(source.url);
    const pageData = structuredData(html);
    const title = meta(html, 'og:title') || clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) || pageData.headline || source.name;
    const description = pageData.description || meta(html, 'og:description') || meta(html, 'description') || '';
    const canonicalRaw = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i)?.[1] || pageData.url || source.url;
    const canonical = new URL(canonicalRaw, source.url).href;
    const pageImages = extractImages(html, source.url, pageData);
    const pageBody = extractBody(html, pageData);
    const feedHref = html.match(/<link[^>]+type=["']application\/(?:rss\+xml|atom\+xml)["'][^>]+href=["']([^"']+)["'][^>]*>/i)?.[1];
    const sourceItem = fallbackItem(source.name, canonical, requestedCategory || source.categories[0] || 'news', title, description, pageBody, pageImages[0], pageImages);
    const warnings: string[] = [];
    let items: CrawlItem[] = [];
    if (feedHref) {
      const feedResponse = await fetch(new URL(feedHref, source.url), { headers: { 'User-Agent': 'GYOPO-Content-Preview/1.0' }, signal: AbortSignal.timeout(8_000) }).catch(() => null);
      if (feedResponse?.ok) {
        const feed = await feedResponse.text();
        const blocks = feed.match(/<item[\s>][\s\S]*?<\/item>/gi) || feed.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
        items = curateSourceItems(await enrichItems(blocks.slice(0, 8).map((block) => ({
          title: tag(block, 'title'),
          url: tag(block, 'link') || block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || canonical,
          description: tag(block, 'description') || tag(block, 'summary'),
          publishedAt: tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || undefined,
          category: 'news' as ContentCategory,
        })).filter((item) => item.title)), 'news').map((item) => ({ ...item, category: 'news' as ContentCategory }));
      }
    }
    const crawlPaths = source.crawlPaths?.filter((crawlPath) => !requestedCategory || crawlPath.category === requestedCategory) || [];
    const sections = source.crawlPaths
      ? await Promise.all(crawlPaths.map(async (crawlPath) => {
        try {
          const url = new URL(crawlPath.path, source.url).href;
          const page = await fetchHtml(url);
           const extracted = extractLinks(page, url, crawlPath.path, crawlPath.category);
           const enriched = curateSourceItems(await enrichItems(extracted), crawlPath.category);
            const fallback = source.categories.includes(crawlPath.category) && crawlPath.path !== '/' && enriched.length === 0 && !['jobs', 'community'].includes(crawlPath.category)
              ? [{ ...sourceItem, category: crawlPath.category, title: `${source.name} · ${crawlPath.label}`, url: canonical }]
              : [];
            return { category: crawlPath.category, label: crawlPath.label, url, items: curateSourceItems(enriched.length ? enriched : fallback, crawlPath.category) };
        } catch (error) {
          warnings.push(`${crawlPath.label}: ${error instanceof Error ? error.message : '목록을 읽지 못했습니다.'}`);
            const fallback = source.categories.includes(crawlPath.category) && crawlPath.path !== '/' && !['jobs', 'community'].includes(crawlPath.category) ? [{ ...sourceItem, category: crawlPath.category, title: `${source.name} · ${crawlPath.label}` }] : [];
          return { category: crawlPath.category, label: crawlPath.label, url: new URL(crawlPath.path, source.url).href, items: curateSourceItems(fallback, crawlPath.category) };
        }
      }))
      : [];
    if (!source.crawlPaths?.length) {
      const defaultCategory = source.categories[0] || 'news';
      items = !requestedCategory || requestedCategory === defaultCategory
        ? curateSourceItems([sourceItem], requestedCategory || defaultCategory).map((item) => ({ ...item, category: requestedCategory || defaultCategory }))
        : [];
    } else if (requestedCategory && !crawlPaths.length) {
      items = [];
    }
    const contentCount = items.length + sections.reduce((sum, section) => sum + section.items.length, 0);
    if (requestedCategory && contentCount === 0) warnings.push('카테고리 기준을 충족하는 실제 콘텐츠가 없습니다.');
    return Response.json({
      sourceId: source.id,
      sourceName: source.name,
      region: source.region,
      url: canonical,
      title: clean(title).slice(0, 240),
      description: clean(description).slice(0, 600),
      items,
      sections,
      image: pageImages[0],
      images: pageImages,
      status: contentCount ? (warnings.length ? 'partial' : 'ready') : 'unavailable',
      warnings,
      fetchedAt: new Date().toISOString(),
      verified: source.trust === 'official' || source.trust === 'verified',
    });
  } catch (error) {
    return Response.json({
      sourceId: source.id,
      sourceName: source.name,
      region: source.region,
      url: source.url,
      title: source.name,
      description: source.note,
      items: [],
      sections: [],
      status: 'unavailable',
      warning: error instanceof Error ? error.message : '출처 연결을 확인하지 못했습니다.',
      fetchedAt: new Date().toISOString(),
      verified: source.trust === 'official' || source.trust === 'verified',
    }, { status: 200 });
  }
}
