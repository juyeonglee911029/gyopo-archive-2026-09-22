'use client';

import { useLayoutEffect, useRef } from 'react';
import { musicPlayback, useMusicPlayback } from '@/lib/musicPlayback';

export default function SiteBackgroundVideo() {
  const playerHostRef = useRef<HTMLDivElement>(null);
  const playback = useMusicPlayback();

  useLayoutEffect(() => {
    if (!playerHostRef.current) return;
    musicPlayback.setRoute('top');
    return musicPlayback.mount('top', playerHostRef.current);
  }, []);

  return (
    <div className="site-background-video" aria-hidden="true">
      <div id="music-background-player" ref={playerHostRef}
        style={{ position: 'absolute', inset: 0, width: '100vw', height: '100dvh', minWidth: 200, minHeight: 200 }}
        data-player-status={playback.status} data-player-state={playback.state} data-player-time={playback.currentTime}
        data-player-owner={playback.owner} data-player-muted={playback.muted} data-player-volume={playback.volume} />
      <div className="site-background-video-shade" />
    </div>
  );
}
