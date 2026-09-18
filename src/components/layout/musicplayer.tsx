'use client';

import { Heart, ListMusic, Music2, Pause, Play, Repeat2, Search, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { emitMusicEvent, MUSIC_HOT_KEYWORDS, MUSIC_TRACKS, musicPopoverPosition, normalizeMusicFavorites, readMusicVolume, searchMusicTracks, type MusicSyncDetail, type MusicTrack } from '@/lib/music';
import { useGlobalStore } from '@/store/useGlobalStore';
import { SITE_URL } from '@/lib/seo';
import '@/styles/music-popover.css';

function sendPlayerCommand(frame: HTMLIFrameElement | null, func: string, args: unknown[] = []) {
  frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), 'https://www.youtube.com');
}

function subscribeToPlayerState(frame: HTMLIFrameElement | null) {
  const target = frame?.contentWindow;
  if (!target) return;
  target.postMessage(JSON.stringify({ event: 'listening', id: 'gyopo-top-player' }), 'https://www.youtube.com');
  target.postMessage(JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onStateChange'] }), 'https://www.youtube.com');
}

export default function MusicPlayer({ embedded = false }: { embedded?: boolean }) {
  const pathname = usePathname();
  const [isCompactCall, setIsCompactCall] = useState(false);
  const user = useGlobalStore((state) => state.user);
  const [track, setTrack] = useState<MusicTrack>(MUSIC_TRACKS[0]);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(70);
  const lastVolumeRef = useRef(70);
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [remoteResults, setRemoteResults] = useState<MusicTrack[]>([]);
  const [remoteQuery, setRemoteQuery] = useState('');
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState(false);
  const [favoriteTracks, setFavoriteTracks] = useState<MusicTrack[]>([]);
  const [favoriteLoop, setFavoriteLoop] = useState(false);
  const [favoriteMenuOpen, setFavoriteMenuOpen] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [popoverPosition, setPopoverPosition] = useState<ReturnType<typeof musicPopoverPosition> | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const searchShellRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const searchPopoverRef = useRef<HTMLDivElement>(null);
  const favoritePopoverRef = useRef<HTMLDivElement>(null);
  const favoriteButtonRef = useRef<HTMLButtonElement>(null);
  const favoriteMenuRef = useRef<HTMLDivElement>(null);
  const pendingSyncRef = useRef<MusicSyncDetail | null>(null);
  const syncTimerRef = useRef<number | null>(null);
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const metadataLoadedRef = useRef(new Set<string>());
  const originRef = useRef('top-player');
  const previousPathRef = useRef(pathname);
  const loadedVideoIdRef = useRef<string | null>(null);
  const localResults = searchMusicTracks(query);
  const hasRemoteResults = remoteQuery === query.trim() && remoteResults.length > 0 && !remoteError;
  const results = query.trim() ? (hasRemoteResults ? remoteResults : localResults.length ? localResults : MUSIC_TRACKS) : MUSIC_TRACKS;

  useEffect(() => {
    setIsCompactCall(pathname === '/webrtc' && new URLSearchParams(window.location.search).get('compact') === '1');
    setSearchFocused(false);
    setFavoriteMenuOpen(false);
    if (pathname === '/music' || previousPathRef.current === '/music') {
      setPlaying(false);
      if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
      pendingSyncRef.current = null;
      sendPlayerCommand(frameRef.current, 'pauseVideo');
      sendPlayerCommand(frameRef.current, 'mute');
    }
    previousPathRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const closeSearch = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!searchShellRef.current?.contains(target) && !searchButtonRef.current?.contains(target) && !searchPopoverRef.current?.contains(target)) setSearchFocused(false);
      if (!favoriteMenuRef.current?.contains(target) && !favoritePopoverRef.current?.contains(target)) setFavoriteMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (searchPopoverRef.current) (searchShellRef.current?.getBoundingClientRect().width ? searchInputRef.current : searchButtonRef.current)?.focus();
        if (favoritePopoverRef.current) favoriteButtonRef.current?.focus();
        setSearchFocused(false);
        setFavoriteMenuOpen(false);
      }
    };
    const closeOnFocus = (event: FocusEvent) => closeSearch(event as unknown as PointerEvent);
    document.addEventListener('pointerdown', closeSearch);
    document.addEventListener('focusin', closeOnFocus);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeSearch);
      document.removeEventListener('focusin', closeOnFocus);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  useLayoutEffect(() => {
    if (!searchFocused && !favoriteMenuOpen) return;
    const update = () => {
      const searchAnchor = searchShellRef.current?.getBoundingClientRect().width ? searchShellRef.current : searchButtonRef.current;
      const anchor = (searchFocused ? searchAnchor : favoriteButtonRef.current)?.getBoundingClientRect();
      if (!anchor) return;
      const viewport = window.visualViewport;
      setPopoverPosition(musicPopoverPosition(anchor, { left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0, width: viewport?.width || window.innerWidth, height: viewport?.height || window.innerHeight }, searchFocused ? 480 : 340));
    };
    update();
    const observer = new ResizeObserver(update);
    if (searchShellRef.current) observer.observe(searchShellRef.current);
    if (favoriteButtonRef.current) observer.observe(favoriteButtonRef.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [searchFocused, favoriteMenuOpen]);

  useEffect(() => {
    try {
      const nextVolume = readMusicVolume(window.localStorage.getItem('gyopo-music-volume'));
      setVolume(nextVolume);
      if (nextVolume > 0) lastVolumeRef.current = nextVolume;
    } catch { /* Keep the default when storage is unavailable. */ }
    try {
      const local = window.localStorage.getItem(`gyopo-music-favorites:${user?.id || 'guest'}`);
      const stored = normalizeMusicFavorites(local !== null ? JSON.parse(local) : user?.musicFavorites);
      setFavoriteTracks(stored);
      setFavoriteLoop(window.localStorage.getItem(`gyopo-music-favorite-loop:${user?.id || 'guest'}`) === '1');
    } catch {
      setFavoriteTracks([]);
      setFavoriteLoop(false);
      setSaveError('저장한 음악 설정을 읽지 못했습니다. 현재 창에서 계속 사용할 수 있습니다.');
    }
  }, [user?.id, user?.musicFavorites]);

  useEffect(() => {
    const receiveLoop = (event: Event) => setFavoriteLoop(Boolean((event as CustomEvent<{ enabled?: boolean }>).detail?.enabled));
    window.addEventListener('gyopo-music-favorite-loop', receiveLoop);
    return () => window.removeEventListener('gyopo-music-favorite-loop', receiveLoop);
  }, []);

  useEffect(() => {
    const pauseForVideo = (event: Event) => {
      const detail = (event as CustomEvent<{ player?: string; playing?: boolean }>).detail;
      if (detail?.player !== 'video' || !detail.playing) return;
      if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
      if (autoAdvanceTimerRef.current) window.clearTimeout(autoAdvanceTimerRef.current);
      pendingSyncRef.current = null;
      setPlaying(false);
      sendPlayerCommand(frameRef.current, 'pauseVideo');
      sendPlayerCommand(frameRef.current, 'mute');
    };
    window.addEventListener('gyopo-music-player', pauseForVideo);
    return () => window.removeEventListener('gyopo-music-player', pauseForVideo);
  }, []);

  useEffect(() => {
    const receiveFavorites = (event: Event) => {
      const tracks = normalizeMusicFavorites((event as CustomEvent<{ tracks?: MusicTrack[] }>).detail?.tracks);
      setFavoriteTracks(tracks);
    };
    window.addEventListener('gyopo-music-favorites', receiveFavorites);
    return () => window.removeEventListener('gyopo-music-favorites', receiveFavorites);
  }, []);

  useEffect(() => {
    if (!searchFocused || !query.trim()) {
      return;
    }
    const controller = new AbortController();
    const normalizedQuery = query.trim();
    const timeout = window.setTimeout(() => {
      controller.abort();
      setRemoteQuery(normalizedQuery);
      setRemoteLoading(false);
      setRemoteError(true);
    }, 8000);
    const timer = window.setTimeout(() => {
      setRemoteLoading(true);
      setRemoteError(false);
      void fetch(`/api/music/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error('Music search failed');
          return response.json();
        })
        .then((data: { results?: MusicTrack[]; error?: string }) => {
          if (controller.signal.aborted) return;
          if (data.error) throw new Error(data.error);
          setRemoteQuery(normalizedQuery);
          setRemoteResults(normalizeMusicFavorites(data.results));
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
          setRemoteQuery(normalizedQuery);
          setRemoteResults([]);
          setRemoteError(true);
        })
        .finally(() => { window.clearTimeout(timeout); if (!controller.signal.aborted) setRemoteLoading(false); });
    }, 280);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      window.clearTimeout(timeout);
    };
  }, [query, searchFocused]);

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

  const syncFrame = (detail?: MusicSyncDetail) => {
    const current = detail || pendingSyncRef.current;
    const videoId = current?.track.videoId || track.videoId;
    const nextVolume = current?.volume ?? volume;
    // The video page consumes top-player events. Delegate there, never play both iframes.
    const nextPlaying = pathname !== '/music' && (current?.playing ?? playing);
    const needsLoad = loadedVideoIdRef.current !== videoId;
    const applyPlayback = () => {
      if (nextPlaying) sendPlayerCommand(frameRef.current, 'unMute');
      else sendPlayerCommand(frameRef.current, 'mute');
      sendPlayerCommand(frameRef.current, 'setVolume', [nextVolume]);
      if (current?.position) sendPlayerCommand(frameRef.current, 'seekTo', [current.position, true]);
      sendPlayerCommand(frameRef.current, nextPlaying ? 'playVideo' : 'pauseVideo');
    };

    if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
    if (needsLoad) {
      loadedVideoIdRef.current = videoId;
      sendPlayerCommand(frameRef.current, nextPlaying ? 'loadVideoById' : 'cueVideoById', [videoId]);
      syncTimerRef.current = window.setTimeout(applyPlayback, 160);
    } else {
      applyPlayback();
    }
    pendingSyncRef.current = null;
  };

  useEffect(() => {
    const receiveMusicSync = (event: Event) => {
      const detail = (event as CustomEvent<MusicSyncDetail>).detail;
      if (!detail?.track?.videoId) return;
      if (detail.player !== 'top') return;
      if (detail.origin === originRef.current) return;
      pendingSyncRef.current = detail;
      setTrack(detail.track);
      setPlaying(detail.playing);
      if (typeof detail.volume === 'number') setVolume(detail.volume);
      syncFrame(detail);
    };
    window.addEventListener('gyopo-music-sync', receiveMusicSync);
    window.addEventListener('gyopo-music-local', receiveMusicSync);
     const sendCurrentMusic = () => emitMusicEvent('gyopo-music-local', { source: 'local', player: 'top', origin: originRef.current, track, playing, position: 0, startedAt: Date.now(), volume });
    window.addEventListener('gyopo-music-request-state', sendCurrentMusic);
    return () => {
      window.removeEventListener('gyopo-music-sync', receiveMusicSync);
      window.removeEventListener('gyopo-music-local', receiveMusicSync);
      window.removeEventListener('gyopo-music-request-state', sendCurrentMusic);
    };
    }, [playing, track, volume, pathname]);

  useEffect(() => {
    const resumeAudio = () => {
      if (!playing || pathname === '/music') return;
      sendPlayerCommand(frameRef.current, 'unMute');
      sendPlayerCommand(frameRef.current, 'playVideo');
    };
    window.addEventListener('pointerdown', resumeAudio, { once: true, passive: true });
    window.addEventListener('keydown', resumeAudio, { once: true });
    return () => {
      window.removeEventListener('pointerdown', resumeAudio);
      window.removeEventListener('keydown', resumeAudio);
    };
  }, [playing, pathname]);

  const selectTrack = (next: MusicTrack) => {
    setTrack(next);
    setPlaying(true);
    setSearchFocused(false);
    const detail: MusicSyncDetail = { source: 'local', player: 'top', origin: originRef.current, track: next, playing: true, position: 0, startedAt: Date.now(), volume };
    pendingSyncRef.current = detail;
    syncFrame(detail);
    emitMusicEvent('gyopo-music-local', detail);
  };

  const selectRelativeTrack = (direction: -1 | 1) => {
    const pool = favoriteLoop && favoriteTracks.length ? favoriteTracks : MUSIC_TRACKS;
    const index = pool.findIndex((item) => item.id === track.id);
    selectTrack(pool[index < 0 ? (direction === 1 ? 0 : pool.length - 1) : (index + direction + pool.length) % pool.length]);
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
      const ended = payload.event === 'onStateChange'
        ? Number(payload.info) === 0
        : payload.event === 'infoDelivery' && typeof payload.info === 'object' && payload.info?.playerState === 0;
       if (!ended || !playing) return;
       if (autoAdvanceTimerRef.current) window.clearTimeout(autoAdvanceTimerRef.current);
       autoAdvanceTimerRef.current = window.setTimeout(() => selectRelativeTrack(1), 250);
    };
    window.addEventListener('message', handlePlayerMessage);
    return () => {
      window.removeEventListener('message', handlePlayerMessage);
      if (autoAdvanceTimerRef.current) window.clearTimeout(autoAdvanceTimerRef.current);
    };
  }, [favoriteLoop, favoriteTracks, playing, track.id]);

  const togglePlaying = () => {
    const next = !playing;
    if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
    pendingSyncRef.current = null;
    setPlaying(next);
    if (next && pathname !== '/music') sendPlayerCommand(frameRef.current, 'unMute');
    else sendPlayerCommand(frameRef.current, 'mute');
    sendPlayerCommand(frameRef.current, next && pathname !== '/music' ? 'playVideo' : 'pauseVideo');
    emitMusicEvent('gyopo-music-local', { source: 'local', player: 'top', origin: originRef.current, track, playing: next, position: 0, startedAt: Date.now(), volume });
  };

  const changeVolume = (next: number) => {
    const bounded = Math.min(100, Math.max(0, next));
    setVolume(bounded);
    if (bounded > 0) lastVolumeRef.current = bounded;
    try { window.localStorage.setItem('gyopo-music-volume', String(bounded)); } catch { setSaveError('볼륨을 저장하지 못했습니다. 현재 창에서만 적용됩니다.'); }
    sendPlayerCommand(frameRef.current, 'setVolume', [bounded]);
    emitMusicEvent('gyopo-music-local', { source: 'local', player: 'top', origin: originRef.current, track, playing, position: 0, startedAt: Date.now(), volume: bounded });
  };

  const toggleMuted = () => changeVolume(volume > 0 ? 0 : lastVolumeRef.current || 70);

  const toggleFavorite = (item: MusicTrack) => {
    const nextTracks = favoriteTracks.some((favorite) => favorite.videoId === item.videoId) ? favoriteTracks.filter((favorite) => favorite.videoId !== item.videoId) : [...favoriteTracks, item];
    setFavoriteTracks(nextTracks);
    setSaveError('');
    try { window.localStorage.setItem(`gyopo-music-favorites:${user?.id || 'guest'}`, JSON.stringify(nextTracks)); }
    catch { setSaveError('즐겨찾기를 저장하지 못했습니다. 현재 창에서만 유지됩니다.'); }
    window.dispatchEvent(new CustomEvent('gyopo-music-favorites', { detail: { tracks: nextTracks } }));
  };

  const toggleFavoriteLoop = () => {
    const next = !favoriteLoop;
    setFavoriteLoop(next);
    setSaveError('');
    try { window.localStorage.setItem(`gyopo-music-favorite-loop:${user?.id || 'guest'}`, next ? '1' : '0'); }
    catch { setSaveError('반복 설정을 저장하지 못했습니다. 현재 창에서만 적용됩니다.'); }
    window.dispatchEvent(new CustomEvent('gyopo-music-favorite-loop', { detail: { enabled: next } }));
  };

  const toggleFavoriteMenu = () => { setSearchFocused(false); setFavoriteMenuOpen((open) => !open); };
  const openSearch = () => { setFavoriteMenuOpen(false); setSearchFocused(true); };
  const navigatePopover = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (event.target instanceof HTMLInputElement && !event.key.startsWith('Arrow')) return;
    const panel = searchFocused ? searchPopoverRef.current : favoritePopoverRef.current;
    const buttons = Array.from(panel?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : index < 0 ? (event.key === 'ArrowUp' ? buttons.length - 1 : 0) : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
  };

  useEffect(() => {
    sendPlayerCommand(frameRef.current, 'setVolume', [volume]);
  }, [volume]);

  return (
    <section hidden={isCompactCall} className={`music-player-shell music-player-refresh ${embedded ? 'music-player-embedded' : ''}`} aria-label="음악 플레이어">
      <div className="music-player-bar">
        <div className="music-player-track">
          <Music2 size={17} className="shrink-0 text-teal-300" />
          <div className="flex min-w-0 items-center gap-2">
            <b className="truncate text-sm" title={track.title}>{track.title}</b>
            <span className="truncate text-xs text-slate-400" title={track.artist}>{track.artist}</span>
          </div>
        </div>
        <div className="music-player-transport">
          <button type="button" onClick={() => selectRelativeTrack(-1)} aria-label="이전 곡" className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"><SkipBack size={15} /></button>
          <button type="button" onClick={togglePlaying} aria-label={playing ? '일시정지' : '재생'} className="rounded-full bg-teal-300 p-2 text-slate-950 hover:bg-teal-200">
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button type="button" onClick={() => selectRelativeTrack(1)} aria-label="다음 곡" className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"><SkipForward size={15} /></button>
        </div>
        <button ref={searchButtonRef} type="button" className="music-search-trigger music-player-control" aria-label="음악 검색 열기" aria-expanded={searchFocused} aria-controls="top-music-search" onClick={openSearch} onKeyDown={navigatePopover}><Search size={16} /></button>
        <div ref={searchShellRef} className="music-player-search">
          <Search size={15} className="shrink-0 text-slate-400" />
          <input ref={searchInputRef} role="combobox" aria-haspopup="dialog" aria-autocomplete="list" aria-label="음악 검색" aria-expanded={searchFocused} aria-controls="top-music-search" placeholder="곡, 아티스트 검색" value={query} onFocus={openSearch} onClick={openSearch} onKeyDown={navigatePopover} onChange={(event) => { setQuery(event.target.value); openSearch(); }} className="min-w-0 w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500" />
        </div>
        <div className="music-player-options">
           <div className="music-player-volume">
             <button type="button" onClick={toggleMuted} aria-label={volume === 0 ? '음악 음소거 해제' : '음악 음소거'} aria-pressed={volume === 0} className="music-player-control">{volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
             <input aria-label="음악 볼륨" type="range" min="0" max="100" value={volume} onChange={(event) => changeVolume(Number(event.target.value))} className="w-16 accent-teal-300" />
           </div>
           <div ref={favoriteMenuRef}>
             <button type="button" onClick={() => toggleFavorite(track)} aria-pressed={favoriteTracks.some((item) => item.videoId === track.videoId)} aria-label="현재 곡 즐겨찾기" className="music-player-control music-favorite-toggle"><Heart size={15} fill={favoriteTracks.some((item) => item.videoId === track.videoId) ? 'currentColor' : 'none'} /></button>
             <button ref={favoriteButtonRef} type="button" onClick={toggleFavoriteMenu} onKeyDown={navigatePopover} aria-controls="top-music-favorites" aria-expanded={favoriteMenuOpen} aria-label="저장한 반복 재생목록" className="music-player-control"><ListMusic size={16} /></button>
             {favoriteMenuOpen && popoverPosition && !isCompactCall && createPortal(<div ref={favoritePopoverRef} id="top-music-favorites" role="dialog" aria-label="저장한 반복 재생목록" onKeyDown={navigatePopover} style={popoverPosition} className="music-anchored-popover">
              <div className="music-popover-heading"><span>저장한 재생목록 · {favoriteTracks.length}</span><button type="button" aria-label="재생목록 닫기" onClick={() => { favoriteButtonRef.current?.focus(); setFavoriteMenuOpen(false); }}><X size={16} /></button></div>
              <p className="music-popover-status">이 브라우저에 저장됩니다. 계정 동기화는 하지 않습니다.</p>
              {saveError && <p role="alert" className="music-popover-error">{saveError}</p>}
              <button type="button" onClick={toggleFavoriteLoop} aria-pressed={favoriteLoop} className="music-repeat-option"><Repeat2 size={15} />{favoriteLoop ? '저장한 곡 반복 켜짐' : '저장한 곡 반복 꺼짐'}</button>
              {favoriteTracks.length > 0 ? favoriteTracks.map((item) => <div key={item.id} className="flex items-center gap-1 bg-white/[.06] px-2 py-1.5">
                <button type="button" onClick={() => { selectTrack(item); setFavoriteMenuOpen(false); }} className="flex min-w-0 flex-1 items-center gap-2 text-left"><Play size={11} className="shrink-0 text-teal-200" /><span className="min-w-0 truncate text-xs">{item.title}</span></button>
                <button type="button" onClick={() => toggleFavorite(item)} aria-label={`${item.title} 즐겨찾기 삭제`} className="shrink-0 p-1 text-rose-200"><Heart size={12} fill="currentColor" /></button>
              </div>) : <p className="px-2 py-3 text-xs text-white/45">저장한 곡이 없습니다.</p>}
              {!favoriteTracks.some((item) => item.videoId === track.videoId) && <button type="button" onClick={() => toggleFavorite(track)} className="mt-1 w-full bg-white/[.08] px-2 py-2 text-left text-xs text-teal-100 hover:bg-white/[.14]">현재 곡 저장</button>}
             </div>, document.body)}
          </div>
           <button type="button" onClick={toggleFavoriteLoop} aria-pressed={favoriteLoop} aria-label={favoriteLoop ? '즐겨찾기 반복 끄기' : '즐겨찾기 반복 켜기'} className={`music-player-utility ${favoriteLoop ? 'text-rose-200' : 'text-slate-300'}`}><Repeat2 size={15} /></button>
        </div>
          <iframe ref={frameRef} tabIndex={-1} onLoad={() => { subscribeToPlayerState(frameRef.current); syncFrame(); }} title="GYOPO music player" src={`https://www.youtube.com/embed/${MUSIC_TRACKS[0].videoId}?enablejsapi=1&origin=${encodeURIComponent(SITE_URL)}&autoplay=0&cc_load_policy=0&iv_load_policy=3&playsinline=1`} className="pointer-events-none absolute h-px w-px opacity-0" allow="autoplay; encrypted-media" />
      </div>

      {saveError && !searchFocused && !favoriteMenuOpen && <button type="button" className="music-save-error" onClick={toggleFavoriteMenu} role="alert">{saveError}</button>}
      {searchFocused && popoverPosition && !isCompactCall && createPortal(<div ref={searchPopoverRef} id="top-music-search" role="dialog" aria-label="음악 추천 및 검색" onKeyDown={navigatePopover} style={popoverPosition} className="music-anchored-popover">
        <div className="music-popover-heading"><span>{query.trim() ? '검색 결과' : '추천 음악'}</span><button type="button" aria-label="음악 검색 닫기" onClick={() => { (searchShellRef.current?.getBoundingClientRect().width ? searchInputRef.current : searchButtonRef.current)?.focus(); setSearchFocused(false); }}><X size={16} /></button></div>
        <input className="music-popover-query" aria-label="추천 음악 검색" placeholder="곡, 아티스트 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
        {saveError && <p role="alert" className="music-popover-error">{saveError}</p>}
        <div className="flex flex-wrap gap-1.5">
          {MUSIC_HOT_KEYWORDS.map((keyword) => <button type="button" key={keyword} onMouseDown={(event) => event.preventDefault()} onClick={() => setQuery(keyword)} className="border-0 bg-white/[.06] px-2.5 py-1.5 text-[11px] font-bold text-slate-400 outline-none ring-0 hover:bg-teal-300/10 hover:text-teal-200">#{keyword}</button>)}
        </div>
        {favoriteTracks.length > 0 && <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2 text-[11px] text-slate-400">
          <span>♥ 즐겨찾기 {favoriteTracks.length}곡 {favoriteLoop ? '반복 재생 중' : ''}</span>
          <button type="button" onClick={toggleFavoriteLoop} className="border-0 text-rose-200">{favoriteLoop ? '반복 끄기' : '즐겨찾기만 반복'}</button>
        </div>}
         <div className="mt-2 grid gap-2">
           {query.trim() && remoteLoading && <p role="status" className="music-popover-status">YouTube 검색 중...</p>}
           {query.trim() && remoteQuery === query.trim() && remoteError && <p role="status" className="music-popover-error">검색 서버에 연결되지 않았습니다. 로컬 음악 목록을 표시합니다.</p>}
           {query.trim() && !hasRemoteResults && <p className="music-popover-status">{localResults.length ? '로컬 일치 항목' : '로컬 추천 음악 · 일치하는 곡이 없습니다.'}</p>}
           {results.length ? results.map((item) => <div key={item.id} className={`flex min-w-0 items-center gap-2 border-0 px-2 py-2 ${item.id === track.id ? 'bg-teal-300/10' : 'bg-white/[.05]'}`}>
            <button type="button" onClick={() => selectTrack(item)} className="flex min-w-0 flex-1 items-center gap-2 border-0 text-left outline-none ring-0">
              {item.thumbnail ? <img src={item.thumbnail} alt="" className="h-10 w-16 shrink-0 object-cover" /> : <span className="h-10 w-16 shrink-0 bg-black" />}
              <span className="min-w-0">
                <b className="block truncate text-xs">{item.title}</b>
                <span className="block truncate text-[11px] text-slate-400">{item.artist}</span>
                <span className="block truncate text-[10px] text-slate-500">{item.views || (hasRemoteResults ? 'YouTube 검색 결과' : '로컬 음악 목록')}{item.published ? ` · ${item.published}` : ''}</span>
              </span>
            </button>
            <button type="button" onClick={() => toggleFavorite(item)} aria-label={`${item.title} 즐겨찾기`} aria-pressed={favoriteTracks.some((favorite) => favorite.videoId === item.videoId)} className="music-favorite-toggle shrink-0"><Heart size={14} fill={favoriteTracks.some((favorite) => favorite.videoId === item.videoId) ? 'currentColor' : 'none'} /></button>
           </div>) : <div className="col-span-full text-xs text-slate-400">{remoteError ? '검색 서버에 연결되지 않았습니다. ' : ''}<a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`} target="_blank" rel="noreferrer" className="font-bold text-teal-200 no-underline">YouTube에서 이 키워드 검색하기</a></div>}
        </div>
      </div>, document.body)}
    </section>
  );
}
