import type { ContentCategory } from '@/lib/contentSources';
import { getDocument } from '@/lib/firebase';

export type LiveSourceItem = {
  title: string;
  url: string;
  description?: string;
  body?: string;
  image?: string;
  images?: string[];
  publishedAt?: string;
  company?: string;
  location?: string;
  salary?: string;
  tag?: string;
  category?: string;
  phone?: string;
  address?: string;
  lat?: number;
  lng?: number;
  entityType?: string;
  author?: string;
  country?: string;
};

export type SourceContentCandidate = Partial<LiveSourceItem> & {
  id?: string;
  authorId?: string;
  sourceCategory?: string;
  sourceContentId?: string;
  sourceName?: string;
  sourceUrl?: string;
  sourceSnapshot?: boolean;
};

type LiveSourceResponse = {
  sourceName?: string;
  region?: string;
  fetchedAt?: string;
  sections?: Array<{ category: ContentCategory; items: LiveSourceItem[] }>;
  items?: LiveSourceItem[];
};

const navigationTitle = /^(?:홈|메인|목록|목록보기|전체|전체보기|더보기|글쓰기|로그인|회원가입|검색|뉴스|광고|구인구직|EU 구인구직|한인광장|게시판|공지사항|이용약관|개인정보처리방침)$/i;
const jobIntent = /(?:채용|구인|구직|모집|직원|인재|포지션|근무\s*희망|입사|career|vacanc|hiring|\bjob\b)/i;
const jobDetail = /(?:업무|담당|지원|자격|경력|근무|회사|직무|급여|연봉|시급|이력서|면접|모집인원|고용|계약|정규직|파트타임|인턴|employment|apply|resume|salary|position)/i;
const jobTag = /^(?:구인|구직|채용|정규직|파트타임|계약직|인턴|재택근무|원격근무|프리랜서|현지\s*채용|임시직|경력직)$/i;
const jobNoise = /(?:취업\s*사기|유의\s*사항|주의\s*사항|채용\s*(?:동향|뉴스|가이드)|구인구직\s*(?:게시판|목록|안내)|필요하신가요|카지노|도박|코인|투자|고수익|수익\s*보장|다단계|총판|파트너\s*모집|회원\s*모집|체험단|교육생|수강생)/i;
const communityNoise = /(?:한인광장\s*테스트|테스트\s*글|(?:한아시아\s*)?공지사항|커뮤니티\s*운영정책|개인정보(?:처리방침)?|이용약관|앱\s*설치|로그인|회원가입)/i;
const communityPromotion = /(?:교육생\s*모집|수강생\s*모집|추가\s*모집|자격증\s*취득|\d+주\s*완성|체험단|선착순|특가|할인|판매|\bselling\b|구매대행|배송비\s*지원|공식제휴업체|오픈채팅|카카오톡\s*문의|상담\s*(?:예약|문의)|제품을\s*생산|원스톱\s*소싱|서비스를\s*이용|연락\s*주세요)/i;
const directoryNonBusinessCategory = /^(?:organization|church|temple|buddhist_temple|consulate_organization|government|nonprofit|association|공공기관·단체|종교·단체)$/i;
const directoryNonBusinessTitle = /(?:교회|성당|사찰|교당|총영사관|영사관|대사관|한인회|공관|church|temple|consulate|embassy|government\s+office)/i;

export function normalizeSourceText(value: unknown) {
  return String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(x?[0-9a-f]+);/gi, (_, code: string) => {
      const parsed = code.toLowerCase().startsWith('x') ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return Number.isNaN(parsed) ? '' : String.fromCodePoint(parsed);
    })
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeSourceTitle(value: unknown) {
  return normalizeSourceText(value)
    .replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u2600-\u27BF\u2B00-\u2BFF\uFE0F]/gu, ' ')
    .replace(/\s*[_|]\s*/g, ' · ')
    .replace(/\s+([,.:!?])/g, '$1')
    .replace(/([!?])\1{3,}/g, '$1$1')
    .replace(/\s+[–—-]\s+(?:한아시아.*|KBA Europe.*|HANIN TODAY.*)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

export function normalizeSourceBody(value: unknown) {
  return normalizeSourceText(value)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !/^(?:공유|목록|목록보기|다음글|이전글|댓글\s*\d*|로그인|좋아요\s*\d*|싫어요\s*\d*|인쇄)$/i.test(line))
    .join('\n\n')
    .slice(0, 16_000);
}

export function normalizeSourceUrl(value: unknown) {
  try {
    const url = new URL(String(value || ''));
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid|ref|source)$/i.test(key) || (key === 'pageid' && url.searchParams.has('uid'))) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.href;
  } catch {
    return String(value || '').trim();
  }
}

export function isGenuineJobListing(item: SourceContentCandidate) {
  const title = normalizeSourceTitle(item.title);
  const body = normalizeSourceBody(item.body || item.description);
  const company = normalizeSourceText(item.company);
  const location = normalizeSourceText(item.location || item.country);
  const tag = normalizeSourceText(item.tag || item.category);
  const combined = `${title}\n${body}`;
  if (title.length < 4 || navigationTitle.test(title) || jobNoise.test(combined)) return false;
  const hasIntent = jobIntent.test(combined) || jobTag.test(tag);
  const hasStructuredFields = company.length >= 2 && location.length >= 2 && jobTag.test(tag);
  const hasSubstantiveDetail = body.length >= 50 && jobDetail.test(body);
  const hasBoardDetail = /^(?:구인|구직)$/i.test(tag) && body.length >= 35;
  return hasIntent && (hasStructuredFields || hasSubstantiveDetail || hasBoardDetail);
}

export function isSubstantiveCommunityItem(item: SourceContentCandidate) {
  const title = normalizeSourceTitle(item.title);
  const body = normalizeSourceBody(item.body || item.description);
  const category = normalizeSourceText(item.tag || item.category);
  const combined = `${title}\n${body}`;
  if (title.length < 4 || navigationTitle.test(title) || communityNoise.test(title) || communityPromotion.test(combined)) return false;
  if (jobIntent.test(title) && !/(?:취업\s*사기|주의|경험|질문|의견)/i.test(combined)) return false;
  return body.length >= 70 || (body.length >= 40 && (/[?？]|(?:질문|정보|팁|공유|추천|경험|후기|주의|방법|왜|어떻게|ㅋㅋ|ㅎㅎ)/i.test(combined) || /(?:question|tip|free|정보|질문)/i.test(category)));
}

export function isGenuineDirectoryListing(item: SourceContentCandidate) {
  const title = normalizeSourceTitle(item.title);
  const entityType = normalizeSourceText(item.entityType).toLowerCase();
  const category = normalizeSourceText(item.tag || item.category).toLowerCase();
  const address = normalizeSourceText(item.address || item.location);
  const description = normalizeSourceBody(item.description);
  const phoneDigits = normalizeSourceText(item.phone).replace(/\D/g, '');
  const latitude = item.lat;
  const longitude = item.lng;
  const hasCoordinates = typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
  const url = normalizeSourceUrl(item.url || item.sourceUrl);

  if (title.length < 2 || navigationTitle.test(title) || directoryNonBusinessTitle.test(title)) return false;
  if (entityType && entityType !== 'business') return false;
  if (directoryNonBusinessCategory.test(category)) return false;
  if (!entityType && (!category || /^(?:directory|업소|한인 업소)$/i.test(category))) return false;
  if (!address && !hasCoordinates) return false;
  if (address.length < 5 && !hasCoordinates) return false;
  if (phoneDigits.length < 7 && description.length < 20) return false;
  try {
    if (new URL(url).protocol !== 'https:') return false;
  } catch {
    return false;
  }
  return true;
}

export function sourceItemDedupKey(item: SourceContentCandidate, category: ContentCategory) {
  const url = normalizeSourceUrl(item.url || item.sourceUrl);
  if (url) return `${category}:url:${url}`;
  return `${category}:content:${normalizeSourceTitle(item.title).toLocaleLowerCase()}:${normalizeSourceText(item.company || item.author).toLocaleLowerCase()}:${normalizeSourceText(item.location || item.country).toLocaleLowerCase()}`;
}

export function curateSourceItems(items: SourceContentCandidate[], category: ContentCategory) {
  const seenUrls = new Set<string>();
  const seenContent = new Set<string>();
  const curated: LiveSourceItem[] = [];
  for (const item of items) {
    const normalized: LiveSourceItem = {
      ...item,
      title: normalizeSourceTitle(item.title),
      url: normalizeSourceUrl(item.url || item.sourceUrl),
      description: normalizeSourceBody(item.description),
      body: normalizeSourceBody(item.body || item.description),
      company: normalizeSourceText(item.company) || undefined,
      location: normalizeSourceText(item.location) || undefined,
      salary: normalizeSourceText(item.salary) || undefined,
      tag: normalizeSourceText(item.tag || item.category) || undefined,
      author: normalizeSourceText(item.author) || undefined,
      country: normalizeSourceText(item.country) || undefined,
    };
    if (!normalized.title || !normalized.url) continue;
    if (category === 'jobs' && !isGenuineJobListing(normalized)) continue;
    if (category === 'community' && !isSubstantiveCommunityItem(normalized)) continue;
    if (category === 'directory' && !isGenuineDirectoryListing(normalized)) continue;
    const urlKey = sourceItemDedupKey(normalized, category);
    const contentKey = `${category}:${normalized.title.toLocaleLowerCase()}:${normalizeSourceText(normalized.company || normalized.author).toLocaleLowerCase()}:${normalizeSourceText(normalized.location || normalized.country).toLocaleLowerCase()}`;
    if (seenUrls.has(urlKey) || seenContent.has(contentKey)) continue;
    seenUrls.add(urlKey);
    seenContent.add(contentKey);
    curated.push(normalized);
  }
  return curated;
}

export async function fetchSourceCategory(sourceId: string, category: ContentCategory) {
  try {
    const settings = await getDocument<{ disabledSourceIds?: string[] }>('adminSettings', 'contentSources');
    if (settings?.disabledSourceIds?.includes(sourceId)) return null;
    const response = await fetch(`/api/content/preview?source=${encodeURIComponent(sourceId)}&category=${encodeURIComponent(category)}`);
    if (!response.ok) return null;
    const data = await response.json() as LiveSourceResponse;
    const section = data.sections?.find((item) => item.category === category);
    if (!section && !data.items?.length) return null;
    const items = curateSourceItems(section?.items || data.items || [], category);
    if (!items.length) return null;
    return { sourceName: data.sourceName || sourceId, region: data.region || 'Global', fetchedAt: data.fetchedAt || new Date().toISOString(), items };
  } catch {
    return null;
  }
}
