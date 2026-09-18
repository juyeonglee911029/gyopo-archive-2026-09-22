import 'server-only';
import { googleAdsAccessToken } from '@/lib/master/keywordData';

export type MarketCountry = { code: string; region: string; geoCriterion: string };
// Google geo-target CSV 2026-08-12, country-level Active criteria, verified 2026-09-16.
// https://developers.google.com/google-ads/api/data/geotargets
export const MARKET_COUNTRIES: MarketCountry[] = [
  ['US', 'USA', '2840'], ['KR', 'SouthKorea', '2410'], ['BR', 'Brazil', '2076'],
  ['CA', 'Canada', '2124'], ['AU', 'Australia', '2036'], ['JP', 'Japan', '2392'],
  ['GB', 'UnitedKingdom', '2826'], ['AR', 'Argentina', '2032'], ['CL', 'Chile', '2152'],
  ['CO', 'Colombia', '2170'], ['BO', 'Bolivia', '2068'], ['PY', 'Paraguay', '2600'],
  ['UY', 'Uruguay', '2858'], ['PA', 'Panama', '2591'], ['MX', 'Mexico', '2484'],
  ['PT', 'Portugal', '2620'], ['ES', 'Spain', '2724'], ['NL', 'Netherlands', '2528'],
  ['DE', 'Germany', '2276'], ['RO', 'Romania', '2642'], ['HU', 'Hungary', '2348'],
  ['MT', 'Malta', '2470'], ['TH', 'Thailand', '2764'], ['VN', 'Vietnam', '2704'],
  ['CN', 'China', '2156'], ['NZ', 'NewZealand', '2554'], ['SG', 'Singapore', '2702'],
  ['FR', 'France', '2250'], ['IT', 'Italy', '2380'], ['PH', 'Philippines', '2608'],
].map(([code, region, geoCriterion]) => ({ code, region, geoCriterion }));

export type MarketMode = 'trends' | 'ideas';
export type MarketSort = 'source' | 'recent' | 'traffic' | 'volume' | 'cpc';
export type MarketRequest = { mode: MarketMode; country: string; query: string; relevance: 'all' | 'diaspora'; sort: MarketSort };
export type MarketKeywordRow = {
  query: string;
  publishedAt: string | null;
  approximateTraffic: string | null;
  approximateTrafficLowerBound: number | null;
  avgMonthlySearches: number | null;
  averageCpc: number | null;
  lowTopOfPageBid: number | null;
  highTopOfPageBid: number | null;
  currency: string | null;
  monthlySearchVolumes: Array<{ month: string; searches: number | null }>;
  relevanceMatches: string[];
};
export type MarketKeywordsResult = {
  mode: MarketMode; country: MarketCountry; query: string; relevance: MarketRequest['relevance']; sort: MarketSort;
  source: string; sourceUrl: string; fetchedAt: string; sourceUpdatedAt: string | null;
  rawCount: number; relevantCount: number; returnedCount: number; hasMore: boolean; limit: number;
  currency: string | null; seeds: string[]; apiVersion: string | null;
  historicalMonthRange: { start: string; end: string } | null;
  rows: MarketKeywordRow[];
};

export class MarketKeywordsError extends Error {
  status: number;
  code: string;
  setup: string[];
  constructor(message: string, status = 502, code = 'SOURCE_UNAVAILABLE', setup: string[] = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.setup = setup;
  }
}

export function parseMarketRequest(params: URLSearchParams): MarketRequest {
  const keys = ['mode', 'country', 'query', 'relevance', 'sort'];
  for (const key of params.keys()) {
    if (!keys.includes(key) || params.getAll(key).length !== 1) throw new MarketKeywordsError('Invalid or duplicate request option.', 400, 'INVALID_INPUT');
  }
  const mode = params.get('mode') || 'trends';
  const country = params.get('country') || 'US';
  const query = (params.get('query') || '').trim();
  const relevance = params.get('relevance') || 'all';
  const sort = params.get('sort') || (mode === 'trends' ? 'recent' : 'volume');
  if (!['trends', 'ideas'].includes(mode) || !MARKET_COUNTRIES.some((item) => item.code === country)
    || !['all', 'diaspora'].includes(relevance) || query.length > 80 || query.split(/\s+/).length > 10
    || /[\u0000-\u001f\u007f]/.test(query)
    || !(mode === 'trends' ? ['source', 'recent', 'traffic'] : ['source', 'volume', 'cpc']).includes(sort)
    || (mode === 'trends' && query) || (mode === 'ideas' && relevance !== 'all')) {
    throw new MarketKeywordsError('Choose a supported country and mode. Idea seeds allow up to 80 characters and 10 words. Trends filters do not apply to ideas.', 400, 'INVALID_INPUT');
  }
  return { mode: mode as MarketMode, country, query, relevance: relevance as MarketRequest['relevance'], sort: sort as MarketSort };
}

const DIASPORA_SEEDS = ['\ud55c\uc778', '\uc7ac\uc678\ub3d9\ud3ec', '\ube44\uc790', '\uc774\ubbfc', '\uc601\uc0ac\uad00', '\ud574\uc678 \ucde8\uc5c5', '\ud55c\uad6d\uc5b4 \ud559\uad50', '\ud574\uc678 \uc138\uae08'];
const RELEVANCE_TERMS = [
  ...DIASPORA_SEEDS, '\uad50\ud3ec', '\uc601\uc8fc\uad8c', '\uc5ec\uad8c', '\ub300\uc0ac\uad00', '\uadc0\uad6d', '\uc720\ud559',
  'korean', 'koreans', 'korea', 'gyopo', 'diaspora', 'immigration', 'immigrant', 'immigrants', 'visa', 'visas', 'consulate', 'embassy',
];
export function diasporaRelevance(text: string): string[] {
  const normalized = text.toLowerCase().normalize('NFKC');
  return RELEVANCE_TERMS.filter((term) => /^[a-z]+$/.test(term)
    ? new RegExp(`\\b${term}\\b`, 'i').test(normalized) : normalized.includes(term));
}

function emptyMetrics(): Omit<MarketKeywordRow, 'query' | 'relevanceMatches'> {
  return { publishedAt: null, approximateTraffic: null, approximateTrafficLowerBound: null, avgMonthlySearches: null,
    averageCpc: null, lowTopOfPageBid: null, highTopOfPageBid: null, currency: null, monthlySearchVolumes: [] };
}

function integer(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function date(value: string): string | null {
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

type XmlNode = { name: string; text: string; children: XmlNode[] };
function xmlText(text: string): string {
  return text.replace(/&([^;\s<&]*);|&/g, (match, entity: string | undefined) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (entity && Object.hasOwn(named, entity)) return named[entity];
    const numeric = entity?.match(/^#(x[\da-f]+|\d+)$/i)?.[1];
    const point = numeric ? Number.parseInt(numeric.replace(/^x/i, ''), /^x/i.test(numeric) ? 16 : 10) : NaN;
    if (point === 9 || point === 10 || point === 13 || (point >= 32 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) && point !== 0xfffe && point !== 0xffff)) return String.fromCodePoint(point);
    throw new MarketKeywordsError('Google Trends returned an invalid XML entity.');
  });
}

// A bounded RSS XML subset for the Edge runtime: no DOM dependency, DTD, or entity expansion.
// Live format verified at https://trends.google.com/trending/rss?geo=US on 2026-09-16.
export function parseGoogleTrendsRss(xml: string): { rows: MarketKeywordRow[]; sourceUpdatedAt: string | null } {
  const invalid = () => new MarketKeywordsError('Google Trends returned malformed or unsupported RSS.');
  if (xml.length > 1_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)) throw invalid();
  const root: XmlNode = { name: '', text: '', children: [] };
  const stack = [root];
  const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][^>]*>|[^<]+/gy;
  let offset = 0;
  let nodes = 0;
  let prefix = '';
  while (offset < xml.length) {
    const token = tokens.exec(xml)?.[0];
    if (!token) throw invalid();
    offset = tokens.lastIndex;
    const current = stack[stack.length - 1];
    if (token.startsWith('<!--') || token.startsWith('<?')) continue;
    if (token.startsWith('<![CDATA[')) {
      if (stack.length === 1) throw invalid();
      current.text += token.slice(9, -3);
    } else if (token.startsWith('</')) {
      if (!/^<\/[A-Za-z_][\w:.-]*\s*>$/.test(token) || stack.length === 1 || token.slice(2, -1).trim() !== current.name) throw invalid();
      stack.pop();
    } else if (token.startsWith('<')) {
      const opening = token.match(/^<([A-Za-z_][\w:.-]*)(?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*\/?\s*>$/);
      if (!opening || ++nodes > 20_000 || stack.length > 24) throw invalid();
      for (const attribute of token.matchAll(/=\s*(?:"([^"]*)"|'([^']*)')/g)) xmlText(attribute[1] ?? attribute[2]);
      if (stack.length === 1) {
        prefix = token.match(/\sxmlns:([\w.-]+)=["']https:\/\/trends\.google\.com\/trending\/rss["']/)?.[1] || '';
      }
      const node: XmlNode = { name: opening[1], text: '', children: [] };
      current.children.push(node);
      if (!/\/\s*>$/.test(token)) stack.push(node);
    } else {
      current.text += xmlText(token);
    }
  }
  const rss = root.children[0];
  if (stack.length !== 1 || root.text.trim() || root.children.length !== 1 || rss?.name !== 'rss' || !prefix) throw invalid();
  const channels = rss.children.filter((node) => node.name === 'channel');
  if (channels.length !== 1) throw invalid();
  const channel = channels[0];
  const value = (node: XmlNode, name: string) => node.children.find((child) => child.name === name)?.text.trim() || '';
  const rows: MarketKeywordRow[] = [];
  const seen = new Set<string>();
  for (const item of channel.children.filter((node) => node.name === 'item')) {
    const query = value(item, 'title');
    if (!query || query.length > 500 || seen.has(query.toLowerCase())) continue;
    seen.add(query.toLowerCase());
    const traffic = value(item, `${prefix}:approx_traffic`);
    const match = traffic.match(/^(\d+(?:,\d{3})*)([KM]?)\+$/i);
    const lowerBound = match ? integer(Number(match[1].replaceAll(',', '')) * ({ K: 1_000, M: 1_000_000 }[match[2].toUpperCase()] || 1)) : null;
    const news = item.children.filter((child) => child.name === `${prefix}:news_item`).map((child) => value(child, `${prefix}:news_item_title`));
    rows.push({ ...emptyMetrics(), query, publishedAt: date(value(item, 'pubDate')), approximateTraffic: traffic.slice(0, 80) || null,
      approximateTrafficLowerBound: lowerBound, relevanceMatches: diasporaRelevance([query, ...news].join(' ')) });
  }
  return { rows, sourceUpdatedAt: date(value(channel, 'lastBuildDate') || value(channel, 'pubDate')) };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// Documented keywordIdeaMetrics, NOT campaign metrics or top-of-page bids substituted for CPC.
// https://developers.google.com/google-ads/api/reference/rpc/v25/KeywordPlanHistoricalMetrics
export function parseGoogleKeywordIdeas(payload: unknown, currency: string): { rows: MarketKeywordRow[]; hasMore: boolean } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !/^[A-Z]{3}$/.test(currency)) throw new MarketKeywordsError('Invalid Keyword Planner response or account currency.');
  const data = record(payload);
  if (data.error || (data.results !== undefined && !Array.isArray(data.results))) throw new MarketKeywordsError('Invalid Keyword Planner response.');
  const months = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  const rows: MarketKeywordRow[] = [];
  const seen = new Set<string>();
  const results = Array.isArray(data.results) ? data.results : [];
  for (const result of results.slice(0, 100)) {
    const item = record(result);
    const query = typeof item.text === 'string' ? item.text.trim() : '';
    if (!query || query.length > 500 || seen.has(query.toLowerCase())) continue;
    seen.add(query.toLowerCase());
    const metrics = record(item.keywordIdeaMetrics);
    const micros = (key: string) => { const amount = integer(metrics[key]); return amount === null ? null : amount / 1_000_000; };
    const volumes = new Map<string, number | null>();
    for (const entry of (Array.isArray(metrics.monthlySearchVolumes) ? metrics.monthlySearchVolumes : []).slice(0, 48)) {
      const volume = record(entry);
      const year = integer(volume.year);
      const month = months.indexOf(String(volume.month)) + 1;
      if (year !== null && year >= 2000 && year <= 2100 && month) volumes.set(`${year}-${String(month).padStart(2, '0')}`, integer(volume.monthlySearches));
    }
    rows.push({ ...emptyMetrics(), query, avgMonthlySearches: integer(metrics.avgMonthlySearches), averageCpc: micros('averageCpcMicros'),
      lowTopOfPageBid: micros('lowTopOfPageBidMicros'), highTopOfPageBid: micros('highTopOfPageBidMicros'), currency,
      monthlySearchVolumes: [...volumes].sort(([a], [b]) => a.localeCompare(b)).map(([month, searches]) => ({ month, searches })), relevanceMatches: diasporaRelevance(query) });
  }
  return { rows, hasMore: (typeof data.nextPageToken === 'string' && Boolean(data.nextPageToken)) || results.length > 100 };
}

export function sortMarketKeywords(rows: MarketKeywordRow[], sort: MarketSort): MarketKeywordRow[] {
  if (sort === 'cpc' && (new Set(rows.filter((row) => row.averageCpc !== null).map((row) => row.currency)).size > 1
    || rows.some((row) => row.averageCpc !== null && !row.currency))) throw new MarketKeywordsError('CPC can only be compared in the same known account currency.');
  const value = (row: MarketKeywordRow) => sort === 'cpc' ? row.averageCpc : sort === 'volume' ? row.avgMonthlySearches
    : sort === 'traffic' ? row.approximateTrafficLowerBound : row.publishedAt ? Date.parse(row.publishedAt) : null;
  return sort === 'source' ? [...rows] : [...rows].sort((a, b) => (value(b) ?? -1) - (value(a) ?? -1));
}

async function sourceText(url: string, options: RequestInit = {}): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        cache: 'no-store',
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
        headers: { accept: 'application/rss+xml, application/xml, text/xml', 'user-agent': 'GYOPO keyword source reader', ...(options.headers || {}) },
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (attempt === 0 && (response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500)) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
        throw new MarketKeywordsError(`Google source request failed (HTTP ${response.status}). Check source availability, API version, OAuth scope, developer-token access and customer permissions.`);
      }
      const maxBytes = 1_000_000;
      if (Number(response.headers.get('content-length')) > maxBytes || !response.body) {
        await response.body?.cancel();
        throw new MarketKeywordsError('Google source response was empty or exceeded the size limit.');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let bytes = 0;
      let text = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) throw new MarketKeywordsError('Google source response exceeded the size limit.');
          text += decoder.decode(value, { stream: true });
        }
        return text + decoder.decode();
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } catch (error) {
      lastError = error;
      if (error instanceof MarketKeywordsError) throw error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (lastError instanceof MarketKeywordsError) throw lastError;
  throw new MarketKeywordsError('Google source request timed out or was interrupted. Retry later and check the source connection.');
}

function adsConfiguration() {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() || '';
  const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID?.trim() || '').replaceAll('-', '');
  const loginCustomerId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim() || '').replaceAll('-', '');
  const version = process.env.GOOGLE_ADS_API_VERSION?.trim() || '';
  const setup: string[] = [];
  if (!developerToken) setup.push('GOOGLE_ADS_DEVELOPER_TOKEN');
  if (!customerId) setup.push('GOOGLE_ADS_CUSTOMER_ID');
  if (!version) setup.push('GOOGLE_ADS_API_VERSION');
  if (!process.env.GOOGLE_ADS_ACCESS_TOKEN?.trim()) {
    for (const key of ['GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET']) if (!process.env[key]?.trim()) setup.push(key);
  }
  const hasOAuth = Boolean(process.env.GOOGLE_ADS_ACCESS_TOKEN?.trim() || (process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim() && process.env.GOOGLE_ADS_CLIENT_ID?.trim() && process.env.GOOGLE_ADS_CLIENT_SECRET?.trim()));
  if (setup.length || !developerToken || !customerId || !hasOAuth) throw new MarketKeywordsError(
    'Keyword Planner is not configured. Set the listed server variables. OAuth: refresh token + client ID + client secret, or a temporary GOOGLE_ADS_ACCESS_TOKEN with the adwords scope. For manager access also set GOOGLE_ADS_LOGIN_CUSTOMER_ID. Public Trends needs no Ads credentials.',
    503, 'NOT_CONFIGURED', setup,
  );
  // No inherited v18 fallback. Operators select a supported major REST version (v25 verified 2026-09-16).
  if (!/^v[1-9]\d{1,2}$/.test(version) || !/^\d{10}$/.test(customerId) || (loginCustomerId && !/^\d{10}$/.test(loginCustomerId))) {
    throw new MarketKeywordsError('Check GOOGLE_ADS_API_VERSION (supported vNN), GOOGLE_ADS_CUSTOMER_ID (10 digits), and optional GOOGLE_ADS_LOGIN_CUSTOMER_ID (10 digits).', 503, 'INVALID_CONFIGURATION');
  }
  return { developerToken, customerId, loginCustomerId, version };
}

export async function loadGoogleMarketKeywords(input: MarketRequest): Promise<MarketKeywordsResult> {
  const country = MARKET_COUNTRIES.find((item) => item.code === input.country);
  if (!country) throw new MarketKeywordsError('Unsupported country.', 400, 'INVALID_INPUT');
  let rows: MarketKeywordRow[];
  let hasMore = false;
  let currency: string | null = null;
  let sourceUpdatedAt: string | null = null;
  let apiVersion: string | null = null;
  const seeds = input.mode === 'ideas' ? (input.query ? [input.query] : [...DIASPORA_SEEDS]) : [];
  const sourceUrl = input.mode === 'trends' ? `https://trends.google.com/trending/rss?geo=${country.code}`
    : 'https://developers.google.com/google-ads/api/docs/keyword-planning/generate-keyword-ideas';
  try {
    if (input.mode === 'trends') {
      ({ rows, sourceUpdatedAt } = parseGoogleTrendsRss(await sourceText(sourceUrl, { headers: { accept: 'application/rss+xml, application/xml' } })));
    } else {
      const config = adsConfiguration();
      apiVersion = config.version;
      // Reuse existing OAuth refresh, but never expose its raw provider error or tokens to clients.
      const accessToken = await googleAdsAccessToken().catch(() => '');
      if (!accessToken) throw new MarketKeywordsError('Google Ads OAuth failed. Check GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET or replace GOOGLE_ADS_ACCESS_TOKEN. Scope: https://www.googleapis.com/auth/adwords.', 503, 'OAUTH_UNAVAILABLE');
      const headers: Record<string, string> = { authorization: `Bearer ${accessToken}`, 'developer-token': config.developerToken, 'content-type': 'application/json' };
      if (config.loginCustomerId) headers['login-customer-id'] = config.loginCustomerId;
      const customerUrl = `https://googleads.googleapis.com/${config.version}/customers/${config.customerId}`;
      const customer = record(JSON.parse(await sourceText(`${customerUrl}/googleAds:search`, {
        method: 'POST', headers, body: JSON.stringify({ query: 'SELECT customer.currency_code FROM customer LIMIT 1' }),
      })));
      const results = Array.isArray(customer.results) ? customer.results : [];
      const code = record(record(results[0]).customer).currencyCode;
      if (typeof code !== 'string' || !/^[A-Z]{3}$/.test(code)) throw new MarketKeywordsError('Google Ads did not return a valid customer.currency_code. Monetary metrics cannot be labeled or compared.');
      currency = code;
      // REST sample and v25 request/options verified against official documentation, 2026-09-16.
      const payload: unknown = JSON.parse(await sourceText(`${customerUrl}:generateKeywordIdeas`, {
        method: 'POST', headers,
        body: JSON.stringify({ language: 'languageConstants/1012', geoTargetConstants: [`geoTargetConstants/${country.geoCriterion}`],
          keywordPlanNetwork: 'GOOGLE_SEARCH', includeAdultKeywords: false, keywordSeed: { keywords: seeds }, pageSize: 100,
          historicalMetricsOptions: { includeAverageCpc: true } }),
      }));
      ({ rows, hasMore } = parseGoogleKeywordIdeas(payload, currency));
    }
  } catch (error) {
    if (error instanceof MarketKeywordsError) throw error;
    throw new MarketKeywordsError('Google source could not be read within the request limits. Retry later or check the source connection. No substitute data was generated.');
  }
  const relevant = rows.filter((row) => row.relevanceMatches.length > 0);
  const selected = input.relevance === 'diaspora' ? relevant : rows;
  const displayed = sortMarketKeywords(selected, input.sort).slice(0, 100);
  const months = rows.flatMap((row) => row.monthlySearchVolumes.map((entry) => entry.month)).sort();
  return { ...input, country, source: input.mode === 'trends' ? 'Google Trends public RSS' : 'Google Ads Keyword Planner', sourceUrl,
    fetchedAt: new Date().toISOString(), sourceUpdatedAt, rawCount: rows.length, relevantCount: relevant.length,
    returnedCount: displayed.length, hasMore: hasMore || selected.length > 100, limit: 100, currency, seeds, apiVersion,
    historicalMonthRange: months.length ? { start: months[0], end: months[months.length - 1] } : null, rows: displayed };
}
