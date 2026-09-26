'use client';

import { useEffect, useState } from 'react';
import { MUSIC_TRACKS, type MusicSyncDetail } from '@/lib/music';

export default function SiteBackgroundVideo() {
  const [videoId, setVideoId] = useState(MUSIC_TRACKS[0].videoId);

  useEffect(() => {
    const syncTrack = (event: Event) => {
      const detail = (event as CustomEvent<MusicSyncDetail>).detail;
      if (detail?.player === 'video') return;
      const next = detail?.track?.videoId;
      if (!next) return;
      setVideoId(next);
    };
    window.addEventListener('gyopo-music-local', syncTrack);
    window.addEventListener('gyopo-music-sync', syncTrack);
    return () => {
      window.removeEventListener('gyopo-music-local', syncTrack);
      window.removeEventListener('gyopo-music-sync', syncTrack);
    };
  }, []);

  return (
    <div className="site-background-video" aria-hidden="true">
       {/* Decorative only: no API, audio commands, or interactive controls. */}
       <iframe
          key={videoId}
          tabIndex={-1}
          style={{ pointerEvents: 'none' }}
          title="GYOPO background music video"
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${videoId}&playsinline=1&rel=0&disablekb=1`}
         allow="autoplay; encrypted-media"
       />
      <div className="site-background-video-shade" />
    </div>
  );
}
