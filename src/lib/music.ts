export type MusicTrack = {
  id: string;
  title: string;
  artist: string;
  videoId: string;
  keywords: string[];
  views?: string;
  published?: string;
  thumbnail?: string;
};

export type MusicSyncDetail = {
  source?: 'local' | 'room';
  player?: 'top' | 'video' | 'radio' | 'game';
  origin?: string;
  track: MusicTrack;
  playing: boolean;
  position?: number;
  startedAt?: number;
  volume?: number;
  userInitiated?: boolean;
};

export function emitMusicEvent(name: 'gyopo-music-local' | 'gyopo-music-sync', detail: MusicSyncDetail) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<MusicSyncDetail>(name, { detail }));
}

export function emitMusicPlayerEvent(detail: { player: 'top' | 'video' | 'radio' | 'game'; playing: boolean }) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('gyopo-music-player', { detail }));
}

export function emitBackgroundMusicEvent(muted: boolean) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('gyopo-background-music', { detail: { muted } }));
}

export const MUSIC_TRACKS: MusicTrack[] = [
  { id: 'like-jennie', title: 'like JENNIE', artist: 'JENNIE', videoId: 'JSFG-IE8n_c', keywords: ['JENNIE', '제니', 'like JENNIE', 'BLACKPINK'], thumbnail: 'https://i.ytimg.com/vi/JSFG-IE8n_c/hqdefault.jpg' },
  { id: 'earthquake', title: 'earthquake', artist: 'JISOO', videoId: '2V6lvCUPT8I', keywords: ['JISOO', '지수', 'earthquake', 'AMORTAGE'], thumbnail: 'https://i.ytimg.com/vi/2V6lvCUPT8I/hqdefault.jpg' },
  { id: 'sawadika', title: 'SaWaDiKa', artist: 'LISA', videoId: 'FyS5dAywkEo', keywords: ['LISA', '리사', 'SaWaDiKa', 'Sawasdee Ka', 'BLACKPINK'], thumbnail: 'https://i.ytimg.com/vi/FyS5dAywkEo/hqdefault.jpg' },
  { id: 'would-you', title: 'WOULD YOU (feat. TARZZAN, WOOCHAN)', artist: 'TAEYANG', videoId: 'K1VTsnCNu3Y', keywords: ['TAEYANG', '태양', 'WOULD YOU', 'QUINTESSENCE'], thumbnail: 'https://i.ytimg.com/vi/K1VTsnCNu3Y/hqdefault.jpg' },
  { id: 'swim', title: 'SWIM', artist: 'BTS', videoId: 'b4iVv91Z6lY', keywords: ['BTS', 'SWIM', '신곡'], thumbnail: 'https://i.ytimg.com/vi/b4iVv91Z6lY/hqdefault.jpg' },
  { id: 'droptop', title: 'DROP TOP', artist: 'MEOVV (미야오)', videoId: 'l4On7TQoM-M', keywords: ['미야오', 'DROPTOP', 'MEOVV'], thumbnail: 'https://i.ytimg.com/vi/l4On7TQoM-M/hqdefault.jpg' },
  { id: 'supernova', title: 'Supernova', artist: 'aespa', videoId: 'phuiiNCxRMg', keywords: ['aespa', 'Supernova', 'SM'], thumbnail: 'https://i.ytimg.com/vi/phuiiNCxRMg/hqdefault.jpg' },
  { id: 'supershy', title: 'Super Shy', artist: 'NewJeans', videoId: 'ArmDp-zijuc', keywords: ['NewJeans', 'Super Shy', '뉴진스'], thumbnail: 'https://i.ytimg.com/vi/ArmDp-zijuc/hqdefault.jpg' },
  { id: 'ddu-du', title: 'DDU-DU DDU-DU', artist: 'BLACKPINK', videoId: 'IHNzOHi8sJs', keywords: ['BLACKPINK', '블랙핑크', 'DANCE'], thumbnail: 'https://i.ytimg.com/vi/IHNzOHi8sJs/hqdefault.jpg' },
  { id: 'butter', title: 'Butter', artist: 'BTS', videoId: 'WMweEpGlu_U', keywords: ['BTS', 'Butter', 'K-pop'], thumbnail: 'https://i.ytimg.com/vi/WMweEpGlu_U/hqdefault.jpg' },
];

export const MUSIC_HOT_KEYWORDS = ['like JENNIE', 'earthquake', 'SaWaDiKa', 'K-pop 최신곡', 'BTS 전곡', 'K-POP TOP 100', '뉴진스', 'BLACKPINK'];

export function searchMusicTracks(query: string): MusicTrack[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return MUSIC_TRACKS;
  return MUSIC_TRACKS.filter((track) => `${track.title} ${track.artist} ${track.keywords.join(' ')}`.toLowerCase().includes(normalized));
}

export function readMusicVolume(value: string | null): number {
  const volume = value === null || !value.trim() ? NaN : Number(value);
  return Number.isFinite(volume) ? Math.min(100, Math.max(0, volume)) : 70;
}

export function normalizeMusicFavorites(value: unknown): MusicTrack[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((item): item is MusicTrack => {
    if (!item || typeof item.id !== 'string' || typeof item.videoId !== 'string' ||
      typeof item.title !== 'string' || typeof item.artist !== 'string' || !Array.isArray(item.keywords) || seen.has(item.videoId)) return false;
    seen.add(item.videoId);
    return true;
  });
}

export function musicPopoverPosition(anchor: { left: number; top: number; bottom: number }, viewport: { left: number; top: number; width: number; height: number }, desiredWidth: number) {
  const margin = 12;
  const width = Math.max(0, Math.min(desiredWidth, viewport.width - margin * 2));
  const left = Math.max(viewport.left + margin, Math.min(anchor.left, viewport.left + viewport.width - width - margin));
  const bottom = viewport.top + viewport.height - margin;
  const anchorTop = Math.max(viewport.top + margin, Math.min(anchor.top, bottom));
  const anchorBottom = Math.max(viewport.top + margin, Math.min(anchor.bottom, bottom));
  const below = bottom - anchorBottom - 8;
  const above = anchorTop - viewport.top - margin - 8;
  const maxHeight = Math.max(0, Math.min(420, below < 180 && above > below ? above : below));
  const top = below < 180 && above > below ? anchorTop - 8 - maxHeight : Math.max(viewport.top + margin, Math.min(bottom, anchorBottom + 8));
  return { left, top, width, maxHeight };
}
