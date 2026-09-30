export const KORNED_ORIGIN = 'http://korned.org';
export const KORNED_LINKS_VERIFIED_ON = '2026-09-30';

export const KORNED_GROUPS = [
  {
    id: 'boards',
    title: '커뮤니티 게시판',
    links: [
      {
        id: 'freeboard',
        title: '자유게시판',
        description: '네덜란드 한인 커뮤니티의 생활 글과 소식을 원문에서 확인합니다.',
        href: `${KORNED_ORIGIN}/board/`,
      },
      {
        id: 'jobseekers',
        title: '구직 게시판',
        description: '일자리를 찾는 교민이 올린 게시글 목록을 확인합니다.',
        href: `${KORNED_ORIGIN}/%EA%B5%AC%EC%A7%81/`,
      },
      {
        id: 'market',
        title: '장터',
        description: '판매·구매 게시글을 원문 게시판에서 확인합니다.',
        href: `${KORNED_ORIGIN}/market/`,
      },
    ],
  },
  {
    id: 'work',
    title: '구인·구직',
    links: [
      {
        id: 'jobs-hub',
        title: '구인·구직 안내',
        description: '한인회가 안내하는 구인·구직 게시판으로 이동합니다.',
        href: `${KORNED_ORIGIN}/job/`,
      },
      {
        id: 'employer-guide',
        title: '구인 공고 안내',
        description: '공고 등록 절차와 게시 조건은 원문에서 확인하세요.',
        href: `${KORNED_ORIGIN}/%EA%B5%AC%EC%9D%B8-%EC%9D%BC%EB%B0%98/`,
      },
    ],
  },
  {
    id: 'news',
    title: '한인회 소식',
    links: [
      {
        id: 'newsletter',
        title: '한인회 소식지',
        description: '네덜란드 한인회가 제공하는 소식지 페이지입니다.',
        href: `${KORNED_ORIGIN}/blog/`,
      },
      {
        id: 'notices',
        title: '공지사항',
        description: '한인회 공지사항 원문 페이지입니다.',
        href: `${KORNED_ORIGIN}/%EA%B3%B5%EC%A7%80%EC%82%AC%ED%95%AD/`,
      },
    ],
  },
  {
    id: 'community-info',
    title: '교민 생활 정보',
    links: [
      {
        id: 'community-guide',
        title: '교민사회 한눈에 보기',
        description: '공공기관·교육기관·교민단체 등 연락처와 링크를 원문에서 확인합니다.',
        href: `${KORNED_ORIGIN}/info/`,
      },
    ],
  },
] as const;
