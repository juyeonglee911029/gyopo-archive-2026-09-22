import { COUNTRY_ROUTES, REGIONAL_CATEGORIES, type CountryRoute } from '@/lib/regionRoutes';

export const ASSET_SEGMENTS = [
  'core', 'countries', 'cities', 'country-jobs', 'country-visa', 'country-tax-finance', 'country-housing', 'country-community',
  'city-jobs', 'city-housing', 'city-community',
] as const;

export const SITEMAP_SEGMENT_LABELS: Record<(typeof ASSET_SEGMENTS)[number], string> = {
  core: '핵심 서비스',
  countries: '국가 허브',
  cities: '도시 허브',
  'country-jobs': '국가·구인구직',
  'country-visa': '국가·이민비자',
  'country-tax-finance': '국가·세금금융',
  'country-housing': '국가·주거',
  'country-community': '국가·커뮤니티',
  'city-jobs': '도시·구인구직',
  'city-housing': '도시·주거',
  'city-community': '도시·커뮤니티',
};

export type AssetSegment = typeof ASSET_SEGMENTS[number];
export type AssetType = 'CORE' | 'COUNTRY' | 'CITY' | 'COUNTRY_CATEGORY' | 'CITY_CATEGORY';
export type KeywordVerification = 'CANDIDATE' | 'APPROVED' | 'VERIFIED_GSC';

export type SearchAsset = {
  id: string;
  targetPath: string;
  primaryIntent: string;
  countryCode: string;
  citySlug: string;
  sitemapSegment: AssetSegment;
  assetType: AssetType;
  important: boolean;
};

export type KeywordSlot = {
  slot: string;
  query: string;
  clusterId: string;
  clusterLabel: string;
  role: 'PRIMARY' | 'SECONDARY' | 'CANDIDATE';
  verification: KeywordVerification;
  source: 'taxonomy' | 'operator' | 'Google Search Console';
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
};

export type AssetKeywordPlan = {
  assetId: string;
  primaryKeyword?: string;
  approvedKeywords?: string[];
  updatedAt?: string;
};

const CORE_ASSETS: Array<[string, string]> = [
  ['/', '전체 교민 포털'],
  ['/regions', '지역별 교민 네트워크'],
  ['/jobs', '해외 한인 구인구직'],
  ['/housing', '해외 한인 주거·월세'],
  ['/guides', '해외생활 가이드'],
  ['/directory', '글로벌 한인 업소록'],
  ['/events', '해외 한인 이벤트'],
  ['/life', '교민 생활 서비스'],
  ['/community', '글로벌 한인 커뮤니티'],
  ['/market', '교민 장터'],
];

const COUNTRY_CATEGORY_SLUGS = [
  ['jobs', '구인구직', 'country-jobs'],
  ['immigration', '이민·비자', 'country-visa'],
  ['tax-finance', '세금·금융', 'country-tax-finance'],
  ['housing', '주거', 'country-housing'],
  ['community', '커뮤니티', 'country-community'],
] as const;

const CITY_CATEGORY_SLUGS = [
  ['jobs', '구인구직', 'city-jobs'],
  ['housing', '주거', 'city-housing'],
  ['community', '커뮤니티', 'city-community'],
] as const;

type KeywordIntent = 'discovery' | 'local' | 'howto' | 'cost' | 'urgent';
type KeywordSeed = { id: string; label: string; intent: KeywordIntent; phrases: readonly string[] };

const KEYWORD_SEEDS: Record<string, readonly KeywordSeed[]> = {
  portal: [
    { id: 'portal-community', label: '교민 커뮤니티 탐색', intent: 'discovery', phrases: ['한인 커뮤니티', '교민 커뮤니티', '재외동포 커뮤니티', '해외 한인 사이트'] },
    { id: 'portal-life', label: '해외생활 정보', intent: 'discovery', phrases: ['해외생활 정보', '해외생활 가이드', '교민 생활 정보', '해외 정착 정보'] },
    { id: 'portal-service', label: '교민 서비스 찾기', intent: 'local', phrases: ['한인 서비스 찾기', '교민 업소록', '한인 업체 찾기', '한국어 서비스'] },
    { id: 'portal-connect', label: '지역 교민 연결', intent: 'local', phrases: ['지역 한인 모임', '한인 모임 찾기', '교민 네트워크', '한인 소식'] },
  ],
  jobs: [
    { id: 'jobs-search', label: '한인 채용·구직', intent: 'local', phrases: ['한인 구인구직', '한국어 구인', '한인 채용', '교민 구직'] },
    { id: 'jobs-sponsor', label: '비자 스폰서·취업', intent: 'howto', phrases: ['비자 스폰서 구인', '취업 스폰서 채용', 'H-1B 구인', '유학생 취업'] },
    { id: 'jobs-local', label: '지역 일자리', intent: 'local', phrases: ['구인', '채용', '알바', '구직'] },
    { id: 'jobs-condition', label: '채용 조건·보상', intent: 'cost', phrases: ['채용 조건', '연봉 정보', '시급 구인', '경력직 채용'] },
  ],
  immigration: [
    { id: 'immigration-visa', label: '비자·체류', intent: 'howto', phrases: ['비자 신청', '이민 비자', '체류 신분 변경', '비자 연장'] },
    { id: 'immigration-residency', label: '영주권·시민권', intent: 'howto', phrases: ['영주권 신청', '시민권 신청', '영주권 조건', '시민권 시험'] },
    { id: 'immigration-professional', label: '이민 전문가 상담', intent: 'local', phrases: ['이민 변호사', '이민 법률 상담', '한인 이민 변호사', '이민 상담'] },
    { id: 'immigration-cost', label: '이민 비용·서류', intent: 'cost', phrases: ['이민 비용', '비자 수수료', '이민 서류 준비', '이민 신청 비용'] },
  ],
  housing: [
    { id: 'housing-rent', label: '렌트·임대', intent: 'local', phrases: ['아파트 렌트', '하우스 렌트', '룸 렌트', '렌트 매물'] },
    { id: 'housing-roommate', label: '룸메이트·서브리스', intent: 'local', phrases: ['룸메이트 구하기', '서브리스', '룸메이트 찾기', '한인 룸메이트'] },
    { id: 'housing-buy', label: '주택 구매', intent: 'howto', phrases: ['집 구매', '주택 매매', '첫 집 구매', '부동산 중개'] },
    { id: 'housing-cost', label: '주거 비용·조건', intent: 'cost', phrases: ['월세 시세', '렌트 가격', '보증금 조건', '주거 비용'] },
  ],
  community: [
    { id: 'community-board', label: '지역 교민 커뮤니티', intent: 'discovery', phrases: ['한인 커뮤니티', '교민 게시판', '지역 한인 게시판', '한인 생활 게시판'] },
    { id: 'community-question', label: '생활 질문·답변', intent: 'howto', phrases: ['교민 질문', '해외생활 질문', '한인 생활 팁', '현지 생활 도움'] },
    { id: 'community-meetup', label: '교민 모임·연결', intent: 'local', phrases: ['한인 모임', '교민 모임', '한국인 모임', '지역 모임'] },
    { id: 'community-latest', label: '최신 지역 소식', intent: 'urgent', phrases: ['교민 최신 소식', '지역 한인 소식', '해외 한인 뉴스', '지역 생활 정보'] },
  ],
  'tax-finance': [
    { id: 'tax-filing', label: '세금 신고·환급', intent: 'howto', phrases: ['세금 신고', '세금 환급', '미국 세금 신고', '교민 세무 상담'] },
    { id: 'tax-bank', label: '은행·신용', intent: 'local', phrases: ['한인 은행', '은행 계좌 개설', '신용점수 관리', '해외 송금'] },
    { id: 'tax-business', label: '사업자·회계', intent: 'howto', phrases: ['사업자 세금', '회계사 추천', '한인 회계사', '사업자 등록'] },
    { id: 'tax-cost', label: '금융 비용·조건', intent: 'cost', phrases: ['세금 계산', '송금 수수료', '대출 조건', '은행 수수료'] },
  ],
  education: [
    { id: 'education-school', label: '학교·학군', intent: 'local', phrases: ['학교 찾기', '학군 정보', '초등학교 추천', '중고등학교 정보'] },
    { id: 'education-korean', label: '한국학교·한글교육', intent: 'local', phrases: ['한글학교', '한국학교', '한인 유치원', '한국어 수업'] },
    { id: 'education-college', label: '유학·대학', intent: 'howto', phrases: ['유학 정보', '대학 입학', '유학생 정보', '학비 정보'] },
    { id: 'education-child', label: '자녀 교육', intent: 'discovery', phrases: ['자녀 교육', '해외 자녀 교육', '과외 찾기', '방과후 프로그램'] },
  ],
  cars: [
    { id: 'cars-buy', label: '차량 구매·판매', intent: 'local', phrases: ['중고차 구매', '차량 판매', '한인 자동차 딜러', '자동차 매매'] },
    { id: 'cars-insurance', label: '자동차 보험', intent: 'cost', phrases: ['자동차 보험', '차량 보험 견적', '한인 보험 에이전트', '자동차 보험료'] },
    { id: 'cars-repair', label: '정비·수리', intent: 'local', phrases: ['자동차 정비', '한인 자동차 정비소', '차량 수리', '자동차 검사'] },
    { id: 'cars-registration', label: '등록·면허', intent: 'howto', phrases: ['차량 등록', '운전면허 갱신', '자동차 등록 방법', '중고차 서류'] },
  ],
  food: [
    { id: 'food-restaurant', label: '한식당·맛집', intent: 'local', phrases: ['한인 식당', '한국 음식점', '한식 맛집', '근처 한식당'] },
    { id: 'food-grocery', label: '한인 마트·식료품', intent: 'local', phrases: ['한인 마트', '한국 식품점', '한국 식재료', '아시안 마트'] },
    { id: 'food-delivery', label: '배달·케이터링', intent: 'local', phrases: ['한식 배달', '한국 음식 배달', '한인 케이터링', '도시락 주문'] },
    { id: 'food-review', label: '맛집 후기·추천', intent: 'discovery', phrases: ['한식당 추천', '한인 맛집 후기', '한국 음식 추천', '지역 맛집'] },
  ],
  safety: [
    { id: 'safety-emergency', label: '긴급·안전 안내', intent: 'urgent', phrases: ['긴급 신고', '현지 응급실', '경찰 연락처', '재외공관 긴급'] },
    { id: 'safety-scam', label: '사기·피해 예방', intent: 'urgent', phrases: ['한인 사기 주의', '해외 사기 피해', '교민 사기 신고', '사기 예방'] },
    { id: 'safety-legal', label: '법률·피해 지원', intent: 'howto', phrases: ['법률 상담', '피해 신고 방법', '한인 법률 도움', '무료 법률 상담'] },
    { id: 'safety-latest', label: '지역 안전 소식', intent: 'urgent', phrases: ['지역 사건 사고', '한인 안전 소식', '현지 치안 정보', '재난 대피 정보'] },
  ],
  freeboard: [
    { id: 'freeboard-life', label: '자유 생활 이야기', intent: 'discovery', phrases: ['해외생활 이야기', '교민 자유게시판', '한인 자유게시판', '해외생활 후기'] },
    { id: 'freeboard-question', label: '교민 질문', intent: 'howto', phrases: ['교민 질문과 답변', '해외생활 궁금한 점', '한인 생활 질문', '현지 정보 질문'] },
  ],
  news: [
    { id: 'news-local', label: '지역 교민 뉴스', intent: 'urgent', phrases: ['지역 한인 뉴스', '해외 한인 뉴스', '교민 뉴스', '현지 뉴스'] },
    { id: 'news-policy', label: '정책·이민 뉴스', intent: 'urgent', phrases: ['이민 정책 뉴스', '비자 변경 소식', '해외 정책 뉴스', '교민 정책 정보'] },
  ],
  events: [
    { id: 'events-community', label: '교민 행사·모임', intent: 'local', phrases: ['한인 행사', '교민 행사', '한국 문화 행사', '한인 모임 일정'] },
    { id: 'events-calendar', label: '지역 일정·티켓', intent: 'urgent', phrases: ['지역 행사 일정', '주말 행사', '한인 콘서트', '한국 축제'] },
  ],
  directory: [
    { id: 'directory-business', label: '한인 업소 찾기', intent: 'local', phrases: ['한인 업소록', '한인 업체 찾기', '한국어 업체', '교민 업체'] },
    { id: 'directory-service', label: '지역 전문 서비스', intent: 'local', phrases: ['한인 변호사', '한인 회계사', '한인 보험', '한인 부동산'] },
  ],
  market: [
    { id: 'market-buy', label: '교민 중고거래', intent: 'local', phrases: ['한인 중고거래', '교민 장터', '중고 물품 판매', '중고 물건 구매'] },
    { id: 'market-rent', label: '렌트·양도 거래', intent: 'local', phrases: ['룸 양도', '렌트 양도', '중고차 판매', '한인 거래'] },
  ],
};

const FALLBACK_KEYWORD_SEEDS: readonly KeywordSeed[] = [
  { id: 'overview', label: '지역 정보 탐색', intent: 'discovery', phrases: ['한인 정보', '교민 정보', '지역 정보', '생활 정보'] },
  { id: 'local', label: '지역 서비스 찾기', intent: 'local', phrases: ['한인 찾기', '근처 한인', '한국어 서비스', '지역 추천'] },
  { id: 'howto', label: '이용 방법·안내', intent: 'howto', phrases: ['신청 방법', '이용 방법', '준비 서류', '문의 방법'] },
  { id: 'cost', label: '비용·조건 비교', intent: 'cost', phrases: ['비용', '가격', '조건', '수수료'] },
];

const KOREAN_COUNTRY_NAMES: Record<string, string> = {
  us: '미국', kr: '한국', cn: '중국', jp: '일본', ca: '캐나다', vn: '베트남', uz: '우즈베키스탄', au: '호주', kz: '카자흐스탄', ru: '러시아', ph: '필리핀', cy: '키프로스', mt: '몰타', lv: '라트비아', ro: '루마니아', pl: '폴란드', ae: '아랍에미리트', pt: '포르투갈', nl: '네덜란드', bg: '불가리아', it: '이탈리아', es: '스페인', fi: '핀란드', uk: '영국', br: '브라질', ar: '아르헨티나', bo: '볼리비아', cl: '칠레', co: '콜롬비아', ec: '에콰도르', gy: '가이아나', py: '파라과이', pe: '페루', sr: '수리남', uy: '우루과이', ve: '베네수엘라', al: '알바니아', ad: '안도라', at: '오스트리아', by: '벨라루스', be: '벨기에', ba: '보스니아 헤르체고비나', hr: '크로아티아', cz: '체코', dk: '덴마크', ee: '에스토니아', fr: '프랑스', de: '독일', gr: '그리스', hu: '헝가리', is: '아이슬란드', ie: '아일랜드', li: '리히텐슈타인', lt: '리투아니아', lu: '룩셈부르크', md: '몰도바', mc: '모나코', me: '몬테네그로', mk: '북마케도니아', no: '노르웨이', sm: '산마리노', rs: '세르비아', sk: '슬로바키아', si: '슬로베니아', se: '스웨덴', ch: '스위스', ua: '우크라이나', va: '바티칸',
};

const KOREAN_CITY_NAMES: Record<string, string> = {
  warsaw: '바르샤바', wroclaw: '브로츠와프', krakow: '크라쿠프', katowice: '카토비체', opole: '오폴레', poznan: '포즈난',
  berlin: '베를린', frankfurt: '프랑크푸르트', munich: '뮌헨', hamburg: '함부르크', paris: '파리', london: '런던', madrid: '마드리드', barcelona: '바르셀로나',
  amsterdam: '암스테르담', rotterdam: '로테르담', rome: '로마', milan: '밀라노', lisbon: '리스본', vienna: '비엔나', prague: '프라하',
  tokyo: '도쿄', osaka: '오사카', beijing: '베이징', shanghai: '상하이', seoul: '서울', busan: '부산', toronto: '토론토', vancouver: '밴쿠버',
};

function assetId(path: string): string {
  return `asset-${path === '/' ? 'root' : path.slice(1).replaceAll('/', '-')}`;
}

function countryLabel(country: CountryRoute): string {
  return KOREAN_COUNTRY_NAMES[country.slug] || country.label || country.english;
}

function addAsset(rows: SearchAsset[], path: string, intent: string, country: string, city: string, segment: AssetSegment, assetType: AssetType, important: boolean) {
  rows.push({ id: assetId(path), targetPath: path, primaryIntent: intent, countryCode: country, citySlug: city, sitemapSegment: segment, assetType, important });
}

export function buildSearchAssetRegistry(): SearchAsset[] {
  const rows: SearchAsset[] = [];
  for (const [path, koreanIntent] of CORE_ASSETS) addAsset(rows, path, koreanIntent, 'GLOBAL', '', 'core', 'CORE', true);
  for (const country of COUNTRY_ROUTES) {
    const location = countryLabel(country);
    addAsset(rows, `/${country.slug}`, `${location} 한인 커뮤니티`, country.isoAlpha2, '', 'countries', 'COUNTRY', true);
    for (const [slug, label, segment] of COUNTRY_CATEGORY_SLUGS) addAsset(rows, `/${country.slug}/${slug}`, `${location} ${label}`, country.isoAlpha2, '', segment, 'COUNTRY_CATEGORY', true);
    for (const city of country.cities) {
      addAsset(rows, `/${country.slug}/${city.slug}`, `${location} ${city.label} 한인 생활`, country.isoAlpha2, city.slug, 'cities', 'CITY', true);
      for (const [slug, label, segment] of CITY_CATEGORY_SLUGS) addAsset(rows, `/${country.slug}/${city.slug}/${slug}`, `${city.label} ${label}`, country.isoAlpha2, city.slug, segment, 'CITY_CATEGORY', false);
    }
  }
  return rows;
}

function categoryForAsset(asset: SearchAsset): { slug: string; label: string } {
  const slug = asset.targetPath.split('/').filter(Boolean).at(-1) || '';
  const category = REGIONAL_CATEGORIES.find((item) => item.slug === slug);
  if (category) return category;
  const core = CORE_ASSETS.find(([path]) => path === asset.targetPath);
  return { slug: core?.[0].slice(1) || 'portal', label: core?.[1] || '교민 정보' };
}

function locationTerms(asset: SearchAsset): string[] {
  if (asset.assetType === 'CORE') return ['해외 한인', '교민', '재외동포', '한인 커뮤니티'];
  const country = COUNTRY_ROUTES.find((item) => item.isoAlpha2 === asset.countryCode);
  const city = country?.cities.find((item) => item.slug === asset.citySlug);
  const countryName = country ? countryLabel(country) : '';
  const cityName = city ? KOREAN_CITY_NAMES[city.slug] || city.label : '';
  return [...new Set([
    cityName,
    cityName && countryName ? `${countryName} ${cityName}` : '',
    countryName,
  ].filter(Boolean))];
}

export function generateKeywordSlots(asset: SearchAsset, plan?: AssetKeywordPlan): KeywordSlot[] {
  const category = categoryForAsset(asset);
  const terms = locationTerms(asset);
  const seeds = KEYWORD_SEEDS[category.slug] || FALLBACK_KEYWORD_SEEDS;
  const modifiers: Array<[string, string]> = [
    ['정보', 'discovery'], ['추천', 'discovery'], ['찾기', 'local'], ['신청', 'howto'], ['조건', 'howto'], ['비용', 'cost'],
    ['후기', 'discovery'], ['최신', 'urgent'], ['안내', 'howto'], ['비교', 'discovery'], ['등록', 'howto'], ['문의', 'local'],
  ];
  const queryExpansions = ['추천', '찾기', '정보', '방법', '조건', '비용', '후기', '안내', '최신', '상담', '온라인', '근처', '전문'];
  const raw: Array<{ query: string; intent: KeywordIntent; clusterId: string; clusterLabel: string }> = [];
  const seenQueries = new Set<string>();
  const add = (query: string, seed: KeywordSeed) => {
    const value = query.replace(/\s+/g, ' ').trim();
    const key = value.toLocaleLowerCase('ko-KR');
    if (value && !seenQueries.has(key)) {
      seenQueries.add(key);
      raw.push({ query: value, intent: seed.intent, clusterId: `${category.slug}-${seed.id}`, clusterLabel: seed.label });
    }
  };
  for (const location of terms) {
    add(`${location} 한인 ${category.label}`, seeds[0]);
    add(`${location} ${category.label} 한인`, seeds[0]);
    add(`${location} ${category.label}`, seeds[0]);
    add(`${location} 교민 ${category.label}`, seeds[0]);
    for (const seed of seeds) for (const phrase of seed.phrases) {
      add(`${location} ${phrase}`, seed);
      for (const expansion of queryExpansions) add(`${location} ${phrase} ${expansion}`, seed);
      if (!phrase.includes('한인') && !phrase.includes('교민')) add(`${location} 한인 ${phrase}`, seed);
    }
    for (const [modifier, intent] of modifiers) {
      const seed = seeds.find((item) => item.intent === intent) || seeds[0];
      add(`${location} ${category.label} ${modifier}`, seed);
      add(`${location} 한인 ${category.label} ${modifier}`, seed);
    }
  }
  for (const [modifier, intent] of modifiers) {
    const seed = seeds.find((item) => item.intent === intent) || seeds[0];
    add(`${category.label} ${modifier} ${terms[0] || '해외 한인'}`, seed);
  }
  const primaryQuery = plan?.primaryKeyword?.trim() || '';
  if (primaryQuery && !raw.some((item) => item.query.toLocaleLowerCase('ko-KR') === primaryQuery.toLocaleLowerCase('ko-KR'))) {
    raw.unshift({ query: primaryQuery, intent: 'discovery', clusterId: `${category.slug}-operator-primary`, clusterLabel: '운영자 지정 대표 키워드' });
  }
  const approved = new Set((plan?.approvedKeywords || []).map((item) => item.trim()).filter(Boolean));
  const rows = raw.slice(0, 80).map((item, index) => ({
    slot: `K${String(index + 1).padStart(2, '0')}`,
    query: item.query,
    clusterId: item.clusterId,
    clusterLabel: item.clusterLabel,
    role: primaryQuery ? item.query.toLocaleLowerCase('ko-KR') === primaryQuery.toLocaleLowerCase('ko-KR') ? 'PRIMARY' as const : index < 8 ? 'SECONDARY' as const : 'CANDIDATE' as const : index === 0 ? 'PRIMARY' as const : index < 8 ? 'SECONDARY' as const : 'CANDIDATE' as const,
    verification: approved.has(item.query) ? 'APPROVED' as const : 'CANDIDATE' as const,
    source: approved.has(item.query) ? 'operator' as const : 'taxonomy' as const,
    clicks: 0,
    impressions: 0,
    ctr: 0,
    position: null,
  }));
  while (rows.length < 80) {
    const index = rows.length;
    rows.push({ slot: `K${String(index + 1).padStart(2, '0')}`, query: '', clusterId: '', clusterLabel: '', role: 'CANDIDATE', verification: 'CANDIDATE', source: 'taxonomy', clicks: 0, impressions: 0, ctr: 0, position: null });
  }
  return rows;
}

function pathname(value: string): string {
  try { return new URL(value).pathname.replace(/\/$/, '') || '/'; } catch { return value.replace(/\/$/, '') || '/'; }
}

export function mergeVerifiedKeywords(asset: SearchAsset, slots: KeywordSlot[], rows: Array<{ query: string; page: string; clicks: number; impressions: number; ctr: number; position: number }>): KeywordSlot[] {
  const verified = rows.filter((row) => pathname(row.page) === asset.targetPath && row.query.trim());
  const byQuery = new Map(slots.filter((slot) => slot.query).map((slot) => [slot.query.toLocaleLowerCase('ko-KR'), slot]));
  for (const row of verified) {
    const key = row.query.toLocaleLowerCase('ko-KR');
    const slot = byQuery.get(key);
    if (slot) {
      slot.verification = 'VERIFIED_GSC';
      slot.source = 'Google Search Console';
      slot.clicks = row.clicks;
      slot.impressions = row.impressions;
      slot.ctr = row.ctr;
      slot.position = row.position || null;
      continue;
    }
    const empty = slots.find((item) => !item.query);
    if (!empty) continue;
    empty.query = row.query;
    empty.clusterId = 'gsc-verified';
    empty.clusterLabel = 'Google이 실제로 확인한 검색어';
    empty.role = 'SECONDARY';
    empty.verification = 'VERIFIED_GSC';
    empty.source = 'Google Search Console';
    empty.clicks = row.clicks;
    empty.impressions = row.impressions;
    empty.ctr = row.ctr;
    empty.position = row.position || null;
  }
  return slots;
}

export function assetKeywordSummary(asset: SearchAsset, slots: KeywordSlot[]) {
  const filled = slots.filter((slot) => slot.query);
  const verified = filled.filter((slot) => slot.verification === 'VERIFIED_GSC');
  const clusters = new Set(filled.map((slot) => slot.clusterId).filter(Boolean));
  return { ...asset, sitemapSegmentLabel: SITEMAP_SEGMENT_LABELS[asset.sitemapSegment], queryCount: filled.length, verifiedQueryCount: verified.length, clusterCount: clusters.size, keywordCluster: filled.slice(0, 8).map((slot) => slot.query) };
}
