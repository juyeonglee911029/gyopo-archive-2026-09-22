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
  getVideoData(): { video_id?: string }; getIframe(): HTMLIFrameElement; destroy(): void;
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
type AudioIntent<T> = { value: T; expiresAt: number; waitForChange: boolean };
export function createYouTubeController(host: HTMLElement, options: {
  videoId: string; volume: number; muted?: boolean; onChange(snapshot: YouTubeSnapshot): void; onEnded?(): void;
  background?: boolean; canPlay?(): boolean;
  origin?: string; loadSDK?: () => Promise<YouTubeSDK>;
}) {
  let snapshot = { ...IDLE_YOUTUBE, volume: options.volume, muted: options.muted ?? options.volume === 0 };
  let player: YouTubePlayer | undefined;
  let videoId = options.videoId;
  let loadedId = '';
  let volume = options.volume;
  let muted = snapshot.muted;
  let observedVolume: number | undefined;
  let observedMuted: boolean | undefined;
  let pendingVolume: AudioIntent<number> | undefined;
  let pendingMuted: AudioIntent<boolean> | undefined;
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
  const audioIntent = <T>(value: T, observed?: T, pending?: AudioIntent<T>): AudioIntent<T> => ({
    value, expiresAt: Date.now() + 2000,
    // Returning to a stale getter value is not acknowledgement of a superseding command.
    waitForChange: Boolean(pending && (pending.waitForChange || (pending.value !== value && observed === value))),
  });
  const acknowledgeAudio = <T>(observed: T, pending?: AudioIntent<T>) => {
    if (!pending) return;
    if (observed !== pending.value) pending.waitForChange = false;
    if ((!pending.waitForChange && observed === pending.value) || Date.now() >= pending.expiresAt) return;
    return pending;
  };
  const readAudio = () => {
    if (snapshot.ready && player) {
      try {
        const actualVolume = player.getVolume();
        if (Number.isFinite(actualVolume)) {
          observedVolume = Math.min(100, Math.max(0, actualVolume));
          pendingVolume = acknowledgeAudio(observedVolume, pendingVolume);
          if (!pendingVolume) volume = observedVolume;
        }
        observedMuted = player.isMuted();
        pendingMuted = acknowledgeAudio(observedMuted, pendingMuted);
        if (!pendingMuted) muted = observedMuted;
      } catch { /* Keep the last audio settings if the iframe has already detached. */ }
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
      if (!player || disposed) return;
      if (!snapshot.desiredPlaying) {
        player.pauseVideo();
        if (loadedId !== videoId) { loadedId = videoId; player.cueVideoById(videoId); }
        return;
      }
      if (loadedId !== videoId) { loadedId = videoId; player.loadVideoById(videoId); }
      else player.playVideo();
    } catch { fail('YouTube playback failed. Press Play to try again.'); }
  };
  const acceptState = (state: number) => {
    if (!player || !snapshot.ready || disposed) return;
    const actualId = player.getVideoData().video_id;
    if (actualId && actualId !== videoId) return;
    // A state event cannot distinguish native Play from a stale start acknowledgement.
    // After programmatic cancellation require explicit app Play; native-only
    // pause/play and blocked-play recovery remain available when not cancelled.
    if ((state === 1 || state === 3) && (cancelPendingStart || options.canPlay?.() === false)) {
      cancelPendingStart = true;
      awaitingPlay = false;
      player.pauseVideo();
      publish({ desiredPlaying: false, ...(snapshot.status !== 'error' && snapshot.status !== 'blocked' ? { status: 'paused' } : {}), ...readAudio() });
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
        fail('YouTube player did not become ready. Press Play to try again.');
      }, 15000);
      const created = new sdk.Player(mount, {
        videoId, width: '100%', height: '100%',
        playerVars: { autoplay: 0, controls: options.background ? 0 : 1, disablekb: options.background ? 1 : 0, playsinline: 1, rel: 0, origin: options.origin ?? window.location.origin },
        events: {
          onReady: ({ target }) => {
            if (!current()) return;
            player = target;
            clearTimeout(readyTimer);
            if (options.background) target.getIframe().tabIndex = -1;
            pendingVolume = audioIntent(volume);
            pendingMuted = audioIntent(muted);
            applyVolume();
            publish({ ready: true, status: 'ready', volume, muted });
            if (!current()) return;
            readAudio();
            apply();
            if (!current()) return;
            clearInterval(poll);
            poll = setInterval(() => {
              if (!current() || !player) return;
              const state = player.getPlayerState();
              if (state !== snapshot.state || ((state === 1 || state === 3) && (cancelPendingStart || options.canPlay?.() === false)) || (state === 1 && snapshot.desiredPlaying && snapshot.status !== 'playing')) acceptState(state);
              else publish({ currentTime: player.getCurrentTime(), ...readAudio() });
            }, 500);
          },
          onStateChange: ({ data }) => { if (current()) acceptState(data); },
          onError: ({ data }) => { if (current()) fail(`YouTube error ${data}. Press Play to try again or choose another track.`); },
          onAutoplayBlocked: () => { if (current()) fail('Playback was blocked. Press Play again or use the video controls.', 'blocked'); },
        },
      });
      // onReady may synchronously trigger owner cleanup before the constructor returns.
      if (!current()) { try { created.destroy(); } catch { /* Already destroyed. */ } return; }
      player = created;
    }).catch(() => { if (current()) fail('YouTube could not load. Check your connection and press Play.'); });
  };
  const controller = {
    getSnapshot: () => ({ ...snapshot, ...readAudio() }),
    setPlaying(next: boolean) {
      if (disposed) return;
      if (next && options.canPlay?.() === false) next = false;
      const retry = next && snapshot.status === 'error';
      cancelPendingStart = !next;
      awaitingPlay = next;
      publish({ desiredPlaying: next, ...(next ? { error: '', status: snapshot.ready ? 'buffering' : 'loading' } : snapshot.ready && snapshot.status !== 'error' && snapshot.status !== 'blocked' ? { status: 'paused' } : {}) });
      if (disposed) return;
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
      if (disposed || !Number.isFinite(next)) return;
      readAudio();
      volume = Math.min(100, Math.max(0, next));
      muted = volume === 0 || (preserveMute && muted);
      pendingVolume = audioIntent(volume, observedVolume, pendingVolume);
      pendingMuted = audioIntent(muted, observedMuted, pendingMuted);
      if (snapshot.ready && player) applyVolume();
      publish(readAudio());
    },
    setMuted(next: boolean) {
      if (disposed) return;
      readAudio();
      muted = next;
      pendingMuted = audioIntent(muted, observedMuted, pendingMuted);
      if (snapshot.ready && player) { if (next) player.mute(); else player.unMute(); }
      publish(readAudio());
    },
    destroy() { if (!disposed) { disposed = true; stopInstance(); } },
  };
  start();
  return controller;
}
