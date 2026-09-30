export type NewsCacheItem = {
  title: string;
  url: string;
  description?: string;
  body?: string;
  publishedAt?: string;
  category?: string;
};

export type NewsCacheSection = { category: string; label: string; url: string; items: NewsCacheItem[] };

export type NewsCacheSnapshot = {
  id: string;
  sourceId: string;
  sourceName: string;
  region: string;
  url: string;
  title: string;
  description?: string;
  fetchedAt: string;
  verified?: boolean;
  items?: NewsCacheItem[];
  sections?: NewsCacheSection[];
};

type CacheStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };
type NewsSnapshotInput = Omit<NewsCacheSnapshot, 'id'> & { id?: string };
type NewsSnapshotResult<T> = { sourceId: string; snapshot?: T };

const CACHE_VERSION = 1;
const ITEM_LIMIT = 40;
const TEXT_LIMIT = 800;

function cacheKey(region: string) {
  return `gyopo-news-last-good-v${CACHE_VERSION}:${encodeURIComponent(region)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function compactItem(value: unknown): NewsCacheItem | null {
  if (!isRecord(value)) return null;
  const title = typeof value.title === 'string' ? value.title.trim().slice(0, 240) : '';
  const url = typeof value.url === 'string' ? value.url.trim() : '';
  const category = typeof value.category === 'string' ? value.category : undefined;
  if (!title || !url || (category && category !== 'news')) return null;
  const description = typeof value.description === 'string' && value.description.trim()
    ? value.description.trim()
    : typeof value.body === 'string' ? value.body.trim() : '';
  return {
    title,
    url,
    description: description.slice(0, TEXT_LIMIT) || undefined,
    publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : undefined,
    category: 'news',
  };
}

function compactSnapshot(value: unknown): NewsCacheSnapshot | null {
  if (!isRecord(value)) return null;
  const sourceId = typeof value.sourceId === 'string' ? value.sourceId : '';
  const sourceName = typeof value.sourceName === 'string' ? value.sourceName : '';
  const region = typeof value.region === 'string' ? value.region : '';
  const url = typeof value.url === 'string' ? value.url : '';
  const title = typeof value.title === 'string' ? value.title : '';
  const fetchedAt = typeof value.fetchedAt === 'string' ? value.fetchedAt : '';
  if (!sourceId || !sourceName || !region || !url || !title || !fetchedAt) return null;

  const sections = Array.isArray(value.sections)
    ? value.sections.flatMap((entry) => {
      if (!isRecord(entry) || entry.category !== 'news' || !Array.isArray(entry.items)) return [];
      const items = entry.items.map(compactItem).filter((item): item is NewsCacheItem => Boolean(item));
      if (!items.length || typeof entry.url !== 'string') return [];
      return [{ category: 'news', label: typeof entry.label === 'string' ? entry.label.slice(0, 120) : '뉴스', url: entry.url, items: items.slice(0, ITEM_LIMIT) }];
    })
    : [];
  const hasNewsSections = sections.length > 0;
  const items = hasNewsSections || !Array.isArray(value.items)
    ? []
    : value.items.map(compactItem).filter((item): item is NewsCacheItem => Boolean(item)).slice(0, ITEM_LIMIT);
  if (!items.length && !hasNewsSections) return null;

  return {
    id: typeof value.id === 'string' && value.id ? value.id : sourceId,
    sourceId,
    sourceName: sourceName.slice(0, 180),
    region: region.slice(0, 80),
    url,
    title: title.slice(0, 240),
    description: typeof value.description === 'string' ? value.description.slice(0, TEXT_LIMIT) : undefined,
    fetchedAt,
    verified: value.verified === true,
    items: items.length ? items : undefined,
    sections: sections.length ? sections : undefined,
  };
}

export function hasCacheableNews(snapshot: Pick<NewsCacheSnapshot, 'items' | 'sections'>) {
  return Boolean(snapshot.items?.some((item) => item.title.trim() && item.url.trim() && (!item.category || item.category === 'news'))
    || snapshot.sections?.some((section) => section.category === 'news' && section.items.some((item) => item.title.trim() && item.url.trim())));
}

export function readLastGoodNews(storage: CacheStorage, region: string): NewsCacheSnapshot[] {
  try {
    const raw = storage.getItem(cacheKey(region));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== CACHE_VERSION || parsed.region !== region || !Array.isArray(parsed.snapshots)) return [];
    return parsed.snapshots.map(compactSnapshot).filter((snapshot): snapshot is NewsCacheSnapshot => Boolean(snapshot));
  } catch {
    return [];
  }
}

export function writeLastGoodNews(storage: CacheStorage, region: string, snapshots: readonly NewsSnapshotInput[]) {
  const compacted = snapshots.map(compactSnapshot).filter((snapshot): snapshot is NewsCacheSnapshot => Boolean(snapshot));
  if (!compacted.length) return false;
  try {
    storage.setItem(cacheKey(region), JSON.stringify({ version: CACHE_VERSION, region, snapshots: compacted }));
    return true;
  } catch {
    return false;
  }
}

export function resolveNewsSnapshots<T extends { id: string; sourceId: string; fetchedAt?: string }>(
  results: readonly NewsSnapshotResult<T>[],
  cachedSnapshots: readonly T[],
  hasNews: (snapshot: T) => boolean,
) {
  const cachedBySource = new Map<string, T>();
  for (const snapshot of cachedSnapshots) {
    const previous = cachedBySource.get(snapshot.sourceId);
    const nextTime = Date.parse(snapshot.fetchedAt || '');
    const previousTime = previous ? Date.parse(previous.fetchedAt || '') : Number.NaN;
    if (!previous || !Number.isFinite(previousTime) || (Number.isFinite(nextTime) && nextTime >= previousTime)) cachedBySource.set(snapshot.sourceId, snapshot);
  }
  const snapshots: T[] = [];
  const cacheFallbacks: T[] = [];
  let freshCount = 0;

  for (const result of results) {
    if (result.snapshot && hasNews(result.snapshot)) {
      snapshots.push(result.snapshot);
      freshCount++;
      continue;
    }
    const cached = cachedBySource.get(result.sourceId);
    if (cached) {
      snapshots.push(cached);
      cacheFallbacks.push(cached);
    } else if (result.snapshot) {
      snapshots.push(result.snapshot);
    }
  }

  return { snapshots, cacheFallbacks, hasFreshNews: freshCount > 0 };
}
