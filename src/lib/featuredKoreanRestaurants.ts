export type FeaturedRestaurant = {
  id: string;
  name: string;
  city: string;
  country: string;
  category: string;
  description: string;
  address: string;
  rating: number;
  reviews: number;
  tel?: string;
  lat?: number;
  lng?: number;
  locationAccuracy?: 'exact' | 'approximate';
  image: string;
  images: string[];
  mapUrl: string;
  ratingSource: string;
};

type RestaurantSeed = Omit<FeaturedRestaurant, 'id' | 'category' | 'description' | 'image' | 'images' | 'mapUrl' | 'ratingSource'>;

const foodImages = [
  'https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=900&q=82',
  'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=82',
  'https://images.unsplash.com/photo-1498654896293-37aacf113fd9?auto=format&fit=crop&w=900&q=82',
  'https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=900&q=82',
  'https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=900&q=82',
];

const cityCoordinates: Record<string, { lat: number; lng: number }> = {
  'New York': { lat: 40.7484, lng: -73.9857 },
  'Los Angeles': { lat: 34.0522, lng: -118.2437 },
  'San Francisco': { lat: 37.7749, lng: -122.4194 },
  Chicago: { lat: 41.8781, lng: -87.6298 },
  Toronto: { lat: 43.6532, lng: -79.3832 },
  London: { lat: 51.5074, lng: -0.1278 },
  Berlin: { lat: 52.5200, lng: 13.4050 },
  Paris: { lat: 48.8566, lng: 2.3522 },
  Sydney: { lat: -33.8688, lng: 151.2093 },
  Seoul: { lat: 37.5665, lng: 126.9780 },
  Rome: { lat: 41.9009, lng: 12.5020 },
  Milan: { lat: 45.4840, lng: 9.1900 },
  Florence: { lat: 43.7769, lng: 11.2520 },
  Ferrara: { lat: 44.8381, lng: 11.6198 },
  Budapest: { lat: 47.4979, lng: 19.0402 },
  Istanbul: { lat: 41.0082, lng: 28.9784 },
  Limassol: { lat: 34.6786, lng: 33.0413 },
  Nicosia: { lat: 35.1856, lng: 33.3823 },
  Larnaca: { lat: 34.9229, lng: 33.6233 },
  'Ayia Napa': { lat: 34.9920, lng: 34.0018 },
  Bucharest: { lat: 44.4268, lng: 26.1025 },
};

const restaurants: RestaurantSeed[] = [
  { name: 'Her Name is Han', city: 'New York', country: 'USA', address: '17 E 31st St, New York, NY', rating: 4.5, reviews: 2923 },
  { name: 'KJUN', city: 'New York', country: 'USA', address: '334 Lexington Ave, New York, NY', rating: 4.8, reviews: 2470 },
  { name: 'Cho Dang Gol', city: 'New York', country: 'USA', address: '55 W 35th St, New York, NY', rating: 4.5, reviews: 2030 },
  { name: 'Hangawi', city: 'New York', country: 'USA', address: '12 E 32nd St, New York, NY', rating: 4.5, reviews: 2800 },
  { name: 'Atoboy', city: 'New York', country: 'USA', address: '36 E 31st St, New York, NY', rating: 4.6, reviews: 1944 },
  { name: 'Jua', city: 'New York', country: 'USA', address: '36 E 22nd St, New York, NY', rating: 4.7, reviews: 1050 },
  { name: 'Kochi', city: 'New York', country: 'USA', address: '652 10th Ave, New York, NY', rating: 4.7, reviews: 1460 },
  { name: 'Jeju Noodle Bar', city: 'New York', country: 'USA', address: '679 Greenwich St, New York, NY', rating: 4.6, reviews: 3220 },
  { name: "Park's BBQ", city: 'Los Angeles', country: 'USA', address: '955 S Vermont Ave, Los Angeles, CA', rating: 4.6, reviews: 1440 },
  { name: 'Sun Nong Dan', city: 'Los Angeles', country: 'USA', address: '927 N Broadway, Los Angeles, CA', rating: 4.5, reviews: 2100 },
  { name: 'Kobawoo House', city: 'Los Angeles', country: 'USA', address: '698 S Vermont Ave, Los Angeles, CA', rating: 4.6, reviews: 790 },
  { name: 'Han Bat Sul Lung Tang', city: 'Los Angeles', country: 'USA', address: '4163 W 5th St, Los Angeles, CA', rating: 4.6, reviews: 1520 },
  { name: 'Soban', city: 'Los Angeles', country: 'USA', address: '4001 W Olympic Blvd, Los Angeles, CA', rating: 4.7, reviews: 1100 },
  { name: 'The Corner Place', city: 'Los Angeles', country: 'USA', address: '2819 James M Wood Blvd, Los Angeles, CA', rating: 4.5, reviews: 1800 },
  { name: 'Jinsol Gukbap', city: 'Los Angeles', country: 'USA', address: '4215 W 3rd St, Los Angeles, CA', rating: 4.5, reviews: 800 },
  { name: 'Toyose', city: 'San Francisco', country: 'USA', address: '3814 Noriega St, San Francisco, CA', rating: 4.5, reviews: 1510 },
  { name: 'Surisan', city: 'San Francisco', country: 'USA', address: '505 Beach St, San Francisco, CA', rating: 4.5, reviews: 2900 },
  { name: 'Han Il Kwan', city: 'San Francisco', country: 'USA', address: '1802 Balboa St, San Francisco, CA', rating: 4.5, reviews: 980 },
  { name: 'Aria Korean Street Food', city: 'San Francisco', country: 'USA', address: '1700 Fillmore St, San Francisco, CA', rating: 4.6, reviews: 610 },
  { name: 'Hanuri', city: 'San Francisco', country: 'USA', address: '1628 Geary Blvd, San Francisco, CA', rating: 4.6, reviews: 840 },
  { name: 'Daeho Kalbijjim', city: 'San Francisco', country: 'USA', address: '2172 San Bruno Ave, San Francisco, CA', rating: 4.6, reviews: 3900 },
  { name: 'San Soo Gab San', city: 'Chicago', country: 'USA', address: '5247 N Western Ave, Chicago, IL', rating: 4.5, reviews: 1550 },
  { name: 'Parachute', city: 'Chicago', country: 'USA', address: '3500 N Elston Ave, Chicago, IL', rating: 4.5, reviews: 1100 },
  { name: 'Mott St', city: 'Chicago', country: 'USA', address: '1401 N Ashland Ave, Chicago, IL', rating: 4.6, reviews: 2250 },
  { name: 'Perilla Korean American Fare', city: 'Chicago', country: 'USA', address: '401 N Milwaukee Ave, Chicago, IL', rating: 4.5, reviews: 920 },
  { name: 'Jeong', city: 'Chicago', country: 'USA', address: '1460 W Chicago Ave, Chicago, IL', rating: 4.7, reviews: 530 },
  { name: 'Daebak Korean BBQ', city: 'Chicago', country: 'USA', address: '3939 N Harlem Ave, Chicago, IL', rating: 4.6, reviews: 1050 },
  { name: 'Dahn', city: 'Toronto', country: 'Canada', address: '1049 Bloor St W, Toronto, ON', rating: 4.7, reviews: 1230 },
  { name: 'Mapo Korean BBQ', city: 'Toronto', country: 'Canada', address: '4744 Yonge St, North York, ON', rating: 4.5, reviews: 950 },
  { name: 'Han Ba Tang', city: 'Toronto', country: 'Canada', address: '5165 Yonge St, North York, ON', rating: 4.5, reviews: 1200 },
  { name: 'Sariwon', city: 'Toronto', country: 'Canada', address: '7388 Yonge St, Thornhill, ON', rating: 4.5, reviews: 840 },
  { name: 'Seoul Shakers', city: 'Toronto', country: 'Canada', address: '1241 Bloor St W, Toronto, ON', rating: 4.6, reviews: 720 },
  { name: 'Koba', city: 'London', country: 'UK', address: '11 Rathbone St, London W1T', rating: 4.5, reviews: 1840 },
  { name: 'Yijo', city: 'London', country: 'UK', address: '21 Kingly St, London W1B', rating: 4.6, reviews: 850 },
  { name: 'Assa', city: 'London', country: 'UK', address: '53 St Giles High St, London WC2H', rating: 4.5, reviews: 960 },
  { name: 'Seoul Bakery', city: 'London', country: 'UK', address: '14 Hanway St, London W1T', rating: 4.5, reviews: 1400 },
  { name: 'Dae Yang', city: 'Berlin', country: 'Germany', address: 'Potsdamer Str. 102, Berlin', rating: 4.5, reviews: 1600 },
  { name: 'Core', city: 'Berlin', country: 'Germany', address: 'Kantstr. 30, Berlin', rating: 4.6, reviews: 720 },
  { name: 'Seoulkitchen', city: 'Berlin', country: 'Germany', address: 'Gormannstr. 31, Berlin', rating: 4.5, reviews: 900 },
  { name: 'Arirang', city: 'Berlin', country: 'Germany', address: 'Bülowstr. 7, Berlin', rating: 4.5, reviews: 1150 },
  { name: 'Soon Grill', city: 'Paris', country: 'France', address: '20 Rue de la Tour d’Auvergne, Paris', rating: 4.5, reviews: 1220 },
  { name: 'Jjin', city: 'Paris', country: 'France', address: '12 Rue du Faubourg Montmartre, Paris', rating: 4.6, reviews: 760 },
  { name: 'Guibine', city: 'Paris', country: 'France', address: '44 Rue Sainte-Anne, Paris', rating: 4.5, reviews: 1000 },
  { name: 'Arisun', city: 'Sydney', country: 'Australia', address: '1/1 Dixon St, Haymarket NSW', rating: 4.5, reviews: 1350 },
  { name: 'Danjee', city: 'Sydney', country: 'Australia', address: '107-109 O’Connell St, North Adelaide NSW', rating: 4.6, reviews: 1080 },
  { name: 'Mapo Galbi', city: 'Sydney', country: 'Australia', address: '1/73-75 King St, Rockdale NSW', rating: 4.5, reviews: 800 },
  { name: 'Madang', city: 'Sydney', country: 'Australia', address: '49 Market St, Sydney NSW', rating: 4.5, reviews: 1900 },
  { name: 'Jihwaja', city: 'Seoul', country: 'South Korea', address: '143-1 Samcheong-ro, Jongno-gu, Seoul', rating: 4.5, reviews: 920 },
  { name: 'Tosokchon', city: 'Seoul', country: 'South Korea', address: '5 Jahamun-ro 5-gil, Jongno-gu, Seoul', rating: 4.6, reviews: 1132 },
  { name: 'Woo Lae Oak', city: 'Seoul', country: 'South Korea', address: '62-29 Changgyeonggung-ro, Jung-gu, Seoul', rating: 4.5, reviews: 1800 },
  { name: 'Seoul Restaurant Rome', city: 'Rome', country: 'Italy', address: 'Via Filippo Turati 49, Rome', rating: 4.4, reviews: 1368, tel: '+39 06 446 7300', lat: 41.9009, lng: 12.5020 },
  { name: 'Koreamor', city: 'Rome', country: 'Italy', address: 'Via Panisperna 101, Rome', rating: 4.8, reviews: 680, lat: 41.8969, lng: 12.4904 },
  { name: 'My Kimchi', city: 'Milan', country: 'Italy', address: 'Via Napo Torriani 10, Milan', rating: 4.5, reviews: 829, lat: 45.4837, lng: 9.2010 },
  { name: 'Hanya', city: 'Milan', country: 'Italy', address: 'Via Panfilo Castaldi 34, Milan', rating: 4.5, reviews: 365, lat: 45.4778, lng: 9.2055 },
  { name: 'Gangnam', city: 'Florence', country: 'Italy', address: 'Via San Gallo 89, Florence', rating: 4.4, reviews: 781, tel: '+39 055 384 2434', lat: 43.7800, lng: 11.2580 },
  { name: 'Moon', city: 'Ferrara', country: 'Italy', address: 'Via San Romano 76, Ferrara', rating: 4.5, reviews: 1126, tel: '+39 0532 772480', lat: 44.8356, lng: 11.6197 },
  { name: 'Nanum', city: 'Budapest', country: 'Hungary', address: 'Király utca 53, Budapest', rating: 4.9, reviews: 551, lat: 47.5020, lng: 19.0612 },
  { name: 'Seoul House', city: 'Budapest', country: 'Hungary', address: 'Fő utca 8, Budapest', rating: 4.5, reviews: 0, tel: '+36 1 201 7452', lat: 47.5028, lng: 19.0390 },
  { name: 'Arirang', city: 'Budapest', country: 'Hungary', address: 'Istenhegyi út 25, Budapest', rating: 4.1, reviews: 1901, lat: 47.4906, lng: 18.9974 },
  { name: 'K-Bunsik', city: 'Budapest', country: 'Hungary', address: 'József körút 26, Budapest', rating: 4.3, reviews: 307, lat: 47.4948, lng: 19.0717 },
  { name: 'Hanaro', city: 'Budapest', country: 'Hungary', address: 'Rákóczi út 29, Budapest', rating: 4.7, reviews: 0, lat: 47.4964, lng: 19.0702 },
  { name: 'Buda K', city: 'Budapest', country: 'Hungary', address: 'Bartók Béla út 62, Budapest', rating: 4.4, reviews: 0, lat: 47.4777, lng: 19.0470 },
  { name: 'Seorabeol', city: 'Istanbul', country: 'Turkey', address: 'Kore Şehitleri Cad. 57/B, Istanbul', rating: 4.0, reviews: 1426, lat: 41.0740, lng: 29.0110 },
  { name: 'From Seoul', city: 'Istanbul', country: 'Turkey', address: 'Teşvikiye, Nişantaşı, Istanbul', rating: 4.4, reviews: 480, lat: 41.0474, lng: 28.9947 },
  { name: 'Norito', city: 'Istanbul', country: 'Turkey', address: 'Beylikdüzü, Istanbul', rating: 4.7, reviews: 704, lat: 41.0060, lng: 28.6470 },
  { name: 'Korecan', city: 'Istanbul', country: 'Turkey', address: 'Taksim, Istanbul', rating: 4.1, reviews: 746, lat: 41.0369, lng: 28.9850 },
  { name: 'Seultost', city: 'Istanbul', country: 'Turkey', address: 'Kadıköy, Istanbul', rating: 4.4, reviews: 463, lat: 40.9900, lng: 29.0280 },
  { name: 'Sojubar', city: 'Istanbul', country: 'Turkey', address: 'Ataşehir, Istanbul', rating: 4.4, reviews: 0, tel: '+90 533 915 6688', lat: 40.9980, lng: 29.1150 },
  { name: 'MATA Korean Restaurant', city: 'Limassol', country: 'Cyprus', address: 'Limassol, Cyprus', rating: 4.5, reviews: 0, lat: 34.6740, lng: 33.0440 },
  { name: 'Umami Nicosia', city: 'Nicosia', country: 'Cyprus', address: 'Nicosia, Cyprus', rating: 4.4, reviews: 0, lat: 35.1700, lng: 33.3600 },
  { name: 'Umami Larnaca', city: 'Larnaca', country: 'Cyprus', address: 'Larnaca, Cyprus', rating: 4.4, reviews: 0, lat: 34.9220, lng: 33.6310 },
  { name: 'Umami Limassol', city: 'Limassol', country: 'Cyprus', address: 'Limassol, Cyprus', rating: 4.4, reviews: 0, lat: 34.6800, lng: 33.0410 },
  { name: 'Umami Ayia Napa', city: 'Ayia Napa', country: 'Cyprus', address: 'Ayia Napa, Cyprus', rating: 4.4, reviews: 0, lat: 34.9920, lng: 34.0018 },
  { name: 'Restaurant Seoul', city: 'Bucharest', country: 'Romania', address: 'Str. Lt. Av. Mircea Zorileanu 89, Bucharest', rating: 4.6, reviews: 2033, lat: 44.4690, lng: 26.0710 },
  { name: 'The Kimchi', city: 'Bucharest', country: 'Romania', address: 'Bucharest, Romania', rating: 4.7, reviews: 359, lat: 44.4520, lng: 26.1000 },
  { name: 'Kimu', city: 'Bucharest', country: 'Romania', address: 'Bucharest, Romania', rating: 4.6, reviews: 0, lat: 44.4660, lng: 26.0950 },
  { name: 'Jeonjuu', city: 'Bucharest', country: 'Romania', address: 'Bucharest, Romania', rating: 4.7, reviews: 0, lat: 44.4310, lng: 26.1010 },
  { name: 'The Kimchi Bistro', city: 'Bucharest', country: 'Romania', address: 'Bucharest, Romania', rating: 4.4, reviews: 841, lat: 44.4420, lng: 26.0970 },
  { name: 'Gangnam Pocha', city: 'Bucharest', country: 'Romania', address: 'Bucharest, Romania', rating: 4.3, reviews: 0, lat: 44.4310, lng: 26.1010 },
];

export const FEATURED_KOREAN_RESTAURANTS: FeaturedRestaurant[] = restaurants.map((restaurant, index) => {
  const id = `${restaurant.country}-${restaurant.city}-${restaurant.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const image = foodImages[index % foodImages.length];
  const reviewLabel = restaurant.reviews ? `리뷰 ${restaurant.reviews.toLocaleString()}개` : '공개 리뷰 수 미확인';
  const hasExactCoordinates = typeof restaurant.lat === 'number' && typeof restaurant.lng === 'number';
  const coordinates = hasExactCoordinates ? restaurant : cityCoordinates[restaurant.city];
  return {
    ...restaurant,
    id: `featured-${id}`,
    category: '음식점·카페',
    description: `평점 ${restaurant.rating.toFixed(1)} · ${reviewLabel} · GYOPO 추천 한식당`,
    lat: coordinates?.lat,
    lng: coordinates?.lng,
    locationAccuracy: hasExactCoordinates ? 'exact' : coordinates ? 'approximate' : undefined,
    image,
    images: [image],
    mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${restaurant.name} ${restaurant.address}`)}`,
    ratingSource: 'Google Maps 검색 기준 · 방문 전 최신 정보 확인',
  };
});
