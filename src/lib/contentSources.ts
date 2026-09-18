import type { RegionId } from '@/lib/regions';

export type ContentCategory = 'news' | 'directory' | 'jobs' | 'market' | 'events' | 'community';
export type SourceTrust = 'official' | 'verified' | 'review';

export type ContentSource = {
  id: string;
  region: RegionId;
  name: string;
  url: string;
  kind: 'government' | 'association' | 'news' | 'business';
  categories: ContentCategory[];
  trust: SourceTrust;
  autoImport: boolean;
  note: string;
  regions?: RegionId[];
  crawlPaths?: Array<{ category: ContentCategory; label: string; path: string }>;
};

// Only sources with a public, human-readable origin are listed here.
// A source is never auto-published until its feed/parser has been reviewed.
export const CONTENT_SOURCES: ContentSource[] = [
  // Individual topic URLs verified against official pages on 2026-09-16; never auto-published.
  { id: 'usagov-guides', region: 'USA', name: 'USAGov', url: 'https://www.usa.gov/', kind: 'government', categories: ['news', 'community'], trust: 'official', autoImport: false, note: '미국 비자·입국·체류·주거·정착 공식 안내 visa immigration housing', crawlPaths: [
    { category: 'community', label: '관광 방문 비자 B-1 B-2 tourist visitor visa', path: '/tourist-visa' },
    { category: 'community', label: 'ESTA 무비자 비자면제 여행허가 Visa Waiver Program', path: '/visa-waiver-esta' },
    { category: 'community', label: '체류 연장 I-539 stay extension', path: '/extend-visa' },
    { category: 'community', label: '운전 국제운전면허 면허증 IDP driving license', path: '/non-citizen-driving' },
    { category: 'community', label: '임대 주거 임차인 분쟁 tenant rights housing', path: '/tenant-rights' },
  ] },
  { id: 'uscis-guides', region: 'USA', name: 'USCIS', url: 'https://www.uscis.gov/', kind: 'government', categories: ['news', 'community'], trust: 'official', autoImport: false, note: '미국 영주권·체류·주소 변경 공식 안내 green card immigration address', crawlPaths: [
    { category: 'community', label: '영주권 자격 green card eligibility', path: '/green-card/green-card-eligibility-categories' },
    { category: 'community', label: '이사 주소 변경 address change AR-11', path: '/addresschange' },
  ] },
  { id: 'cbp-guides', region: 'USA', name: 'U.S. Customs and Border Protection', url: 'https://www.cbp.gov/', kind: 'government', categories: ['news', 'community'], trust: 'official', autoImport: false, note: '미국 입출국·I-94·ESTA 공식 안내', crawlPaths: [
    { category: 'community', label: 'I-94 입출국 기록 체류기간 arrival departure record', path: '/travel/international-visitors/i-94' },
  ] },
  { id: 'ssa-guides', region: 'USA', name: 'Social Security Administration', url: 'https://www.ssa.gov/', kind: 'government', categories: ['community'], trust: 'official', autoImport: false, note: '미국 사회보장번호 SSN 공식 안내', crawlPaths: [
    { category: 'community', label: 'SSN 사회보장번호 신규 영주권자 Social Security immigrant visa', path: '/ssnvisa/Handout_11_1.html' },
  ] },
  { id: 'irs-guides', region: 'USA', name: 'Internal Revenue Service', url: 'https://www.irs.gov/', kind: 'government', categories: ['community'], trust: 'official', autoImport: false, note: '미국 세금·ITIN 공식 안내 tax', crawlPaths: [
    { category: 'community', label: 'ITIN 납세자 식별번호 세금 taxpayer identification tax', path: '/tin/itin/individual-taxpayer-identification-number-itin' },
  ] },
  { id: 'healthcare-guides', region: 'USA', name: 'HealthCare.gov', url: 'https://www.healthcare.gov/', kind: 'government', categories: ['community'], trust: 'official', autoImport: false, note: '미국 건강보험 공식 안내 insurance healthcare', crawlPaths: [
    { category: 'community', label: '건강보험 의료보험 이민자 Marketplace Medicaid CHIP health insurance', path: '/immigrants/lawfully-present-immigrants/' },
  ] },
  { id: 'bea-guides', region: 'USA', name: 'Bureau of Economic Analysis', url: 'https://www.bea.gov/', kind: 'government', categories: ['news', 'community'], trust: 'official', autoImport: false, note: '미국 물가·지역 가격지수 통계 prices cost of living', crawlPaths: [
    { category: 'community', label: '물가 생활비 지역 가격지수 RPP regional price parities cost living', path: '/data/prices-inflation/regional-price-parities-state-and-metro-area' },
  ] },
  { id: 'nps-guides', region: 'USA', name: 'National Park Service', url: 'https://www.nps.gov/', kind: 'government', categories: ['community'], trust: 'official', autoImport: false, note: '미국 국립공원 여행·예약·안전 공식 안내 travel parks', crawlPaths: [
    { category: 'community', label: '국립공원 여행 방문 예약 안전 national parks travel visit', path: '/planyourvisit/index.htm' },
  ] },
  { id: 'busan-film-festival', region: 'SouthKorea', name: '부산국제영화제 공식 홈페이지', url: 'https://www.biff.kr/', kind: 'association', categories: ['news', 'events'], trust: 'official', autoImport: false, note: '부산국제영화제 공식 일정·상영·예매 안내', crawlPaths: [
    { category: 'events', label: '부산국제영화제 영화제 일정 상영 시간표 티켓 예매', path: '/pop/20260917_1400/schedule_kor.asp' },
  ] },
  { id: 'korea-net', region: 'Global', name: 'Korea.net · KOCIS', url: 'https://www.korea.net/', kind: 'government', categories: ['news', 'events'], trust: 'official', autoImport: false, note: '대한민국 문화체육관광부 해외홍보 포털' },
  { id: 'korea-herald', region: 'Global', name: 'The Korea Herald', url: 'https://www.koreaherald.com/', kind: 'news', categories: ['news'], trust: 'verified', autoImport: false, note: '영문 한국 뉴스 매체' },
  { id: 'kafla', region: 'USA-LA', name: 'Korean American Federation of Los Angeles', url: 'https://kafla.info/', kind: 'association', categories: ['news', 'directory', 'events'], trust: 'official', autoImport: false, note: 'LA 한인회 공식 사이트' },
  { id: 'la-kacc', region: 'USA-LA', name: 'Korean American Chamber of Commerce of Los Angeles', url: 'https://lakacc.com/', kind: 'business', categories: ['directory', 'jobs', 'events'], trust: 'official', autoImport: false, note: 'LA 한미상공회의소 공식 사이트' },
  { id: 'kiwa', region: 'USA-LA', name: 'Koreatown Immigrant Workers Alliance', url: 'https://kiwa.org/', kind: 'association', categories: ['news', 'jobs', 'events'], trust: 'official', autoImport: false, note: 'LA 코리아타운 이민자·노동자 지원 단체' },
  { id: 'kccla', region: 'USA-LA', name: 'Korean Cultural Center Los Angeles', url: 'https://kccla.org/', kind: 'government', categories: ['news', 'events'], trust: 'official', autoImport: false, note: 'LA 한국문화원·총영사관 문화행사 정보' },
  { id: 'kapn', region: 'USA', name: 'Korean American Professional Network', url: 'https://kapn.org/', kind: 'association', categories: ['jobs', 'events'], trust: 'verified', autoImport: false, note: '미국 한인 전문인 네트워크' },
  { id: 'kba-europe-jobs', region: 'Global', regions: ['Germany', 'Netherlands', 'Hungary', 'Spain', 'Portugal', 'Romania', 'Malta'], name: 'KBA Europe · EU Job Search', url: 'https://kba-europe.com/member/eu-job-search/', kind: 'business', categories: ['jobs'], trust: 'official', autoImport: true, note: '유럽한국기업연합회가 확인·게시하는 유럽 현지 채용 공고', crawlPaths: [{ category: 'jobs', label: 'EU 구인구직', path: '/member/eu-job-search/' }] },
  { id: 'brazil-korea', region: 'Brazil', name: 'BrazilKorea', url: 'https://brazilkorea.com.br/', kind: 'news', categories: ['news', 'events'], trust: 'verified', autoImport: false, note: '브라질·한국 관계 및 현지 한국 문화 뉴스' },
  { id: 'hanin-argentina', region: 'Argentina', name: '재아르헨티나 한인회 · Hanin', url: 'https://hanin.org.ar/', kind: 'association', categories: ['news', 'jobs', 'community', 'events'], trust: 'official', autoImport: true, note: '재아르헨티나 한인회 공식 안내와 교민 소식', crawlPaths: [{ category: 'news', label: '한인회 소식', path: '/' }, { category: 'community', label: '교민 소식', path: '/?page_id=70' }] },
  { id: 'chile-hanin', region: 'Chile', name: '칠레 한인회', url: 'https://chilehanin.cl/', kind: 'association', categories: ['news', 'jobs', 'community', 'directory'], trust: 'official', autoImport: true, note: '칠레 한인회 공지·한인신문·업소·생활 게시판', crawlPaths: [{ category: 'news', label: '한인회 소식', path: '/' }, { category: 'community', label: '한인 소식', path: '/' }, { category: 'directory', label: '한인 업소', path: '/' }] },
  { id: 'paraguay-korean-association', region: 'Paraguay', name: '재파라과이 한인회', url: 'https://www.asocoreapy.org.py/', kind: 'association', categories: ['news', 'jobs', 'community', 'events'], trust: 'official', autoImport: true, note: '재파라과이 한인회 공식 행사·공지·교민 소식', crawlPaths: [{ category: 'news', label: '한인회 소식', path: '/' }, { category: 'community', label: '교민 소식', path: '/' }] },
  { id: 'panama-korean-association', region: 'Panama', name: '파나마 한인회', url: 'https://sites.google.com/view/koreanpanama', kind: 'association', categories: ['news', 'jobs', 'community', 'directory'], trust: 'verified', autoImport: true, note: '파나마 한인회 공지·월간 소식지·한인 업체 안내' },
  { id: 'uruguay-korean-embassy', region: 'Global', regions: ['Uruguay'], name: '주우루과이 대한민국 대사관', url: 'https://ury.mofa.go.kr/', kind: 'government', categories: ['news', 'events', 'jobs'], trust: 'official', autoImport: true, note: '우루과이 공관 공지·영사·동포 행사 정보' },
  {
    id: 'hanintoday-brazil',
    region: 'Brazil',
    name: '한인투데이 · HANIN TODAY',
    url: 'https://hanintoday.com.br/',
    kind: 'news',
    categories: ['news', 'jobs', 'directory', 'market', 'events', 'community'],
    trust: 'official',
    autoImport: true,
    note: '브라질 한인 뉴스·구인구직·업소·공동구매·장터·한인광장 통합 사이트',
    crawlPaths: [
      { category: 'news', label: '한인뉴스', path: '/news' },
      { category: 'jobs', label: '구인구직', path: '/jobs' },
      { category: 'directory', label: '업소', path: '/businesses' },
      { category: 'events', label: '공동구매', path: '/group-buying' },
      { category: 'market', label: '중고장터', path: '/market' },
      { category: 'community', label: '한인광장', path: '/community' },
    ],
  },
  { id: 'kccbrazil', region: 'Brazil', name: 'Centro Cultural Coreano no Brasil', url: 'https://brazil.korean-culture.org/', kind: 'government', categories: ['news', 'events'], trust: 'official', autoImport: false, note: '주브라질한국문화원 공식 사이트' },
  { id: 'miargentina', region: 'Argentina', name: 'MIArgentina', url: 'https://miargentina.us/', kind: 'association', categories: ['news', 'events'], trust: 'verified', autoImport: false, note: '아르헨티나 생활·커뮤니티 정보' },
  { id: 'spain-embassy', region: 'Spain', name: '주스페인 대한민국 대사관', url: 'https://overseas.mofa.go.kr/es-ko/index.do', kind: 'government', categories: ['news', 'events'], trust: 'official', autoImport: false, note: '공관 공지·영사·재외국민 정보' },
  { id: 'adece', region: 'Spain', name: 'ADECCE', url: 'https://adecce.blogspot.com/', kind: 'association', categories: ['news', 'events'], trust: 'verified', autoImport: false, note: '스페인 한국학·문화 교류 단체' },
  { id: 'spainagain-koreans', region: 'Spain', name: 'Spain Again · 스페인 어게인', url: 'https://spainagain.net/koreans-in-spain/', kind: 'news', categories: ['news', 'community', 'jobs', 'directory', 'events'], trust: 'verified', autoImport: true, note: '스페인 한인 최신 커뮤니티·생활 정보·구인구직 출처', crawlPaths: [{ category: 'community', label: '스페인 한인 커뮤니티', path: '/koreans-in-spain/' }, { category: 'jobs', label: '스페인 구인구직', path: '/koreans-in-spain/' }] },
  { id: 'gutentag-korea', region: 'Germany', name: 'Gutentag Korea', url: 'https://gutentagkorea.com/', kind: 'news', categories: ['news', 'community', 'directory', 'jobs', 'events'], trust: 'verified', autoImport: false, note: '독일 한인 뉴스·구인구직·업소록·생활·행사 정보 출처' },
  { id: 'naver-news', region: 'Global', name: '네이버 뉴스', url: 'https://news.naver.com/', kind: 'news', categories: ['news'], trust: 'verified', autoImport: false, note: '정치·경제·사회·세계·연예·생활 분야 최신 공개 뉴스', crawlPaths: [{ category: 'news', label: '정치', path: '/section/100' }, { category: 'news', label: '사회', path: '/section/102' }, { category: 'news', label: '생활·여행', path: '/section/103' }, { category: 'news', label: '세계', path: '/section/104' }, { category: 'news', label: '연예', path: '/section/106' }] },
  { id: 'nlkrg', region: 'Netherlands', name: 'Netherlands Korean Rights Group', url: 'https://nlkrg.nl/', kind: 'association', categories: ['news', 'events'], trust: 'verified', autoImport: false, note: '네덜란드 입양 한인 권리 단체' },
  { id: 'ksan', region: 'Netherlands', name: 'Korean Students Association in the Netherlands', url: 'https://linktr.ee/ksan_marketing', kind: 'association', categories: ['jobs', 'events'], trust: 'verified', autoImport: false, note: '네덜란드 한인 학생 커뮤니티' },
  { id: 'dkw', region: 'Germany', name: 'Deutsch-Koreanischer Wirtschaftskreis', url: 'https://korea-dkw.de/', kind: 'business', categories: ['directory', 'jobs', 'events'], trust: 'verified', autoImport: false, note: '독일·한국 경제 교류 단체' },
  { id: 'dekrforum', region: 'Germany', name: 'Deutsch-Koreanisches Forum', url: 'https://dekrforum.de/', kind: 'association', categories: ['news', 'events'], trust: 'verified', autoImport: false, note: '독일·한국 정치·경제·문화 교류 포럼' },
  { id: 'hanasia-thailand', region: 'Thailand', name: '한아시아 · HANASIA', url: 'https://www.hanasia.com/%EA%B5%AC%EC%9D%B8%EA%B5%AC%EC%A7%81', kind: 'news', categories: ['jobs', 'community'], trust: 'verified', autoImport: true, note: '태국 한인 구인구직과 회원 작성 생활정보 게시판', crawlPaths: [{ category: 'jobs', label: '구인구직', path: '/구인구직' }, { category: 'community', label: '게시판', path: '/게시판' }] },
  { id: 'kocham-vietnam', region: 'Vietnam', name: 'KOCHAM Vietnam', url: 'https://kocham.kr/', kind: 'business', categories: ['news', 'directory', 'jobs', 'community', 'events'], trust: 'official', autoImport: true, note: '베트남 한인상공인 뉴스·기업·채용·커뮤니티 정보' },
];

export const REVIEW_REGIONS: RegionId[] = ['Chile', 'Colombia', 'Bolivia', 'Paraguay', 'Panama', 'Mexico', 'Portugal', 'Romania', 'Hungary', 'Malta', 'Thailand'];

export function sourceItemId(sourceId: string, category: string, url: string) {
  let hash = 0;
  for (const character of `${sourceId}:${category}:${url}`) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `source-${sourceId}-${category}-${hash.toString(36)}`;
}

export function sourcesForRegion(region: string) {
  return CONTENT_SOURCES.filter((source) => source.region === 'Global' || source.region === region);
}
