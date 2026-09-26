'use client';

import { useSyncExternalStore } from 'react';
import { MUSIC_TRACKS, type MusicSyncDetail, type MusicTrack } from './music.ts';
import { createYouTubeController, IDLE_YOUTUBE, type YouTubeController, type YouTubeSnapshot } from './youtube.ts';

type Owner = 'top' | 'video';
export type MusicPlaybackSnapshot = YouTubeSnapshot & {
  track: MusicTrack; volume: number; owner: Owner; panelOpen: boolean;
};
const INITIAL: MusicPlaybackSnapshot = { ...IDLE_YOUTUBE, track: MUSIC_TRACKS[0], volume: 70, owner: 'top', panelOpen: false };

// Header and page controls share intent and feedback, not competing iframe event buses.
export function createMusicPlayback(makeController = createYouTubeController) {
  let snapshot = INITIAL;
  let controller: YouTubeController | undefined;
  let mountedOwner: Owner | undefined;
  let mountId = 0;
  let favorites: MusicTrack[] = [];
  let favoriteLoop = false;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<MusicPlaybackSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };
  const idle = () => ({ ...IDLE_YOUTUBE, volume: snapshot.volume, muted: snapshot.muted });
  const detach = () => {
    mountId++;
    controller?.destroy();
    controller = undefined;
    mountedOwner = undefined;
  };
  const play = () => {
    const retry = snapshot.status === 'error' || snapshot.status === 'blocked';
    update({ desiredPlaying: true, panelOpen: snapshot.owner === 'top', error: '', status: 'loading' });
    if (retry) controller?.retry(); else controller?.setPlaying(true);
  };
  const select = (track: MusicTrack, start = true) => {
    update({ track });
    controller?.setTrack(track.videoId);
    if (start) play();
  };
  const relative = (direction: -1 | 1) => {
    const pool = favoriteLoop && favorites.length ? favorites : MUSIC_TRACKS;
    const index = pool.findIndex((item) => item.videoId === snapshot.track.videoId);
    select(pool[index < 0 ? (direction === 1 ? 0 : pool.length - 1) : (index + direction + pool.length) % pool.length]);
  };
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => INITIAL,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setRoute(owner: Owner) {
      controller?.setPlaying(false);
      if (owner !== snapshot.owner) detach();
      update({ ...idle(), owner, panelOpen: false });
    },
    mount(owner: Owner, host: HTMLElement) {
      if (owner !== snapshot.owner) return () => {};
      detach();
      mountedOwner = owner;
      const ticket = mountId;
      const desired = snapshot.desiredPlaying;
      controller = makeController(host, {
        videoId: snapshot.track.videoId, volume: snapshot.volume, muted: snapshot.muted,
        canPlay() {
          if (typeof document !== 'undefined' && document.hidden) return false;
          if (typeof window === 'undefined') return true;
          if (!host.isConnected) return false;
          const rect = host.getBoundingClientRect();
          const viewport = window.visualViewport;
          const left = viewport?.offsetLeft || 0;
          const top = viewport?.offsetTop || 0;
          return rect.width > 0 && rect.height > 0 && rect.bottom > top && rect.right > left && rect.top < top + (viewport?.height || window.innerHeight) && rect.left < left + (viewport?.width || window.innerWidth);
        },
        onChange(next) { if (ticket === mountId) update(next); },
        onEnded() { if (ticket === mountId) relative(1); },
      });
      if (desired) controller.setPlaying(true);
      return () => {
        if (ticket !== mountId) return;
        detach();
        // Preserve pending intent across StrictMode setup/cleanup/setup; no detached player survives.
        update({ ...idle(), desiredPlaying: snapshot.desiredPlaying });
      };
    },
    play,
    pause() { update({ desiredPlaying: false }); controller?.setPlaying(false); },
    toggle() {
      if (snapshot.desiredPlaying) this.pause();
      else play();
    },
    close() {
      controller?.setPlaying(false);
      if (mountedOwner === 'top') detach();
      update({ ...idle(), panelOpen: false });
    },
    retry() { update({ panelOpen: snapshot.owner === 'top', desiredPlaying: true }); if (controller) controller.retry(); else play(); },
    select, relative,
    setVolume(volume: number, preserveMute = false) {
      if (!Number.isFinite(volume)) return;
      const bounded = Math.min(100, Math.max(0, volume));
      update({ volume: bounded, muted: bounded === 0 || (preserveMute && snapshot.muted) });
      controller?.setVolume(bounded, preserveMute);
    },
    setMuted(muted: boolean) { update({ muted }); controller?.setMuted(muted); },
    sync(detail?: MusicSyncDetail) {
      if (!detail?.track?.videoId || detail.player !== 'top') return false;
      // A room can cue/update music, but never grants local playback consent.
      if (!detail.playing) this.pause();
      select(detail.track, false);
      if (typeof detail.volume === 'number') this.setVolume(detail.volume, true);
      return true;
    },
    setPlaylist(tracks: MusicTrack[], loop: boolean) { favorites = tracks; favoriteLoop = loop; },
  };
}

export const musicPlayback = createMusicPlayback();
export function useMusicPlayback() {
  return useSyncExternalStore(musicPlayback.subscribe, musicPlayback.getSnapshot, musicPlayback.getServerSnapshot);
}

export function revealMusicPlayer(host = document.getElementById('music-video-player')) {
  host?.scrollIntoView({ block: 'center', behavior: 'instant' });
}

export function playbackMessage(snapshot: YouTubeSnapshot) {
  if (snapshot.status === 'error') return snapshot.error;
  if (snapshot.status === 'blocked') return '재생이 차단되었습니다. 다시 재생하거나 영상 안의 재생 버튼을 누르세요.';
  if (snapshot.status === 'loading' || snapshot.status === 'buffering' || (snapshot.desiredPlaying && snapshot.status !== 'playing')) return 'YouTube 연결 / 재생 준비 중...';
  if (snapshot.status === 'playing') return '재생 중';
  return '재생 버튼을 누르세요.';
}
