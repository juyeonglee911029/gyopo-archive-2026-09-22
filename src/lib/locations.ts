export type CityLocation = {
  slug: string;
  label: string;
  english: string;
};

export type LocationRegion = 'north-america' | 'south-america' | 'europe' | 'east-asia' | 'southeast-asia' | 'central-asia' | 'oceania' | 'middle-east' | 'africa';
export type LocationGroup = 'asia' | 'americas' | 'europe' | 'oceania';

export type CountryLocation = {
  id: string;
  slug: string;
  isoAlpha2: string;
  label: string;
  english: string;
  flag: string;
  group: LocationGroup;
  region: LocationRegion;
  cities: readonly CityLocation[];
  priority?: string;
  currency?: string;
  localLanguage?: string;
  primaryPortal?: string;
};

const CORE_COUNTRY_SLUGS = ['us', 'kr', 'cn', 'jp', 'ca', 'vn', 'uz', 'au', 'kz', 'ru', 'ph', 'cy', 'mt', 'lv', 'ro', 'pl', 'ae', 'pt', 'nl', 'bg', 'it', 'es', 'fi', 'uk'] as const;
const SOUTH_AMERICA_COUNTRY_SLUGS = ['br', 'ar', 'bo', 'cl', 'co', 'ec', 'gy', 'py', 'pe', 'sr', 'uy', 've'] as const;
const EUROPE_COUNTRY_SLUGS = ['al', 'ad', 'at', 'by', 'be', 'ba', 'bg', 'hr', 'cy', 'cz', 'dk', 'ee', 'fi', 'fr', 'de', 'gr', 'hu', 'is', 'ie', 'it', 'lv', 'li', 'lt', 'lu', 'mt', 'md', 'mc', 'me', 'nl', 'mk', 'no', 'pl', 'pt', 'ro', 'sm', 'rs', 'sk', 'si', 'es', 'se', 'ch', 'ua', 'uk', 'va', 'ru'] as const;

export const PUBLIC_COUNTRY_SLUGS = [...new Set([...CORE_COUNTRY_SLUGS, ...SOUTH_AMERICA_COUNTRY_SLUGS, ...EUROPE_COUNTRY_SLUGS])] as readonly string[];

export const CITY_SLUGS_BY_COUNTRY: Readonly<Record<string, readonly string[]>> = {
  kr: ['seoul', 'busan', 'incheon', 'daegu', 'daejeon', 'gwangju', 'ulsan', 'jeju'],
  br: ['sao-paulo', 'rio-de-janeiro', 'brasilia', 'curitiba', 'campinas', 'belo-horizonte', 'porto-alegre', 'manaus', 'salvador', 'recife'],
  ar: ['buenos-aires', 'cordoba', 'rosario'],
  bo: ['santa-cruz-de-la-sierra', 'la-paz', 'cochabamba'],
  cl: ['santiago', 'valparaiso', 'concepcion'],
  co: ['bogota', 'medellin', 'cali'],
  ec: ['quito', 'guayaquil'],
  gy: ['georgetown'],
  py: ['asuncion', 'ciudad-del-este'],
  pe: ['lima', 'arequipa'],
  sr: ['paramaribo'],
  uy: ['montevideo'],
  ve: ['caracas', 'valencia', 'maracaibo'],
  nl: ['amsterdam', 'rotterdam', 'the-hague', 'eindhoven', 'utrecht', 'amstelveen'],
  bg: ['sofia', 'plovdiv', 'varna', 'burgas', 'ruse'],
  it: ['rome', 'milan', 'florence', 'turin', 'bologna', 'naples', 'venice'],
  es: ['madrid', 'barcelona', 'valencia', 'malaga', 'seville', 'alicante', 'bilbao'],
  fi: ['helsinki', 'espoo', 'tampere', 'turku', 'oulu', 'vantaa'],
  uk: ['london', 'manchester', 'birmingham', 'edinburgh', 'glasgow', 'cambridge', 'oxford', 'bristol', 'leeds', 'liverpool'],
  cy: ['nicosia', 'limassol', 'larnaca', 'paphos'],
  mt: ['valletta', 'sliema', 'st-julians', 'birkirkara', 'swieqi'],
  lv: ['riga'],
  ro: ['bucharest', 'cluj-napoca', 'timisoara'],
  pl: ['warsaw', 'wroclaw', 'krakow', 'katowice', 'opole', 'poznan'],
  ae: ['dubai', 'abu-dhabi', 'ras-al-khaimah'],
  pt: ['lisbon', 'porto'],
  us: ['los-angeles', 'new-york', 'fort-lee', 'palisades-park', 'seattle', 'san-francisco', 'san-jose', 'chicago', 'atlanta', 'dallas', 'washington-dc', 'honolulu'],
  cn: ['beijing', 'shanghai', 'qingdao', 'guangzhou', 'shenzhen', 'shenyang', 'dalian', 'tianjin', 'yanji'],
  jp: ['tokyo', 'osaka', 'yokohama', 'nagoya', 'fukuoka', 'kyoto', 'kobe'],
  ca: ['toronto', 'vancouver', 'calgary', 'edmonton', 'montreal', 'ottawa'],
  vn: ['ho-chi-minh-city', 'hanoi', 'da-nang', 'hai-phong', 'bac-ninh', 'thai-nguyen'],
  au: ['sydney', 'melbourne', 'brisbane', 'perth', 'adelaide'],
  uz: ['tashkent', 'samarkand'],
  kz: ['almaty', 'astana'],
  ru: ['moscow', 'saint-petersburg', 'vladivostok', 'yuzhno-sakhalinsk'],
  ph: ['manila', 'cebu', 'angeles', 'baguio'],
};

const COUNTRY_NAMES: Record<string, string> = {
  us: 'United States', kr: 'South Korea', cn: 'China', jp: 'Japan', ca: 'Canada', vn: 'Vietnam', uz: 'Uzbekistan', au: 'Australia', kz: 'Kazakhstan', ru: 'Russia', ph: 'Philippines', cy: 'Cyprus', mt: 'Malta', lv: 'Latvia', ro: 'Romania', pl: 'Poland', ae: 'United Arab Emirates', pt: 'Portugal', nl: 'Netherlands', bg: 'Bulgaria', it: 'Italy', es: 'Spain', fi: 'Finland', uk: 'United Kingdom', br: 'Brazil', ar: 'Argentina', bo: 'Bolivia', cl: 'Chile', co: 'Colombia', ec: 'Ecuador', gy: 'Guyana', py: 'Paraguay', pe: 'Peru', sr: 'Suriname', uy: 'Uruguay', ve: 'Venezuela', al: 'Albania', ad: 'Andorra', at: 'Austria', by: 'Belarus', be: 'Belgium', ba: 'Bosnia and Herzegovina', hr: 'Croatia', cz: 'Czechia', dk: 'Denmark', ee: 'Estonia', fr: 'France', de: 'Germany', gr: 'Greece', hu: 'Hungary', is: 'Iceland', ie: 'Ireland', li: 'Liechtenstein', lt: 'Lithuania', lu: 'Luxembourg', md: 'Moldova', mc: 'Monaco', me: 'Montenegro', mk: 'North Macedonia', no: 'Norway', sm: 'San Marino', rs: 'Serbia', sk: 'Slovakia', si: 'Slovenia', se: 'Sweden', ch: 'Switzerland', ua: 'Ukraine', va: 'Vatican City',
};

const COUNTRY_ISO_ALPHA2: Record<string, string> = { ...Object.fromEntries(PUBLIC_COUNTRY_SLUGS.map((slug) => [slug, slug.toUpperCase()])), uk: 'GB' };
const COUNTRY_REGIONS: Record<string, LocationRegion> = {
  us: 'north-america', ca: 'north-america', br: 'south-america', ar: 'south-america', bo: 'south-america', cl: 'south-america', co: 'south-america', ec: 'south-america', gy: 'south-america', py: 'south-america', pe: 'south-america', sr: 'south-america', uy: 'south-america', ve: 'south-america',
  kr: 'east-asia', cn: 'east-asia', jp: 'east-asia', vn: 'southeast-asia', ph: 'southeast-asia', uz: 'central-asia', kz: 'central-asia', au: 'oceania', ae: 'middle-east',
  al: 'europe', ad: 'europe', at: 'europe', by: 'europe', be: 'europe', ba: 'europe', bg: 'europe', hr: 'europe', cy: 'europe', cz: 'europe', dk: 'europe', ee: 'europe', fi: 'europe', fr: 'europe', de: 'europe', gr: 'europe', hu: 'europe', is: 'europe', ie: 'europe', it: 'europe', lv: 'europe', li: 'europe', lt: 'europe', lu: 'europe', mt: 'europe', md: 'europe', mc: 'europe', me: 'europe', nl: 'europe', mk: 'europe', no: 'europe', pl: 'europe', pt: 'europe', ro: 'europe', ru: 'europe', sm: 'europe', rs: 'europe', sk: 'europe', si: 'europe', es: 'europe', se: 'europe', ch: 'europe', ua: 'europe', uk: 'europe', va: 'europe',
};
const LEGACY_IDS: Record<string, string> = { us: 'USA', kr: 'SouthKorea', uk: 'UnitedKingdom', ae: 'UAE', br: 'Brazil', ar: 'Argentina', bo: 'Bolivia', cl: 'Chile', co: 'Colombia', py: 'Paraguay', uy: 'Uruguay', pt: 'Portugal', es: 'Spain', nl: 'Netherlands', de: 'Germany', fr: 'France', it: 'Italy', ro: 'Romania', hu: 'Hungary', mt: 'Malta', vn: 'Vietnam', ph: 'Philippines', ca: 'Canada', au: 'Australia', jp: 'Japan', cn: 'China' };

export const COUNTRY_OVERRIDES = {
  uk: { publicSlug: 'uk', isoAlpha2: 'GB' },
  br: { currency: 'BRL', localLanguage: 'pt-BR', primaryPortal: 'ko', region: 'south-america', priority: 'Brazil priority, not a numeric rank' },
} as const;

function flagForIso(isoAlpha2: string) {
  return [...isoAlpha2].map((letter) => String.fromCodePoint(letter.charCodeAt(0) + 127397)).join('');
}

function titleFromSlug(slug: string) {
  return slug.split('-').map((part) => part === 'dc' ? 'DC' : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ');
}

export const COUNTRY_LOCATIONS: readonly CountryLocation[] = PUBLIC_COUNTRY_SLUGS.map((slug) => {
  const isoAlpha2 = COUNTRY_ISO_ALPHA2[slug];
  const english = COUNTRY_NAMES[slug];
  const citySlugs = CITY_SLUGS_BY_COUNTRY[slug] || [];
  const override = COUNTRY_OVERRIDES[slug as keyof typeof COUNTRY_OVERRIDES];
  return {
    id: LEGACY_IDS[slug] || english.replace(/[^A-Za-z0-9]+/g, ''),
    slug,
    isoAlpha2,
    label: english,
    english,
    flag: flagForIso(isoAlpha2),
    group: COUNTRY_REGIONS[slug] === 'europe' ? 'europe' : COUNTRY_REGIONS[slug] === 'north-america' || COUNTRY_REGIONS[slug] === 'south-america' ? 'americas' : COUNTRY_REGIONS[slug] === 'oceania' ? 'oceania' : 'asia',
    region: COUNTRY_REGIONS[slug],
    cities: citySlugs.map((citySlug) => ({ slug: citySlug, label: titleFromSlug(citySlug), english: titleFromSlug(citySlug) })),
    ...(override && 'currency' in override ? { currency: override.currency, localLanguage: override.localLanguage, primaryPortal: override.primaryPortal, priority: override.priority } : {}),
  };
});

export const LOCATION_GROUPS = [
  { id: 'asia', label: '아시아', english: 'Asia' },
  { id: 'americas', label: '미주', english: 'Americas' },
  { id: 'europe', label: '유럽', english: 'Europe' },
  { id: 'oceania', label: '오세아니아', english: 'Oceania' },
] as const;
