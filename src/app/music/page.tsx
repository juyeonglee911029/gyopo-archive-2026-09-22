'use client';

import { Heart, Pause, Play, Search, Music2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MUSIC_HOT_KEYWORDS, MUSIC_TRACKS, searchMusicTracks, type MusicTrack } from '@/lib/music';
import { getSessionToken, saveProfile } from '@/lib/firebase';
import { useGlobalStore } from '@/store/useGlobalStore';
import { musicPlayback, playbackMessage, revealMusicPlayer, useMusicPlayback } from '@/lib/musicPlayback';

export default function MusicPage() {
  const user = useGlobalStore((state) => state.user);
  const setUser = useGlobalStore((state) => state.setUser);
  const playback = useMusicPlayback();
  const { track, volume } = playback;
  const playing = playback.status === 'playing';
  const [query, setQuery] = useState('');
  const [remoteResults, setRemoteResults] = useState<MusicTrack[]>([]);
  const [remoteQuery, setRemoteQuery] = useState('');
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState(false);
  const [favoriteTracks, setFavoriteTracks] = useState<MusicTrack[]>([]);
  const [favoriteLoop, setFavoriteLoop] = useState(false);
  const metadataLoadedRef = useRef(new Set<string>());
  const playerHostRef = useRef<HTMLDivElement>(null);
  const localResults = useMemo(() => searchMusicTracks(query), [query]);
  const results = query.trim() ? (remoteQuery === query.trim() && remoteResults.length ? remoteResults : localResults) : MUSIC_TRACKS;
  const favoriteIds = favoriteTracks.map((item) => item.id);

  useLayoutEffect(() => {
    if (!playerHostRef.current) return;
    if (musicPlayback.getSnapshot().owner !== 'video') musicPlayback.setRoute('video');
    return musicPlayback.mount('video', playerHostRef.current);
  }, []);

  useEffect(() => {
    try {
      const stored = user?.musicFavorites || JSON.parse(window.localStorage.getItem(`gyopo-music-favorites:${user?.id || 'guest'}`) || '[]');
      setFavoriteTracks(stored);
      setFavoriteLoop(window.localStorage.getItem(`gyopo-music-favorite-loop:${user?.id || 'guest'}`) === '1');
    } catch {
      setFavoriteTracks([]);
    }
  }, [user?.id, user?.musicFavorites]);

  useEffect(() => { musicPlayback.setPlaylist(favoriteTracks, favoriteLoop); }, [favoriteTracks, favoriteLoop]);

  useEffect(() => {
    const host = playerHostRef.current;
    if (!host) return;
    let active = true;
    const observer = new IntersectionObserver(([entry]) => {
      if (active && !entry.isIntersecting && musicPlayback.getSnapshot().owner === 'video') musicPlayback.pause();
    });
    observer.observe(host);
    return () => { active = false; observer.disconnect(); };
  }, []);

  useEffect(() => {
    const receiveFavorites = (event: Event) => setFavoriteTracks((event as CustomEvent<{ tracks?: MusicTrack[] }>).detail?.tracks || []);
    const receiveLoop = (event: Event) => setFavoriteLoop(Boolean((event as CustomEvent<{ enabled?: boolean }>).detail?.enabled));
    window.addEventListener('gyopo-music-favorites', receiveFavorites);
    window.addEventListener('gyopo-music-favorite-loop', receiveLoop);
    return () => { window.removeEventListener('gyopo-music-favorites', receiveFavorites); window.removeEventListener('gyopo-music-favorite-loop', receiveLoop); };
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      return;
    }
    const controller = new AbortController();
    const normalizedQuery = query.trim();
    const timer = window.setTimeout(() => {
      setRemoteLoading(true);
      setRemoteError(false);
      void fetch(`/api/music/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error('Music search failed');
          return response.json();
        })
        .then((data: { results?: MusicTrack[] }) => {
          setRemoteQuery(normalizedQuery);
          setRemoteResults(data.results || []);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setRemoteQuery(normalizedQuery);
          setRemoteResults([]);
          setRemoteError(true);
        })
        .finally(() => setRemoteLoading(false));
    }, 280);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (metadataLoadedRef.current.has(track.videoId) || (track.views && track.published)) return;
    metadataLoadedRef.current.add(track.videoId);
    void fetch(`/api/music/details?videoId=${encodeURIComponent(track.videoId)}`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() as Promise<Partial<MusicTrack>> : null)
      .then((metadata) => {
        if (!metadata) return;
        const current = musicPlayback.getSnapshot().track;
        if (current.videoId === track.videoId) musicPlayback.select({ ...current, ...metadata }, false);
        setFavoriteTracks((current) => current.map((item) => item.videoId === track.videoId ? { ...item, ...metadata } : item));
      })
      .catch(() => undefined);
  }, [track.videoId, track.views, track.published]);

  const selectTrack = (item: MusicTrack) => {
    revealMusicPlayer(playerHostRef.current);
    musicPlayback.select(item);
    setQuery('');
  };

  const togglePlaying = () => {
    revealMusicPlayer(playerHostRef.current);
    musicPlayback.toggle();
  };

  const retryPlaying = () => {
    revealMusicPlayer(playerHostRef.current);
    musicPlayback.retry();
  };

  const changeVolume = (next: number) => {
    musicPlayback.setVolume(next);
    try { window.localStorage.setItem('gyopo-music-volume', String(next)); } catch { /* Playback works without storage. */ }
  };

  const toggleFavorite = (item: MusicTrack) => {
    const next = favoriteIds.includes(item.id) ? favoriteTracks.filter((favorite) => favorite.id !== item.id) : [...favoriteTracks, item];
    setFavoriteTracks(next);
    window.localStorage.setItem(`gyopo-music-favorites:${user?.id || 'guest'}`, JSON.stringify(next));
    if (user) {
      const nextUser = { ...user, musicFavorites: next };
      setUser(nextUser);
      void saveProfile(nextUser, getSessionToken()).catch(() => undefined);
    }
    window.dispatchEvent(new CustomEvent('gyopo-music-favorites', { detail: { tracks: next } }));
  };

  const toggleFavoriteLoop = () => {
    const next = !favoriteLoop;
    setFavoriteLoop(next);
    window.localStorage.setItem(`gyopo-music-favorite-loop:${user?.id || 'guest'}`, next ? '1' : '0');
    window.dispatchEvent(new CustomEvent('gyopo-music-favorite-loop', { detail: { enabled: next } }));
  };

  return (
    <div className="category-page music-page min-h-screen bg-[#070b17] px-4 py-8 text-white md:px-8 md:py-12">
      <div className="category-shell mx-auto max-w-7xl">
        <div className="category-header">
            <div className="category-heading"><div className="mb-3 flex items-center gap-2 text-sm font-medium tracking-[0.12em] text-teal-300"><Music2 size={16} /> MUSIC VIDEO</div><h1 className="text-4xl font-medium tracking-tight md:text-6xl">MUSIC VIDEO</h1><p className="mt-3 text-sm text-slate-400">등록곡뿐 아니라 YouTube에서 검색한 뮤직비디오도 바로 재생하고 함께 들을 수 있습니다.</p></div>
          <div className="flex flex-wrap gap-2">{MUSIC_HOT_KEYWORDS.map((keyword) => <button type="button" key={keyword} onClick={() => setQuery(keyword)} className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-300 hover:border-teal-300/50 hover:text-teal-200">#{keyword}</button>)}</div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_330px]">
          <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#10182b] shadow-2xl">
            <div id="music-video-player" ref={playerHostRef} className="aspect-video bg-black" style={{ minWidth: 200, minHeight: 200 }} data-player-status={playback.status} data-player-state={playback.state} data-player-time={playback.currentTime} data-player-muted={playback.muted} />
            <div style={{ padding: '8px 20px', fontSize: 13 }}>
              <p role={playback.error ? 'alert' : 'status'}>{playbackMessage(playback)}{playback.muted || volume === 0 ? ' · 음소거' : ''}</p>
              {(playback.status === 'blocked' || playback.status === 'error') && <button type="button" onClick={retryPlaying} style={{ color: '#5eead4', marginRight: 16 }}>다시 재생</button>}
              <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(track.videoId)}`} target="_blank" rel="noreferrer">YouTube에서 열기</a>
            </div>
               <div className="flex flex-wrap items-center justify-between gap-3 p-5 md:p-7"><div><div className="text-xs font-black uppercase tracking-[0.2em] text-teal-300">Now playing</div><h2 className="mt-2 text-3xl font-black">{track.title}</h2><p className="mt-1 text-sm font-bold text-slate-400">{track.artist}</p><div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold text-slate-500"><span className="border border-white/10 bg-white/[.04] px-2.5 py-1.5">조회수 · {track.views || '조회 중'}</span><span className="border border-white/10 bg-white/[.04] px-2.5 py-1.5">발매일 · {track.published || '조회 중'}</span></div></div><div className="flex items-center gap-3"><button type="button" onClick={() => toggleFavorite(track)} className={`border px-3 py-2 text-xs font-black ${favoriteIds.includes(track.id) ? 'border-rose-300/50 text-rose-200' : 'border-white/10 text-slate-300'}`}><Heart size={14} fill={favoriteIds.includes(track.id) ? 'currentColor' : 'none'} /></button><button type="button" onClick={togglePlaying} className="flex items-center gap-2 border border-teal-300/30 bg-teal-300 px-3 py-2 text-xs font-black text-slate-950">{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? '일시정지' : '재생'}</button><label className="flex items-center gap-2 text-xs text-slate-400">볼륨<input type="range" min="0" max="100" value={volume} onChange={(event) => changeVolume(Number(event.target.value))} className="accent-teal-300" /></label></div></div>
          </section>

           <aside className="border border-white/10 bg-[#10182b] p-5">
              <div className="music-search-box flex items-center gap-2 px-3 py-2"><Search size={16} className="text-slate-500" /><input aria-label="뮤직비디오 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="YouTube 곡·가수 검색" className="w-full bg-transparent text-sm outline-none placeholder:text-slate-500" /></div>
             <div className="mt-4 flex items-center justify-between border-b border-white/10 pb-3"><span className="text-xs font-black text-slate-300">♥ 즐겨찾기 보관함</span><button type="button" onClick={toggleFavoriteLoop} className={`border px-2 py-1 text-[10px] font-black ${favoriteLoop ? 'border-rose-300/50 text-rose-200' : 'border-white/10 text-slate-500'}`}>{favoriteLoop ? '즐겨찾기 반복 ON' : '즐겨찾기만 반복'}</button></div>
             {favoriteTracks.length > 0 && <div className="mt-3 space-y-2">{favoriteTracks.map((item) => <button type="button" key={item.id} onClick={() => selectTrack(item)} className="flex w-full items-center gap-2 border-0 bg-white/5 p-2 text-left"><img src={item.thumbnail || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`} alt="" className="h-10 w-16 object-cover" /><span className="min-w-0 flex-1"><b className="block truncate text-xs">{item.title}</b><span className="block truncate text-[10px] text-slate-500">{item.artist}</span></span><Heart size={13} className="shrink-0 text-rose-300" fill="currentColor" /></button>)}</div>}
             <h3 className="mt-6 text-xs font-black uppercase tracking-[0.2em] text-slate-500">YouTube 검색 결과</h3>
              <div className="mt-3 space-y-2">{remoteLoading && <p className="text-xs text-slate-400">YouTube 검색 중...</p>}{results.map((item) => <div key={item.id} className={`flex items-center gap-2 border p-3 text-left transition ${track.id === item.id ? 'border-teal-300/50 bg-teal-300/10' : 'border-white/10 bg-white/5 hover:border-white/20'}`}><button type="button" onClick={() => selectTrack(item)} className="flex min-w-0 flex-1 items-center gap-3 border-0 text-left"><img src={item.thumbnail || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`} alt="" className="h-12 w-20 object-cover" /><span className="min-w-0"><b className="block truncate text-sm">{item.title}</b><span className="block truncate text-xs text-slate-400">{item.artist}</span><span className="block truncate text-[10px] text-slate-500">{item.views || '조회 중'}{item.published ? ` · ${item.published}` : ''}</span></span></button><button type="button" onClick={() => toggleFavorite(item)} aria-label="즐겨찾기" className={`border-0 ${favoriteIds.includes(item.id) ? 'text-rose-300' : 'text-slate-500'}`}><Heart size={14} fill={favoriteIds.includes(item.id) ? 'currentColor' : 'none'} /></button></div>)}{!results.length && <div className="text-sm text-slate-400">{remoteError ? '검색 서버에 연결되지 않았습니다. ' : ''}<a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`} target="_blank" rel="noreferrer" className="font-bold text-teal-200 underline">YouTube에서 이 키워드 검색하기</a></div>}</div>
          </aside>
        </div>
      </div>
    </div>
  );
}
