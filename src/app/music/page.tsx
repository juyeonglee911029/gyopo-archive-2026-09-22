'use client';

import { Heart, Pause, Play, Search, Music2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { emitBackgroundMusicEvent, emitMusicEvent, emitMusicPlayerEvent, MUSIC_HOT_KEYWORDS, MUSIC_TRACKS, searchMusicTracks, type MusicSyncDetail, type MusicTrack } from '@/lib/music';
import { getSessionToken, saveProfile } from '@/lib/firebase';
import { useGlobalStore } from '@/store/useGlobalStore';
import { SITE_URL } from '@/lib/seo';

export default function MusicPage() {
  const user = useGlobalStore((state) => state.user);
  const setUser = useGlobalStore((state) => state.setUser);
  const [track, setTrack] = useState<MusicTrack>(MUSIC_TRACKS[0]);
  const [query, setQuery] = useState('');
  const [remoteResults, setRemoteResults] = useState<MusicTrack[]>([]);
  const [remoteQuery, setRemoteQuery] = useState('');
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState(false);
  const [volume, setVolume] = useState(70);
  const [playing, setPlaying] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [favoriteTracks, setFavoriteTracks] = useState<MusicTrack[]>([]);
  const [favoriteLoop, setFavoriteLoop] = useState(false);
  const metadataLoadedRef = useRef(new Set<string>());
  const frameRef = useRef<HTMLIFrameElement>(null);
  const desiredPlayingRef = useRef(false);
  const videoSelectedRef = useRef(false);
  const localResults = useMemo(() => searchMusicTracks(query), [query]);
  const results = query.trim() ? (remoteQuery === query.trim() && remoteResults.length ? remoteResults : localResults) : MUSIC_TRACKS;
  const favoriteIds = favoriteTracks.map((item) => item.id);

  useEffect(() => {
    emitMusicPlayerEvent({ player: 'video', playing: false });
    return () => {
      videoSelectedRef.current = false;
      emitMusicPlayerEvent({ player: 'video', playing: false });
      emitBackgroundMusicEvent(false);
    };
  }, []);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem('gyopo-music-volume'));
    if (Number.isFinite(saved)) setVolume(Math.min(100, Math.max(0, saved)));
    try {
      const stored = user?.musicFavorites || JSON.parse(window.localStorage.getItem(`gyopo-music-favorites:${user?.id || 'guest'}`) || '[]');
      setFavoriteTracks(stored);
    } catch {
      setFavoriteTracks([]);
    }
    setFavoriteLoop(window.localStorage.getItem(`gyopo-music-favorite-loop:${user?.id || 'guest'}`) === '1');
    const syncTopPlayer = (event: Event) => {
      const detail = (event as CustomEvent<MusicSyncDetail>).detail;
       if (!detail?.track?.videoId || detail.player !== 'top' || videoSelectedRef.current) return;
       setTrack(detail.track);
       desiredPlayingRef.current = detail.playing;
       setPlaying(detail.playing);
      if (typeof detail.volume === 'number') setVolume(detail.volume);
    };
    window.addEventListener('gyopo-music-local', syncTopPlayer);
    window.addEventListener('gyopo-music-sync', syncTopPlayer);
    window.dispatchEvent(new Event('gyopo-music-request-state'));
    return () => {
      window.removeEventListener('gyopo-music-local', syncTopPlayer);
      window.removeEventListener('gyopo-music-sync', syncTopPlayer);
    };
  }, [user?.id, user?.musicFavorites]);

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
        setTrack((current) => current.videoId === track.videoId ? { ...current, ...metadata } : current);
        setFavoriteTracks((current) => current.map((item) => item.videoId === track.videoId ? { ...item, ...metadata } : item));
      })
      .catch(() => undefined);
  }, [track.videoId, track.views, track.published]);

  useEffect(() => {
    const frame = frameRef.current?.contentWindow;
    if (!frame || !playerReady) return;
    const send = (func: string, args: unknown[] = []) => frame.postMessage(JSON.stringify({ event: 'command', func, args }), 'https://www.youtube.com');
    send('setVolume', [volume]);
    if (playing) {
      send('unMute');
      send('playVideo');
    } else {
      send('pauseVideo');
    }
  }, [playing, track.videoId, volume, playerReady]);

  const selectTrack = (item: MusicTrack) => {
    videoSelectedRef.current = true;
    setPlayerReady(false);
    desiredPlayingRef.current = true;
    setTrack(item);
    setPlaying(true);
    setQuery('');
    emitMusicEvent('gyopo-music-local', { source: 'local', player: 'video', track: item, playing: true, position: 0, startedAt: Date.now(), volume });
    emitMusicPlayerEvent({ player: 'video', playing: true });
    emitBackgroundMusicEvent(true);
  };

  useEffect(() => {
    const handlePlayerMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://www.youtube.com' || event.source !== frameRef.current?.contentWindow || typeof event.data !== 'string') return;
      let payload: { event?: string; info?: number | { playerState?: number } };
      try {
        payload = JSON.parse(event.data) as typeof payload;
      } catch {
        return;
      }
      // infoDelivery reports transient initial states too. Advance only on an explicit ended event.
      const ended = payload.event === 'onStateChange' && Number(payload.info) === 0;
      if (!ended) return;
      const pool = favoriteLoop && favoriteTracks.length ? favoriteTracks : MUSIC_TRACKS;
      if (!pool.length) return;
      const index = pool.findIndex((item) => item.id === track.id);
      selectTrack(pool[(Math.max(index, 0) + 1) % pool.length]);
    };
    window.addEventListener('message', handlePlayerMessage);
    return () => window.removeEventListener('message', handlePlayerMessage);
  }, [favoriteLoop, favoriteTracks, track.id, volume]);

  const togglePlaying = () => {
    const next = !playing;
    desiredPlayingRef.current = next;
    setPlaying(next);
    if (playerReady) {
      const frame = frameRef.current?.contentWindow;
      frame?.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [volume] }), 'https://www.youtube.com');
      if (next) frame?.postMessage(JSON.stringify({ event: 'command', func: 'unMute', args: [] }), 'https://www.youtube.com');
      frame?.postMessage(JSON.stringify({ event: 'command', func: next ? 'playVideo' : 'pauseVideo', args: [] }), 'https://www.youtube.com');
    }
    emitMusicEvent('gyopo-music-local', { source: 'local', player: 'video', track, playing: next, position: 0, startedAt: Date.now(), volume });
    emitMusicPlayerEvent({ player: 'video', playing: next });
  };

  const changeVolume = (next: number) => {
    setVolume(next);
    window.localStorage.setItem('gyopo-music-volume', String(next));
    frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [next] }), 'https://www.youtube.com');
    emitMusicEvent('gyopo-music-local', { source: 'local', player: 'video', track, playing, position: 0, startedAt: Date.now(), volume: next });
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
                 <div className="aspect-video bg-black"><iframe ref={frameRef} key={track.videoId} onLoad={() => { const frame = frameRef.current?.contentWindow; setPlayerReady(true); frame?.postMessage(JSON.stringify({ event: 'listening', id: 'gyopo-music-page' }), 'https://www.youtube.com'); frame?.postMessage(JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onStateChange'] }), 'https://www.youtube.com'); frame?.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [volume] }), 'https://www.youtube.com'); if (desiredPlayingRef.current) { frame?.postMessage(JSON.stringify({ event: 'command', func: 'unMute', args: [] }), 'https://www.youtube.com'); frame?.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), 'https://www.youtube.com'); } else frame?.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), 'https://www.youtube.com'); }} src={`https://www.youtube.com/embed/${track.videoId}?enablejsapi=1&origin=${encodeURIComponent(SITE_URL)}&autoplay=0&rel=0`} title={track.title} className="h-full w-full" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /></div>
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
