import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

type YouTubeResult = {
  id: string;
  title: string;
  artist: string;
  videoId: string;
  keywords: string[];
  views?: string;
  published?: string;
  thumbnail?: string;
};

function text(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'runs' in value) return (value.runs as { text?: string }[]).map((run) => run.text || '').join('');
  if (value && typeof value === 'object' && 'simpleText' in value) return String(value.simpleText || '');
  return '';
}

function parseInitialData(html: string): Record<string, unknown> | null {
  const marker = 'ytInitialData';
  const markerStart = html.indexOf(marker);
  const objectStart = html.indexOf('{', markerStart);
  if (markerStart < 0 || objectStart < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = objectStart; index < html.length; index += 1) {
    const character = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}' && --depth === 0) {
      try {
        return JSON.parse(html.slice(objectStart, index + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function collectVideos(value: unknown, result: YouTubeResult[]) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectVideos(item, result));
    return;
  }
  const item = value as Record<string, unknown>;
  const video = item.videoRenderer as Record<string, unknown> | undefined;
  if (video?.videoId && result.length < 20) {
    const videoId = String(video.videoId);
    const title = text(video.title) || 'YouTube video';
    const artist = text(video.ownerText) || text(video.longBylineText) || 'YouTube';
    result.push({
      id: `youtube-${videoId}`,
      title,
      artist,
      videoId,
      keywords: [title, artist],
      views: text(video.viewCountText),
      published: text(video.publishedTimeText),
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    });
  }
  Object.values(item).forEach((child) => collectVideos(child, result));
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')?.trim();
  if (!query) return NextResponse.json({ results: [] });
  try {
    const response = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GYOPO Music Search/1.0)' },
      next: { revalidate: 120 },
      signal: AbortSignal.timeout(6500),
    });
    if (!response.ok) throw new Error(`YouTube returned ${response.status}`);
    const html = await response.text();
    const initialData = parseInitialData(html);
    if (!initialData) throw new Error('YouTube search data unavailable');
    const results: YouTubeResult[] = [];
    collectVideos(initialData, results);
    return NextResponse.json({ results: results.slice(0, 12) });
  } catch {
    return NextResponse.json({ results: [], error: 'YouTube 검색 결과를 불러오지 못했습니다.' }, { status: 502 });
  }
}
