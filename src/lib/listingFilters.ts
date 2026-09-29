import type { CountryLocation } from './locations';

type FilterCity = { slug: string; label: string; aliases: string[] };
type FilterCountry = { id: string; label: string; aliases: string[]; cities: FilterCity[] };
export type ListingLocation = { country?: string; city?: string };
export type LocationFields = { country?: unknown; city?: unknown; citySlug?: unknown; cityName?: unknown; locationCity?: unknown; location?: unknown; sourceLocation?: LocationFields };

function key(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s_-]+/g, '') : '';
}

export function createFilterLocations(countries: readonly CountryLocation[], regions: readonly { id: string; label: string; short: string }[]): FilterCountry[] {
  const result = countries.map((country) => {
    const region = regions.find((item) => item.id === country.id);
    return {
      id: country.id,
      label: region?.short || country.label,
      aliases: [country.id, country.slug, country.isoAlpha2, country.label, country.english, region?.label, region?.short].map(key).filter(Boolean),
      cities: country.cities.map((city) => ({ slug: city.slug, label: city.label, aliases: [city.slug, city.label, city.english].map(key) })),
    };
  });
  for (const region of regions) {
    if (region.id !== 'Global' && region.id !== 'USA-LA' && !result.some((country) => country.id === region.id)) {
      result.push({ id: region.id, label: region.short, aliases: [region.id, region.label, region.short].map(key), cities: [] });
    }
  }
  // This is an existing city-valued region, not a country alias.
  const la = result.find((country) => country.id === 'USA')?.cities.find((city) => city.slug === 'los-angeles');
  const legacyLA = regions.find((region) => region.id === 'USA-LA');
  if (la && legacyLA) la.aliases.push(...[legacyLA.id, legacyLA.label, legacyLA.short, '로스앤젤레스'].map(key));
  return result;
}

export function listingLocation(record: LocationFields, countries: readonly FilterCountry[]): ListingLocation {
  // Display fallbacks such as a publisher's region are not a listing's location.
  record = record.sourceLocation || record;
  const countryValue = key(record.country);
  const legacyLA = countries.find((country) => country.id === 'USA')?.cities.find((city) => city.slug === 'los-angeles');
  const isLegacyLA = countryValue === key('USA-LA');
  let country = countries.find((item) => item.aliases.includes(countryValue));
  if (isLegacyLA && legacyLA) country = countries.find((item) => item.id === 'USA');
  // Do not reinterpret an unknown explicit country as a different location.
  if (countryValue && countryValue !== 'global' && !country) return {};
  const cityValues = [record.city, record.citySlug, record.cityName, record.locationCity].map(key).filter(Boolean);
  const locationValue = key(record.location);
  if (!country && !cityValues.length) country = countries.find((item) => item.aliases.includes(locationValue));
  const candidates = cityValues.length ? cityValues : isLegacyLA ? [key('USA-LA')] : locationValue ? [locationValue] : [];
  const matches = (country ? [country] : countries).flatMap((item) => item.cities
    .filter((city) => candidates.length > 0 && candidates.every((value) => city.aliases.includes(value)))
    .map((city) => ({ country: item.id, city: city.slug })));
  if (matches.length === 1) return matches[0];
  return country ? { country: country.id } : {};
}

function matchesLocation(record: LocationFields, scope: 'all' | 'country' | 'city', chosen: ListingLocation, countries: readonly FilterCountry[]) {
  if (scope === 'all') return true;
  if (!chosen.country || (scope === 'city' && !chosen.city)) return false;
  const location = listingLocation(record, countries);
  return location.country === chosen.country && (scope !== 'city' || location.city === chosen.city);
}

export type JobFilterFields = LocationFields & {
  id: string;
  tag?: unknown;
  category?: unknown;
  createdAt?: unknown;
  publishedAt?: unknown;
  sourceId?: unknown;
  sourceUrl?: unknown;
  sourceSnapshot?: unknown;
  sourceContentId?: unknown;
  koreanRequired?: unknown;
  isRemote?: unknown;
  visaSupport?: unknown;
};
export type JobFilters = { local: boolean; recent: boolean; korean: boolean; remote: boolean; visa: boolean; saved: boolean };
export const EMPTY_JOB_FILTERS: JobFilters = { local: false, recent: false, korean: false, remote: false, visa: false, saved: false };

export function jobDetailHref(job: { id: string; sourceContentId?: string; sourceId?: string; sourceUrl?: string }) {
  if (!job.sourceContentId) return `/content/${encodeURIComponent(job.id)}?collection=jobs`;
  return `/content/${encodeURIComponent(job.sourceContentId)}?source=${encodeURIComponent(job.sourceId || '')}&category=jobs&url=${encodeURIComponent(job.sourceUrl || '')}`;
}

export function matchesJobFilters(job: JobFilterFields, filters: JobFilters, chosen: ListingLocation, countries: readonly FilterCountry[], savedIds: readonly string[], now: number) {
  if (filters.local && !matchesLocation(job, chosen.city ? 'city' : 'country', chosen, countries)) return false;
  if (filters.saved && !savedIds.includes(job.id)) return false;
  if (filters.recent) {
    const imported = job.sourceId || job.sourceUrl || job.sourceContentId || job.sourceSnapshot || job.id.startsWith('source-');
    // A source fetch/import time is not proof of a recent publication.
    const date = imported ? job.publishedAt : job.createdAt;
    const timestamp = typeof date === 'string' && date.trim() ? Date.parse(date) : NaN;
    if (!Number.isFinite(now) || !Number.isFinite(timestamp) || timestamp > now || now - timestamp > 7 * 24 * 60 * 60 * 1000) return false;
  }
  const tags = [key(job.tag), key(job.category)];
  const explicit = (value: unknown, labels: string[]) => value === true || (value == null && labels.some((label) => tags.includes(key(label))));
  if (filters.korean && !explicit(job.koreanRequired, ['한국어', '한국어 필수', '한국어 가능', 'Korean', 'Korean required'])) return false;
  if (filters.remote && !explicit(job.isRemote, ['재택근무', '원격근무', 'Remote'])) return false;
  if (filters.visa && !explicit(job.visaSupport, ['비자 지원', '비자 스폰서', 'Visa sponsorship'])) return false;
  return true;
}

export const COMMUNITY_FILTERS = ['전체', '내국가', '내도시', '질문', '생활', '정보', '후기', '자유'] as const;
export type CommunityTopic = '질문' | '생활' | '정보' | '후기' | '자유';
export type CommunityFilterFields = LocationFields & { id?: unknown; type?: unknown; category?: unknown; tag?: unknown; sourceId?: unknown; sourceUrl?: unknown; sourceContentId?: unknown; sourceSnapshot?: unknown };

export function communityTopic(post: CommunityFilterFields): CommunityTopic | undefined {
  if (post.type === 'notice' || post.type === 'news') return undefined;
  const topics: Array<[CommunityTopic, string[]]> = [
    ['질문', ['질문', 'question', 'qna']],
    ['생활', ['생활', 'life', 'living']],
    ['정보', ['정보', 'info', 'information']],
    ['후기', ['후기', 'review']],
    ['자유', ['자유', 'free', 'freeboard']],
  ];
  for (const value of [post.category, post.tag, post.type]) {
    const topic = topics.find(([, aliases]) => aliases.some((alias) => key(alias) === key(value)));
    if (topic) return topic[0];
  }
  // Existing locally authored general posts are freeboard; unlabelled imports are not.
  if (post.type === 'general' && !post.sourceId && !post.sourceUrl && !post.sourceContentId && !post.sourceSnapshot && !(typeof post.id === 'string' && post.id.startsWith('source-'))) return '자유';
}

export function matchesCommunityFilters(post: CommunityFilterFields, scope: 'all' | 'country' | 'city', topic: CommunityTopic | null, chosen: ListingLocation, countries: readonly FilterCountry[]) {
  return matchesLocation(post, scope, chosen, countries) && (!topic || communityTopic(post) === topic);
}

export function paginateListings<T>(items: readonly T[], requestedPage: number, pageSize = 10) {
  const size = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : 10;
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(totalPages, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  const start = (page - 1) * size;
  return { items: items.slice(start, start + size), total, totalPages, page, from: total ? start + 1 : 0, to: Math.min(start + size, total) };
}

export function parseSavedJobIds(raw: string | null): string[] {
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string' && id.trim().length > 0)) throw new Error('Invalid saved job IDs');
  return value;
}
