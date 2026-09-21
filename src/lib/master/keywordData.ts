import { getCityRoute, getCountryRoute } from '@/lib/regionRoutes';
import { serviceAccountAccessToken } from '@/lib/firebaseAdmin';

export type GoldenKeywordSource = 'Google Search Console' | 'Google Ads';

export type GoldenKeywordRow = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  cpc: number | null;
  country: string;
  city: string;
  category: string;
  page: string;
  sources: GoldenKeywordSource[];
  siteCoverage?: 'ON_SITE' | 'NOT_MAPPED';
};

export type KeywordSourceStatus = 'connected' | 'not_configured' | 'error';

export type KeywordSourceReport = {
  searchConsole: KeywordSourceStatus;
  googleAds: KeywordSourceStatus;
  searchConsoleMessage?: string;
  googleAdsMessage?: string;
};

export type ExposureRow = {
  date: string;
  query: string;
  page: string;
  country: string;
  device: string;
  searchAppearance: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

function numberValue(value: unknown): number {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function googleAdsApiVersion(): string {
  const version = process.env.GOOGLE_ADS_API_VERSION?.trim() || '';
  return /^v[1-9]\d{1,2}$/.test(version) ? version : '';
}

export function keywordDateRange(days: number) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

function pageContext(page: string): Pick<GoldenKeywordRow, 'country' | 'city' | 'category'> {
  if (!page) return { country: '', city: '', category: '' };
  try {
    const pathname = new URL(page).pathname;
    const segments = pathname.split('/').filter(Boolean);
    const countryRoute = segments[0] ? getCountryRoute(segments[0]) : undefined;
    const cityRoute = countryRoute && segments[1] ? getCityRoute(countryRoute.slug, segments[1]) : undefined;
    const route = segments.find((segment) => ['jobs', 'businesses', 'directory', 'market', 'community', 'news', 'events', 'housing', 'immigration', 'education', 'cars', 'tax-finance', 'safety', 'food', 'freeboard'].includes(segment));
    const category = route === 'businesses' || route === 'directory' ? 'directory' : route || '';
    return {
      country: countryRoute?.label || '',
      city: cityRoute?.label || '',
      category,
    };
  } catch {
    return { country: '', city: '', category: '' };
  }
}

type SearchConsolePayload = {
  rows?: Array<{ keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }>;
  error?: { message?: string };
};

async function fetchSearchConsoleRows(accessToken: string, siteUrl: string, startDate: string, endDate: string): Promise<GoldenKeywordRow[]> {
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      startDate,
      endDate,
      dimensions: ['query', 'country', 'page'],
      rowLimit: 1_000,
      dataState: 'final',
    }),
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json().catch(() => null) as SearchConsolePayload | null;
  if (!response.ok) throw new Error(payload?.error?.message || 'Google Search Console이 요청을 처리하지 못했습니다.');

  const rows = new Map<string, GoldenKeywordRow & { weightedPosition: number; weightedCtr: number }>();
  for (const item of payload?.rows || []) {
    const query = String(item.keys?.[0] || '').trim();
    if (!query) continue;
    const countryCode = String(item.keys?.[1] || '').trim().toUpperCase();
    const page = String(item.keys?.[2] || '').trim();
    const context = pageContext(page);
    const impressions = numberValue(item.impressions);
    const clicks = numberValue(item.clicks);
    const key = [query.toLocaleLowerCase(), countryCode, context.city, context.category].join('|');
    const previous = rows.get(key);
    if (previous) {
      previous.clicks += clicks;
      previous.impressions += impressions;
      previous.weightedCtr += numberValue(item.ctr) * impressions;
      previous.weightedPosition += numberValue(item.position) * impressions;
      if (!previous.page && page) previous.page = page;
      continue;
    }
    rows.set(key, {
      query,
      clicks,
      impressions,
      ctr: numberValue(item.ctr),
      position: numberValue(item.position) || null,
      cpc: null,
      country: context.country || countryCode,
      city: context.city,
      category: context.category,
      page,
      sources: ['Google Search Console'],
      siteCoverage: 'ON_SITE',
      weightedPosition: numberValue(item.position) * impressions,
      weightedCtr: numberValue(item.ctr) * impressions,
    });
  }

  return [...rows.values()].map(({ weightedPosition, weightedCtr, ...row }) => ({
    ...row,
    ctr: row.impressions ? weightedCtr / row.impressions : row.ctr,
    position: row.impressions ? weightedPosition / row.impressions : row.position,
  }));
}

export async function googleAdsAccessToken(): Promise<string> {
  const directToken = process.env.GOOGLE_ADS_ACCESS_TOKEN?.trim();
  if (directToken) return directToken;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim();
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  if (!refreshToken || !clientId || !clientSecret) return '';
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json().catch(() => null) as { access_token?: string; error_description?: string } | null;
  if (!response.ok || !payload?.access_token) throw new Error(payload?.error_description || 'Google Ads OAuth 토큰을 가져오지 못했습니다.');
  return payload.access_token;
}

async function googleOAuthAccessToken(prefix: string): Promise<string> {
  const directToken = process.env[`${prefix}_ACCESS_TOKEN`]?.trim();
  if (directToken) return directToken;
  const refreshToken = process.env[`${prefix}_REFRESH_TOKEN`]?.trim();
  const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]?.trim();
  if (!refreshToken || !clientId || !clientSecret) return '';
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json().catch(() => null) as { access_token?: string; error_description?: string } | null;
  if (!response.ok || !payload?.access_token) throw new Error(payload?.error_description || `${prefix} OAuth 토큰을 가져오지 못했습니다.`);
  return payload.access_token;
}

export async function searchConsoleAccessToken(): Promise<string> {
  const oauthToken = await googleOAuthAccessToken('GOOGLE_SEARCH_CONSOLE').catch(() => '');
  if (oauthToken) return oauthToken;
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()) return '';
  return serviceAccountAccessToken('https://www.googleapis.com/auth/webmasters.readonly').catch(() => '');
}

export function searchConsoleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN?.trim() || (
    process.env.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN?.trim()
    && process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID?.trim()
    && process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET?.trim()
  ) || process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim());
}

export function googleAdsConfigured(): boolean {
  const version = googleAdsApiVersion();
  return Boolean(
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim()
    && process.env.GOOGLE_ADS_CUSTOMER_ID?.trim()
    && version
    && (process.env.GOOGLE_ADS_ACCESS_TOKEN?.trim() || (
      process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim()
      && process.env.GOOGLE_ADS_CLIENT_ID?.trim()
      && process.env.GOOGLE_ADS_CLIENT_SECRET?.trim()
    )),
  );
}

type SearchConsoleExposurePayload = {
  rows?: Array<{ keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }>;
  error?: { message?: string };
};

async function querySearchConsoleExposure(accessToken: string, siteUrl: string, startDate: string, endDate: string, dimensions: string[]): Promise<SearchConsoleExposurePayload> {
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ startDate, endDate, dimensions, rowLimit: 25_000, dataState: 'final' }),
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => null) as SearchConsoleExposurePayload | null;
  if (!response.ok) throw new Error(payload?.error?.message || 'Google Search Console 분석을 가져오지 못했습니다.');
  return payload || {};
}

export async function loadExposureRows(days: number, previous = false): Promise<{ rows: ExposureRow[]; source: KeywordSourceStatus; message?: string; range: { startDate: string; endDate: string } }> {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2 - (previous ? days : 0));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  const range = { startDate: isoDate(start), endDate: isoDate(end) };
  const siteUrl = process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL?.trim() || 'https://gyopo.kr/';
  if (!searchConsoleConfigured()) return { rows: [], source: 'not_configured', range };
  try {
    const accessToken = await searchConsoleAccessToken();
    if (!accessToken) return { rows: [], source: 'not_configured', range };
    let payload: SearchConsoleExposurePayload;
    let dimensions = ['date', 'query', 'page', 'country', 'device', 'searchAppearance'];
    try {
      payload = await querySearchConsoleExposure(accessToken, siteUrl, range.startDate, range.endDate, dimensions);
    } catch {
      dimensions = ['date', 'query', 'page', 'country', 'device'];
      payload = await querySearchConsoleExposure(accessToken, siteUrl, range.startDate, range.endDate, dimensions);
    }
    const rows = (payload.rows || []).map((row) => ({
      date: String(row.keys?.[0] || ''),
      query: String(row.keys?.[1] || '').trim(),
      page: String(row.keys?.[2] || '').trim(),
      country: String(row.keys?.[3] || '').trim().toUpperCase(),
      device: String(row.keys?.[4] || '').trim(),
      searchAppearance: dimensions.includes('searchAppearance') ? String(row.keys?.[5] || '').trim() : '',
      clicks: numberValue(row.clicks),
      impressions: numberValue(row.impressions),
      ctr: numberValue(row.ctr),
      position: numberValue(row.position),
    })).filter((row) => row.query || row.page);
    return { rows, source: 'connected', range };
  } catch (error) {
    return { rows: [], source: 'error', message: error instanceof Error ? error.message : 'Search Console 분석을 가져오지 못했습니다.', range };
  }
}

type AdsPayload = Array<{ results?: Array<{ adGroupCriterion?: { keyword?: { text?: string } }; metrics?: { clicks?: string | number; impressions?: string | number; ctr?: number; averageCpcMicros?: string | number } }> }>;

async function fetchGoogleAdsRows(accessToken: string, developerToken: string, customerId: string, loginCustomerId: string, version: string, startDate: string, endDate: string): Promise<GoldenKeywordRow[]> {
  const query = `SELECT ad_group_criterion.keyword.text, metrics.clicks, metrics.impressions, metrics.ctr, metrics.average_cpc_micros FROM keyword_view WHERE segments.date BETWEEN '${startDate}' AND '${endDate}' AND ad_group_criterion.status = 'ENABLED'`;
  const endpoint = `https://googleads.googleapis.com/${version}/customers/${customerId.replace(/-/g, '')}/googleAds:searchStream`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'developer-token': developerToken,
      ...(loginCustomerId ? { 'login-customer-id': loginCustomerId } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null) as AdsPayload | { error?: { message?: string } } | null;
  if (!response.ok) throw new Error((payload && 'error' in payload ? payload.error?.message : '') || 'Google Ads가 요청을 처리하지 못했습니다.');
  const rows = new Map<string, GoldenKeywordRow>();
  for (const chunk of (Array.isArray(payload) ? payload : [])) {
    for (const result of chunk.results || []) {
      const queryText = String(result.adGroupCriterion?.keyword?.text || '').trim();
      if (!queryText) continue;
      const metrics = result.metrics || {};
      const key = queryText.toLocaleLowerCase();
      const previous = rows.get(key);
      const clicks = numberValue(metrics.clicks);
      const impressions = numberValue(metrics.impressions);
      const cpc = numberValue(metrics.averageCpcMicros) / 1_000_000;
      if (previous) {
        previous.clicks += clicks;
        previous.impressions += impressions;
        previous.ctr = previous.impressions ? previous.clicks / previous.impressions : previous.ctr;
        previous.cpc = cpc || previous.cpc;
      } else {
        rows.set(key, { query: queryText, clicks, impressions, ctr: numberValue(metrics.ctr), position: null, cpc: cpc || null, country: '', city: '', category: '', page: '', sources: ['Google Ads'], siteCoverage: 'NOT_MAPPED' });
      }
    }
  }
  return [...rows.values()];
}

export async function loadGoldenKeywordRows(days: number): Promise<{ rows: GoldenKeywordRow[]; sources: KeywordSourceReport; range: { startDate: string; endDate: string } }> {
  const { startDate, endDate } = keywordDateRange(days);
  const siteUrl = process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL?.trim() || 'https://gyopo.kr/';
  const searchConsoleToken = searchConsoleConfigured() ? await searchConsoleAccessToken().catch(() => '') : '';
  const adsDeveloperToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() || '';
  const adsCustomerId = process.env.GOOGLE_ADS_CUSTOMER_ID?.trim() || '';
  const adsLoginCustomerId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim() || '').replace(/-/g, '');
  const adsVersion = googleAdsApiVersion();
  const adsAccessConfigured = Boolean(process.env.GOOGLE_ADS_ACCESS_TOKEN?.trim() || (process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim() && process.env.GOOGLE_ADS_CLIENT_ID?.trim() && process.env.GOOGLE_ADS_CLIENT_SECRET?.trim()));
  const adsConfigured = Boolean(adsDeveloperToken && adsCustomerId && adsVersion && adsAccessConfigured);
  const sources: KeywordSourceReport = {
    searchConsole: searchConsoleToken ? 'connected' : searchConsoleConfigured() ? 'error' : 'not_configured',
    googleAds: adsConfigured ? 'connected' : 'not_configured',
  };
  if (!adsConfigured && (adsDeveloperToken || adsCustomerId || adsAccessConfigured)) sources.googleAdsMessage = 'Google Ads Developer Token·Customer ID·API version·OAuth 연결을 모두 설정해야 합니다.';
  const results = await Promise.allSettled([
    searchConsoleToken ? fetchSearchConsoleRows(searchConsoleToken, siteUrl, startDate, endDate) : Promise.resolve([]),
    adsConfigured ? googleAdsAccessToken().then((token) => token ? fetchGoogleAdsRows(token, adsDeveloperToken, adsCustomerId, adsLoginCustomerId, adsVersion, startDate, endDate) : []) : Promise.resolve([]),
  ]);
  const searchConsoleRows = results[0].status === 'fulfilled' ? results[0].value : [];
  const adsRows = results[1].status === 'fulfilled' ? results[1].value : [];
  if (results[0].status === 'rejected') {
    sources.searchConsole = 'error';
    sources.searchConsoleMessage = results[0].reason instanceof Error ? results[0].reason.message : 'Search Console 데이터를 가져오지 못했습니다.';
  }
  if (results[1].status === 'rejected') {
    sources.googleAds = 'error';
    sources.googleAdsMessage = results[1].reason instanceof Error ? results[1].reason.message : 'Google Ads 데이터를 가져오지 못했습니다.';
  }

  const merged = new Map<string, GoldenKeywordRow>();
  for (const row of [...searchConsoleRows, ...adsRows]) {
    const key = row.query.toLocaleLowerCase();
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...row, sources: [...row.sources] });
      continue;
    }
    existing.sources = [...new Set([...existing.sources, ...row.sources])];
    if (row.siteCoverage === 'ON_SITE') existing.siteCoverage = 'ON_SITE';
    if (!existing.clicks && row.clicks) existing.clicks = row.clicks;
    if (!existing.impressions && row.impressions) existing.impressions = row.impressions;
    if (!existing.ctr && row.ctr) existing.ctr = row.ctr;
    if (existing.position === null && row.position !== null) existing.position = row.position;
    if (existing.cpc === null && row.cpc !== null) existing.cpc = row.cpc;
    if (!existing.country && row.country) existing.country = row.country;
    if (!existing.city && row.city) existing.city = row.city;
    if (!existing.category && row.category) existing.category = row.category;
    if (!existing.page && row.page) existing.page = row.page;
  }

  return { rows: [...merged.values()].sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks), sources, range: { startDate, endDate } };
}
