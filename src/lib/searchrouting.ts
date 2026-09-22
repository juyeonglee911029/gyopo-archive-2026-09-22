export type PortalSearchRoute = {
  mode: 'PORTAL';
  href: string;
  label: string;
};

const HOT_KEYWORD_ROUTES: Array<{ aliases: string[]; href: string; label: string }> = [
  { aliases: ['구인', '구인구직', '일자리', 'jobs', 'job'], href: '/jobs', label: '구인·구직' },
  { aliases: ['업소록', '업체', '업소', 'directory'], href: '/directory', label: '업소록' },
  { aliases: ['생활', '생활정보', '생활 가이드', '가이드', 'guides'], href: '/life', label: '생활 가이드' },
  { aliases: ['주거', '집', 'housing'], href: '/life', label: '주거·생활' },
  { aliases: ['지역', '지역보기', 'regions'], href: '/regions', label: '지역 둘러보기' },
  { aliases: ['뉴스', '지역 뉴스', '오늘의 뉴스', 'news'], href: '/news', label: '오늘의 뉴스' },
  { aliases: ['커뮤니티', 'community'], href: '/community', label: '커뮤니티' },
  { aliases: ['장터', 'market'], href: '/market', label: '장터' },
  { aliases: ['korean stuff', 'koreanstuff', '한국 상품', '한국 쇼핑'], href: '/korean-stuff', label: 'KOREAN STUFF' },
  { aliases: ['음악', 'music'], href: '/music', label: '음악' },
];

export function resolvePortalSearch(query: string): PortalSearchRoute | null {
  const normalized = query.trim().toLocaleLowerCase('ko-KR');
  if (!normalized) return null;
  const route = HOT_KEYWORD_ROUTES.find((item) => item.aliases.some((alias) => alias.toLocaleLowerCase('ko-KR') === normalized));
  return route ? { mode: 'PORTAL', href: route.href, label: route.label } : null;
}

export const HOT_SEARCH_KEYWORDS = HOT_KEYWORD_ROUTES.map((item) => item.aliases[0]);
