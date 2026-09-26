'use client';

import { useSyncExternalStore } from 'react';
import { MUSIC_TRACKS, type MusicSyncDetail, type MusicTrack } from './music.ts';
import { createYouTubeController, IDLE_YOUTUBE, type YouTubeController, type YouTubeSnapshot } from './youtube.ts';

type Owner = 'top' | 'video' | null;
export type MusicPlaybackSnapshot = YouTubeSnapshot & {
  track: MusicTrack; owner: Owner; mounted: boolean;
};
const INITIAL: MusicPlaybackSnapshot = { ...IDLE_YOUTUBE, track: MUSIC_TRACKS[0], owner: null, mounted: false };

// Header and page controls share intent and feedback, not competing iframe event buses.
export function createMusicPlayback(makeController = createYouTubeController) {
  let snapshot = INITIAL;
  let controller: YouTubeController | undefined;
  let mountId = 0;
  let volumeRestored = false;
  let favorites: MusicTrack[] = [];
  let favoriteLoop = false;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<MusicPlaybackSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };
  const detach = () => {
    const audio = controller?.getSnapshot() || snapshot;
    mountId++;
    const old = controller;
    controller = undefined;
    old?.destroy();
    return { ...IDLE_YOUTUBE, volume: audio.volume, muted: audio.muted, mounted: false };
  };
  const play = () => {
    if (!controller || !snapshot.owner) return;
    controller.setPlaying(true);
  };
  const select = (track: MusicTrack, start = true) => {
    update({ track });
    controller?.setTrack(track.videoId, start);
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
      if (owner === snapshot.owner) return;
      update({ ...detach(), owner });
    },
    mount(owner: Exclude<Owner, null>, host: HTMLElement) {
      if (owner !== snapshot.owner) return () => {};
      const idle = detach();
      const ticket = mountId;
      update(idle);
      if (ticket !== mountId) return () => {};
      const nextController = makeController(host, {
        videoId: snapshot.track.videoId, volume: snapshot.volume, muted: snapshot.muted,
        background: owner === 'top',
        canPlay() {
          if (ticket !== mountId || snapshot.owner !== owner) return false;
          if (typeof document !== 'undefined' && document.hidden) return false;
          if (typeof window === 'undefined') return true;
          if (!host.isConnected) return false;
          const rect = host.getBoundingClientRect();
          const viewport = window.visualViewport;
          const left = viewport?.offsetLeft || 0;
          const top = viewport?.offsetTop || 0;
          return rect.width >= 200 && rect.height >= 200 && rect.bottom > top && rect.right > left && rect.top < top + (viewport?.height || window.innerHeight) && rect.left < left + (viewport?.width || window.innerWidth);
        },
        onChange(next) { if (ticket === mountId) update(next); },
        onEnded() { if (ticket === mountId) relative(1); },
      });
      // A synchronous subscriber can navigate while the controller is being created.
      if (ticket !== mountId) { nextController.destroy(); return () => {}; }
      controller = nextController;
      update({ mounted: true });
      return () => {
        if (ticket !== mountId) return;
        update(detach());
      };
    },
    play,
    pause() { update({ desiredPlaying: false }); controller?.setPlaying(false); },
    toggle() {
      if (snapshot.desiredPlaying) this.pause();
      else play();
    },
    select, relative,
    restoreVolume(volume: number) {
      if (volumeRestored) return;
      volumeRestored = true;
      this.setVolume(volume, true);
    },
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
