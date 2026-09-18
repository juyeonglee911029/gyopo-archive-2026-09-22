export function parseGoogleMapsUrl(value: string): { url: string; placeId: string | null } | null {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const valid = ((url.hostname === 'www.google.com' || url.hostname === 'google.com') && /^\/maps(?:\/|$)/.test(url.pathname)) || (url.hostname === 'maps.google.com' && (url.pathname === '/' || /^\/maps(?:\/|$)/.test(url.pathname))) || (url.hostname === 'maps.app.goo.gl' && /^\/[A-Za-z0-9]+$/.test(url.pathname)) || (url.hostname === 'goo.gl' && url.pathname.startsWith('/maps/'));
    if (!valid) return null;
    const id = url.searchParams.get('query_place_id') || url.searchParams.get('place_id') || url.searchParams.get('q')?.match(/^place_id:([A-Za-z0-9_-]+)$/)?.[1] || null;
    return { url: url.href, placeId: id && /^[A-Za-z0-9_-]{5,200}$/.test(id) ? id : null };
  } catch { return null; }
}
