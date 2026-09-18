import { COUNTRY_LOCATIONS } from './locations';

const LEGACY_REGIONS = [
  { id: 'Global', label: '전체 지역', short: '전체', flag: '🌐' },
  { id: 'SouthKorea', label: '대한민국', short: '한국', flag: '🇰🇷' },
  { id: 'USA', label: '미국 전체', short: '미국', flag: '🇺🇸' },
  { id: 'USA-LA', label: '미국 · 로스앤젤레스', short: 'LA', flag: '🇺🇸' },
  { id: 'Brazil', label: '브라질', short: '브라질', flag: '🇧🇷' },
  { id: 'Argentina', label: '아르헨티나', short: '아르헨티나', flag: '🇦🇷' },
  { id: 'Chile', label: '칠레', short: '칠레', flag: '🇨🇱' },
  { id: 'Colombia', label: '콜롬비아', short: '콜롬비아', flag: '🇨🇴' },
  { id: 'Bolivia', label: '볼리비아', short: '볼리비아', flag: '🇧🇴' },
  { id: 'Paraguay', label: '파라과이', short: '파라과이', flag: '🇵🇾' },
  { id: 'Uruguay', label: '우루과이', short: '우루과이', flag: '🇺🇾' },
  { id: 'Panama', label: '파나마', short: '파나마', flag: '🇵🇦' },
  { id: 'Mexico', label: '멕시코', short: '멕시코', flag: '🇲🇽' },
  { id: 'Portugal', label: '포르투갈', short: '포르투갈', flag: '🇵🇹' },
  { id: 'Spain', label: '스페인', short: '스페인', flag: '🇪🇸' },
  { id: 'Netherlands', label: '네덜란드', short: '네덜란드', flag: '🇳🇱' },
  { id: 'Germany', label: '독일', short: '독일', flag: '🇩🇪' },
  { id: 'Romania', label: '루마니아', short: '루마니아', flag: '🇷🇴' },
  { id: 'Hungary', label: '헝가리', short: '헝가리', flag: '🇭🇺' },
  { id: 'Malta', label: '몰타', short: '몰타', flag: '🇲🇹' },
  { id: 'Thailand', label: '태국', short: '태국', flag: '🇹🇭' },
  { id: 'Vietnam', label: '베트남', short: '베트남', flag: '🇻🇳' },
  { id: 'Canada', label: '캐나다', short: '캐나다', flag: '🇨🇦' },
  { id: 'Australia', label: '호주', short: '호주', flag: '🇦🇺' },
  { id: 'Japan', label: '일본', short: '일본', flag: '🇯🇵' },
  { id: 'China', label: '중국', short: '중국', flag: '🇨🇳' },
  { id: 'NewZealand', label: '뉴질랜드', short: '뉴질랜드', flag: '🇳🇿' },
  { id: 'Singapore', label: '싱가포르', short: '싱가포르', flag: '🇸🇬' },
  { id: 'UnitedKingdom', label: '영국', short: '영국', flag: '🇬🇧' },
  { id: 'France', label: '프랑스', short: '프랑스', flag: '🇫🇷' },
  { id: 'Italy', label: '이탈리아', short: '이탈리아', flag: '🇮🇹' },
  { id: 'Philippines', label: '필리핀', short: '필리핀', flag: '🇵🇭' },
] as const;

export const REGIONS = [
  ...LEGACY_REGIONS,
  ...COUNTRY_LOCATIONS.filter((country) => !LEGACY_REGIONS.some((region) => region.id === country.id))
    .map((country) => ({ id: country.id, label: country.label, short: country.label, flag: country.flag })),
];

export type RegionId = (typeof REGIONS)[number]['id'];

const REGION_BY_COUNTRY_CODE: Record<string, RegionId> = {
  KR: 'SouthKorea', US: 'USA', CA: 'Canada', BR: 'Brazil', AR: 'Argentina', CL: 'Chile', CO: 'Colombia',
  BO: 'Bolivia', PY: 'Paraguay', UY: 'Uruguay', PA: 'Panama', MX: 'Mexico', PT: 'Portugal', ES: 'Spain',
  NL: 'Netherlands', DE: 'Germany', RO: 'Romania', HU: 'Hungary', MT: 'Malta', TH: 'Thailand', VN: 'Vietnam',
  AU: 'Australia', JP: 'Japan', CN: 'China', NZ: 'NewZealand', SG: 'Singapore', GB: 'UnitedKingdom',
  UK: 'UnitedKingdom', FR: 'France', IT: 'Italy', PH: 'Philippines',
};

export function regionForCountryCode(code: string): RegionId | undefined {
  const normalized = code.trim().toUpperCase();
  return REGION_BY_COUNTRY_CODE[normalized] || COUNTRY_LOCATIONS.find((country) => country.isoAlpha2 === normalized)?.id;
}

export async function detectRegionFromIp(): Promise<RegionId | undefined> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch('https://ipapi.co/country_code/', { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return undefined;
    return regionForCountryCode(await response.text());
  } catch {
    return undefined;
  } finally {
    window.clearTimeout(timeout);
  }
}

export const REGION_TIME_ZONES: Record<RegionId, string> = {
  Global: 'UTC',
  SouthKorea: 'Asia/Seoul',
  USA: 'America/New_York',
  'USA-LA': 'America/Los_Angeles',
  Brazil: 'America/Sao_Paulo',
  Argentina: 'America/Argentina/Buenos_Aires',
  Chile: 'America/Santiago',
  Colombia: 'America/Bogota',
  Bolivia: 'America/La_Paz',
  Paraguay: 'America/Asuncion',
  Uruguay: 'America/Montevideo',
  Panama: 'America/Panama',
  Mexico: 'America/Mexico_City',
  Portugal: 'Europe/Lisbon',
  Spain: 'Europe/Madrid',
  Netherlands: 'Europe/Amsterdam',
  Germany: 'Europe/Berlin',
  Romania: 'Europe/Bucharest',
  Hungary: 'Europe/Budapest',
  Malta: 'Europe/Malta',
  Thailand: 'Asia/Bangkok',
  Vietnam: 'Asia/Ho_Chi_Minh',
  Canada: 'America/Toronto',
  Australia: 'Australia/Sydney',
  Japan: 'Asia/Tokyo',
  China: 'Asia/Shanghai',
  NewZealand: 'Pacific/Auckland',
  Singapore: 'Asia/Singapore',
  UnitedKingdom: 'Europe/London',
  France: 'Europe/Paris',
  Italy: 'Europe/Rome',
  Philippines: 'Asia/Manila',
};

export function regionLabel(id: string) {
  return REGIONS.find((region) => region.id === id)?.label || id;
}

export function regionTimeZone(id: string) {
  return REGION_TIME_ZONES[id as RegionId] || 'UTC';
}
