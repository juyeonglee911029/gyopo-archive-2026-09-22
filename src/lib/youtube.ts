export type YouTubeStatus = 'idle' | 'loading' | 'ready' | 'buffering' | 'playing' | 'paused' | 'ended' | 'blocked' | 'error';
export type YouTubeSnapshot = {
  ready: boolean; state: number; status: YouTubeStatus; desiredPlaying: boolean;
  currentTime: number; volume: number; muted: boolean; error: string;
};
export const IDLE_YOUTUBE: YouTubeSnapshot = {
  ready: false, state: -1, status: 'idle', desiredPlaying: false, currentTime: 0, volume: 70, muted: false, error: '',
};
export interface YouTubePlayer {
  playVideo(): void; pauseVideo(): void; mute(): void; unMute(): void;
  setVolume(volume: number): void; cueVideoById(id: string): void; loadVideoById(id: string): void;
  getPlayerState(): number; getCurrentTime(): number; getVolume(): number; isMuted(): boolean;
  getVideoData(): { video_id?: string }; destroy(): void;
}
export type YouTubeOptions = {
  videoId: string; width: string; height: string;
  playerVars: Record<string, string | number>;
  events: {
    onReady(event: { target: YouTubePlayer }): void;
    onStateChange(event: { data: number }): void;
    onError(event: { data: number }): void;
    onAutoplayBlocked(): void;
  };
};
export type YouTubeSDK = { Player: new (host: HTMLElement, options: YouTubeOptions) => YouTubePlayer };
type YouTubeWindow = Window & { YT?: YouTubeSDK; onYouTubeIframeAPIReady?: () => void };
let sdkPromise: Promise<YouTubeSDK> | undefined;

export function loadYouTube(): Promise<YouTubeSDK> {
  const win = window as YouTubeWindow;
  if (win.YT?.Player) return Promise.resolve(win.YT);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<YouTubeSDK>((resolve, reject) => {
    const previous = win.onYouTubeIframeAPIReady;
    const script = document.createElement('script');
    const cleanup = () => {
      clearTimeout(timeout);
      script.onerror = null;
      if (win.onYouTubeIframeAPIReady === ready) win.onYouTubeIframeAPIReady = previous;
    };
    const fail = () => { cleanup(); script.remove(); reject(new Error('YouTube SDK could not load.')); };
    const ready = () => {
      if (!win.YT?.Player) { fail(); return; }
      cleanup();
      resolve(win.YT);
      previous?.();
    };
    const timeout = setTimeout(fail, 15000);
    win.onYouTubeIframeAPIReady = ready;
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = fail;
    document.head.appendChild(script);
  }).catch((error: unknown) => { sdkPromise = undefined; throw error; });
  return sdkPromise;
}

export type YouTubeController = ReturnType<typeof createYouTubeController>;
export function createYouTubeController(host: HTMLElement, options: {
  videoId: string; volume: number; muted?: boolean; onChange(snapshot: YouTubeSnapshot): void; onEnded?(): void;
  canPlay?(): boolean;
  origin?: string; loadSDK?: () => Promise<YouTubeSDK>;
}) {
  let snapshot = { ...IDLE_YOUTUBE, volume: options.volume, muted: options.muted ?? options.volume === 0 };
  let player: YouTubePlayer | undefined;
  let videoId = options.videoId;
  let loadedId = '';
  let volume = options.volume;
  let muted = snapshot.muted;
  let generation = 0;
  let disposed = false;
  let hasPlayed = false;
  let cancelPendingStart = false;
  let awaitingPlay = false;
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  const publish = (patch: Partial<YouTubeSnapshot>) => {
    if (disposed) return;
    snapshot = { ...snapshot, ...patch };
    options.onChange(snapshot);
  };
  const stopInstance = () => {
    generation++;
    clearTimeout(readyTimer);
    clearInterval(poll);
    const old = player;
    player = undefined;
    try { old?.destroy(); } catch { /* A removed iframe may already be destroyed. */ }
    host.replaceChildren();
  };
  const fail = (error: string, status: 'error' | 'blocked' = 'error') => {
    clearTimeout(readyTimer);
    awaitingPlay = false;
    publish({ status, error, desiredPlaying: false });
  };
  const readAudio = () => {
    if (snapshot.ready && player) {
      const actualVolume = player.getVolume();
      if (Number.isFinite(actualVolume)) volume = Math.min(100, Math.max(0, actualVolume));
      muted = player.isMuted();
    }
    return { volume, muted };
  };
  const applyVolume = () => {
    player?.setVolume(volume);
    if (muted || volume === 0) player?.mute(); else player?.unMute();
  };
  const apply = () => {
    if (!snapshot.ready || !player || disposed) return;
    try {
      if (snapshot.desiredPlaying && options.canPlay?.() === false) {
        cancelPendingStart = true;
        awaitingPlay = false;
        publish({ desiredPlaying: false });
      }
      if (!snapshot.desiredPlaying) {
        player.pauseVideo();
        if (loadedId !== videoId) { loadedId = videoId; player.cueVideoById(videoId); }
        return;
      }
      if (loadedId !== videoId) { loadedId = videoId; player.loadVideoById(videoId); }
      else player.playVideo();
    } catch { fail('YouTube playback failed. Please retry.'); }
  };
  const acceptState = (state: number) => {
    if (!player || !snapshot.ready || disposed) return;
    const actualId = player.getVideoData().video_id;
    if (actualId && actualId !== videoId) return;
    // A state event cannot distinguish native Play from a stale start acknowledgement.
    // After programmatic cancellation require explicit app Play/Retry; native-only
    // pause/play and blocked-play recovery remain available when not cancelled.
    if ((state === 1 || state === 3) && (cancelPendingStart || options.canPlay?.() === false)) {
      cancelPendingStart = true;
      awaitingPlay = false;
      publish({ desiredPlaying: false, ...readAudio() });
      player.pauseVideo();
      return;
    }
    const ended = state === 0 && hasPlayed && snapshot.desiredPlaying;
    if (state === 1) { hasPlayed = true; awaitingPlay = false; }
    const status = state === 1 ? 'playing' : state === 2 ? 'paused' : state === 3 ? 'buffering' : state === 0 ? 'ended' : 'ready';
    const failed = snapshot.status === 'error' || snapshot.status === 'blocked';
    const paused = state === 2 && !awaitingPlay && (snapshot.state === 1 || (snapshot.state === 3 && hasPlayed));
    publish({ state, currentTime: player.getCurrentTime(), ...readAudio(),
      ...(!failed || state === 1 ? { status, error: '' } : {}),
      ...(state === 1 ? { desiredPlaying: true } : paused || ended ? { desiredPlaying: false } : {}),
    });
    if (ended) { hasPlayed = false; options.onEnded?.(); }
  };
  const start = () => {
    readAudio();
    stopInstance();
    const ticket = generation;
    const current = () => !disposed && ticket === generation;
    loadedId = '';
    hasPlayed = false;
    publish({ ready: false, state: -1, status: 'loading', currentTime: 0, error: '' });
    void (options.loadSDK || loadYouTube)().then((sdk) => {
      if (!current()) return;
      const mount = host.ownerDocument.createElement('div');
      host.replaceChildren(mount);
      readyTimer = setTimeout(() => {
        if (!current()) return;
        stopInstance();
        fail('YouTube player did not become ready. Please retry.');
      }, 15000);
      player = new sdk.Player(mount, {
        videoId, width: '100%', height: '100%',
        playerVars: { autoplay: 0, controls: 1, playsinline: 1, rel: 0, origin: options.origin ?? window.location.origin },
        events: {
          onReady: ({ target }) => {
            if (!current()) return;
            player = target;
            clearTimeout(readyTimer);
            applyVolume();
            publish({ ready: true, status: 'ready', volume, muted });
            apply();
            if (!current()) return;
            poll = setInterval(() => {
              if (!current() || !player) return;
              const state = player.getPlayerState();
              if (state !== snapshot.state || ((state === 1 || state === 3) && (cancelPendingStart || options.canPlay?.() === false)) || (state === 1 && snapshot.desiredPlaying && snapshot.status !== 'playing')) acceptState(state);
              else publish({ currentTime: player.getCurrentTime(), ...readAudio() });
            }, 500);
          },
          onStateChange: ({ data }) => { if (current()) acceptState(data); },
          onError: ({ data }) => { if (current()) fail(`YouTube error ${data}. Retry or open this video on YouTube.`); },
          onAutoplayBlocked: () => { if (current()) fail('Playback was blocked. Press Play again or use the video controls.', 'blocked'); },
        },
      });
    }).catch(() => { if (current()) fail('YouTube could not load. Check your connection and retry.'); });
  };
  const controller = {
    getSnapshot: () => snapshot,
    setPlaying(next: boolean) {
      if (disposed) return;
      if (next && options.canPlay?.() === false) next = false;
      const retry = next && snapshot.status === 'error';
      cancelPendingStart = !next;
      awaitingPlay = next;
      publish({ desiredPlaying: next, ...(next ? { error: '', status: snapshot.ready ? 'buffering' : 'loading' } : {}) });
      if (retry) start();
      else apply();
    },
    setTrack(next: string) {
      if (disposed || next === videoId) return;
      videoId = next;
      hasPlayed = false;
      awaitingPlay = snapshot.desiredPlaying;
      publish({ currentTime: 0, state: -1 });
      apply();
    },
    setVolume(next: number, preserveMute = false) {
      if (disposed) return;
      if (preserveMute) readAudio();
      volume = Math.min(100, Math.max(0, next));
      muted = volume === 0 || (preserveMute && muted);
      publish({ volume, muted });
      if (snapshot.ready && player) applyVolume();
    },
    setMuted(next: boolean) {
      if (disposed) return;
      readAudio();
      muted = next;
      publish({ volume, muted });
      if (snapshot.ready && player) { if (next) player.mute(); else player.unMute(); }
    },
    retry() {
      if (disposed) return;
      if (options.canPlay?.() === false) { this.setPlaying(false); return; }
      const restart = !snapshot.ready || snapshot.status === 'error';
      cancelPendingStart = false;
      awaitingPlay = true;
      publish({ desiredPlaying: true, error: '', status: 'loading' });
      if (restart) start(); else apply();
    },
    destroy() { if (!disposed) { disposed = true; stopInstance(); } },
  };
  start();
  return controller;
}
