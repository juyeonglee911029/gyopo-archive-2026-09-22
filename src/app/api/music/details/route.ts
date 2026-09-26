import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'runs' in value) return (value.runs as Array<{ text?: string }>).map((run) => run.text || '').join('');
  if (value && typeof value === 'object' && 'simpleText' in value) return String(value.simpleText || '');
  return '';
}

function parseObject(html: string, marker: string): Record<string, unknown> | null {
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const objectStart = html.indexOf('{', start);
  if (objectStart < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let objectEnd = -1;
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
      objectEnd = index + 1;
      break;
    }
  }
  if (objectEnd < 0) return null;
  const source = html.slice(objectStart, objectEnd);
  try {
    return JSON.parse(source) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get('videoId')?.trim();
  if (!videoId || !/^[\w-]{6,20}$/.test(videoId)) return NextResponse.json({ error: '올바른 YouTube 영상 ID가 아닙니다.' }, { status: 400 });
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GYOPO Music Details/1.0)' },
      next: { revalidate: 300 },
    });
    if (!response.ok) throw new Error(`YouTube returned ${response.status}`);
    const html = await response.text();
    const player = parseObject(html, 'ytInitialPlayerResponse');
    const video = player?.videoDetails as Record<string, unknown> | undefined;
    const microformat = (player?.microformat as Record<string, unknown> | undefined)?.playerMicroformatRenderer as Record<string, unknown> | undefined;
    const title = text(video?.title);
    if (!title.trim()) throw new Error('YouTube metadata is unavailable');
    const author = text(video?.author);
    const viewCount = String(video?.viewCount || html.match(/"viewCount":"(\d+)"/)?.[1] || '');
    const published = text(microformat?.publishDate) || text(microformat?.uploadDate) || html.match(/"(?:publishDate|uploadDate)":"([^"]+)"/)?.[1] || '';
    const thumbnails = video?.thumbnail as { thumbnails?: Array<{ url?: string }> } | undefined;
    return NextResponse.json({
      title,
      artist: author,
      views: viewCount ? `${Number(viewCount).toLocaleString('en-US')} views` : '',
      published,
      thumbnail: thumbnails?.thumbnails?.at(-1)?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch {
    return NextResponse.json({ error: 'YouTube 영상 정보를 불러오지 못했습니다.' }, { status: 502 });
  }
}
