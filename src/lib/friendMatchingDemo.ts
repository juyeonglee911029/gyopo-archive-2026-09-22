import type { OnlineUser } from './firebase';

export const FRIEND_MATCHING_DEMO_COUNT = 159;

const demoRegions = [
  '미국',
  '캐나다',
  '대한민국',
  '일본',
  '호주',
  '독일',
  '영국',
  '프랑스',
  '베트남',
  '필리핀',
  '브라질',
  '뉴질랜드',
  '싱가포르',
];

export const friendMatchingDemoProfiles: OnlineUser[] = Array.from(
  { length: FRIEND_MATCHING_DEMO_COUNT },
  (_, index) => {
    const serial = String(index + 1).padStart(3, '0');
    return {
      id: `demo-member-${serial}`,
      userId: `demo-member-${serial}`,
      name: `테스트 회원 ${serial}`,
      image: '',
      age: 22 + (index % 24),
      country: demoRegions[index % demoRegions.length],
      lastSeenAt: '1970-01-01T00:00:00.000Z',
    };
  },
);
