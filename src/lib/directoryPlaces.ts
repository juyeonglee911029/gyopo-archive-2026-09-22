// Server routes only: never return the provider key or provider error payload.
export async function placesRequest(path: string, init: RequestInit = {}) {
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!key) throw new Error('NOT_CONFIGURED');
  const response = await fetch(`https://places.googleapis.com/v1/${path}`, { ...init, headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, ...init.headers }, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error('PROVIDER_UNAVAILABLE');
  return response.json();
}

export async function googlePlace(placeId: string) {
  if (!/^[A-Za-z0-9_-]{5,200}$/.test(placeId)) throw new Error('INVALID_PLACE');
  const data = await placesRequest(`places/${encodeURIComponent(placeId)}`, { headers: { 'X-Goog-FieldMask': 'id,displayName,formattedAddress,internationalPhoneNumber,googleMapsUri,businessStatus,primaryType,rating,userRatingCount,currentOpeningHours,location,reviews,photos' } });
  if (data.id !== placeId || !data.displayName?.text || !data.formattedAddress || !data.businessStatus) throw new Error('UNVERIFIED_PLACE');
  return {
    status: 'ready', source: 'Google Places', placeId: data.id, name: data.displayName.text,
    address: data.formattedAddress, tel: data.internationalPhoneNumber || '', mapsUrl: data.googleMapsUri,
    businessStatus: data.businessStatus, rating: data.rating, reviews: data.userRatingCount,
    lat: data.location?.latitude, lng: data.location?.longitude,
    hours: data.currentOpeningHours?.weekdayDescriptions || [], openNow: data.currentOpeningHours?.openNow,
    images: (data.photos || []).slice(0, 8).map((p: { name: string }) => `/api/directory/photo?name=${encodeURIComponent(p.name)}`),
    photoAttributions: (data.photos || []).slice(0, 8).flatMap((p: { authorAttributions?: Array<{ displayName: string; uri?: string }> }) => p.authorAttributions || []),
    recentReviews: (data.reviews || []).slice(0, 5).map((r: { authorAttribution?: { displayName?: string; uri?: string }; rating?: number; text?: { text?: string }; relativePublishTimeDescription?: string }) => ({ author: r.authorAttribution?.displayName || '', authorUrl: r.authorAttribution?.uri || '', rating: r.rating, text: r.text?.text || '', relativeTime: r.relativePublishTimeDescription || '' })),
  };
}
