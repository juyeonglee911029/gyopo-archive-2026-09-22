import { CONTENT_SOURCES } from '../contentSources';
import { getCountryRoute } from '../regionRoutes';
import { sourceAllowsUrl } from './editorialDiscovery';
import { loadGoogleMarketKeywords, parseMarketRequest } from './googleMarketKeywords';

export type EditorialDiscoveryMode = 'trends' | 'ideas' | 'official-topics';
export type EditorialCandidate = { country: string; keyword: string; source: EditorialDiscoveryMode; metric: string; sourceUrl: string };

export async function loadEditorialCandidates(countryCode: string, mode: EditorialDiscoveryMode, query = '') {
  const country = getCountryRoute(countryCode);
  if (!country || !['trends', 'ideas', 'official-topics'].includes(mode) || query.length > 80) throw new Error('Invalid candidate request.');
  let rows: EditorialCandidate[];
  let description: string;
  if (mode === 'official-topics') {
    rows = CONTENT_SOURCES.filter((source) => source.trust === 'official' && (source.kind === 'government' || source.id === 'busan-film-festival')
      && (source.region === country.id || source.regions?.includes(country.id))).flatMap((source) => (source.crawlPaths || []).flatMap((topic) => {
        try {
          const sourceUrl = new URL(topic.path, source.url).href;
          return sourceAllowsUrl(sourceUrl, source) ? [{ country: country.isoAlpha2, keyword: topic.label, source: mode, metric: '검색량·순위 미제공', sourceUrl }] : [];
        } catch { return []; }
      }));
    description = '등록된 공식 기관의 교민 생활 주제입니다. 급상승 순위나 검색량이 아니며 Google Ads 없이 사용할 수 있습니다.';
  } else {
    const request = parseMarketRequest(new URLSearchParams({ country: country.isoAlpha2, mode, query: mode === 'ideas' ? query : '', relevance: 'all', sort: mode === 'trends' ? 'recent' : 'volume' }));
    const feed = await loadGoogleMarketKeywords(request);
    rows = feed.rows.map((row) => ({ country: country.isoAlpha2, keyword: row.query, source: mode, sourceUrl: feed.sourceUrl,
      metric: mode === 'trends' ? `근사 검색 규모 ${row.approximateTraffic || '미제공'}` : `월평균 ${row.avgMonthlySearches ?? '미제공'} / CPC ${row.averageCpc === null ? '미제공' : `${row.averageCpc} ${row.currency || ''}`}`,
    }));
    description = mode === 'trends' ? 'Google Trends가 실제 반환한 급상승 검색어입니다. 교민 관련성은 별도 검토가 필요합니다. 100개를 채우기 위해 가짜 행을 만들지 않습니다.'
      : 'Google Keyword Planner 실제 결과입니다. OpenAI 키는 Google Ads API 연결을 대신하지 않습니다.';
  }
  const term = query.toLocaleLowerCase().trim();
  rows = rows.filter((row, index, all) => all.findIndex((item) => item.keyword.toLocaleLowerCase() === row.keyword.toLocaleLowerCase()) === index)
    .filter((row) => mode === 'ideas' || !term || row.keyword.toLocaleLowerCase().includes(term)).slice(0, 100);
  return { country: country.isoAlpha2, mode, rows, count: rows.length, limit: 100, description, fetchedAt: new Date().toISOString() };
}
